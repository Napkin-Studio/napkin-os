"""Carry a Production Tool export into a Deck Maker stages folder (deck-prod-assets, slice 1). No model, no network, no spend.

    python3 -m deck.from_production BUNDLE.zip --stages DIR

BUNDLE.zip is the Production Tool's export (``napkin-<title>-production.zip``, production-tool/web/src/export.ts): ``<project>.clan``
plus ``assets/<sha256 hex>.<ext>``. It is read as a file contract, locally, by exact member names: the inner .clan's
``shared/data.yaml`` must be contract 3 of ``app: production-tool`` (production-tool/contracts/document.schema.json). Writes into
``--stages``: ``production.json`` (the frozen record and the offer list, built from an allow-list) and ``assets/<sha256>.<ext>``
(each offered picture once). ``run_deck`` reads ``production.json`` only when given ``--production``.

Fable 5.2's review fixes, as applied here:

* (4) The legacy export (``document.json``, assets never verified) is refused by name. Every picture is re-hashed and must equal its
  sha256 key; a missing or mismatched one is refused item by item, with the reason, and the rest are offered.
* (5) Images only: a video, a render, a video size or a video master is never offered (counted in ``not_carried``). The master may
  be absent: the offer then has no key visual.
* (6) Protect boxes are in the master's pixels: a size's focal point is their centre mapped through ``size.crop``; extend and
  regenerate sizes (and sizes with no crop) use the centre. A focal point and the boxes' union as fractions (``keep``) are stored,
  never pixels, so the binding can refuse a slot whose crop would cut through a box (not only lose its centre).
* (7) A size's channel comes from a pinned copy of format-packs.json (``vendor/``, with its source commit); a format not in it falls
  back to the nearest aspect.
* (8) Rights are never assumed upward. A STATED ``assets[sha].rights`` (generated, own or licensed; contract 3 item 25, set by Production
  when a provider made the picture or a person said so) is trusted; ``unknown`` is ``Rights to supply``. With none stated the origin
  decides, and only ever lowers: generated -> generated; drawn -> own; uploaded, extracted, a library ref and an edit of one ->
  reference_only, ``Rights to supply``; an ``edited`` asset whose frame chain does not reach only generated frames (no chain, or an
  ``original`` canvas picture at its root) -> reference_only. Mock output (asset origin or frame kind ``mock``) is refused, checked
  first, whatever is stated.
* (production-spinoff) The same document can arrive carried whole in a Deck document (``data.upstream.<id>``, ``carried()``), not only as
  an export: its ``finals`` (contract 3 item 26) fill slots first (see plan_offer), and its ``briefs`` feed a deck that has no brief.
* (9) production.json is written from an allow-list: no brief spine (nor its confidential parts), no decision, no thumb, no
  location, no copy line, no layer text. Only offered image assets are copied. Zip members are read by exact name with size
  caps; nothing is extracted by a member's own name (zip-bomb and path-traversal safe).
* (2) Updates are detected by ``offer_sha256``, the hash of the offered items' (entity id, asset sha256) pairs, never the ETag.

When the inner .clan carries finished pictures in ``human/assets/<hex>.<ext>`` (proposed to the Production Tool, not built there yet),
they are preferred over the zip's ``assets/``; either way every byte is hashed against its key. This module imports no provider code.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

from . import images

HERE = Path(__file__).resolve().parent
PACKS = HERE / "vendor" / "format-packs.json"
PACKS_SOURCE = HERE / "vendor" / "format-packs.source.json"
APP_ID = "ie.napkin.production-tool"
CONTRACT = "3"
#: Caps, checked on the zip's own sizes BEFORE a member is read, then again on the bytes read (a header can lie).
BUNDLE_MAX = 2_000_000_000          # the export zip on disk
MEMBERS_MAX = 6_000                 # assets are at most 5000 (schema) plus the .clan and the canvas file
CLAN_MAX = 64_000_000               # the inner .clan
DATA_MAX = 16_000_000               # its shared/data.yaml
ASSET_MAX = images.MAX_BYTES        # one picture (25 MB, the deck's own cap)
RATIO_MAX = 200                     # uncompressed over compressed: a zip bomb is refused before it is inflated
IMAGE_MIMES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
#: All verified pictures together, written to disk one by one as each passes (never all held in memory).
ASSETS_TOTAL_MAX = 1_000_000_000
ULID = r"[0-9A-HJKMNP-TV-Z]{26}"


class FromProductionError(ValueError):
    """The bundle cannot be used at all; the message says why and what to do."""


# ------------------------------------------------------------------------------------------------ the zip, by exact names

def _read(zf: zipfile.ZipFile, name: str, cap: int) -> bytes:
    """One member's bytes, by its exact name, refused over ``cap`` (by the header first, then by what is read) or past RATIO_MAX."""
    info = zf.getinfo(name)
    if info.flag_bits & 0x1:
        raise FromProductionError(f"{name} is encrypted: an export is never encrypted")
    if info.file_size > cap:
        raise FromProductionError(f"{name} is {info.file_size} bytes, over the {cap} byte cap")
    if info.compress_size and info.file_size / max(1, info.compress_size) > RATIO_MAX:
        raise FromProductionError(f"{name} inflates {info.file_size // max(1, info.compress_size)} times: refused as a zip bomb")
    with zf.open(info) as f:
        raw = f.read(cap + 1)
    if len(raw) > cap:
        raise FromProductionError(f"{name} is over the {cap} byte cap")
    return raw


