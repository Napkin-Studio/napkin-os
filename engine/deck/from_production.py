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
* (8) Rights are never assumed: generated -> generated; drawn -> own; uploaded, extracted, a library ref and an edit of one ->
  reference_only, ``Rights to supply``; an ``edited`` asset whose frame chain does not reach only generated frames (no chain, or an
  ``original`` canvas picture at its root) -> reference_only. Mock output (asset origin or frame kind ``mock``) is refused, checked
  first. Contract 3 defines no ``rights`` field on an asset (it forbids extra properties): one is ignored, and the export is
  reported as forged or altered in ``warnings``.
* (9) production.json is written from an allow-list: no brief spine (nor its confidential parts), no decision, no thumb, no
  location, no copy line, no layer text. Only offered image assets are copied. Zip members are read by exact name with size
  caps; nothing is extracted by a member's own name (zip-bomb and path-traversal safe).
* (2) Updates are detected by ``offer_sha256``, the hash of the offered items' (entity id, asset sha256) pairs, never the ETag.

When the inner .clan carries finished pictures in ``human/assets/<hex>.<ext>`` (proposed to the Production Tool, not built there yet),
they are preferred over the zip's ``assets/``; either way every byte is hashed against its key. This module imports no provider code.

Contract 3 with finals and rights (develop #257, production-tool/contracts README item 26; deck-handoffs):

* ``assets[sha].rights`` (generated, own, licensed, unknown) is read now that the contract defines it. ``unknown`` is rights to supply.
  A person's ``own`` or ``licensed`` on an upload (or extract) makes it placeable; a stated value never raises a mock, and ``generated``
  stated on a picture Production did not make is not believed (reference_only, with a warning). A value outside the enum is ignored
  and named in ``warnings``. Absent: inferred from the origin, as before.
* ``finals`` (a person's Final toggle): a final of a size or a frame offers the exact picture it names, marked ``final`` with who and
  when, ahead of the shot's pick; a final of a canvas picture that is a Format set's master marks that master. Other picture finals are
  listed under ``finals`` (no slot takes them yet).
* Every item says ``client_showable`` (its rights are generated, own or licensed) and ``asset_size`` (the asset's own width and height in
  the document); ``relay`` names the relay's sized copies (``GET /assets/{sha256}?w=480|1200|2400``), never a location.
* A contract 2 document (lists, one script, frames with ``selected``) is still read: its selected storyboard frames are offered as
  frames, its rights inferred from origin; the record says ``source_contract: "2"``.
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
#: The contracts a document may be in: 3, and the older 2 (read through ``from_v2``).
CONTRACTS = ("2", "3")
#: contract 3's assets[].rights (develop #257): what a person or Production stated. unknown is rights to supply.
STATED_RIGHTS = ("generated", "own", "licensed", "unknown")
#: The relay's sized copies of a picture (GET /assets/{sha256}?w=...): at most this wide.
RELAY_WIDTHS = (480, 1200, 2400)
#: Rights a client may see a picture under.
SHOWABLE = ("generated", "own", "licensed")
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
    cv = str(doc.get("contract_version"))
    if cv not in CONTRACTS:
        raise FromProductionError(f"the document is contract {cv!r}; the deck reads contract {' or '.join(repr(c) for c in CONTRACTS)}: refused")
    if doc.get("app") != "production-tool":
        raise FromProductionError(f"the document's app is {doc.get('app')!r}, not 'production-tool': refused")
    if cv == "2":
        return from_v2(doc)
    if not re.fullmatch(rf"proj_{ULID}", str((doc.get("project") or {}).get("id") or "")):
        raise FromProductionError("the document has no project id: refused")
    return doc


def _hex(sha: str) -> str:
    return str(sha or "").removeprefix("sha256:")


def from_v2(doc: dict) -> dict:
    """A contract 2 document in contract 3's shape, for the offer: assets keyed by sha256, frames and shots keyed by id, each shot's
    ``selected`` frame as its pick. Contract 2 has no format sets, sizes, finals or rights: only storyboard frames are offered. Its project
    id is made from the participant (contract 2 has no project), stable for the same document. Refuses a document that is not contract 2's
    shape (lists)."""
    for k in ("assets", "frames", "shots"):
        if doc.get(k) is not None and not isinstance(doc.get(k), list):
            raise FromProductionError(f"a contract '2' document holds {k} as a list: this one is not contract 2's shape: refused")
    assets = {}
    for a in doc.get("assets") or []:
        if isinstance(a, dict) and a.get("sha256"):
            assets[a["sha256"]] = {k: a.get(k) for k in ("sha256", "kind", "mime", "w", "h", "origin", "job_id") if a.get(k) is not None}
    frames, picks = {}, {}
    for f in doc.get("frames") or []:
        if isinstance(f, dict) and f.get("id"):
            frames[f["id"]] = {k: f.get(k) for k in ("id", "shot_id", "asset", "job_id", "kind") if f.get(k) is not None}
            if f.get("parent"):
                frames[f["id"]]["parent_id"] = f["parent"]
            if f.get("selected"):
                picks[f.get("shot_id")] = f["id"]
    shots = {}
    for i, sh in enumerate(doc.get("shots") or []):
        if isinstance(sh, dict) and sh.get("id"):
            cur = sh.get("storyboard_frame") or picks.get(sh["id"])
            shots[sh["id"]] = {"id": sh["id"], "rank": f"a{i:03d}", "kind": "shot", **({"pick": {"current": cur}} if cur else {})}
    who = str((doc.get("participant") or {}).get("id") or "")
    digest = hashlib.sha256(("v2:" + who).encode()).hexdigest().upper()
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    pid = "proj_" + "".join(alphabet[int(digest[i:i + 2], 16) % 32] for i in range(0, 52, 2))
    return {"contract_version": CONTRACT, "source_contract": "2", "app": "production-tool",
            "project": {"id": pid, "title": str((doc.get("participant") or {}).get("handle") or "Production (contract 2)")},
            "assets": assets, "frames": frames, "shots": shots}


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


def rights_of(doc: dict, sha: str, by_asset: dict | None = None) -> tuple:
    """``(rights, why)`` of one asset, or ``("mock", why)`` for mock output (refused, checked first). Inferred from the origin alone, and
    inference only ever lowers: generated -> generated; drawn -> own; uploaded or extracted -> reference_only; edited -> generated only
    when its frame chain reaches only generated frames, else reference_only. An asset's ``rights`` field is never read: contract 3 has
    none (see forged_fields), so a bundle cannot raise a mock or an upload to placeable by writing one."""
    a = (doc.get("assets") or {}).get(sha) or {}
    origin = a.get("origin")
    if origin == "mock":
        return "mock", "mock output"
    stated = a.get("rights") if a.get("rights") in STATED_RIGHTS else None   # contract 3 (#257); a value outside it is ignored (forged_fields)
    if stated == "unknown":
        return "reference_only", "its rights are unknown in Production (a person has not said)"
    if origin == "generated":
        return "generated", "made in Production"
    if origin == "drawn":
        return "own", "drawn on the canvas"
    if origin in ("uploaded", "extracted"):
        if stated in ("own", "licensed"):
            return stated, f"{origin}; a person said it is {'the agency’s own' if stated == 'own' else 'licensed'} in Production"
        return "reference_only", f"{origin} with no stated licence"
    if origin != "edited":
        return "reference_only", f"origin {origin!r} is not known"
    by_asset = by_asset if by_asset is not None else _frames_by_asset(doc)
    chain = by_asset.get(sha) or []
    if not chain:
        return "reference_only", "an edit with no frame chain"
    frames = doc.get("frames") or {}
    f, seen = chain[-1], set()
    while f is not None:
        if f.get("id") in seen:
            return "reference_only", "an edit whose frame chain loops"
        seen.add(f.get("id"))
        kind = f.get("kind")
        if kind == "mock":
            return "mock", "an edit of mock output"
        if kind == "original":
            root = (doc.get("assets") or {}).get(f.get("asset")) or {}
            if f.get("asset") != sha and root.get("rights") in ("own", "licensed") and root.get("origin") != "mock":
                return root["rights"], f"an edit of a canvas picture a person said is {root['rights']} in Production"
            return "reference_only", "an edit of a canvas picture (its licence is not stated)"
        if kind == "generated":
            r, why = rights_of(doc, f.get("asset"), by_asset) if f.get("asset") != sha else ("generated", "")
            return ("generated", "an edit of a picture made in Production") if r == "generated" else (r, f"an edit of: {why}")
        parent = f.get("parent_id")
        if not parent:
            return "reference_only", "an edit whose chain reaches no generated frame"
        f = frames.get(parent)
    return "reference_only", "an edit whose parent frame is missing"


def forged_fields(doc: dict) -> list:
    """Warnings for a stated ``rights`` the deck does not believe: a value outside contract 3's enum (generated, own, licensed, unknown), or
    ``generated`` on a picture Production did not make. Each is ignored and named: only a forged or hand-altered export carries one."""
    out = []
    for sha, a in sorted((doc.get("assets") or {}).items()):
        if not isinstance(a, dict) or "rights" not in a:
            continue
        r = a.get("rights")
        if r not in STATED_RIGHTS:
            out.append({"entity": sha, "warning": f"the asset's rights {r!r} is not one contract 3 defines (generated, own, licensed, unknown): "
                                                  "ignored (a forged or altered export); its rights come from its origin"})
        elif r == "generated" and a.get("origin") not in ("generated", "edited"):
            out.append({"entity": sha, "warning": f"the asset says rights 'generated' but its origin is {a.get('origin')!r}: not believed (a forged "
                                                  "or altered export); its rights come from its origin"})
        elif a.get("origin") == "mock":
            out.append({"entity": sha, "warning": "a mock asset states rights: ignored; mock output is never used as real work"})
    return out


def finals_of(doc: dict) -> dict:
    """``{(kind, id): final}`` from contract 3's ``finals`` (#257): what a person marked final, one per frame, size or picture (the newest
    when a document holds two for one thing). Each final names its exact picture (``asset``)."""
    out = {}
    for fid, f in sorted((doc.get("finals") or {}).items()):
        if not isinstance(f, dict) or not isinstance(f.get("of"), dict) or not f.get("asset"):
            continue
        k = (f["of"].get("kind"), f["of"].get("id"))
        if k not in out or str(f.get("at") or "") > str(out[k].get("at") or ""):
            out[k] = {**f, "id": f.get("id") or fid}
    return out


def _final_mark(f: dict) -> dict:
    return {k: f.get(k) for k in ("id", "at", "by", "version") if f.get(k) is not None}


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


def plan_offer(doc: dict, packs: dict) -> tuple:
    """``(candidates, refused, not_carried)`` from the document alone (no bytes read yet). A candidate is ``{key, entity, role, sha, ...}``;
    its asset is still to be read and hashed. Video, renders and video sizes are counted, never offered."""
    assets = doc.get("assets") or {}
    by_asset = _frames_by_asset(doc)
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

    finals = finals_of(doc)
    fsets = doc.get("format_sets") or {}
    for fid in sorted(fsets):
        fs = fsets[fid]
        m = fs.get("master") or {}
        sha = m.get("asset")
        if not sha and m.get("kind") == "frame":
            sha = ((doc.get("frames") or {}).get(m.get("id")) or {}).get("asset")
        mfinal = finals.get((m.get("kind"), m.get("id"))) if m.get("kind") in ("picture", "frame") else None
        if mfinal and mfinal.get("asset") in assets:
            sha = mfinal["asset"]
        if m.get("kind") in ("video", "render"):
            not_carried["video_masters"] += 1
        elif sha:
            a = image_asset(sha, f"{fid}#master")
            if a == "video":
                not_carried["video_masters"] += 1
            elif a:
                rr = rights(f"{fid}#master", sha)
                if rr:
                    w, h = m.get("w") or a.get("w"), m.get("h") or a.get("h")
                    focal, by = master_focal(fs, w, h)
                    cands.append({"key": f"{fid}#master", "entity": fid, "role": "master", "set": fid, "version": fs.get("v"), "sha": sha,
                                  "origin": a.get("origin"), "rights": rr[0], "rights_why": rr[1], "status": "ready", "focal": focal, "focal_by": by,
                                  "keep": master_keep(fs, w, h),
                                  **({"final": _final_mark(mfinal)} if mfinal else {}),
                                  **({"job_id": a["job_id"]} if a.get("job_id") else {})})
    sizes = doc.get("sizes") or {}
    for sid in sorted(sizes):
        s = sizes[sid]
        st = s.get("status")
        if s.get("media") == "video":
            not_carried["video_sizes"] += 1
            continue
        sfinal = finals.get(("size", sid))
        if sfinal and sfinal.get("asset") not in assets:
            sfinal = None
        if st not in ("ready", "look", "stale") and not sfinal:
            continue   # making, or not made yet: nothing to show (a final stands until it is unmarked)
        full = s.get("full") or {}
        sha = full.get("asset") if full.get("asset") and full.get("from") == s.get("asset") else s.get("asset")
        if sfinal:   # the exact picture the person marked final
            sha, st = sfinal["asset"], "ready"
        if not sha:
            continue
        a = image_asset(sha, sid)
        if a == "video":
            not_carried["video_sizes"] += 1
            continue
        if not a:
            continue
        fs = fsets.get(s.get("set_id")) or {}
        rr = rights(sid, sha, s.get("from_asset") or (fs.get("master") or {}).get("asset"))
        if not rr:
            continue
        ch, ch_by = size_channel(s, packs)
        focal, by = size_focal(s, fs)
        c = {"key": sid, "entity": sid, "role": "size", "set": s.get("set_id"), "version": s.get("v"), "sha": sha, "origin": a.get("origin"),
             "rights": rr[0], "rights_why": rr[1], "status": st, "channel": ch, "channel_by": ch_by, "focal": focal, "focal_by": by,
             "keep": size_keep(s, fs),
             "format": {k: v for k, v in (s.get("format") or {}).items() if k in ("pack_id", "pack_version", "format_id")},
             "aspect": _aspect(s.get("aspect")) or {"w": a.get("w") or 1, "h": a.get("h") or 1}}
        for k in ("method", "job_id"):
            if s.get(k):
                c[k] = s[k]
        if s.get("delivery"):
            c["delivery"] = {"width": s["delivery"].get("width"), "height": s["delivery"].get("height")}
        if st == "look":
            c["reason"] = "Flagged by review in Production: needs a look"
        elif st == "stale":
            c["reason"] = "Out of date in Production: what it was made from changed"
        if sfinal:
            c["final"] = _final_mark(sfinal)
        cands.append(c)
    frames = doc.get("frames") or {}
    shots = doc.get("shots") or {}
    for shid in sorted(shots):
        sh = shots[shid]
        cur = ((sh.get("pick") or {}).get("current"))
        ffinal = next((fl for (k, i), fl in sorted(finals.items(), key=lambda kv: str(kv[1].get("at") or ""), reverse=True)
                       if k == "frame" and (frames.get(i) or {}).get("shot_id") == shid), None)
        if ffinal:   # a frame of this shot a person marked final: it is offered ahead of the pick
            cur = ffinal["of"]["id"]
        f = frames.get(cur) if cur else None
        if not f or f.get("shot_id") != shid:
            continue   # v1: only the frame a person picked for the shot
        if f.get("kind") == "mock":
            refused.append({"entity": cur, "reason": "mock output is never used as real work"})
            continue
        if f.get("kind") not in ("generated", "edited"):
            continue
        a = image_asset(f.get("asset"), cur)
        if a == "video" or not a:
            continue
        rr = rights(cur, f["asset"])
        if not rr:
            continue
        cands.append({"key": cur, "entity": cur, "role": "frame", "shot": shid, "storyboard": sh.get("storyboard_id"), "shot_rank": sh.get("rank"),
                      "shot_kind": sh.get("kind") or "shot", "version": f.get("v"), "sha": f["asset"], "origin": a.get("origin"), "rights": rr[0],
                      "rights_why": rr[1], "status": "ready", "focal": dict(CENTRE), "focal_by": "centre",
                      **({"final": _final_mark(ffinal)} if ffinal else {}),
                      **({"job_id": f["job_id"]} if f.get("job_id") else {})})
    return cands, refused, not_carried


def finals_rows(doc: dict, items: dict) -> list:
    """production.json's ``finals``: every final in the document, whether an item carries it (``item``) and, for one no slot takes yet (a
    canvas picture that is no set's master), its rights and whether a client may see it. Ids, hashes and rights only: no location."""
    by_asset = _frames_by_asset(doc)
    carried = {(it.get("final") or {}).get("id"): key for key, it in items.items() if it.get("final")}
    rows = []
    for (kind, oid), f in sorted(finals_of(doc).items(), key=lambda kv: kv[1]["id"]):
        r, why = rights_of(doc, f["asset"], by_asset) if f["asset"] in (doc.get("assets") or {}) else ("reference_only", "its asset is not in the document")
        row = {"id": f["id"], "of": {"kind": kind, "id": oid}, "sha256": _hex(f["asset"]), "rights": "refused" if r == "mock" else r,
               "client_showable": r in SHOWABLE, "at": f.get("at"), "by": f.get("by")}
        for k in ("channel", "set_id", "version"):
            if f.get(k) is not None:
                row[k] = f[k]
        if (f.get("format") or {}).get("format_id"):
            row["format_id"] = f["format"]["format_id"]
        row["item"] = carried.get(f["id"])
        if not row["item"]:
            row["why_not_placed"] = "a final of a canvas picture that is no Format set's master: no slot takes it yet" if kind == "picture" else \
                                    "its picture was not offered (see refused)"
        rows.append(row)
    return rows


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
    if c["rights"] == "reference_only":
        it["to_supply"] = "rights"
        it["rights_why"] = c.get("rights_why", "")
    for k in ("set", "job_id", "channel", "channel_by", "format", "aspect", "delivery", "method", "reason", "shot", "storyboard", "shot_rank", "shot_kind", "keep",
              "final", "asset_size"):
        if c.get(k) not in (None, "", {}):
            it[k] = c[k]
    it["client_showable"] = c["rights"] in SHOWABLE   # deck-handoffs: what a client may see is decided by its rights alone
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
        if a.get("w") and a.get("h"):
            c["asset_size"] = {"w": int(a["w"]), "h": int(a["h"])}
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
            "refused": refused, "not_carried": not_carried,
            "relay": {"route": "GET /assets/{sha256}", "widths": list(RELAY_WIDTHS)}}
    frows = finals_rows(doc, items)
    if frows:
        prod["finals"] = frows
    if doc.get("source_contract"):
        prod["source_contract"] = doc["source_contract"]
    warnings = forged_fields(doc)
    if warnings:
        prod["warnings"] = warnings
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
    for w in prod.get("warnings") or []:
        print(f"WARNING: {w['entity']}: {w['warning']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
