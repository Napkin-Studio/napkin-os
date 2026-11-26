"""Pictures that arrive with a document, and the frames that go into a route's slots (features territories-handlers, territories-pictures-rights).

A document spun in from Production, or an imported export, names pictures in its ``assets`` map (``sha256:<hex>`` -> {kind, mime, origin, rights,
touchpoint?}). Before a run reads it, ``arrive`` puts EVERY picture on the workspace's own blob store (``blobs/<aa>/<sha256>``, the layout of the
hosted store) through ``territory.pictures.rehome`` and ``require_all``: a partial arrival is refused in words and nothing runs. The bytes come
from a reader the host's feature registers (``delivery.register_asset_reader``: the signed assets pass of the source); with none registered a
picture that is not already on the store is named missing, never invented. ``place`` puts arrived pictures into slots by link with
``pictures.fill`` and ``pictures.attach``: one hash, one slot of one route.
"""
from __future__ import annotations

import copy
import os
from pathlib import Path

from . import delivery

ENV_BLOBS = "NAPKIN_TERRITORY_BLOBS"


def blob_store():
    """The workspace store pictures are rehomed onto: ``NAPKIN_TERRITORY_BLOBS`` (a folder holding ``blobs/``), else the territory data root."""
    from territory import pictures, runner
    return pictures.DirStore(os.environ.get(ENV_BLOBS) or os.environ.get(runner.ENV_DATA) or runner.DEFAULT_DATA)


def assets_of(data: dict) -> dict:
    """The ``assets`` maps an arriving document names pictures in: its own, and each frozen source's (``upstream.<id>.assets``: the Territories
    document itself has no ``assets`` member, a spin-in carries its source whole)."""
    out = {}
    for m in [data.get("assets"), *[u.get("assets") for u in (data.get("upstream") or {}).values() if isinstance(u, dict)]]:
        if isinstance(m, dict):
            out.update(m)
    return out


def has_pictures(data: dict) -> bool:
    from territory import pictures
    return any(pictures._is_picture(m if isinstance(m, dict) else {}) for m in assets_of(data).values())


def arrive(doc_id: str, data: dict, store=None) -> dict:
    """The arrival report, or ``PictureError`` in words when any picture did not come. Idempotent: what is already on the store is not read again."""
    from territory import pictures
    store = store or blob_store()
    make = delivery.ASSET_READER
    reader = make(doc_id, data) if make else (lambda sha: None)
    rep = pictures.rehome(assets_of(data), reader, store, source=str(data.get("title") or "")[:80] or None)
    return pictures.require_all(rep)


def _touchpoints(data: dict) -> dict:
    out = {}
    for k, m in assets_of(data).items():
        if isinstance(m, dict) and m.get("touchpoint"):
            out[str(m.get("sha256") or k).removeprefix("sha256:")] = m["touchpoint"]
    return out


def carried(data: dict, report: dict) -> list[dict]:
    tp = _touchpoints(data)
    return [{**r, **({"touchpoint": tp[r["sha256"]]} if r["sha256"] in tp else {})} for r in report["pictures"] if r["status"] in ("arrived", "already")]


def _used(doc: dict) -> set:
    return {s.get("sha256") for t in doc.get("territories") or [] for s in t.get("pictures") or [] if s.get("kind") == "frame"}


def place(doc: dict, data: dict, report: dict, *, territory_id: str | None = None, slot_id: str | None = None, sha256: str | None = None):
    """``(doc, refusals, note)``. With ``slot_id`` and ``sha256``: that arrived picture goes into that slot (``pictures.attach``). Otherwise each live
    developed route (or the one named) takes the arrived pictures nobody has placed, once each (``pictures.fill``)."""
    from territory import pictures
    rows = carried(data, report)
    d = copy.deepcopy(doc)
    ts = {t["id"]: t for t in d.get("territories") or []}
    try:
        if slot_id or sha256:
            if not (slot_id and sha256 and territory_id):
                return doc, ["Say which route, which place and which picture."], ""
            t = ts.get(territory_id)
            row = next((r for r in rows if r["sha256"] == pictures.bare(sha256)), None)
            if t is None or row is None:
                return doc, ["That route or that picture is not in this document."], ""
            pictures.attach(t, slot_id, row)
            return d, [], "The picture is in its place."
        targets = [ts[territory_id]] if territory_id in ts else [] if territory_id else \
            [t for t in d.get("territories") or [] if t.get("status") == "live" and t.get("state") == "developed"]
        if not targets:
            return doc, ["There is no developed route to put pictures on."], ""
        left, placed = [r for r in rows if r["sha256"] not in _used(d)], 0
        for t in targets:
            if not t.get("pictures"):
                continue
            got = pictures.fill(t, left)
            placed += got["placed"]
            left = [r for r in left if r["sha256"] not in _used(d)]
        if not placed:
            return doc, ["There was no picture left to place, or no open place for one."], ""
        return d, [], f"{placed} picture{'s' if placed != 1 else ''} placed."
    except pictures.PictureError as e:
        return doc, [str(e)], ""