def open_bundle(path: Path) -> tuple:
    """``(outer zip, inner .clan zip, clan name, clan bytes)``. Refuses the legacy export by name, a bundle with no or several .clan files
    at its top level, an oversized bundle and anything that is not a zip."""
    path = Path(path)
    if not path.is_file():
        raise FromProductionError(f"{path} is not a file")
    if path.stat().st_size > BUNDLE_MAX:
        raise FromProductionError(f"{path.name} is over {BUNDLE_MAX // 1_000_000} MB")
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise FromProductionError(f"{path.name} is not a zip: give the Production Tool's export (napkin-<title>-production.zip)") from None
    names = zf.namelist()
    if len(names) > MEMBERS_MAX:
        raise FromProductionError(f"{path.name} has {len(names)} members, over {MEMBERS_MAX}")
    clans = [n for n in names if re.fullmatch(r"[^/\\]+\.clan", n)]
    if not clans:
        if "document.json" in names:
            raise FromProductionError("this is the legacy export (document.json, made without the CLAN store; its pictures were never verified): "
                                      "refused. Export again from the Production Tool once it has loaded, so the zip holds <project>.clan")
        raise FromProductionError(f"{path.name} holds no <project>.clan at its top level: it is not a Production Tool export")
    if len(clans) > 1:
        raise FromProductionError(f"{path.name} holds {len(clans)} .clan files: an export holds one")
    raw = _read(zf, clans[0], CLAN_MAX)
    try:
        inner = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise FromProductionError(f"{clans[0]} is not a CLAN file (not a zip)") from None
    if len(inner.namelist()) > MEMBERS_MAX:
        raise FromProductionError(f"{clans[0]} has too many members")
    return zf, inner, clans[0], raw


def read_document(inner: zipfile.ZipFile) -> dict:
    """The contract-3 document: ``shared/data.yaml`` of the inner .clan, by exact name. Refuses any other contract version by name."""
    if "shared/data.yaml" not in inner.namelist():
        raise FromProductionError("the .clan has no shared/data.yaml: it is not a Production Tool document")
    doc = yaml.safe_load(_read(inner, "shared/data.yaml", DATA_MAX).decode("utf-8"))
    if not isinstance(doc, dict):
        raise FromProductionError("shared/data.yaml is not a document")
    return check_document(doc)


def check_document(doc: dict) -> dict:
    """``doc`` itself when it is a contract-3 Production document with a project id; else a FromProductionError naming why."""
    cv = str(doc.get("contract_version"))
    if cv != CONTRACT:
        raise FromProductionError(f"the document is contract {cv!r}; the deck reads only contract {CONTRACT!r}: refused")
    if doc.get("app") != "production-tool":
        raise FromProductionError(f"the document's app is {doc.get('app')!r}, not 'production-tool': refused")
    if not re.fullmatch(rf"proj_{ULID}", str((doc.get("project") or {}).get("id") or "")):
        raise FromProductionError("the document has no project id: refused")
    return doc


# ------------------------------------------------------------------------------------------------ carried whole in a Deck (production-spinoff)

def is_production_data(entry) -> bool:
    """True when a ``data.upstream`` entry is a Production project's data (contract 3's ``app: production-tool``), whatever else it holds."""
    return isinstance(entry, dict) and entry.get("app") == "production-tool"


def carried(data: dict) -> tuple | None:
    """``(source document id, document)`` of the Production project a Deck document carries under ``data.upstream`` (the first one), checked
    as contract 3 (FromProductionError when it is another contract or has no project id); None when the deck carries none."""
    for key, entry in ((data or {}).get("upstream") or {}).items():
        if is_production_data(entry):
            return str(key), check_document(entry)
    return None


#: A Production brief's spine part -> the Brief Maker data field the deck reads (inputs.CLAN_FIELDS values). donts restate mandatories as
#: prohibitions and format is not a brief field: neither is carried.
SPINE_FIELDS = {"insight": "insight", "proposition": "single_minded_proposition", "audience": "audience", "tone": "tone_and_world",
                "feel": "desired_response", "mandatories": "mandatories"}


def brief_data(doc: dict) -> tuple | None:
    """``(brief id, title, Brief Maker data)`` of the newest brief a Production project carries (``briefs``, a frozen spine), shaped the way
    ``inputs.brief_from_data`` reads a brief; None when it carries none or its spine is empty. The parts the brief marked Confidential are
    named in ``confidential_fields`` so the deck's picture step never sends them to a picture model."""
    briefs = doc.get("briefs") or {}
    for bid in sorted(briefs, reverse=True):   # ULIDs sort by the time they were made
        spine = (briefs[bid] or {}).get("spine") or {}
        data = {SPINE_FIELDS[k]: v for k, v in spine.items() if k in SPINE_FIELDS and v}
        if data:
            conf = [SPINE_FIELDS[c] for c in (briefs[bid].get("confidential") or []) if SPINE_FIELDS.get(c) in data]
            return bid, str(briefs[bid].get("title") or ""), {**data, **({"confidential_fields": conf} if conf else {})}
    return None


