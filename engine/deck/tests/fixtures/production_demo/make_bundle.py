"""An invented Production Tool export for deck-prod-assets, built in code (no client material, nothing committed but this script).

    python3 make_bundle.py OUT.zip

The zip follows production-tool/web/src/export.ts and clan-store/src/bundle.ts on develop (375e3a77): ``<project>.clan`` (a CLAN zip
whose ``shared/data.yaml`` is a contract-3 document) plus ``assets/<sha256 hex>.<ext>``, stored, with the comment ``napkin-fixture``.
The project is the invented Lumen Water demo: abstract Pillow drawings of a tap, a glass and morning light.

What it holds, so the importer has each case once: two Format sets (the newer one's master made in Production, with a protect box;
the older one's master an upload, linked to a brief), sizes ready, flagged ('look'), stale, making, a film (video) size, a size of a
client's own format and an upload's size; a storyboard of four shots and an end card with picked frames (generated, an edit of a
generated frame, a mock one); an ad render (video); an edit of a canvas picture and an edit with no frame chain; a brief whose spine
has a part marked Confidential; a decision chain; asset thumbs, locations and a copy line. ``CANARIES`` lists words that must never
reach production.json.
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

T0 = (1980, 1, 1, 0, 0, 0)
CANARIES = ("SECRET-INSIGHT-LUMEN", "DECISION-TEXT-LUMEN", "COPY-LINE-LUMEN", "THUMBDATA", "example.invalid", "LAYER-WORDS-LUMEN")


def uid(prefix: str, n: int) -> str:
    """A fixed id in the contract's form: prefix, '_', 26 Crockford base-32 characters (time-sortable like a ULID: higher n is newer)."""
    return f"{prefix}_01KB{n:022d}"


PROJECT = uid("proj", 1)
FSET_OLD, FSET_NEW = uid("fset", 1), uid("fset", 2)
S_STORY, S_SIX, S_FEED, S_LINK, S_MAKING, S_FILM, S_CLIENT, S_OLD_STORY = (uid("size", n) for n in range(1, 9))
SB = uid("storyboard", 1)
SH1, SH2, SH3, SH4, SH_END = (uid("shot", n) for n in range(1, 6))
F1_OLD, F1, F2, F3_GEN, F3, F4, FE, FN0, FN1 = (uid("frame", n) for n in range(1, 10))
BRIEF, LINK, VIDEO, RENDER = uid("brief", 1), uid("link", 1), uid("video", 1), uid("render", 1)
JOB = uid("job", 1)
BRIEF_DOC = "doc-lumen-brief-0001"

#: name -> (w, h, hue): every picture drawn once.
PICTURES = {"master": (1920, 1080, 0), "upload_master": (1280, 720, 1), "story": (1080, 1920, 2), "six": (1200, 1800, 3), "feed": (1080, 1350, 4),
            "link": (1146, 600, 5), "client": (1080, 1350, 6), "old_story": (1080, 1920, 7), "f1_old": (1280, 720, 8), "f1": (1280, 720, 9),
            "f2": (1280, 720, 10), "f3_gen": (1280, 720, 11), "f3": (1280, 720, 12), "f4": (1280, 720, 13), "fe": (1280, 720, 14),
            "fn0": (1280, 720, 15), "fn1": (1280, 720, 16), "orphan": (1280, 720, 17), "making": (1080, 1080, 18)}


