"""The Production asset picker (deck-prod-picker; deck-graphics part 5, slices P1-P5): the deck reads a Production .clan directly, lists
every asset from metadata, picks by rule, and pulls only the picked pictures.

    python3 -m deck.prod_picker FILE.clan|BUNDLE.zip --stages DIR      P1: production_inventory.json (offline, nothing downloaded)

``run_deck --production FILE`` (a .clan, or the export zip) runs the rest during a build:

1. Inventory (free, offline). ``shared/data.yaml`` is read as contract 3 with the importer's own checks (deck.from_production): one row per
   asset with its label, role (key visual, size, storyboard frame, or what else it is), Format set / size / frame ids, channel, aspect,
   formatRef, origin, inferred rights, brief link, version, status, sha256, and reach (embedded | https | zip | s3_only | idb_only | none).
   Only https hosts are kept, never a location's path: provider URLs are capability links.
2. Pick from metadata. images.bind_production runs on a production.json built from the metadata alone, so every rule is today's (key
   visual -> cover and idea; the typed size whose channel and aspect match -> each execution; the picked storyboard frame -> film) and
   every check too (mock refused, forged rights ignored, aspect tolerance, protect boxes, Rights to supply never placed). Where the rules
   rank several candidates equal the newest wins and the others are reported as a tie; ``--production-agent`` (off by default) asks Claude
   (stages MODELS['production_pick'], Sonnet, the deck's own brief_llm route; never Gemini) to break it on metadata rows only. An answer
   outside the eligible keys is discarded. It cannot change rights, status or eligibility: only keys of the same rank are offered.
3. Pull only the picked, in source order: the .clan's ``human/assets/`` -> https (only with ``--production-fetch``, off by default) -> the
   export zip's ``assets/``. The fetch takes https only, a host on policy/production_fetch.yaml (EMPTY by default: every fetch refuses and
   says where to add the hosts) that is also in the document's own locations, a public address (pinned for the connection), no redirect
   off the host, no cookie or auth header, image/* only, 25 MB a file, 300 MB and 40 files a run, 20 s. Every byte must hash to the
   document's sha256 and pass the deck's own picture check (images.inspect_file). A picked picture no source yields is
   ``not reachable — re-save or export in Production`` in production.json, report.json and its slot (empty, never generated), with why.
4. Optional look (``--production-look``, off by default): local Ollama first, else Claude Haiku (8 pictures a run at most), plus the
   calm-zone measure for the cover and idea (images.text_zone, pixels, free). It only FLAGS (status look, with the reason): it never
   places, removes or re-picks anything.

Writes into the stages folder what deck.from_production writes (production.json, assets/<sha256>.<ext>) plus production_inventory.json.
Nothing here spends money unless --production-agent or --production-look is given, and their cost is reported as a stage.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import io
import ipaddress
import json
import re
import socket
import ssl
import sys
import tempfile
import time
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import yaml

from . import from_production as fp
from . import images, spec

HERE = Path(__file__).resolve().parent
POLICY = HERE / spec.PRODUCTION_FETCH_POLICY
NOT_REACHABLE = spec.PRODUCTION_NOT_REACHABLE
LABEL_MAX = 80
FILE_MAX = images.MAX_BYTES        # 25 MB, the deck's own picture cap
RUN_MAX = 300_000_000
FILES_MAX = 40
TIMEOUT_S = 20.0
REDIRECTS_MAX = 3
LOOK_MAX = 8
ROLE = {"master": "key_visual", "size": "size", "frame": "storyboard_frame"}
CARD_WORD = "Production"


class Source:
    """A Production document opened for the picker: a .clan read directly (``kind`` clan), or the export zip (``kind`` zip: its inner .clan,
    and its ``assets/`` as the last source). Refuses what deck.from_production refuses (other contracts, other apps, no project id)."""

    def __init__(self, path):
        path = Path(path)
        if not path.is_file():
            raise fp.FromProductionError(f"{path} is not a file")
        suffix = path.suffix.lower()
        if suffix == ".clan":
            if path.stat().st_size > fp.CLAN_MAX:
                raise fp.FromProductionError(f"{path.name} is over the {fp.CLAN_MAX // 1_000_000} MB cap")
            raw = path.read_bytes()
            try:
                inner = zipfile.ZipFile(io.BytesIO(raw))
            except zipfile.BadZipFile:
                raise fp.FromProductionError(f"{path.name} is not a CLAN file (not a zip)") from None
            if len(inner.namelist()) > fp.MEMBERS_MAX:
                raise fp.FromProductionError(f"{path.name} has too many members")
            self.outer, self.inner, self.name, self.kind = None, inner, path.name, "clan"
        elif suffix == ".zip":
            self.outer, self.inner, self.name, raw = fp.open_bundle(path)
            self.kind = "zip"
        else:
            raise fp.FromProductionError(f"{path.name}: give a Production .clan or its export zip (napkin-<title>-production.zip)")
        self.clan_sha256 = hashlib.sha256(raw).hexdigest()
        del raw
        self.doc = fp.read_document(self.inner)
        self.fixture = any((z.comment or b"").strip() == b"napkin-fixture" for z in (self.outer, self.inner) if z is not None)
        self.embedded = {n for n in self.inner.namelist() if re.fullmatch(r"human/assets/[0-9a-f]{64}\.(png|jpg|webp)", n)}
        self.zipped = {n for n in (self.outer.namelist() if self.outer else []) if re.fullmatch(r"assets/[0-9a-f]{64}\.(png|jpg|webp)", n)}

    def member(self, where: str, hx: str, mime: str) -> bytes | None:
        """The bytes of one picture from the .clan (``embedded``) or the zip (``zip``) by its exact expected name, or None."""
        ext = fp.IMAGE_MIMES.get(mime)
        if not ext or not re.fullmatch(r"[0-9a-f]{64}", hx):
            return None
        name = f"{'human/' if where == 'embedded' else ''}assets/{hx}.{ext}"
        z = self.inner if where == "embedded" else self.outer
        if name not in (self.embedded if where == "embedded" else self.zipped):
            return None
        return fp._read(z, name, fp.ASSET_MAX)


# ------------------------------------------------------------------------------------------------ P1 inventory

def clean(text, n: int = LABEL_MAX) -> str:
    """A label as the inventory keeps it: control characters out, spaces folded, at most ``n`` characters."""
    s = "".join(" " if unicodedata.category(ch).startswith("C") else ch for ch in str(text or ""))
    return re.sub(r"\s+", " ", s).strip()[:n]


def https_hosts(locations) -> list:
    """The https hosts of an asset's locations, lower case. Never the path or query: a provider URL is a capability link."""
    out = set()
    for loc in locations or []:
        if isinstance(loc, str) and loc.startswith("https://"):
            h = urlsplit(loc).hostname
            if h:
                out.add(h.lower())
    return sorted(out)