def _hex(sha: str) -> str:
    return str(sha or "").removeprefix("sha256:")


# ------------------------------------------------------------------------------------------------ channels (fix 7)

def load_packs() -> dict:
    """format id -> {pack_id, channel, kind, ratio, w, h} from the pinned copy, and the copy's own record."""
    packs = json.loads(PACKS.read_text())
    out = {}
    for p in packs.get("packs") or []:
        for f in p.get("formats") or []:
            out.setdefault(f["id"], {"pack_id": p["id"], "channel": f.get("channel"), "kind": f.get("kind"), "ratio": f.get("ratio")})
    return out


def packs_record() -> dict:
    src = json.loads(PACKS_SOURCE.read_text())
    return {"version": json.loads(PACKS.read_text()).get("version"), "commit": src["commit"], "sha256": src["sha256"]}


def size_channel(size: dict, packs: dict) -> tuple:
    """``(channel, by)``: the format's channel from the pinned packs, or ``(None, "nearest_aspect")`` for a format they do not hold
    (a client's own pack, or a newer format): the binding then matches it by aspect alone."""
    fid = ((size.get("format") or {}).get("format_id")) or ""
    f = packs.get(fid)
    if f and f.get("channel"):
        return f["channel"], "format_packs"
    return None, "nearest_aspect"


# ------------------------------------------------------------------------------------------------ rights (fix 8)

def _frames_by_asset(doc: dict) -> dict:
    out = {}
    for fid, f in sorted((doc.get("frames") or {}).items()):
        out.setdefault(f.get("asset"), []).append(f)
    return out


STATED_RIGHTS = ("generated", "own", "licensed")


def rights_of(doc: dict, sha: str, by_asset: dict | None = None) -> tuple:
    """``(rights, why)`` of one asset, or ``("mock", why)`` for mock output (refused, checked first, whatever is stated). A stated
    ``rights`` of generated, own or licensed is trusted (Production sets it: a provider made the picture, or a person said so).
    ``unknown`` or none stated is ``reference_only`` (Rights to supply; owner, 2026-11-22: trust what is stated, ask for the rest);
    the origin is read only to refuse mock output, never to raise the rights."""
    a = (doc.get("assets") or {}).get(sha) or {}
    origin = a.get("origin")
    if origin == "mock":
        return "mock", "mock output"
    if origin == "edited" and _edit_of_mock(doc, sha, by_asset if by_asset is not None else _frames_by_asset(doc)):
        return "mock", "an edit of mock output"
    stated = a.get("rights")
    if stated in STATED_RIGHTS:
        return stated, {"generated": "made in Production", "own": "stated own in Production", "licensed": "stated licensed in Production"}[stated]
    if stated == "unknown":
        return "reference_only", f"{origin or 'a picture'} with its rights not yet stated in Production"
    return "reference_only", f"{origin or 'a picture'} with no rights stated in Production"


def _edit_of_mock(doc: dict, sha: str, by_asset: dict, seen: set | None = None) -> bool:
    """Whether an edited picture's frame chain reaches mock output (a mock frame, or a picture whose origin is mock)."""
    seen = seen if seen is not None else set()
    chain = by_asset.get(sha) or []
    frames = doc.get("frames") or {}
    f = chain[-1] if chain else None
    while f is not None and f.get("id") not in seen:
        seen.add(f.get("id"))
        if f.get("kind") == "mock":
            return True
        other = f.get("asset")
        if other and other != sha:
            o = ((doc.get("assets") or {}).get(other) or {}).get("origin")
            if o == "mock" or (o == "edited" and _edit_of_mock(doc, other, by_asset, seen)):
                return True
        f = frames.get(f.get("parent_id")) if f.get("parent_id") else None
    return False


def lower(*rights) -> str:
    """The lowest of several rights: reference_only beats anything; otherwise the first."""
    return "reference_only" if "reference_only" in rights else rights[0]


# ------------------------------------------------------------------------------------------------ focal points (fix 6)

def _union(boxes: list) -> tuple | None:
    bs = [b for b in boxes or [] if isinstance(b, dict) and b.get("w", 0) > 0 and b.get("h", 0) > 0]
    if not bs:
        return None
    x0, y0 = min(b["x"] for b in bs), min(b["y"] for b in bs)
    x1, y1 = max(b["x"] + b["w"] for b in bs), max(b["y"] + b["h"] for b in bs)
    return x0, y0, x1, y1


def _clamp(v: float) -> float:
    return round(min(1.0, max(0.0, v)), 4)


CENTRE = {"x": 0.5, "y": 0.5}


def master_focal(fset: dict, w: int, h: int) -> tuple:
    """``(focal, by)`` of the master: the centre of its protect boxes (in its own pixels) as fractions, else the centre."""
    pr = fset.get("protect") or {}
    u = None if pr.get("keep_middle") else _union(pr.get("boxes"))
    if not u or not w or not h:
        return dict(CENTRE), "centre"
    return {"x": _clamp((u[0] + u[2]) / 2 / w), "y": _clamp((u[1] + u[3]) / 2 / h)}, "protect"


def _keep(x0, y0, x1, y1, w, h) -> dict:
    return {"x0": _clamp(x0 / w), "y0": _clamp(y0 / h), "x1": _clamp(x1 / w), "y1": _clamp(y1 / h)}


