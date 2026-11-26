"""Pictures on a route: identity by hash, rights, the Final marker, and carrying them in (feature territories-pictures-rights).

A route's ``pictures[]`` slot (schema ``picture``) is a ``sketch`` (drawn from the palette), a ``frame`` (a real picture, held by link:
``image`` is ``sha256:<hex>``, never copied bytes) or a ``gap`` (an honest "no picture", with its reason). This module is the ONE place
that says what a slot shows and what may happen to it, so the screen, the Booth and the gates read the same words (LESSONS 8, 9, 10, 14):

* identity: a picture is its content hash. Slots are picked by id or hash, never by position; one hash fills one slot of a route
  (``fill`` leaves the repeats as gaps with a reason) and never two routes (``contract.check``);
* rights: the words of Production's rights chip and the Deck. ``generated``, ``own`` and ``licensed`` count only when someone stated
  them; unknown, unstated, a mock's silence, or any other word (``client_supplied``, ``reference_only``) read ``Rights to supply``;
* Final: only a frame, one per touchpoint of a route, and a Final with no stated rights holds the greenlight gate (``blockers``);
* carrying in: ``rehome`` puts EVERY picture of an arriving bundle on this document's own store and says which did not arrive
  (a mock is never used and is named, never counted as arrived); ``require_all`` refuses a partial arrival in words;

Standard library only: it runs in the middleware image.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path


TRUSTED = ("generated", "own", "licensed")
RIGHTS_WORD = {"generated": "Generated", "own": "Own", "licensed": "Licensed", "unknown": "Rights to supply"}
#: the menu a person picks from, in order, with Production's hints
RIGHTS_CHOICES = [
    {"rights": "generated", "label": "Generated", "hint": "Made by the agency's tools."},
    {"rights": "own", "label": "Own", "hint": "Drawn or shot by the agency."},
    {"rights": "licensed", "label": "Licensed", "hint": "Someone has said it is licensed."},
    {"rights": "unknown", "label": "Rights to supply", "hint": "Nobody has said yet. A client sees it marked 'Rights to supply'."},
]
LABEL_SKETCH, LABEL_FRAME = "Mock-up", "Illustrative"
HEX = re.compile(r"^[0-9a-f]{64}$")
PICTURE_MIME = ("image/png", "image/jpeg", "image/webp", "image/gif")


class PictureError(ValueError):
    """Said in words a person can read."""


# ---------------------------------------------------------------- identity


def hash_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def link(sha: str) -> str:
    return "sha256:" + bare(sha)


def bare(sha: str) -> str:
    """64 lowercase hex from ``<hex>`` or ``sha256:<hex>``; anything else is an error."""
    h = str(sha or "").strip().lower().removeprefix("sha256:")
    if not HEX.match(h):
        raise PictureError("That is not a picture hash (64 hex characters).")
    return h


# ---------------------------------------------------------------- rights, labels


def rights_of(value) -> str:
    """The rights a person stated, or ``unknown``. Nothing is inferred from where a picture came from."""
    return value if value in TRUSTED else "unknown"


def rights_word(value) -> str:
    return RIGHTS_WORD[rights_of(value)]


def label_of(slot: dict) -> str:
    """The label every picture carries: a palette sketch is a Mock-up of the look, a picture is Illustrative (creative, never sourced)."""
    return LABEL_SKETCH if slot.get("kind") == "sketch" else LABEL_FRAME


def chip(slot: dict) -> dict | None:
    """What the screen draws on a slot: ``None`` for a gap (no picture, nothing to label)."""
    kind = slot.get("kind")
    if kind == "gap":
        return None
    r = rights_of(slot.get("rights")) if kind == "frame" else None
    sha = slot.get("sha256")
    return {"id": slot["id"], "kind": kind, "label": label_of(slot), "sha256": sha, "hash": (sha or "")[:8] or None,
            "rights": r, "rights_word": RIGHTS_WORD[r] if r else None, "trusted": r in TRUSTED if r else None,
            "final": bool(slot.get("final")), "source": slot.get("source")}


def view(t: dict) -> list[dict]:
    """The chips of a route's slots, in slot order (a gap shows its reason instead)."""
    return [{**(chip(s) or {"id": s["id"], "kind": "gap", "label": None, "final": False}), "touchpoint": s["touchpoint"],
             **({"gap_reason": s["gap_reason"]} if s.get("gap_reason") else {})} for s in t.get("pictures") or []]


# ---------------------------------------------------------------- slots: picked by id or hash, never by position


def find(t: dict, ref: str) -> dict:
    """The slot ``ref`` names: a slot id (``pic_...``) or a picture hash. A position is never a name."""
    slots = t.get("pictures") or []
    for s in slots:
        if s["id"] == ref:
            return s
    try:
        h = bare(ref)
    except PictureError:
        raise PictureError("That picture slot is not on this route.") from None
    hit = [s for s in slots if s.get("sha256") == h]
    if not hit:
        raise PictureError("No picture on this route has that hash.")
    return hit[0]


