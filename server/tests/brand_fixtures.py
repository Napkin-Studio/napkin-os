"""Fixtures for the brand tests: a PDF made in memory, a zip, the recorded model outputs (recorded/brand/*.json: the answers the model
gives for the Tidewell sample, as the schemas of brand/identify.py and brand/build.py shape them), and a writer that records what
the job sent the host, shaped by docs/contracts/brand-clan.md section 5. Nothing here calls a model or the network."""

import io
import json
import zipfile
import zlib
from pathlib import Path

RECORDED = Path(__file__).parent / "recorded" / "brand"

BIBLE_PAGES = [
    "Tidewell Brand Guidelines 2026",
    "Our logo. Clear space: keep the height of the T clear on every side. Minimum size 24 mm.",
    "Colour palette. Tide blue #0A6BA0, Foam #F4F6F7, Ink #1C2630. Pantone 3005 C. RGB 10 107 160. CMYK 100 50 0 20.",
    "Typography. Tidewell Serif 700 for headlines, Tidewell Sans 400 and 600 for body copy.",
    "Tone of voice. Warm, plain, never shouty. Do write in short sentences. Don't use exclamation marks.",
    "Imagery. Real people by the water, natural light. Never stock handshakes. Do's and don'ts of logo misuse.",
]


def recorded(name: str):
    return json.loads((RECORDED / name).read_text())


def make_pdf(pages: list[str], jpeg: bytes | None = None, rgb: bytes | None = None, vector: bool = False) -> bytes:
    """A PDF with one text line per page (Helvetica) and, when `jpeg` is given, that JPEG as a DCT image on page 2; `rgb` is 40x40 raw RGB pixels (4800 bytes) as a Flate image on page 3;
    `vector` draws an invented logo as paths on page 1: a blue block with a smaller orange block beside it, 130 x 60 points at (100, 500), and a page-sized pale background."""
    objs = []   # object bodies, 1-based

    def add(body: bytes) -> int:
        objs.append(body)
        return len(objs)

    cat = add(b"")          # 1 catalog, filled below
    tree = add(b"")         # 2 pages
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    img = add(b"<< /Type /XObject /Subtype /Image /Width 40 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n%s\nendstream"
              % (len(jpeg), jpeg)) if jpeg else None
    img2 = add(b"<< /Type /XObject /Subtype /Image /Width 40 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream"
               % (len(z := zlib.compress(rgb)), z)) if rgb else None
    kids = []
    for i, text in enumerate(pages):
        safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 40 700 Td ({safe}) Tj ET"
        if vector and i == 0:
            stream = "0.95 0.95 0.9 rg 0 0 595 842 re f 0.1 0.3 0.8 rg 100 500 80 60 re f 1 0.5 0 rg 190 500 40 30 re f " + stream
        if jpeg and i == 1:
            stream += " q 100 0 0 100 40 500 cm /Im1 Do Q"
        if rgb and i == 2:
            stream += " q 100 0 0 100 40 500 cm /Im2 Do Q"
        c = add(("<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)).encode())
        res = "/Font << /F1 %d 0 R >>" % font + (" /XObject << /Im1 %d 0 R >>" % img if jpeg and i == 1 else "") \
            + (" /XObject << /Im2 %d 0 R >>" % img2 if rgb and i == 2 else "")
        kids.append(add(("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Contents %d 0 R /Resources << %s >> >>" % (tree, c, res)).encode()))
    objs[cat - 1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[tree - 1] = ("<< /Type /Pages /Count %d /Kids [%s] >>" % (len(kids), " ".join("%d 0 R" % k for k in kids))).encode()
    out, offs = bytearray(b"%PDF-1.4\n"), []
    for n, body in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % n + body + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    return bytes(out)


def fake_jpeg(n: int = 3000, seed: int = 7) -> bytes:
    """Not a picture a viewer could draw: bytes with a JPEG's first bytes, which is all the reader checks."""
    body = bytes((seed * i * 31 + i * i) % 251 for i in range(n))
    return b"\xff\xd8\xff\xe0" + body + b"\xff\xd9"


def fake_png(n: int = 3000, seed: int = 3) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + bytes((seed * i * 17 + i * i) % 253 for i in range(n))


def make_zip(files: dict) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        for k, v in files.items():
            z.writestr(k, v)
    return b.getvalue()


class FakeWriter:
    """What the job sends the host, recorded; shaped by docs/contracts/brand-clan.md section 5 and 7. `refuse` makes a call fail the way the host does."""

    def __init__(self, refuse=None, rename=False):
        self.calls, self.refuse, self.rename = [], refuse, rename

    def _go(self, op, *a):
        from napkin.brand.writer import HostWriteError
        self.calls.append((op, *a))
        if self.refuse == op:
            raise HostWriteError(409, "changed while you were editing")

    def create(self, client, body):
        self._go("create", client, body)
        return {"document_id": "bc-doc-1", "path": "agency/tidewell/brand-original.clan", "version": 1, "name": body["name"]}

    def put_asset(self, doc, name, data, media_type):
        from napkin.brand.writer import asset_path
        self._go("asset.put", doc, name, media_type, len(data))
        return asset_path(name, data) + ("x" if self.rename else "")

    def proposal_set(self, doc, body):
        self._go("proposal.set", doc, body)
        return {"document_id": "bc-doc-1", "path": doc, "version": 1, "pending": {"from_version": 1}}

    def ops(self):
        return [c[0] for c in self.calls]