def master_keep(fset: dict, w: int, h: int) -> dict | None:
    """The union of the master's protect boxes as fractions of the master ({x0, y0, x1, y1}), or None (no boxes, keep_middle)."""
    pr = fset.get("protect") or {}
    u = None if pr.get("keep_middle") else _union(pr.get("boxes"))
    return _keep(*u, w, h) if u and w and h else None


def size_keep(size: dict, fset: dict | None) -> dict | None:
    """The part of the protect boxes a cropped size shows, as fractions of the size; None wherever size_focal takes the centre."""
    crop = size.get("crop")
    pr = (fset or {}).get("protect") or {}
    if size.get("method") in ("extend", "regenerate") or not isinstance(crop, dict) or not crop.get("w") or not crop.get("h") or pr.get("keep_middle"):
        return None
    u = _union(pr.get("boxes"))
    if not u:
        return None
    x0, y0 = max(u[0], crop["x"]), max(u[1], crop["y"])
    x1, y1 = min(u[2], crop["x"] + crop["w"]), min(u[3], crop["y"] + crop["h"])
    if x1 <= x0 or y1 <= y0:
        return None
    return _keep(x0 - crop["x"], y0 - crop["y"], x1 - crop["x"], y1 - crop["y"], crop["w"], crop["h"])


def size_focal(size: dict, fset: dict | None) -> tuple:
    """``(focal, by)`` of a size: the protect boxes (master pixels) mapped through ``size.crop`` (the part of the master it shows); the
    centre for an extend or regenerate size, a size with no crop, or a set with no boxes."""
    crop = size.get("crop")
    pr = (fset or {}).get("protect") or {}
    if size.get("method") in ("extend", "regenerate") or not isinstance(crop, dict) or not crop.get("w") or not crop.get("h") or pr.get("keep_middle"):
        return dict(CENTRE), "centre"
    u = _union(pr.get("boxes"))
    if not u:
        return dict(CENTRE), "centre"
    x0, y0 = max(u[0], crop["x"]), max(u[1], crop["y"])
    x1, y1 = min(u[2], crop["x"] + crop["w"]), min(u[3], crop["y"] + crop["h"])
    if x1 <= x0 or y1 <= y0:   # the boxes fall outside the crop: nothing of them to keep in view
        return dict(CENTRE), "centre"
    return {"x": _clamp(((x0 + x1) / 2 - crop["x"]) / crop["w"]), "y": _clamp(((y0 + y1) / 2 - crop["y"]) / crop["h"])}, "protect"


# ------------------------------------------------------------------------------------------------ the offer

def _brief_of(doc: dict, fset_id: str) -> dict | None:
    """The brief linked into a Format set (link role brief): only its source document id and data hash, never its spine."""
    briefs = doc.get("briefs") or {}
    for ln in (doc.get("links") or {}).values():
        if ln.get("role") != "brief":
            continue
        ends = {(ln.get("from") or {}).get("id"), (ln.get("to") or {}).get("id")}
        if fset_id in ends:
            for bid in ends - {fset_id}:
                src = (briefs.get(bid) or {}).get("source") or {}
                if src.get("document_id"):
                    return {k: src[k] for k in ("document_id", "data_sha256") if src.get(k)}
    return None


def _aspect(d: dict | None) -> dict | None:
    if isinstance(d, dict) and d.get("w") and d.get("h"):
        return {"w": int(d["w"]), "h": int(d["h"])}
    return None


def finals_of(doc: dict) -> dict:
    """The document's finals (contract 3 item 26) by what they are of: ``{"frame": {id: [final, ...]}, "size": {id: [...]}, "picture": {id: [...]}}``,
    each list oldest first (a size or a picture keeps one; a frame may have several). A final with no asset or no target is ignored."""
    out = {"frame": {}, "size": {}, "picture": {}}
    rows = [f for f in (doc.get("finals") or {}).values() if isinstance(f, dict)]
    for f in sorted(rows, key=lambda f: (str(f.get("at") or ""), str(f.get("id") or ""))):
        of = f.get("of") if isinstance(f.get("of"), dict) else {}
        if of.get("kind") in out and of.get("id") and f.get("asset"):
            out[of["kind"]].setdefault(of["id"], []).append(f)
    return out