def reach_of(src: Source, asset: dict, hx: str) -> tuple:
    """``(reach, sources)``: where this asset's bytes can come from, in source order (embedded, https, zip), and the first of them; with none,
    s3_only (Production's storage, behind a sign-in), idb_only (only in a browser) or none."""
    ext = fp.IMAGE_MIMES.get(asset.get("mime"))
    locs = [str(x) for x in asset.get("locations") or []]
    sources = []
    if ext and f"human/assets/{hx}.{ext}" in src.embedded:
        sources.append("embedded")
    if any(x.startswith("https://") for x in locs):
        sources.append("https")
    if ext and f"assets/{hx}.{ext}" in src.zipped:
        sources.append("zip")
    if sources:
        return sources[0], sources
    if any(x.startswith("s3://") for x in locs):
        return "s3_only", []
    if any(x.startswith("idb://") for x in locs):
        return "idb_only", []
    return "none", []


REACH_NOTE = {"idb_only": "only in a browser (idb): export from Production to carry this picture",
              "s3_only": "on Production's storage, behind a sign-in: export from Production to carry this picture",
              "none": "no location in the document: export from Production to carry this picture"}


def _shot_numbers(doc: dict) -> dict:
    """shot id -> its number within its storyboard (shots in rank order; an end card is 'end card')."""
    out, by_sb = {}, {}
    for sid, sh in (doc.get("shots") or {}).items():
        by_sb.setdefault(sh.get("storyboard_id"), []).append((str(sh.get("rank") or ""), sid))
    for rows in by_sb.values():
        n = 0
        for _, sid in sorted(rows):
            if ((doc.get("shots") or {}).get(sid) or {}).get("kind") == "end_card":
                out[sid] = "end card"
            else:
                n += 1
                out[sid] = f"shot {n}"
    return out


def label_of(doc: dict, role: str, c: dict, asset: dict) -> str:
    """A person's name for one candidate, built from metadata only (pack, format, storyboard title, shot number), capped and cleaned."""
    if role == "master":
        pack = (((doc.get("format_sets") or {}).get(c.get("set")) or {}).get("pack") or {}).get("pack_id")
        return clean(f"Key visual · {pack or 'Format set'} v{c.get('version') or 1}")
    if role == "size":
        fmt = (c.get("format") or {}).get("format_id") or "size"
        a = c.get("aspect") or {}
        return clean(f"{fmt} · {a.get('w')}:{a.get('h')}" + (f" · {c.get('status')}" if c.get("status") not in (None, "ready") else ""))
    if role == "frame":
        title = ((doc.get("storyboards") or {}).get(c.get("storyboard")) or {}).get("title") or "Storyboard"
        return clean(f"{title} · {_shot_numbers(doc).get(c.get('shot'), 'shot')}")
    return clean(asset.get("kind") or "asset")


def _asset_of(doc: dict, key: str) -> str | None:
    """The asset hash a refused entity key points at (a set's master, a size, a frame)."""
    if key.endswith("#master"):
        fs = (doc.get("format_sets") or {}).get(key.split("#")[0]) or {}
        m = fs.get("master") or {}
        return m.get("asset") or ((doc.get("frames") or {}).get(m.get("id")) or {}).get("asset")
    for coll in ("sizes", "frames"):
        e = (doc.get(coll) or {}).get(key)
        if e:
            return e.get("asset")
    return None


def _uses(doc: dict) -> dict:
    """asset hash -> (role, entity, why it is not offered) for every entity that holds an asset the offer does not carry."""
    out = {}
    for sid, s in sorted((doc.get("sizes") or {}).items()):
        for k in (s.get("asset"), (s.get("full") or {}).get("asset"), s.get("plate")):
            if k:
                why = ("a video size: not drawn on a slide" if s.get("media") == "video" else
                       "being made in Production" if s.get("status") == "making" else
                       "not made yet" if not s.get("status") else "a working file of a size (its plate or full-size copy)")
                out.setdefault(k, ("size", sid, why))
    for fid, f in sorted((doc.get("frames") or {}).items()):
        if f.get("asset"):
            why = ("an alternate frame: only the frame picked for its shot is offered" if f.get("shot_id") else
                   "a canvas picture's version, not a storyboard frame")
            out.setdefault(f["asset"], ("storyboard_frame" if f.get("shot_id") else "canvas_picture", fid, why))
    for rid, r in sorted((doc.get("renders") or {}).items()):
        if r.get("asset"):
            out.setdefault(r["asset"], ("render", rid, "the rendered ad (video): not drawn on a slide"))
    return out


def _row(src: Source, key: str, role: str, c: dict, asset: dict, eligible: bool, reason: str | None = None) -> dict:
    doc = src.doc
    hx = fp._hex(asset.get("sha256") or c.get("sha") or "")
    reach, sources = reach_of(src, asset, hx) if asset else ("none", [])
    brief = fp._brief_of(doc, c.get("set") or c.get("storyboard") or "") if (c.get("set") or c.get("storyboard")) else None
    a = c.get("aspect") or ({"w": asset.get("w"), "h": asset.get("h")} if asset.get("w") and asset.get("h") else None)
    row = {"key": key, "entity": c.get("entity") or key.split("#")[0], "role": ROLE.get(role, role),
           "label": label_of(doc, role, c, asset) if role in ROLE else clean(f"{ROLE.get(role, role).replace('_', ' ')} ({hx[:8]})"),
           "set": c.get("set"), "size": c.get("entity") if role == "size" else None, "frame": c.get("entity") if role == "frame" else None,
           "shot": c.get("shot"), "channel": c.get("channel"), "aspect": f"{a['w']}:{a['h']}" if a else None,
           "format": c.get("format") or None, "origin": asset.get("origin") or c.get("origin"), "rights": c.get("rights"),
           "rights_why": c.get("rights_why"), "brief": brief, "version": c.get("version"), "status": c.get("status"), "sha256": hx or None,
           "mime": asset.get("mime"), "kind": asset.get("kind"), "width": asset.get("w"), "height": asset.get("h"),
           "reach": reach, "sources": sources, "hosts": https_hosts(asset.get("locations")), "eligible": eligible}
    if reason:
        row["reason"] = clean(reason, 300)
    if reach in REACH_NOTE and eligible:
        row["note"] = REACH_NOTE[reach]
    return {k: v for k, v in row.items() if v not in (None, "", {}, [])} | {"eligible": eligible, "reach": reach}