def attach(t: dict, slot_id: str, carried: dict) -> dict:
    """Put a carried picture (``rehome``'s record: sha256, rights, source) in the slot ``slot_id`` as a frame, by link. A hash the route
    already shows is refused (one picture, one slot). Rights are the picture's own stated rights, else ``unknown``."""
    s = find(t, slot_id)
    if s["id"] != slot_id:
        raise PictureError("Name the slot by its id.")
    h = bare(carried["sha256"])
    if any(o.get("sha256") == h and o is not s for o in t["pictures"]):
        raise PictureError("This route already shows that picture in another place.")
    if carried.get("status") == "skipped":
        raise PictureError(carried.get("why") or "That picture cannot be used.")
    s.update(kind="frame", image=link(h), sha256=h, rights=rights_of(carried.get("rights")))
    s.pop("gap_reason", None)
    s.pop("final", None)
    if carried.get("source"):
        s["source"] = str(carried["source"])[:200]
    return s


def fill(t: dict, carried: list[dict]) -> dict:
    """Give each slot that is not yet a frame the next picture that fits (same touchpoint first, then any), once each. A picture repeated
    in the list fills one slot; a slot it would have filled again is an honest gap with the reason, never the same picture twice (LESSONS
    14). A slot nothing was carried for stays as it was (a sketch). Returns ``{placed, gaps}``."""
    seen, queue, repeats = {s.get("sha256") for s in t["pictures"] if s.get("kind") == "frame"}, [], 0
    for c in carried:
        if c.get("status") == "skipped":
            continue
        h = bare(c["sha256"])
        if h in seen:
            repeats += 1
            continue
        seen.add(h)
        queue.append(c)
    placed = gaps = 0
    open_slots = [s for s in t["pictures"] if s.get("kind") != "frame"]
    for s in list(open_slots):          # first, a picture meant for this very place
        pick = next((c for c in queue if c.get("touchpoint") == s["touchpoint"]), None)
        if pick is not None:
            queue.remove(pick)
            attach(t, s["id"], pick)
            open_slots.remove(s)
            placed += 1
    for s in open_slots:                # then the next one left
        if queue:
            attach(t, s["id"], queue.pop(0))
            placed += 1
        elif repeats > gaps:
            s.update(kind="gap", gap_reason="The same picture was already placed on this route; this place needs its own.")
            gaps += 1
    return {"placed": placed, "gaps": gaps}


def set_rights(t: dict, ref: str, rights: str) -> dict:
    s = find(t, ref)
    if s.get("kind") != "frame":
        raise PictureError("Only a picture has rights; this slot holds none.")
    if rights not in (*TRUSTED, "unknown"):
        raise PictureError("Rights are Generated, Own, Licensed or not known yet.")
    s["rights"] = rights
    return s


def set_final(t: dict, ref: str, on: bool = True) -> dict:
    """Mark (or unmark) a picture Final. Only a frame can be Final; marking one replaces the Final of the same touchpoint, so a route's
    two pictures of one place never both claim it. Rights are not required to mark, but ``blockers`` holds the greenlight until stated."""
    s = find(t, ref)
    if s.get("kind") != "frame":
        raise PictureError("Only a picture can be marked Final.")
    if not on:
        s.pop("final", None)
        return s
    for o in t["pictures"]:
        if o is not s and o["touchpoint"] == s["touchpoint"]:
            o.pop("final", None)
    s["final"] = True
    return s


def finals(t: dict) -> list[dict]:
    return [s for s in t.get("pictures") or [] if s.get("final")]


def blockers(doc: dict) -> list[dict]:
    """``run.gate.blocked_by`` entries for greenlit routes whose Final picture has no stated rights (Send is held, the Booth asks)."""
    green = {g["territory_id"] for g in doc.get("greenlit") or []}
    out = []
    for t in doc.get("territories") or []:
        if t["id"] in green and t.get("state") == "developed":
            if any(rights_of(s.get("rights")) == "unknown" for s in finals(t)):
                out.append(t)
    if not out:
        return []
    names = [t.get("name") or "A route" for t in out]
    many = len(names) > 1
    return [{"kind": "picture_rights", "ids": [t["id"] for t in out],
             "text": ", ".join(names[:-1]) + (" and " if many else "") + names[-1] +
                     (" have" if many else " has") + " a Final picture with no rights chosen. Say whose it is, or take it off Final."}]


# ---------------------------------------------------------------- carrying pictures in (LESSONS 8: all of them, on this store)


class MemoryStore:
    """A content-addressed store: ``put`` verifies the hash and never overwrites. The hosted web's blob store has the same two calls."""

    def __init__(self):
        self.blobs: dict[str, bytes] = {}

    def has(self, sha: str) -> bool:
        return sha in self.blobs

    def put(self, sha: str, data: bytes) -> None:
        if hash_of(data) != sha:
            raise PictureError("The bytes do not match the picture's hash.")
        self.blobs.setdefault(sha, data)