def plan_offer(doc: dict, packs: dict) -> tuple:
    """``(candidates, refused, not_carried)`` from the document alone (no bytes read yet). A candidate is ``{key, entity, role, sha, ...}``;
    its asset is still to be read and hashed. Video, renders and video sizes are counted, never offered.

    Finals first (production-spinoff): a candidate whose picture a person marked final carries ``final: True`` and the exact picture
    marked (``final.asset``, which may differ from what its size or master holds now: a final stands until unmarked). A final picture on
    the canvas that no Format set holds as its master is offered as a key visual of its own (key ``<final id>#master``); a final of a
    size that was removed is offered from its own copied format; a still storyboard frame marked final stands in for the pick of its
    shot. The binding (images.bind_production) takes finals before any rule's pick."""
    assets = doc.get("assets") or {}
    by_asset = _frames_by_asset(doc)
    fin = finals_of(doc)
    newest = lambda lst: lst[-1] if lst else None   # noqa: E731
    frames_all = doc.get("frames") or {}
    cands, refused = [], []
    not_carried = {"renders": len(doc.get("renders") or {}), "video_sizes": 0, "video_masters": 0}

    def image_asset(sha, entity):
        a = assets.get(sha)
        if not a:
            refused.append({"entity": entity, "reason": "its asset is not in the document"})
            return None
        if a.get("kind") != "image":
            return "video"
        if a.get("mime") not in IMAGE_MIMES:
            refused.append({"entity": entity, "reason": f"a {a.get('mime')} picture is not drawn on a slide (PNG, JPEG or WEBP only)"})
            return None
        return a

    def rights(entity, *shas):
        rs = [rights_of(doc, s, by_asset) for s in shas if s and s in assets]   # a master's asset no longer in the document lowers nothing
        if any(r == "mock" for r, _ in rs):
            refused.append({"entity": entity, "reason": "mock output is never used as real work"})
            return None
        r = lower(*[r for r, _ in rs])
        why = next((w for rr, w in rs if rr == r), "")
        return r, why

    def master_final(m: dict):
        """The newest final of a Format set's master: its picture (or its canvas node's), or the frame it is."""
        if m.get("kind") == "frame":
            return newest(fin["frame"].get(m.get("id")) or [])
        got = list(fin["picture"].get(m.get("id")) or [])
        for lst in fin["frame"].values():
            got += [f for f in lst if (frames_all.get(f["of"]["id"]) or {}).get("node") == m.get("id") and not (frames_all.get(f["of"]["id"]) or {}).get("shot_id")]
        return max(got, key=lambda f: (str(f.get("at") or ""), str(f.get("id") or ""))) if got else None

    fsets = doc.get("format_sets") or {}
    master_ids = {(fs.get("master") or {}).get("id") for fs in fsets.values()}
    for fid in sorted(fsets):
        fs = fsets[fid]
        m = fs.get("master") or {}
        sha = m.get("asset")
        if not sha and m.get("kind") == "frame":
            sha = (frames_all.get(m.get("id")) or {}).get("asset")
        mf = master_final(m)
        same = not mf or mf["asset"] == sha   # protect boxes are in the master's own pixels: only its own picture keeps them
        if mf:
            sha = mf["asset"]   # the exact picture marked, even if the master has moved on
        if m.get("kind") in ("video", "render"):
            not_carried["video_masters"] += 1
        elif sha:
            a = image_asset(sha, f"{fid}#master")
            if a == "video":
                not_carried["video_masters"] += 1
            elif a:
                rr = rights(f"{fid}#master", sha)
                if rr:
                    w, h = (m.get("w") or a.get("w"), m.get("h") or a.get("h")) if same else (a.get("w"), a.get("h"))
                    focal, by = master_focal(fs, w, h) if same else (dict(CENTRE), "centre")
                    cands.append({"key": f"{fid}#master", "entity": fid, "role": "master", "set": fid, "version": fs.get("v"), "sha": sha,
                                  "origin": a.get("origin"), "rights": rr[0], "rights_why": rr[1], "status": "ready", "focal": focal, "focal_by": by,
                                  "keep": master_keep(fs, w, h) if same else None,
                                  **({"final": True} if mf else {}),
                                  **({"job_id": a["job_id"]} if a.get("job_id") else {})})
    # A canvas picture marked final that no Format set holds as its master: a key visual of its own.
    standalone = [(f, f["of"]["id"]) for f in (x for lst in fin["picture"].values() for x in lst) if f["of"]["id"] not in master_ids]
    for lst in fin["frame"].values():
        for f in lst:
            fr = frames_all.get(f["of"]["id"]) or {}
            if fr.get("node") and not fr.get("shot_id") and fr["node"] not in master_ids and f["of"]["id"] not in master_ids:
                standalone.append((f, fr["node"]))
    seen_node = set()
    for f, node in sorted(standalone, key=lambda t: (str(t[0].get("at") or ""), str(t[0].get("id") or ""))):
        if node in seen_node:
            continue
        seen_node.add(node)
        key = f"{f['id']}#master"
        a = image_asset(f["asset"], key)
        if a == "video":
            not_carried["video_masters"] += 1
        elif a:
            rr = rights(key, f["asset"])
            if rr:
                cands.append({"key": key, "entity": f["id"], "role": "master", "set": f["id"], "standalone": True, "version": f.get("version") or 1,
                              "sha": f["asset"], "origin": a.get("origin"), "rights": rr[0], "rights_why": rr[1], "status": "ready",
                              "focal": dict(CENTRE), "focal_by": "centre", "keep": None, "final": True,
                              **({"job_id": a["job_id"]} if a.get("job_id") else {})})
    sizes = doc.get("sizes") or {}

    def size_candidate(sid, s, f, st):
        """One size's candidate: ``s`` its entry (or {} for a removed size), ``f`` the final marked on it (or None), ``st`` its status."""
        if f:
            sha = f["asset"]   # the exact picture marked: a final stands until unmarked, even when the size has been remade since
        else:
            full = s.get("full") or {}
            sha = full.get("asset") if full.get("asset") and full.get("from") == s.get("asset") else s.get("asset")
        if not sha:
            return
        a = image_asset(sha, sid)
        if a == "video":
            not_carried["video_sizes"] += 1
            return
        if not a:
            return
        set_id = s.get("set_id") or (f or {}).get("set_id")
        fs = fsets.get(set_id) or {}
        rr = rights(sid, sha, (s.get("from_asset") or (fs.get("master") or {}).get("asset")) if s else None)   # a size made from a picture that waits waits too
        if not rr:
            return
        shape = {"format": s.get("format") or (f or {}).get("format") or {}}
        ch, ch_by = size_channel(shape, packs)
        if ch is None and f and f.get("channel"):
            ch, ch_by = f["channel"], "final"
        kept = bool(s) and not f or (bool(s) and f["asset"] in (s.get("asset"), (s.get("full") or {}).get("asset")))   # the size still holds the marked picture
        focal, by = size_focal(s, fs) if kept else (dict(CENTRE), "centre")
        c = {"key": sid, "entity": sid, "role": "size", "set": set_id, "version": s.get("v") or (f or {}).get("version"), "sha": sha,
             "origin": a.get("origin"), "rights": rr[0], "rights_why": rr[1], "status": st, "channel": ch, "channel_by": ch_by, "focal": focal,
             "focal_by": by, "keep": size_keep(s, fs) if kept else None,
             "format": {k: v for k, v in shape["format"].items() if k in ("pack_id", "pack_version", "format_id")},
             "aspect": (_aspect(s.get("aspect")) if kept else None) or {"w": a.get("w") or 1, "h": a.get("h") or 1}}
        if f:
            c["final"] = True
        for k in ("method", "job_id"):
            if s.get(k):
                c[k] = s[k]
        if s.get("delivery"):
            c["delivery"] = {"width": s["delivery"].get("width"), "height": s["delivery"].get("height")}
        if st == "look":
            c["reason"] = "Flagged by review in Production: needs a look"
        elif st == "stale":
            c["reason"] = "Out of date in Production: what it was made from changed"
        cands.append(c)

    for sid in sorted(sizes):
        s = sizes[sid]
        st = s.get("status")
        f = newest(fin["size"].get(sid) or [])
        if s.get("media") == "video":
            not_carried["video_sizes"] += 1
            continue
        if not f and st not in ("ready", "look", "stale"):
            continue   # making, or not made yet: nothing to show
        size_candidate(sid, s, f, st if st in ("ready", "look", "stale") else "ready")
    for sid in sorted(set(fin["size"]) - set(sizes)):   # a final of a size that has since been removed still stands
        size_candidate(sid, {}, newest(fin["size"][sid]), "ready")
    frames = doc.get("frames") or {}
    shots = doc.get("shots") or {}
    shot_finals = {}   # shot id -> its newest final frame (a still marked final stands in for the pick)
    for fid_, lst in fin["frame"].items():
        fr = frames.get(fid_) or {}
        for f in lst:
            if fr.get("shot_id") in shots:
                cur_f = shot_finals.get(fr["shot_id"])
                if cur_f is None or (str(f.get("at") or ""), str(f.get("id") or "")) > (str(cur_f.get("at") or ""), str(cur_f.get("id") or "")):
                    shot_finals[fr["shot_id"]] = f
    for shid in sorted(shots):
        sh = shots[shid]
        ff = shot_finals.get(shid)
        cur = ff["of"]["id"] if ff else ((sh.get("pick") or {}).get("current"))
        f = frames.get(cur) if cur else None
        if not f or f.get("shot_id") != shid:
            continue   # v1: only the frame a person picked for the shot (or marked final)
        if f.get("kind") == "mock":
            refused.append({"entity": cur, "reason": "mock output is never used as real work"})
            continue
        if f.get("kind") not in ("generated", "edited"):
            continue
        sha = ff["asset"] if ff else f.get("asset")
        a = image_asset(sha, cur)
        if a == "video" or not a:
            continue
        rr = rights(cur, sha)
        if not rr:
            continue
        cands.append({"key": cur, "entity": cur, "role": "frame", "shot": shid, "storyboard": sh.get("storyboard_id"), "shot_rank": sh.get("rank"),
                      "shot_kind": sh.get("kind") or "shot", "version": f.get("v"), "sha": sha, "origin": a.get("origin"), "rights": rr[0],
                      "rights_why": rr[1], "status": "ready", "focal": dict(CENTRE), "focal_by": "centre",
                      **({"final": True} if ff else {}),
                      **({"job_id": f["job_id"]} if f.get("job_id") else {})})
    packs_, crops_ = _made_pictures(doc)
    for c in cands:   # what a picture is, from the job that made it (the deck's "Packshot" and "Size crops" slides take only their own kind)
        if c["sha"] in packs_:
            c["subject"] = "packshot"
        elif c["sha"] in crops_:
            c["subject"] = "crop"
    return _one_of_each(cands, not_carried), refused, not_carried