class Plan:
    """The inventory of one Source and the importer's candidates (plan_offer), from metadata alone: nothing is read but shared/data.yaml."""

    def __init__(self, src: Source):
        self.src, doc = src, src.doc
        self.cands, self.refused, self.not_carried = fp.plan_offer(doc, fp.load_packs())
        self.by_key = {c["key"]: c for c in self.cands}
        assets = doc.get("assets") or {}
        rows, seen = [], set()
        for c in self.cands:
            rows.append(_row(src, c["key"], c["role"], c, assets.get(c["sha"]) or {}, True, c.get("reason")))
            seen.add(c["sha"])
        for r in self.refused:
            sha = _asset_of(doc, r["entity"])
            role = "master" if r["entity"].endswith("#master") else "size" if r["entity"].startswith("size_") else "frame"
            rows.append(_row(src, r["entity"], role, {"entity": r["entity"].split("#")[0]}, assets.get(sha) or {}, False, r["reason"]))
            seen.add(sha)
        uses = _uses(doc)
        for sha in sorted(assets):
            if sha in seen:
                continue
            role, ent, why = uses.get(sha, ("other", None, "not used by a key visual, size or storyboard frame"))
            a = assets[sha]
            if a.get("kind") != "image" and role == "other":
                why = f"a {a.get('kind')}: not drawn on a slide"
            rows.append(_row(src, f"asset:{fp._hex(sha)[:12]}", role, {"entity": ent or f"asset:{fp._hex(sha)[:12]}"}, a, False, why))
        self.rows = rows

    def inventory(self, at: str | None = None) -> dict:
        doc = self.src.doc
        by_reach = {}
        for r in self.rows:
            by_reach[r["reach"]] = by_reach.get(r["reach"], 0) + 1
        return {"stage": "production_inventory",
                "produced_by": "deck.prod_picker (a Production .clan read directly: metadata only, nothing downloaded, no model call)",
                "contract_version": fp.CONTRACT, "app": fp.APP_ID,
                "project": {"id": doc["project"]["id"], "title": clean(doc["project"].get("title"), 120)},
                "source": {"kind": self.src.kind, "name": clean(self.src.name, 120), "clan_sha256": self.src.clan_sha256},
                "taken_at": at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "counts": {"rows": len(self.rows), "eligible": sum(1 for r in self.rows if r["eligible"]), "by_reach": dict(sorted(by_reach.items()))},
                "not_carried": self.not_carried, "rows": self.rows, **({"fixture": True} if self.src.fixture else {})}

    def metadata_prod(self) -> dict:
        """A production.json built from metadata alone (every candidate, sizes from the document, no file read): what the picker binds."""
        assets = self.src.doc.get("assets") or {}
        items = {}
        for c in self.cands:
            a = assets[c["sha"]]
            w = a.get("w") or (c.get("aspect") or {}).get("w") or 1
            h = a.get("h") or (c.get("aspect") or {}).get("h") or 1
            items[c["key"]] = fp.make_item(c, {"ext": fp.IMAGE_MIMES[a["mime"]], "mime": a["mime"], "width": int(w), "height": int(h),
                                               "bytes": int(a.get("bytes") or 0)}, self.src.clan_sha256)
        return {"stage": "production", "contract_version": fp.CONTRACT, "app": fp.APP_ID,
                "project": {"id": self.src.doc["project"]["id"], "title": clean(self.src.doc["project"].get("title"), 120)},
                "bundle": {"clan": self.src.name, "clan_sha256": self.src.clan_sha256},
                "format_sets": fp.format_set_rows(self.src.doc, items), "items": items, "offer_sha256": fp.offer_sha(items)}


# ------------------------------------------------------------------------------------------------ P2 the rule pick

def _same_rank(meta: dict, a: str, b: str) -> bool:
    ia, ib = meta["items"][a], meta["items"][b]
    return (ia.get("rights") == "reference_only") == (ib.get("rights") == "reference_only") and ia.get("status") == ib.get("status")


def pool_of(meta: dict, slide: dict, aspect: str, role: str, brief_doc, mset) -> list:
    """The keys the rules rank equal for one slot (the chosen one among them), from images.master_pool / size_pool. Frames: no tie."""
    if role == "master":
        sets, _ = images.master_pool(meta, brief_doc)
        return sorted(meta["format_sets"][f]["master"] for f in sets)
    if role == "size":
        ch = images.execution_channel(spec.picture_of(slide)[1])
        return images.size_pool(meta, ch, aspect, mset)[0] if ch else []
    return []


def collect_picks(deck: dict, meta: dict, got: dict, brief_doc) -> list:
    """Every slot bind_production filled from the metadata: ``[{slide, slot, key, aspect, role, label, placeable, tie?}]``. A tie lists the
    keys of the same rank (rights and status) the rule passed over for the newest."""
    mset = (got.get("master") or {}).get("set")
    picks = []
    for sid in deck["order"]:
        s = deck["slides"][sid]
        for slot, v in (s.get("slots") or {}).items():
            im = v.get("image") if isinstance(v, dict) else None
            fr = (im or {}).get("from") or {}
            if fr.get("kind") != "production" or not fr.get("key") or fr["key"] not in meta["items"]:
                continue
            key = fr["key"]
            it = meta["items"][key]
            pk = {"slide": sid, "slot": slot, "key": key, "aspect": im["aspect"], "role": it["role"], "placeable": it.get("rights") != "reference_only"}
            alts = [k for k in pool_of(meta, s, im["aspect"], it["role"], brief_doc, mset) if k != key and _same_rank(meta, k, key)]
            if alts:
                pk["tie"] = {"alternatives": alts, "rule": "the newest of equal rank"}
            pk["eligible"] = eligible_of(meta, s, im["aspect"], it["role"], brief_doc, mset, key)
            picks.append(pk)
    return picks


def eligible_of(meta: dict, slide: dict, aspect: str, role: str, brief_doc, mset, key: str) -> list:
    """Every candidate a person may swap this slot to (P6), best first, the rule's pick among them: any Format set's key visual for the cover
    and the idea; every size that fits an execution (images.size_fits: channel, aspect tolerance, protect boxes, not stale); every picked
    storyboard frame for a film. Rights are not a test here: a candidate waiting for its rights is offered and, if chosen, held as today."""
    items = meta["items"]
    if role == "master":
        first, _ = images.master_pool(meta, brief_doc)
        sets = meta.get("format_sets") or {}
        order = sorted(first, reverse=True) + sorted((f for f in sets if f not in first and sets[f].get("master") in items), reverse=True)
        out = [sets[f]["master"] for f in order if sets[f].get("master") in items]
    elif role == "size":
        ch = images.execution_channel(spec.picture_of(slide)[1])
        out = images.size_fits(meta, ch, aspect, mset) if ch else []
    else:
        frames = [(str(it.get("storyboard") or ""), str(it.get("shot_rank") or ""), k) for k, it in items.items()
                  if it.get("role") == "frame" and it.get("shot_kind", "shot") == "shot"]
        out = [k for _, _, k in sorted(frames, key=lambda r: (tuple(-ord(c) for c in r[0]), r[1]))]
    return ([key] if key not in out else []) + out


CHOICES_FILE = "production_choices.json"
SLOT_KEY = re.compile(r"s[0-9]{2,3}\.[a-z][a-z0-9_]{1,23}")


def load_choices(stages: Path, clan_sha256: str | None = None) -> dict:
    """The person's recorded swaps (P6), ``{"sNN.slot": {key, by, at}}``, from ``<stages>/production_choices.json``; {} when none, and {}
    when they were recorded against another Production file than ``clan_sha256`` (a new file starts with no swaps)."""
    try:
        raw = json.loads((Path(stages) / CHOICES_FILE).read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict) or (clan_sha256 is not None and raw.get("clan_sha256") != clan_sha256):
        return {}
    return clean_choices(raw.get("choices"))


