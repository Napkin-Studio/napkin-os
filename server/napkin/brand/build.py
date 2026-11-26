"""brand_build: a stronger model reads the whole file in pieces and a candidate Brand Bible comes out.

  Build(model, material, name).read(progress) -> Bundle(candidate, uploads, pieces, pictures)

The pieces (the way reading.py reads a long PDF): runs of PIECE_PAGES pages, each sent as its own PDF so the model sees the
pages as pictures (logos, colour chips, specimens) as well as their text; for a file with no PDF (a Word file, a zip of text)
the text. Then the pictures the file holds (embedded pictures, a zip's files) in batches, each classified as a logo, an
example or neither. Merge is merge.py: nothing invented, a section the file lacks is omitted and listed in gaps.

Every call's purpose starts `brand_` (never logged with bodies; see __init__.confidential)."""

import base64
import io
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from . import HARD_CAP
from .merge import assemble, has_content

PIECE = "brand_build_piece"
PICTURES = "brand_build_pictures"
PIECE_PAGES = 15
BATCH = 12
MAX_PICTURES = 48
WORKERS = 4
MAX_DOC = 30 * 1024 * 1024

PIECE_SYSTEM = """You read pages of a brand's own identity guidelines (its brand bible) for an advertising agency, and write down the rules exactly as the book gives them.
Return only what these pages state. Never invent, never fill a gap from what a brand like this usually does, never add a colour, typeface or rule the pages do not show; an empty list is the right answer when the pages do not cover it.
- colours: each brand colour with its name as the book writes it and its hex value if printed. If the book prints only RGB values, convert them; if only CMYK or Pantone and no RGB or hex, leave the colour out. role: accent (the main brand colour), paper (the light background), ink (the text colour), panel (a dark or block background), accent_ink (text on the accent), chart (a data colour), or other when the book says none.
- typography: each typeface family named, its weight(s) as text ("700", "400 / 600"), what it is used for, and role head (headlines), body (body copy) or other.
- tone: one line, in the book's words, on how the brand sounds. rules: each writing rule, kind do (what to do) or dont (what never to do), one sentence each.
- imagery_style: one line on the style of pictures. imagery_bans: each kind of picture the book bans.
- logo_note: the clear-space and placement rule for the logo, in one line.
Copy no more than a short phrase of the book at a time."""
PIECE_SCHEMA = {"type": "object", "additionalProperties": False,
                "required": ["colours", "typography", "tone", "rules", "imagery_style", "imagery_bans", "logo_note"],
                "properties": {
                    "colours": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["name", "hex", "role"],
                                                           "properties": {"name": {"type": "string"}, "hex": {"type": "string"}, "role": {"type": "string"}}}},
                    "typography": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["family", "weight", "use", "role"],
                                                              "properties": {"family": {"type": "string"}, "weight": {"type": "string"}, "use": {"type": "string"},
                                                                             "role": {"type": "string"}}}},
                    "tone": {"type": "string"},
                    "rules": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["text", "kind"],
                                                         "properties": {"text": {"type": "string"}, "kind": {"type": "string"}}}},
                    "imagery_style": {"type": "string"},
                    "imagery_bans": {"type": "array", "items": {"type": "string"}},
                    "logo_note": {"type": "string"}}}

PICTURE_SYSTEM = """These are pictures taken from a brand's identity guidelines or the files sent with them. For each, say what it is for the brand's Brand Clan.
- use: logo (the brand's logo, wordmark or mark, a real artwork of it), example (a photograph or picture the book gives as an example of its imagery), or other (a diagram, a page background, a rule, a person, a competitor, anything else).
- label: for a logo, what it is ("Wordmark, light ground", "Mark"); variant: light (for a light ground), dark (for a dark ground), mark (the symbol alone) or other.
- note: one short line only when it helps.
Judge only from the picture, its name and the text near it. When unsure, use other. Never describe a picture that is not in the list."""
PICTURE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["pictures"],
                  "properties": {"pictures": {"type": "array", "items": {
                      "type": "object", "additionalProperties": False, "required": ["image_id", "use", "label", "variant", "note"],
                      "properties": {"image_id": {"type": "string"}, "use": {"type": "string"}, "label": {"type": "string"},
                                     "variant": {"type": "string"}, "note": {"type": "string"}}}}}}