_PACKSHOT = re.compile(r"pack[\s-]?shots?\b", re.I)


def _made_pictures(doc: dict) -> tuple:
    """``(packshot shas, crop shas)`` from the jobs that made the pictures. A packshot is a picture whose job's own words ask for one ('Product
    packshot of ...'), and so is every picture made from it by a resize; a crop is a picture a resize job made from another. The brief's words
    never count. Anything else (a key visual, a scene) is neither."""
    jobs = [j for j in (doc.get("jobs") or {}).values() if isinstance(j, dict)]

    def shas(v):
        out = []
        for x in v or []:
            x = x.get("sha256") or x.get("asset") if isinstance(x, dict) else x
            if isinstance(x, str):
                out.append(x)
        return out
    packs, crops = set(), set()
    for j in jobs:
        text = json.dumps({k: v for k, v in j.items() if k not in ("cost", "director")}, ensure_ascii=False) + " " + str(((j.get("director") or {}).get("input") or {}).get("text") or "")
        if _PACKSHOT.search(text):
            packs |= set(shas(j.get("outputs")))
        if j.get("op") == "resize":
            crops |= set(shas(j.get("outputs")))
    changed = True
    while changed:   # a resize of a packshot is a packshot
        changed = False
        for j in jobs:
            if j.get("op") == "resize" and set(shas(j.get("input_hashes"))) & packs and not set(shas(j.get("outputs"))) <= packs:
                packs |= set(shas(j.get("outputs")))
                changed = True
    return packs, crops - packs