def clean_choices(raw) -> dict:
    """Well-formed swaps only: a slot ``sNN.slot`` and a key; ``by`` and ``at`` kept as given (a person's, from the app's review.production)."""
    out = {}
    for sk, c in (raw or {}).items() if isinstance(raw, dict) else ():
        c = c if isinstance(c, dict) else {"key": c}
        k = str(c.get("key") or "")
        if SLOT_KEY.fullmatch(str(sk)) and re.fullmatch(r"[A-Za-z0-9_#]{6,80}", k):
            out[str(sk)] = {"key": k, "by": clean(c.get("by") or "a person", 60), "at": clean(c.get("at") or "", 40)}
    return out


def choices_from_review(review) -> dict:
    """``review.production`` as the app writes it ({slide: {slot: {key, by, at}}}) as ``{"sNN.slot": {key, by, at}}``."""
    rp = review.get("production") if isinstance(review, dict) else None
    rp = rp if isinstance(rp, dict) else {}
    flat = {f"{sid}.{slot}": c for sid, slots in rp.items() if isinstance(slots, dict) for slot, c in slots.items()}
    return clean_choices(flat)


def tie_groups(picks: list) -> list:
    """One decision per distinct tie (the key visual's cover and idea share one): ``[{id, eligible, rule_pick, slots}]``."""
    groups = {}
    for pk in picks:
        if not pk.get("tie") or not pk["placeable"]:
            continue
        eligible = sorted({pk["key"], *pk["tie"]["alternatives"]})
        g = groups.setdefault((pk["role"], tuple(eligible)), {"id": f"t{len(groups) + 1}", "eligible": eligible, "rule_pick": pk["key"], "slots": []})
        g["slots"].append(f"{pk['slide']}.{pk['slot']}")
    return list(groups.values())


# ------------------------------------------------------------------------------------------------ P4 the optional tie-break

TIE_SYSTEM = ("You break a tie between campaign pictures a deck's rules rank equal. You see metadata rows only, never the pictures. Pick the "
              "row that best suits the slides named. Answer with one JSON object and nothing else: {\"choice\": \"<one key from eligible>\", "
              "\"why\": \"<under 20 words>\"}. The choice must be one of the eligible keys exactly as written.")


def meta_row(meta: dict, key: str, labels: dict) -> dict:
    """What the tie-break sees of one candidate: metadata, no pixels, no location, no brief text."""
    it = meta["items"][key]
    a = it.get("aspect") or {}
    row = {"key": key, "label": labels.get(key) or "", "role": ROLE.get(it["role"], it["role"]), "channel": it.get("channel"),
           "format": (it.get("format") or {}).get("format_id"), "aspect": f"{a.get('w')}:{a.get('h')}" if a else None,
           "version": it.get("version"), "status": it.get("status"), "origin": it.get("origin"), "set": it.get("set")}
    return {k: v for k, v in row.items() if v not in (None, "")}


def _claude_call(user: str, system: str) -> tuple:
    from . import stages   # noqa: PLC0415  (brief_llm, the deck's own Claude route: only on the flag)
    return stages._call("production_pick", user, system)


def tie_break(groups: list, deck: dict, meta: dict, labels: dict, call=None) -> tuple:
    """``(decisions, usage)``: one Claude call per tie group (``call(user, system) -> (obj, usage)``; tests inject it). A choice outside the
    group's eligible keys is discarded and the rule's pick stands; so does a failed call. Usage sums every call."""
    call = call or _claude_call
    decisions, usage = [], {"model": None, "prompt_tokens": 0, "completion_tokens": 0, "calls": 0, "usd": 0.0}
    for g in groups:
        titles = sorted({clean(deck["slides"][s.split(".")[0]].get("title"), 120) for s in g["slots"]})
        user = json.dumps({"slides": titles, "eligible": [meta_row(meta, k, labels) for k in g["eligible"]]}, ensure_ascii=False)
        d = {"tie": g["id"], "slots": g["slots"], "rule_pick": g["rule_pick"], "eligible": g["eligible"], "choice": g["rule_pick"], "by": "rule"}
        try:
            obj, u = call(user, TIE_SYSTEM)
        except Exception as e:   # noqa: BLE001  (no Claude, a refusal, a transport error: the rule's pick stands)
            d["note"] = clean(f"tie-break unavailable ({type(e).__name__}): the rule's pick stands", 200)
            decisions.append(d)
            continue
        for k in ("prompt_tokens", "completion_tokens", "calls"):
            usage[k] += int((u or {}).get(k) or 0)
        usage["usd"] = round(usage["usd"] + float((u or {}).get("usd") or 0), 4)
        usage["model"] = (u or {}).get("model") or usage["model"]
        choice = str((obj or {}).get("choice") or "") if isinstance(obj, dict) else ""
        if choice in g["eligible"]:
            d.update(choice=choice, by="claude", why=clean((obj or {}).get("why"), 160))
        else:
            d["note"] = "the answer named no eligible key: discarded, the rule's pick stands"
        decisions.append(d)
    return decisions, usage


# ------------------------------------------------------------------------------------------------ P3 the guarded fetch

def fetch_policy(path: Path | None = None) -> dict:
    """``{hosts}`` from policy/production_fetch.yaml: exact lower-case host names. Empty by default (Q12)."""
    p = Path(path or POLICY)
    raw = (yaml.safe_load(p.read_text()) if p.is_file() else None) or {}
    hosts = [str(h).strip().lower() for h in raw.get("hosts") or [] if re.fullmatch(r"[a-z0-9.-]+", str(h).strip().lower())]
    return {"hosts": sorted(set(hosts)), "file": str(p)}


def refusal_empty(policy_file: str) -> str:
    return (f"fetch refused: no host is on the Production fetch allow-list. Add the provider's output hosts to {Path(policy_file).name} "
            f"(engine/deck/policy, `hosts:`); it is empty by default until they are named (Q12, Shrey)")