class DirStore(MemoryStore):
    """``<root>/blobs/<aa>/<sha256>`` on disk, the layout of the hosted workspace's blob store."""

    def __init__(self, root):
        super().__init__()
        self.root = Path(root)

    def _path(self, sha: str) -> Path:
        return self.root / "blobs" / sha[:2] / sha

    def has(self, sha: str) -> bool:
        return self._path(sha).is_file()

    def put(self, sha: str, data: bytes) -> None:
        if hash_of(data) != sha:
            raise PictureError("The bytes do not match the picture's hash.")
        p = self._path(sha)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)

    def get(self, sha: str) -> bytes:
        return self._path(sha).read_bytes()


def zip_reader(z):
    """A reader of an export zip's ``assets/<hex>.<ext>`` files: ``reader(sha) -> bytes | None``."""
    names = {}
    for n in z.namelist():
        if n.startswith("assets/") and not n.endswith("/"):
            names.setdefault(Path(n).stem.lower(), n)
    return lambda sha: z.read(names[sha]) if sha in names else None


def _is_picture(meta: dict) -> bool:
    return meta.get("kind") == "image" or str(meta.get("mime") or "").lower() in PICTURE_MIME


def rehome(assets: dict, reader, store, *, source: str | None = None) -> dict:
    """Put every picture an arriving document names on ``store``. ``assets``: its ``assets`` map (``sha256:<hex>`` -> {kind, mime, origin,
    rights, ...}); ``reader(sha) -> bytes | None`` finds the bytes (the bundle, or the source's signed assets pass). Videos and files are not
    pictures and are not touched. A mock is never used: named as skipped, never as arrived. Bytes that do not hash to their name, or that
    cannot be read, are named too. Returns ``{ok, pictures: [{sha256, status, rights, why?, ...}], arrived, missing, skipped, wanted}``."""
    rows = []
    for key, meta in (assets or {}).items():
        meta = meta if isinstance(meta, dict) else {}
        if not _is_picture(meta):
            continue
        try:
            sha = bare(meta.get("sha256") or key)
        except PictureError:
            rows.append({"sha256": str(key), "status": "missing", "why": "Its hash is not a hash."})
            continue
        row = {"sha256": sha, "rights": rights_of(meta.get("rights")), "origin": meta.get("origin"), "mime": meta.get("mime"),
               "source": source}
        if meta.get("origin") == "mock":
            rows.append({**row, "status": "skipped", "why": "A mock is never used as a picture."})
            continue
        if store.has(sha):
            rows.append({**row, "status": "already"})
            continue
        data = reader(sha)
        if data is None:
            rows.append({**row, "status": "missing", "why": "The picture's file did not come with the document."})
        elif hash_of(data) != sha:
            rows.append({**row, "status": "mismatch", "why": "The file is not the picture it is named for."})
        else:
            store.put(sha, data)
            rows.append({**row, "status": "arrived"})
    n = lambda *st: sum(r["status"] in st for r in rows)  # noqa: E731
    wanted = len(rows) - n("skipped")
    return {"ok": n("missing", "mismatch") == 0, "pictures": rows, "arrived": n("arrived", "already"), "missing": n("missing", "mismatch"),
            "skipped": n("skipped"), "wanted": wanted}


def require_all(report: dict) -> dict:
    """The report, or a refusal that counts and says it in words: ``19 of 23 pictures arrived``."""
    if report["ok"]:
        return report
    raise PictureError(f"{report['arrived']} of {report['wanted']} pictures arrived; the rest are missing from the document sent. "
                       "Send it again from its source.")


def carry_export(zip_path, store) -> dict:
    """The local check: carry the pictures of a Production export (a zip of ``<name>.clan`` and ``assets/<hex>.<ext>``) onto ``store``.
    Needs PyYAML, only here, to read the export's ``shared/data.yaml``."""
    import io
    import zipfile

    import yaml
    with zipfile.ZipFile(zip_path) as z:
        clan = next(n for n in z.namelist() if n.endswith(".clan"))
        with zipfile.ZipFile(io.BytesIO(z.read(clan))) as c:
            data = yaml.safe_load(c.read("shared/data.yaml"))
            title = yaml.safe_load(c.read("manifest.yaml")).get("title")
        return rehome(data.get("assets") or {}, zip_reader(z), store, source=f"Production: {title}" if title else None)


if __name__ == "__main__":     # python -m territory.pictures carry <export.zip> <store dir>
    import json
    import sys
    if sys.argv[1:2] == ["carry"] and len(sys.argv) == 4:
        rep = carry_export(sys.argv[2], DirStore(sys.argv[3]))
        print(json.dumps({k: rep[k] for k in ("ok", "wanted", "arrived", "missing", "skipped")}), *(f"{r['status']:8} {r['sha256'][:12]} {r['rights']:9} {r.get('origin')}" for r in rep["pictures"]), sep="\n")
        sys.exit(0 if rep["ok"] else 1)
    sys.exit("usage: python -m territory.pictures carry <export.zip> <store dir>")