def _one_of_each(cands: list, not_carried: dict) -> list:
    """Every key visual once. Production can hold one picture as the key visual of two Format sets (UAT 2026-11-22: the same sha256 listed
    twice): the offer lists it once, the one a person marked final first, then the newest entity (ULIDs sort by time),
    so no picker row and no slot sees the same key visual twice. The count of those dropped goes in ``not_carried['duplicates']``."""
    best = {}
    for c in cands:
        if c["role"] != "master":   # sizes and frames are separate things a person may pick among even when two share a file
            continue
        if c["sha"] not in best or (bool(c.get("final")), c["key"]) > (bool(best[c["sha"]].get("final")), best[c["sha"]]["key"]):
            best[c["sha"]] = c
    out = [c for c in cands if c["role"] != "master" or best[c["sha"]] is c]
    if len(out) != len(cands):
        not_carried["duplicates"] = len(cands) - len(out)
    return out


def asset_bytes(zf: zipfile.ZipFile, inner: zipfile.ZipFile, sha: str, mime: str) -> tuple:
    """``(bytes, where)`` of one asset by its exact expected names: the .clan's ``human/assets/<hex>.<ext>`` first (finished pictures, when
    Production embeds them), then the zip's ``assets/<hex>.<ext>`` (bundle.ts assetPath). ``(None, reason)`` when neither holds it."""
    hx = _hex(sha)
    if not re.fullmatch(r"[0-9a-f]{64}", hx):
        return None, "its key is not a sha256"
    ext = IMAGE_MIMES.get(mime, "bin")
    for z, name, where in ((inner, f"human/assets/{hx}.{ext}", "clan"), (zf, f"assets/{hx}.{ext}", "zip")):
        try:
            z.getinfo(name)
        except KeyError:
            continue
        return _read(z, name, ASSET_MAX), where
    return None, "the export holds no bytes for it (Production could not fetch them when it exported)"


def offer_sha(items: dict) -> str:
    """The update key (fix 2): sha256 of the sorted (entity, asset) pairs offered. Never the relay's ETag: an unrelated patch changes that."""
    pairs = sorted((v["entity"] + ("#master" if v["role"] == "master" else ""), v["sha256"]) for v in items.values())
    return hashlib.sha256(json.dumps(pairs, separators=(",", ":")).encode()).hexdigest()


def make_item(c: dict, info: dict, clan_hex: str) -> dict:
    """One production.json item from a plan_offer candidate and its checked picture (``info``: images.inspect_file's ext, mime, width, height,
    bytes). Shared with deck.prod_picker, which builds the same items from a .clan read directly (the metadata ones before any byte is read)."""
    hx = _hex(c["sha"])
    it = {"entity": c["entity"], "role": c["role"], "version": c.get("version"), "origin": c.get("origin"), "rights": c["rights"],
          "status": c["status"], "sha256": hx, "bundle_sha256": clan_hex, "file": f"assets/{hx}.{info['ext']}", "mime": info["mime"],
          "width": info["width"], "height": info["height"], "bytes": info["bytes"], "focal": c["focal"], "focal_by": c["focal_by"]}
    if c.get("final"):
        it["final"] = True
    if c["rights"] == "reference_only":
        it["to_supply"] = "rights"
        it["rights_why"] = c.get("rights_why", "")
    for k in ("set", "job_id", "channel", "channel_by", "format", "aspect", "delivery", "method", "reason", "shot", "storyboard", "shot_rank", "shot_kind", "keep", "subject"):
        if c.get(k) not in (None, "", {}):
            it[k] = c[k]
    if c["role"] != "size":
        it["aspect"] = {"w": info["width"], "h": info["height"]}
    return it


def format_set_rows(doc: dict, items: dict) -> dict:
    """production.json's ``format_sets``: each set's version, its master's item key when offered, and the brief it links to (id and hash only)."""
    fsets = {}
    for fid, fs in sorted((doc.get("format_sets") or {}).items()):
        row = {"v": fs.get("v"), "master": f"{fid}#master" if f"{fid}#master" in items else None}
        b = _brief_of(doc, fid)
        if b:
            row["brief"] = b
        fsets[fid] = row
    for key, it in items.items():   # a final picture no Format set holds: a row of its own, so the key-visual rule can rank it
        if it.get("role") == "master" and it["entity"] not in fsets:
            fsets[it["entity"]] = {"v": it.get("version"), "master": key}
    return fsets