def is_public(ip: str) -> bool:
    """True for a global unicast address: never loopback, private, link-local (169.254.169.254 included), shared, reserved or multicast.
    IPv6 forms that carry an IPv4 address are judged by it (IPv4-mapped, 6to4, Teredo) or refused outright (NAT64 64:ff9b::/96 and
    64:ff9b:1::/48, which a gateway turns into any IPv4 address, and the deprecated IPv4-compatible ::a.b.c.d)."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if isinstance(a, ipaddress.IPv6Address):
        if a in NAT64 or a in NAT64_LOCAL or int(a) >> 32 == 0:   # NAT64, and ::/96 (IPv4-compatible, ::1 and :: among them)
            return False
        inner = a.ipv4_mapped or a.sixtofour or (a.teredo[1] if a.teredo else None)
        if inner is not None:
            return is_public(str(inner))
    return a.is_global and not a.is_multicast


NAT64 = ipaddress.ip_network("64:ff9b::/96")
NAT64_LOCAL = ipaddress.ip_network("64:ff9b:1::/48")


def _resolve(host: str) -> list:
    return sorted({ai[4][0] for ai in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})


class _Pinned(http.client.HTTPSConnection):
    """An HTTPS connection to the address that was checked (no second lookup), with the certificate checked against the host name."""

    def __init__(self, host: str, ip: str, timeout: float):
        super().__init__(host, 443, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, 443), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _open(host: str, ip: str, path: str, timeout: float):
    """GET over the pinned connection: no redirect is followed here (http.client never does), no cookie, no auth header, no proxy. The
    response carries ``settimeout`` (its socket's), so the stream can shrink the socket timeout to the time the fetch has left."""
    conn = _Pinned(host, ip, timeout)
    conn.request("GET", path, headers={"User-Agent": "napkin-deck-picker", "Accept": "image/*", "Accept-Encoding": "identity", "Connection": "close"})
    sock = conn.sock
    resp = conn.getresponse()
    resp.settimeout = sock.settimeout
    return resp


class Fetcher:
    """Downloads one picked picture at a time under the run's caps. ``opener(host, ip, path, timeout)`` and ``resolver(host)`` are injected in
    tests (no socket). Every reason and log line names the host only, never a location's path or query."""

    def __init__(self, hosts, policy_file: str = str(POLICY), opener=None, resolver=None, timeout: float = TIMEOUT_S,
                 file_max: int = FILE_MAX, run_max: int = RUN_MAX, files_max: int = FILES_MAX, clock=None):
        self.clock = clock or time.monotonic
        self.hosts = {str(h).lower() for h in hosts or ()}
        self.policy_file = policy_file
        self.opener, self.resolver = opener or _open, resolver or _resolve
        self.timeout, self.file_max, self.run_max, self.files_max = timeout, file_max, run_max, files_max
        self.files, self.bytes, self.log = 0, 0, []

    @property
    def refused(self) -> str | None:
        return refusal_empty(self.policy_file) if not self.hosts else None

    def _done(self, host, why=None):
        self.log.append({"host": host or "?", "outcome": why or "ok"})
        return why

    def get(self, url: str, want_hex: str, dest: Path, doc_hosts) -> tuple:
        """``(path, None)`` with the verified bytes at ``dest``, or ``(None, reason)``."""
        if self.refused:
            return None, self._done(None, self.refused)
        doc_hosts = {h.lower() for h in doc_hosts or ()}
        hops, t0 = 0, self.clock()   # one deadline for the whole fetch: redirects, headers and body together
        while True:
            u = urlsplit(url)
            h = (u.hostname or "").lower()
            if u.scheme != "https" or not h:
                return None, self._done(h, "not an https:// location")
            if u.username or u.password or u.port not in (None, 443):
                return None, self._done(h, f"{h}: credentials or a port in the location are refused")
            if h not in self.hosts:
                return None, self._done(h, f"{h} is not on the fetch allow-list ({Path(self.policy_file).name})")
            if h not in doc_hosts:
                return None, self._done(h, f"{h} is not among the document's own locations")
            if self.files >= self.files_max:
                return None, self._done(h, f"the run's {self.files_max}-file fetch cap is reached")
            try:
                ips = list(self.resolver(h))
            except OSError:
                return None, self._done(h, f"{h} does not resolve")
            if not ips or not all(is_public(ip) for ip in ips):
                return None, self._done(h, f"{h} resolves to a private or reserved address: refused")
            path = (u.path or "/") + (f"?{u.query}" if u.query else "")
            left = self.timeout - (self.clock() - t0)
            if left <= 0:
                return None, self._done(h, f"{h}: timed out")
            self.files += 1   # an attempt counts toward the run's file cap, whatever comes of it
            try:
                resp = self.opener(h, ips[0], path, left)
            except (socket.timeout, TimeoutError):
                return None, self._done(h, f"{h}: timed out")
            except (OSError, ssl.SSLError, http.client.HTTPException) as e:
                return None, self._done(h, f"{h}: connection failed ({type(e).__name__})")
            try:
                st = int(getattr(resp, "status", 0) or 0)
                if st in (301, 302, 303, 307, 308):
                    nxt = urljoin(url, resp.getheader("Location") or "")
                    n = urlsplit(nxt)
                    if n.scheme != "https" or (n.hostname or "").lower() != h:
                        return None, self._done(h, f"{h}: redirected to another host or scheme: refused")
                    hops += 1
                    if hops > REDIRECTS_MAX:
                        return None, self._done(h, f"{h}: more than {REDIRECTS_MAX} redirects")
                    url = nxt
                    continue
                if st in (401, 403, 404, 410):
                    return None, self._done(h, f"{h}: expired or gone (HTTP {st})")
                if st != 200:
                    return None, self._done(h, f"{h}: HTTP {st}")
                ctype = (resp.getheader("Content-Type") or "").split(";")[0].strip().lower()
                if not ctype.startswith("image/"):
                    return None, self._done(h, f"{h}: not a picture (content-type {clean(ctype, 40) or 'none'})")
                clen = str(resp.getheader("Content-Length") or "")
                if clen.isdigit() and int(clen) > self.file_max:
                    return None, self._done(h, f"{h}: {int(clen) // 1_000_000} MB, over the {self.file_max // 1_000_000} MB cap")
                if clen.isdigit() and self.bytes + int(clen) > self.run_max:
                    return None, self._done(h, f"{h}: the run's {self.run_max // 1_000_000} MB fetch cap would be passed")
                return self._stream(resp, h, want_hex, Path(dest), t0)
            except (socket.timeout, TimeoutError):
                return None, self._done(h, f"{h}: timed out")
            except (OSError, http.client.HTTPException) as e:
                return None, self._done(h, f"{h}: connection failed ({type(e).__name__})")
            finally:
                try:
                    resp.close()
                except Exception:   # noqa: BLE001
                    pass

    def _stream(self, resp, h: str, want_hex: str, dest: Path, t0: float) -> tuple:
        part = dest.with_name(dest.name + ".part")
        digest, n = hashlib.sha256(), 0
        try:
            with open(part, "wb") as f:
                read = getattr(resp, "read1", None) or resp.read   # read1: whatever has arrived, never a wait for a full 64 KiB
                settimeout = getattr(resp, "settimeout", None)
                while True:
                    left = self.timeout - (self.clock() - t0)
                    if left <= 0:   # the total deadline: a host dripping a byte at a time cannot hold the build past it
                        return None, self._done(h, f"{h}: timed out")
                    if settimeout:
                        settimeout(left)   # the socket waits no longer than the fetch has left
                    chunk = read(65536)
                    if not chunk:
                        break
                    n += len(chunk)
                    if n > self.file_max:
                        return None, self._done(h, f"{h}: over the {self.file_max // 1_000_000} MB cap")
                    if self.bytes + n > self.run_max:
                        return None, self._done(h, f"{h}: the run's {self.run_max // 1_000_000} MB fetch cap would be passed")
                    digest.update(chunk)
                    f.write(chunk)
            if digest.hexdigest() != want_hex:
                return None, self._done(h, f"{h}: the bytes do not hash to the document's sha256 (changed or replaced): refused")
            part.replace(dest)
        finally:
            part.unlink(missing_ok=True)
            self.bytes += n   # what came down counts toward the run's byte cap, kept or not
        self._done(h)
        return dest, None


# ------------------------------------------------------------------------------------------------ source order

def obtain(src: Source, meta: dict, keys: list, work: Path, fetcher: Fetcher | None) -> tuple:
    """Bytes for each picked key, in source order: embedded human/assets/ -> https (only with a fetcher) -> the export zip. Each must hash to
    its sha256 and pass images.inspect_file. Returns ``(files {hex: path}, infos {hex: info}, where {key: source}, unreachable {key: why})``."""
    assets = src.doc.get("assets") or {}
    files, infos, where, unreachable, total = {}, {}, {}, {}, 0
    by_hex = {}
    for key in keys:
        it = meta["items"][key]
        hx, mime = it["sha256"], it["mime"]
        if hx in by_hex:
            if by_hex[hx][0] == "ok":
                where[key] = by_hex[hx][1]
            else:
                unreachable[key] = by_hex[hx][1]
            continue
        a = assets.get("sha256:" + hx) or assets.get(hx) or {}
        dest = Path(work) / f"{hx}.{fp.IMAGE_MIMES[mime]}"
        tried, got = [], None
        for how in ("embedded", "https", "zip"):
            if how == "https":
                urls = [x for x in a.get("locations") or [] if isinstance(x, str) and x.startswith("https://")]
                if not urls:
                    continue
                if fetcher is None:
                    tried.append(f"https ({', '.join(https_hosts(urls))}): not fetched, --production-fetch is off")
                    continue
                for url in urls:
                    p, why = fetcher.get(url, hx, dest, https_hosts(a.get("locations")))
                    if p:
                        got = how
                        break
                    tried.append(why)
            else:
                try:
                    raw = src.member(how, hx, mime)
                except fp.FromProductionError as e:
                    tried.append(f"{how}: {e}")
                    continue
                if raw is None:
                    continue
                if hashlib.sha256(raw).hexdigest() != hx:
                    tried.append(f"{how}: its bytes do not hash to its sha256 (changed or damaged)")
                    continue
                dest.write_bytes(raw)
                del raw
                got = how
            if got:
                break
        if got:
            try:
                info = images.inspect_file(dest)
            except images.ImageError as e:
                dest.unlink(missing_ok=True)
                got, tried = None, tried + [str(e)[:200]]
            else:
                if total + info["bytes"] > fp.ASSETS_TOTAL_MAX:
                    dest.unlink(missing_ok=True)
                    got, tried = None, tried + [f"the pulled pictures together pass the {fp.ASSETS_TOTAL_MAX // 1_000_000} MB cap"]
                else:
                    total += info["bytes"]
                    files[hx], infos[hx], where[key] = dest, info, got
                    by_hex[hx] = ("ok", got)
                    continue
        if not tried:
            reach, _ = reach_of(src, a, hx)
            tried.append(REACH_NOTE.get(reach, "no source holds it"))
        unreachable[key] = clean("; ".join(tried), 260)
        by_hex[hx] = ("no", unreachable[key])
    return files, infos, where, unreachable


# ------------------------------------------------------------------------------------------------ P5 the optional look

LOOK_Q = ("This picture was picked for a presentation slide titled {title!r}, as {what}. Answer with JSON only: {{\"subject_fits\": true or false, "
          "\"subject\": \"<what it shows, under 8 words>\", \"logos_or_brands\": [strings], \"readable_text\": [strings]}}. Use empty lists when "
          "there are none.")
LOOK_KEYS = ("subject_fits", "logos_or_brands", "readable_text")


def _shrink(path: Path) -> bytes:
    """The picture as a JPEG at most 1024 px on its long side: what the look check sends (smaller, and free of metadata)."""
    from PIL import Image, ImageOps   # noqa: PLC0415
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((1024, 1024))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return buf.getvalue()


def _parse_look(text: str):
    try:
        got = json.loads(text)
    except (ValueError, TypeError):
        return "unreadable"
    return got if isinstance(got, dict) and all(k in got for k in LOOK_KEYS) else "unreadable"


def ollama_look(jpeg: bytes, question: str, post=None):
    """The local route (visuals.guard's URL and model): a dict, ``"unreadable"``, or None when Ollama is not reachable."""
    import urllib.error   # noqa: PLC0415
    from visuals import guard   # noqa: PLC0415
    body = {"model": guard.MODEL, "stream": False, "think": False, "format": "json",
            "messages": [{"role": "user", "content": question, "images": [base64.b64encode(jpeg).decode()]}]}
    try:
        reply = (post or guard._post)(guard.OLLAMA, body)
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
        return None
    except ValueError:
        return "unreadable"
    return _parse_look(((reply or {}).get("message") or {}).get("content") or "")


def haiku_look(jpeg: bytes, question: str) -> tuple:
    """Claude Haiku through brief_llm's Anthropic client: ``(answer, usage)``; ``(None, None)`` when there is no key or the call fails. Never Gemini."""
    try:
        import brief_llm as L   # noqa: PLC0415
        client = L._anthropic_client()
        msg = client.messages.create(model=L.HAIKU, max_tokens=400, messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(jpeg).decode()}},
            {"type": "text", "text": question}]}])
    except Exception:   # noqa: BLE001  (no key, no SDK, a transport error: not checked)
        return None, None
    text = next((b.text for b in msg.content if getattr(b, "type", None) == "text"), "")
    u = getattr(msg, "usage", None)
    usage = {"model": L.HAIKU, "prompt_tokens": getattr(u, "input_tokens", 0) or 0, "completion_tokens": getattr(u, "output_tokens", 0) or 0, "calls": 1}
    return _parse_look(text), usage