def draw(w: int, h: int, hue: int) -> bytes:
    """An abstract morning scene: a sky band, a tap and a glass, shifted by ``hue``. PNG bytes."""
    im = Image.new("RGB", (w, h), (200 - hue * 5, 220 - hue * 3, 235))
    d = ImageDraw.Draw(im)
    d.rectangle([0, int(h * 0.62), w, h], fill=(90 + hue * 4, 110, 130 - hue * 2))
    cx = int(w * (0.62 + 0.01 * (hue % 5)))
    d.rectangle([cx - w // 30, int(h * 0.18), cx + w // 30, int(h * 0.40)], fill=(60, 66, 74))
    d.rectangle([cx - w // 30, int(h * 0.18), cx + w // 8, int(h * 0.24)], fill=(60, 66, 74))
    d.rectangle([cx + w // 12, int(h * 0.30), cx + w // 6, int(h * 0.60)], outline=(240, 248, 255), width=max(2, w // 120))
    d.ellipse([w // 10, h // 10, w // 10 + h // 5, h // 10 + h // 5], fill=(250, 230, 170))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def sha(b: bytes) -> str:
    return "sha256:" + hashlib.sha256(b).hexdigest()


def document(pics: dict) -> dict:
    """The contract-3 document for the drawn pictures (``pics``: name -> bytes)."""
    A = {k: sha(v) for k, v in pics.items()}
    video_bytes = b"invented clip, not a real video"
    A["film"] = sha(video_bytes)
    A["render"] = sha(video_bytes + b" render")

    def asset(name, origin, kind="image", mime="image/png", **kw):
        w, h = PICTURES.get(name, (0, 0, 0))[:2]
        a = {"sha256": A[name], "kind": kind, "mime": mime, "origin": origin, "locations": [f"https://example.invalid/out/{A[name]}"],
             "thumb": "data:image/webp;base64,THUMBDATA"}
        if kind == "image":
            a.update(w=w, h=h)
        a.update(kw)
        return a

    assets = {A["master"]: asset("master", "generated", job_id=JOB), A["upload_master"]: asset("upload_master", "uploaded"),
              A["story"]: asset("story", "generated", job_id=JOB), A["six"]: asset("six", "generated"), A["feed"]: asset("feed", "generated"),
              A["link"]: asset("link", "generated"), A["client"]: asset("client", "generated"), A["old_story"]: asset("old_story", "generated"),
              A["f1_old"]: asset("f1_old", "generated"), A["f1"]: asset("f1", "generated", job_id=JOB), A["f2"]: asset("f2", "generated"),
              A["f3_gen"]: asset("f3_gen", "generated"), A["f3"]: asset("f3", "edited"), A["f4"]: asset("f4", "mock"), A["fe"]: asset("fe", "generated"),
              A["fn0"]: asset("fn0", "uploaded"), A["fn1"]: asset("fn1", "edited"), A["orphan"]: asset("orphan", "edited"),
              A["making"]: asset("making", "generated"),
              A["film"]: asset("film", "generated", kind="video", mime="video/mp4", duration_s=6),
              A["render"]: asset("render", "generated", kind="video", mime="video/mp4", duration_s=30)}
    E = lambda i, **kw: {"id": i, "v": 2, "field_v": {}, **kw}   # noqa: E731

    def fmt(pack, fid):
        return {"pack_id": pack, "pack_version": "2026-10-13", "format_id": fid}

    def size(i, set_id, rank, pack, fid, aw, ah, method, status, name, **kw):
        s = E(i, set_id=set_id, rank=rank, format=fmt(pack, fid), aspect={"w": aw, "h": ah}, delivery={"width": aw * 100, "height": ah * 100},
              method=method, media="image", **kw)
        if status:
            s["status"] = status
        if name:
            s["asset"] = A[name]
            s["plate"] = A[name]
            s["from_asset"] = A["upload_master" if set_id == FSET_OLD else "master"]
        s["layers"] = {"line": {"text": "LAYER-WORDS-LUMEN"}}
        return s

    sizes = {
        S_STORY: size(S_STORY, FSET_NEW, "a1", "social", "meta-stories-9x16", 9, 16, "crop", "ready", "story", crop={"x": 1040, "y": 0, "w": 607.5, "h": 1080}, job_id=JOB),
        S_SIX: size(S_SIX, FSET_NEW, "a2", "ooh-uk-ie", "uk-6-sheet", 2, 3, "regenerate", "ready", "six"),
        S_FEED: size(S_FEED, FSET_NEW, "a3", "social", "meta-feed-image-4x5", 4, 5, "crop", "look", "feed", crop={"x": 800, "y": 0, "w": 864, "h": 1080}),
        S_LINK: size(S_LINK, FSET_NEW, "a4", "social", "linkedin-image-1.91x1", 191, 100, "crop", "stale", "link"),
        S_MAKING: size(S_MAKING, FSET_NEW, "a5", "social", "meta-feed-image-1x1", 1, 1, "crop", "making", "making"),
        S_FILM: {**size(S_FILM, FSET_NEW, "a6", "film", "film-16x9", 16, 9, "reedit", "ready", None), "media": "video", "asset": A["film"], "length_s": 6},
        S_CLIENT: size(S_CLIENT, FSET_NEW, "a7", "lumen-own", "lumen-bus-panel", 4, 5, "extend", "ready", "client"),
        S_OLD_STORY: size(S_OLD_STORY, FSET_OLD, "a1", "social", "meta-stories-9x16", 9, 16, "crop", "ready", "old_story"),
    }
    frames = {
        F1_OLD: E(F1_OLD, shot_id=SH1, version=1, kind="generated", asset=A["f1_old"], crew="wren"),
        F1: E(F1, shot_id=SH1, version=2, kind="generated", asset=A["f1"], crew="wren", job_id=JOB),
        F2: E(F2, shot_id=SH2, version=1, kind="generated", asset=A["f2"], crew="wren"),
        F3_GEN: E(F3_GEN, shot_id=SH3, version=1, kind="generated", asset=A["f3_gen"], crew="wren"),
        F3: E(F3, shot_id=SH3, version=2, kind="edited", parent_id=F3_GEN, asset=A["f3"], crew="rhea", edits=[{"op": "crop"}]),
        F4: E(F4, shot_id=SH4, version=1, kind="mock", asset=A["f4"], crew="wren"),
        FE: E(FE, shot_id=SH_END, version=1, kind="generated", asset=A["fe"], crew="wren"),
        FN0: E(FN0, node="pic_up_0001", version=1, kind="original", asset=A["fn0"]),
        FN1: E(FN1, node="pic_up_0001", version=2, kind="edited", parent_id=FN0, asset=A["fn1"], crew="rhea"),
    }
    cam = {"size": "wide"}
    shots = {SH1: E(SH1, storyboard_id=SB, rank="a1", kind="shot", duration_s=3, camera=cam, status="locked", pick={"current": F1, "alternates": [F1_OLD]},
                    action="A kitchen tap at first light"),
             SH2: E(SH2, storyboard_id=SB, rank="a2", kind="shot", duration_s=3, camera=cam, status="locked", pick={"current": F2}),
             SH3: E(SH3, storyboard_id=SB, rank="a3", kind="shot", duration_s=3, camera=cam, status="locked", pick={"current": F3}),
             SH4: E(SH4, storyboard_id=SB, rank="a4", kind="shot", duration_s=3, camera=cam, status="locked", pick={"current": F4}),
             SH_END: E(SH_END, storyboard_id=SB, rank="a5", kind="end_card", duration_s=2, camera=cam, status="locked", pick={"current": FE})}
    empty = ("boards", "sketches", "scripts", "scenes", "beats", "generations", "reviews", "keys", "refs", "documents", "checks", "asks",
             "suggestions", "spin_ins", "jobs", "stale", "exports", "texts")
    doc = {"contract_version": "3", "app": "production-tool",
           "project": {"id": PROJECT, "tenant_id": "00000000-0000-4000-8000-000000000001", "title": "Lumen Water launch (invented)",
                       "created_by": "human:demo-producer", "created_at": "2026-11-18T09:00:00Z"},
           **{k: {} for k in empty}, "assets": assets, "frames": frames, "shots": shots, "sizes": sizes,
           "storyboards": {SB: E(SB, title="The Tap Tells film", ratio="16:9", target_s=30)},
           "videos": {VIDEO: E(VIDEO, title="The Tap Tells", ratio="16:9", timeline={})},
           "renders": {RENDER: E(RENDER, video_id=VIDEO, version=1, asset=A["render"], job_id=JOB)},
           "format_sets": {
               FSET_OLD: E(FSET_OLD, master={"kind": "picture", "id": "pic_up_0002", "asset": A["upload_master"], "w": 1280, "h": 720},
                           pack={"pack_id": "social", "pack_version": "2026-10-13"}, protect={"keep_middle": True}),
               FSET_NEW: E(FSET_NEW, master={"kind": "picture", "id": "pic_kv_0001", "asset": A["master"], "w": 1920, "h": 1080},
                           pack={"pack_id": "campaign-launch", "pack_version": "2026-10-13"},
                           protect={"boxes": [{"role": "subject", "label": "the tap", "x": 1200, "y": 240, "w": 400, "h": 600}]},
                           copy={"line": "COPY-LINE-LUMEN", "legal": "Invented legal line."})},
           "briefs": {BRIEF: E(BRIEF, title="Lumen Water awareness",
                               source={"document_id": BRIEF_DOC, "app_id": "ie.napkin.brief-maker", "data_sha256": "sha256:" + "ab" * 32,
                                       "taken": 1, "at": "2026-11-18T09:00:00Z", "how": "link"},
                               spine={"insight": "SECRET-INSIGHT-LUMEN: people never link water to their own tap", "proposition": "Every drop has a story."},
                               confidential=["insight"])},
           "links": {LINK: E(LINK, **{"from": {"kind": "brief", "id": BRIEF}, "to": {"kind": "format_set", "id": FSET_OLD}, "role": "brief"})}}
    return doc


def build(out: Path, *, legacy: bool = False, contract: str = "3", flip: str | None = None, omit: str | None = None, embed: tuple = (),
          mutate=None) -> dict:
    """Write the export zip to ``out``; return ``{name: sha256 hex}`` of the drawn pictures. ``flip``: a picture whose zip bytes get one byte
    changed after hashing; ``omit``: one left out of the zip; ``embed``: pictures put in the .clan's human/assets/ instead of the zip's
    assets/; ``legacy``: the document.json export; ``mutate(doc)``: change the document before it is written."""
    pics = {k: draw(*v) for k, v in PICTURES.items()}
    doc = document(pics)
    doc["contract_version"] = contract
    if mutate:
        mutate(doc)
    zi = lambda n: zipfile.ZipInfo(n, T0)   # noqa: E731
    files = {}
    for name, b in pics.items():
        hx = hashlib.sha256(b).hexdigest()
        if name == omit:
            continue
        if name == flip:
            b = bytes([b[0] ^ 0xFF]) + b[1:]
        files[("clan" if name in embed else "zip", f"{'human/' if name in embed else ''}assets/{hx}.png")] = b
    video = b"invented clip, not a real video"
    files[("zip", f"assets/{hashlib.sha256(video).hexdigest()}.mp4")] = video
    files[("zip", f"assets/{hashlib.sha256(video + b' render').hexdigest()}.mp4")] = video + b" render"
    out = Path(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        z.comment = b"napkin-fixture"
        if legacy:
            z.writestr(zi("document.json"), json.dumps(doc))
        else:
            cbuf = io.BytesIO()
            with zipfile.ZipFile(cbuf, "w", zipfile.ZIP_DEFLATED) as c:
                c.writestr(zi("manifest.yaml"), "format: clan\napp_id: ie.napkin.production-tool\n")
                c.writestr(zi("shared/data.yaml"), json.dumps(doc, indent=1))   # JSON is YAML: the store writes YAML, the reader reads either
                c.writestr(zi("agent/decision-chain.yaml"), "- decision: DECISION-TEXT-LUMEN\n")
                for (where, name), b in sorted(files.items()):
                    if where == "clan":
                        c.writestr(zi(name), b)
            z.writestr(zi("Lumen-Water-launch-invented.clan"), cbuf.getvalue())
        for (where, name), b in sorted(files.items()):
            if where == "zip":
                z.writestr(zi(name), b)
        z.writestr(zi("canvas.napkin.json"), json.dumps({"elements": []}))
    return {k: hashlib.sha256(v).hexdigest() for k, v in pics.items()}


if __name__ == "__main__":
    build(Path(sys.argv[1]))
    print(f"wrote {sys.argv[1]}")