def build(bundle: Path, at: str | None = None, work: Path | None = None) -> tuple:
    """Read the bundle and return ``(production, {sha256 hex: path})``. Each picture is read, hashed and checked one at a time and written
    to ``work`` (a folder; write() moves the files into the stages folder) as soon as it passes, so only one picture is ever held in memory;
    together they are capped at ASSETS_TOTAL_MAX, and a picture past the cap is refused, item by item. With no ``work`` the pictures are
    checked in a temporary folder that is removed before return, and the map is empty: nothing is written."""
    if work is None:
        with tempfile.TemporaryDirectory() as td:
            return build(bundle, at, Path(td))[0], {}
    work = Path(work)
    zf, inner, clan_name, clan_raw = open_bundle(bundle)
    doc = read_document(inner)
    clan_hex = hashlib.sha256(clan_raw).hexdigest()
    del clan_raw
    packs = load_packs()
    cands, refused, not_carried = plan_offer(doc, packs)
    assets = doc.get("assets") or {}
    items, files, infos, where, total = {}, {}, {}, set(), 0
    for c in cands:
        a = assets[c["sha"]]
        hx = _hex(c["sha"])
        if hx not in infos:
            try:
                raw, how = asset_bytes(zf, inner, c["sha"], a.get("mime"))
            except FromProductionError as e:
                refused.append({"entity": c["key"], "reason": str(e)})
                continue
            if raw is None:
                refused.append({"entity": c["key"], "reason": how})
                continue
            if hashlib.sha256(raw).hexdigest() != hx:
                refused.append({"entity": c["key"], "reason": "its bytes do not hash to its sha256 (changed or damaged): refused"})
                continue
            if total + len(raw) > ASSETS_TOTAL_MAX:
                refused.append({"entity": c["key"], "reason": f"the export's pictures together pass the {ASSETS_TOTAL_MAX // 1_000_000} MB cap: refused"})
                continue
            p = work / f"{hx}.{IMAGE_MIMES[a['mime']]}"   # the deck's own picture check: PNG, JPEG or WEBP, no SVG, no bomb, size read from the header
            p.write_bytes(raw)
            del raw
            try:
                info = images.inspect_file(p)
            except images.ImageError as e:
                p.unlink(missing_ok=True)
                refused.append({"entity": c["key"], "reason": str(e)[:300]})
                continue
            total += info["bytes"]
            infos[hx], files[hx] = info, p
            where.add(how)
        items[c["key"]] = make_item(c, infos[hx], clan_hex)
    fsets = format_set_rows(doc, items)
    proj = doc["project"]
    prod = {"stage": "production", "produced_by": "deck.from_production (a Production Tool export, no model call, no network)",
            "contract_version": CONTRACT, "app": APP_ID, "project": {"id": proj["id"], "title": str(proj.get("title") or "")[:120]},
            "bundle": {"clan": clan_name, "clan_sha256": clan_hex, "assets_from": "+".join(sorted(where)) or "none"},
            "taken_at": at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "format_packs": packs_record(), "format_sets": fsets, "items": items, "offer_sha256": offer_sha(items),
            "refused": refused, "not_carried": not_carried}
    if (zf.comment or b"").strip() == b"napkin-fixture":
        prod["fixture"] = True
    return prod, files


def write(prod: dict, files: dict, stages: Path) -> None:
    """``<stages>/production.json`` and ``<stages>/assets/<sha256>.<ext>``, each picture once, moved from where build() wrote it (keep its
    ``work`` folder on the same disk as ``stages``: the move is then a rename). Replaces an earlier production.json: it is a frozen copy of
    the export, and run_deck keeps what was placed in deck.json until the person takes an update."""
    stages = Path(stages)
    (stages / "assets").mkdir(parents=True, exist_ok=True)
    for it in prod["items"].values():
        dst = stages / it["file"]
        src = Path(files[it["sha256"]])
        if not dst.exists() and src.exists():
            src.replace(dst)
    (stages / "production.json").write_text(json.dumps(prod, indent=1, ensure_ascii=False))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m deck.from_production", description=__doc__.split("\n")[0])
    ap.add_argument("bundle", type=Path, help="the Production Tool's export: napkin-<title>-production.zip")
    ap.add_argument("--stages", required=True, type=Path)
    a = ap.parse_args(argv)
    try:
        a.stages.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=a.stages, prefix=".production-") as td:   # same disk: write() renames, and the folder goes
            prod, files = build(a.bundle, work=Path(td))
            write(prod, files, a.stages)
    except (FromProductionError, images.ImageError, yaml.YAMLError) as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    n = {r: sum(1 for i in prod["items"].values() if i["role"] == r) for r in ("master", "size", "frame")}
    supply = sum(1 for i in prod["items"].values() if i.get("to_supply"))
    print(f"wrote {a.stages}/production.json: {n['master']} key visual(s), {n['size']} size(s), {n['frame']} storyboard frame(s); "
          f"{supply} with rights to supply; {len(prod['refused'])} refused; not carried: {prod['not_carried']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