def look_check(prod: dict, files: dict, picks: list, deck: dict, ollama=None, haiku=None, zone=None) -> tuple:
    """Flag (never place, remove or re-pick) the pulled pictures: ``(rows, usage)``. Local Ollama first, else Claude Haiku; at most LOOK_MAX
    pictures. A storyboard frame or key visual showing a brand or readable text is flagged (a typed size's own branding and copy are expected),
    as is a subject that may not suit its slide, an unreadable answer, and, for the cover and the idea, no calm zone for the words
    (images.text_zone, from pixels). A flag sets the item's status to look with the reason."""
    ollama, haiku, zone = ollama or ollama_look, haiku or haiku_look, zone or images.text_zone
    usage = {"model": None, "prompt_tokens": 0, "completion_tokens": 0, "calls": 0}
    rows, seen = [], []
    fin = lambda pk: pk.get("final") or pk["key"]   # noqa: E731  (a person's or the tie-break's choice, else the rule's)
    for pk in picks:
        if fin(pk) in prod["items"] and fin(pk) not in seen:
            seen.append(fin(pk))
    for key in seen[:LOOK_MAX]:
        it = prod["items"][key]
        path = files[it["sha256"]]
        mine = [pk for pk in picks if fin(pk) == key]
        title = "; ".join(sorted({clean(deck["slides"][pk["slide"]].get("title"), 80) for pk in mine}))
        what = {"master": "the campaign's key visual", "size": "a channel size of the campaign", "frame": "a storyboard frame"}[it["role"]]
        q = LOOK_Q.format(title=title, what=what)
        jpeg = _shrink(path)
        ans, by = ollama(jpeg, q), "ollama"
        if ans is None:
            ans, u = haiku(jpeg, q)
            by = "claude-haiku"
            if u:
                usage["model"] = u.get("model")
                for k in ("prompt_tokens", "completion_tokens", "calls"):
                    usage[k] += int(u.get(k) or 0)
        flags = []
        if ans is None:
            by = "not checked"
        elif ans == "unreadable":
            flags.append("the vision check's answer was not readable: needs a person")
        else:
            if ans.get("subject_fits") is False:
                flags.append(f"the subject may not suit the slide (it shows: {clean(ans.get('subject'), 60) or 'unknown'})")
            if it["role"] != "size":
                brands = [clean(x, 40) for x in ans.get("logos_or_brands") or [] if clean(x, 40)]
                words = [clean(x, 40) for x in ans.get("readable_text") or [] if clean(x, 40)]
                if brands:
                    flags.append("a brand may show: " + ", ".join(brands[:4]))
                if words:
                    flags.append("readable text: " + ", ".join(words[:4]))
        if any(spec.picture_of(deck["slides"][pk["slide"]])[0] in ("title", "idea") for pk in mine):
            try:
                z = zone(path, focal=it.get("focal"))
            except Exception:   # noqa: BLE001
                z = {}
            if z.get("none"):
                flags.append("no calm zone for the words over it")
        row = {"key": key, "by": by, "flags": flags}
        if flags:
            it["status"] = "look"
            it["reason"] = clean("Vision check: " + "; ".join(flags), 300)
        rows.append(row)
    if len(seen) > LOOK_MAX:
        rows.append({"note": f"{len(seen) - LOOK_MAX} picture(s) past the {LOOK_MAX}-picture cap were not checked"})
    return rows, usage