@dataclass
class Bundle:
    candidate: dict
    uploads: dict                       # asset name -> (bytes, media type)
    pieces: int = 0
    pictures: int = 0
    notes: list = field(default_factory=list)

    @property
    def has_content(self) -> bool:
        return has_content(self.candidate)


def sub_pdf(data: bytes, first: int, last: int) -> bytes | None:
    """Pages first..last (from 1) of a PDF as a PDF of their own, or None when it cannot be cut or is too big to send."""
    from pypdf import PdfReader, PdfWriter
    try:
        r, w = PdfReader(io.BytesIO(data)), PdfWriter()
        if r.is_encrypted:
            r.decrypt("")
        for i in range(first - 1, min(last, len(r.pages))):
            w.add_page(r.pages[i])
        buf = io.BytesIO()
        w.write(buf)
        out = buf.getvalue()
        return out if len(out) <= MAX_DOC else None
    except Exception:  # noqa: BLE001
        return None


class Build:
    def __init__(self, model, material, name: str):
        self.model, self.m, self.name = model, material, name

    def ranges(self) -> list:
        n = min(self.m.page_count, HARD_CAP)
        return [(a, min(a + PIECE_PAGES - 1, n)) for a in range(1, n + 1, PIECE_PAGES)] if n else []

    def batches(self) -> list:
        ims = self.m.images[:MAX_PICTURES]
        return [ims[i:i + BATCH] for i in range(0, len(ims), BATCH)]

    def units(self) -> int:
        """Model calls this build makes: what the progress counts."""
        return len(self.ranges()) + len(self.batches())

    def _piece(self, a: int, b: int) -> dict:
        payload = {"file_name": self.m.name, "pages": f"{a}-{b}" if b > a else str(a), "of": self.m.page_count}
        parts = None
        if self.m.pdf and b <= self.m.pdf_pages:
            doc = sub_pdf(self.m.pdf, a, b)
            if doc:
                parts = [{"media_type": "application/pdf", "data": base64.b64encode(doc).decode()}]
        if parts is None:
            payload["text"] = {str(i): self.m.pages[i - 1][:4000] for i in range(a, b + 1) if i <= len(self.m.pages)}
        return self.model.structured(PIECE, PIECE_SYSTEM, payload, PIECE_SCHEMA, max_tokens=4000, images=parts, vision=parts is not None)

    def _batch(self, ims: list) -> list:
        viewable = [im for im in ims if im.media_type != "image/svg+xml"]
        payload = {"file_name": self.m.name, "members": self.m.members[:60],
                   "pictures": [{"image_id": im.id, "name": im.name, "page": im.page, "viewable": im.media_type != "image/svg+xml",
                                 "near_text": (self.m.pages[im.page - 1][:300] if im.page and im.page <= len(self.m.pages) else None)} for im in ims]}
        parts = [{"media_type": im.media_type, "data": base64.b64encode(im.data).decode()} for im in viewable]
        out = self.model.structured(PICTURES, PICTURE_SYSTEM, payload, PICTURE_SCHEMA, max_tokens=2500, images=parts or None, vision=bool(parts))
        return out.get("pictures") or []

    def read(self, progress=lambda done: None) -> Bundle:
        done, pieces, classified = [0], [], []

        def tick(v):
            done[0] += 1
            progress(done[0])
            return v
        jobs = [("piece", r) for r in self.ranges()] + [("pictures", b) for b in self.batches()]
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = [ex.submit(lambda k=k, x=x: tick(self._piece(*x) if k == "piece" else self._batch(x))) for k, x in jobs]
            try:
                results = [f.result() for f in futs]
            except BaseException:
                for f in futs:
                    f.cancel()          # what has not started never spends
                raise
        for (kind, _), res in zip(jobs, results):
            (pieces if kind == "piece" else classified).extend([res] if kind == "piece" else res)
        images = {im.id: im for im in self.m.images}
        cand, uploads = assemble(self.name, pieces, classified, images, saw_pictures=bool(self.m.images))
        return Bundle(cand, uploads, pieces=len(pieces), pictures=len(self.m.images[:MAX_PICTURES]))