# ------------------------------------------------------------------------------------------------ the whole pull, in run_deck

def _tile(key: str, meta: dict, labels: dict, rows_by: dict, where: dict) -> dict:
    """One candidate as the app's tile shows it: label, role, reach (where it was pulled from, else where it could come from), rights, status."""
    it, row = meta["items"].get(key) or {}, rows_by.get(key) or {}
    reach = where.get(key) or row.get("reach") or "none"
    t = {"key": key, "label": labels.get(key, key), "role": ROLE.get(it.get("role"), it.get("role")), "reach": reach,
         "rights": it.get("rights"), "status": it.get("status")}
    a = it.get("aspect") or {}
    if a:
        t["aspect"] = f"{a.get('w')}:{a.get('h')}"
    return t


def _pick_row(pk: dict, meta: dict, labels: dict, rows_by: dict, where: dict) -> dict:
    key = pk["final"]
    frm = where.get(key) or ("rights" if not pk["placeable"] else "not reachable")
    row = {"slot": f"{pk['slide']}.{pk['slot']}", "key": key, "label": labels.get(key, ""), "role": ROLE[meta["items"][key]["role"]], "from": frm,
           "by": pk["by"], "rights": meta["items"][key].get("rights"), "status": meta["items"][key].get("status"),
           "eligible": [_tile(k, meta, labels, rows_by, where) for k in pk["eligible"][:12]]}
    if pk.get("choice_note"):
        row["note"] = pk["choice_note"]
    return row


def place(deck: dict, meta: dict, prod: dict, picks: list, chosen: dict, unreachable: dict, names) -> dict:
    """Put the pulled items in the slots bind_production filled from the metadata: a pulled pick gets its checked file's record (and the
    tie-break's choice where it made one); a pick no source yielded becomes an empty slot whose reason says it is not reachable (never
    planned for generation: images.add_empty_slots and the image plan leave a production slot alone). Rights-pending and no-fit slots stay as
    bind_production wrote them. Returns ``{placed, held: [{slide, slot, message}], not_reachable: [...]}``."""
    run = str((prod.get("bundle") or {}).get("clan_sha256") or "")[:12]
    placed, held, nr = 0, [], []
    stale = set()
    for pk in picks:
        s = deck["slides"][pk["slide"]]
        key = pk.get("final") or chosen.get(f"{pk['slide']}.{pk['slot']}", pk["key"])
        if not pk["placeable"]:
            if key != pk["key"]:   # a person's swap to a picture waiting for its rights: held, with why, as bind_production holds one
                stale.add(((s["slots"].get(pk["slot"]) or {}).get("image") or {}).get("asset"))
                s["slots"][pk["slot"]] = images.production_slot(meta, key, pk["aspect"], names)[0]
                held.append({"slide": pk["slide"], "slot": pk["slot"], "message": s["slots"][pk["slot"]]["image"]["reason"]})
            continue
        stale.add(((s["slots"].get(pk["slot"]) or {}).get("image") or {}).get("asset"))
        if key in prod["items"]:
            val, asset = images.production_slot(prod, key, pk["aspect"], names)
            if asset:
                deck.setdefault("assets", {})[val["image"]["asset"]] = asset
                placed += 1
            s["slots"][pk["slot"]] = val
            continue
        why = unreachable.get(key) or "no source holds it"
        reason = f"{NOT_REACHABLE}: {why}"[:images.REASON_MAX]
        s["slots"][pk["slot"]] = {"kind": "image", "image": {"kind": "frame" if meta["items"][key]["role"] == "frame" else "illustration",
                                                            "status": "empty", "aspect": pk["aspect"], "basis": "creative", "reason": reason,
                                                            "from": {"kind": "production", "key": key, **({"run": run} if run else {})}}}
        held.append({"slide": pk["slide"], "slot": pk["slot"], "message": reason})
        nr.append({"slot": f"{pk['slide']}.{pk['slot']}", "key": key, "reason": reason})
    used = {im.get("asset") for _, _, im in images.image_slots(deck)}
    for aid in stale - used - {None}:   # the metadata's record of a picture that was not pulled, or that a tie-break replaced
        (deck.get("assets") or {}).pop(aid, None)
    return {"placed": placed, "held": held, "not_reachable": nr}


def run(deck: dict, src: Source, stages: Path, pictures: str = "creative_cover", names=(), brief_doc: str | None = None, *, fetch: bool = False,
        agent: bool = False, look: bool = False, tie_call=None, fetcher: Fetcher | None = None, look_fns: dict | None = None,
        at: str | None = None, choices: dict | None = None) -> dict:
    """The picker in a build (run_deck --production FILE). Binds the metadata, breaks ties (``agent``), pulls the picks (``fetch`` opens the
    https source), looks (``look``), places, and writes production_inventory.json, production.json and assets/ into ``stages``. Returns what
    run_deck reports: ``{placed, held, kept, master, picker, card, usage: {agent, look}}``."""
    stages = Path(stages)
    stages.mkdir(parents=True, exist_ok=True)
    at = at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    plan = Plan(src)
    meta = plan.metadata_prod()
    labels = {r["key"]: r["label"] for r in plan.rows}
    got = images.bind_production(deck, meta, pictures, names, brief_doc)
    picks = collect_picks(deck, meta, got, brief_doc)
    groups = tie_groups(picks)
    decisions, agent_usage = ([], None)
    if agent and groups:
        decisions, agent_usage = tie_break(groups, deck, meta, labels, tie_call)
    else:
        decisions = [{"tie": g["id"], "slots": g["slots"], "rule_pick": g["rule_pick"], "eligible": g["eligible"], "choice": g["rule_pick"],
                      "by": "rule"} for g in groups]
    chosen = {s: d["choice"] for d in decisions for s in d["slots"]}
    by_claude = {s for d in decisions if d["by"] == "claude" for s in d["slots"]}
    stored = load_choices(stages, src.clan_sha256)   # swaps recorded against another file are dropped with it
    stored.update(clean_choices(choices))   # a newer swap for a slot replaces the recorded one
    keys = []
    for pk in picks:
        sk = f"{pk['slide']}.{pk['slot']}"
        c = stored.get(sk)
        pk["by"] = "claude" if sk in by_claude else "rule"
        if c and c["key"] in pk["eligible"]:   # a person's swap wins over the rule and the tie-break, among the slot's own candidates only
            chosen[sk], pk["by"] = c["key"], "person"
        elif c:
            pk["choice_note"] = clean(f"your swap to {labels.get(c['key'], c['key'])} does not fit this slot now: the rule's pick is used", 200)
        pk["final"] = chosen.get(sk, pk["key"])
        pk["placeable"] = meta["items"][pk["final"]].get("rights") != "reference_only"
        if pk["placeable"] and pk["final"] not in keys:
            keys.append(pk["final"])
    swapped = {(pk["slide"], pk["slot"]) for pk in picks if pk["final"] != pk["key"]}
    live = {f"{pk['slide']}.{pk['slot']}": pk["eligible"] for pk in picks}
    kept = {sk: c for sk, c in stored.items() if c["key"] in live.get(sk, ())}   # a swap that is no longer a candidate is not kept
    (stages / CHOICES_FILE).write_text(json.dumps({"stage": "production_choices", "produced_by": "a person's swaps in the Production picker (P6)",
                                                    "clan_sha256": src.clan_sha256, "choices": kept}, indent=1, ensure_ascii=False))
    pol = fetch_policy()
    if fetch and fetcher is None:
        fetcher = Fetcher(pol["hosts"], pol["file"])
    if not fetch:
        fetcher = None
    with tempfile.TemporaryDirectory(dir=stages, prefix=".production-") as td:
        files, infos, where, unreachable = obtain(src, meta, keys, Path(td), fetcher)
        items = {}
        for k in keys:
            if k in where:
                it = fp.make_item(plan.by_key[k], infos[meta["items"][k]["sha256"]], src.clan_sha256)
                it["source"] = where[k]
                items[k] = it
        prod = {"stage": "production", "produced_by": "deck.prod_picker (a Production .clan read directly; only the picked pictures pulled; no model call "
                                                      "unless --production-agent or --production-look)",
                "contract_version": fp.CONTRACT, "app": fp.APP_ID, "project": meta["project"],
                "bundle": {"clan": clean(src.name, 120), "clan_sha256": src.clan_sha256, "assets_from": "+".join(sorted(set(where.values()))) or "none"},
                "taken_at": at, "format_packs": fp.packs_record(), "format_sets": fp.format_set_rows(src.doc, items), "items": items,
                "offer_sha256": fp.offer_sha(items), "refused": plan.refused, "not_carried": plan.not_carried}
        warnings = fp.forged_fields(src.doc)
        if warnings:
            prod["warnings"] = warnings
        if src.fixture:
            prod["fixture"] = True
        rows_by = {r["key"]: r for r in plan.rows}
        look_rows, look_usage = ([], None)
        if look and items:
            look_rows, look_usage = look_check(prod, files, [pk for pk in picks if pk["placeable"]], deck, **(look_fns or {}))
        res = place(deck, meta, prod, picks, chosen, unreachable, names)
        held = [h for h in got["held"] if (h["slide"], h["slot"]) not in swapped] + res["held"]
        picked = len(keys)
        card = f"{CARD_WORD}: {picked} picked, {len({n['key'] for n in res['not_reachable']})} not reachable"
        supply = sum(1 for pk in picks if not pk["placeable"])
        if supply:
            card += f", {supply} waiting for rights"
        report = {"source": {"kind": src.kind, "name": clean(src.name, 120), "clan_sha256": src.clan_sha256},
                  "inventory": plan.inventory(at)["counts"], "picked": picked,
                  "picks": [_pick_row(pk, meta, labels, rows_by, where) for pk in picks],
                  "not_reachable": res["not_reachable"], "ties": decisions,
                  "tie_break": {"on": bool(agent), "model": (agent_usage or {}).get("model")},
                  "fetch": {"on": bool(fetcher), "allow_list": pol["hosts"], "allow_list_empty": not pol["hosts"],
                            "refused": fetcher.refused if fetcher else None, "log": fetcher.log if fetcher else []},
                  "look": {"on": bool(look), "rows": look_rows}, "card": card}
        prod["picker"] = {k: report[k] for k in ("source", "picks", "not_reachable", "ties", "fetch")}
        prod["not_reachable"] = res["not_reachable"]
        fp.write(prod, files, stages)
    inv = plan.inventory(at)
    pulled = {k: where[k] for k in where}
    for r in inv["rows"]:
        slots = [p["slot"] for p in report["picks"] if p["key"] == r["key"]]
        if slots:
            r["picked_for"] = slots
            r["pulled_from"] = pulled.get(r["key"]) or ("rights" if r.get("rights") == "reference_only" else "not reachable")
    (stages / "production_inventory.json").write_text(json.dumps(inv, indent=1, ensure_ascii=False))
    mp = deck["meta"].get("production") or {}
    mp.update(how="clan", offer_sha256=prod["offer_sha256"], placed=res["placed"], held=len(held), at=at)
    deck["meta"]["production"] = mp
    return {"placed": res["placed"], "held": held, "kept": got["kept"], "master": got["master"], "picker": report, "card": card,
            "usage": {"agent": agent_usage, "look": look_usage if look_usage and look_usage.get("calls") else None}}


# ------------------------------------------------------------------------------------------------ CLI (P1)

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m deck.prod_picker", description="List a Production .clan's assets from metadata (P1): no download, no model, no spend")
    ap.add_argument("source", type=Path, help="a Production .clan, or its export zip (napkin-<title>-production.zip)")
    ap.add_argument("--stages", required=True, type=Path)
    a = ap.parse_args(argv)
    try:
        plan = Plan(Source(a.source))
    except (fp.FromProductionError, yaml.YAMLError) as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    inv = plan.inventory()
    a.stages.mkdir(parents=True, exist_ok=True)
    (a.stages / "production_inventory.json").write_text(json.dumps(inv, indent=1, ensure_ascii=False))
    c = inv["counts"]
    print(f"wrote {a.stages}/production_inventory.json: {c['rows']} asset row(s), {c['eligible']} the deck could place; reach {c['by_reach']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
