"""Reading the uploaded file: a PDF, a picture, a zip of them, a Word file or plain text -> `Material`.

  load(name, data) -> Material(name, kind, pages[text per page], pdf, images, members)

Pages are the text layer a PDF carries (the model also sees the pages as pictures: build.py sends the PDF itself). `images` are
the pictures a logo or an example could be cut from: a PDF's embedded pictures, a zip's picture files, or the file itself. Nothing
is written to disk: a zip is read in memory, member by member, and bounded (a zip bomb is refused, never expanded)."""

import io
import re
import struct
import zipfile
import zlib
from dataclasses import dataclass, field

from ..util import TaskError

MAX_IMAGE = 5 * 1024 * 1024
MIN_IMAGE = 1500            # smaller is a rule line or a bullet, never a logo
MAX_IMAGES = 80             # kept from one file
ZIP_MEMBERS, ZIP_BYTES = 600, 300 * 1024 * 1024
EXT_OF = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
IMAGE_EXT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
SVG = "image/svg+xml"


@dataclass
class Image:
    id: str
    name: str
    media_type: str
    data: bytes
    page: int | None = None   # the PDF page it sits on, from 1


@dataclass
class Material:
    name: str
    kind: str                                   # pdf docx pptx image zip text
    pages: list = field(default_factory=list)   # text of each page, in order
    pdf: bytes | None = None
    pdf_pages: int = 0                          # how many of `pages` the `pdf` holds (a zip may hold several books)
    images: list = field(default_factory=list)
    members: list = field(default_factory=list)  # a zip's file names, for the signals and the model

    @property
    def page_count(self) -> int:
        return len(self.pages) or (1 if self.kind == "image" else 0)

    @property
    def text(self) -> str:
        return "\n\n".join(self.pages)

    def source_kind(self) -> str:
        """The `source.kind` of the schema."""
        return {"pdf": "pdf", "docx": "docx", "pptx": "pptx", "image": "image"}.get(self.kind, "other")


def media_of(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    head = data[:600].lstrip().lower()
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in data[:2000].lower()):
        return SVG
    return None


def ext_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def unreadable(why: str) -> TaskError:
    return TaskError(422, "unreadable_file", why)


def load(name: str, data: bytes) -> Material:
    if not data:
        raise unreadable("the file is empty")
    ext = ext_of(name)
    if data[:4] == b"%PDF" or ext == "pdf":
        return _pdf(name, data)
    if data[:2] == b"PK":
        if ext in ("docx", "pptx"):
            return _office(name, data, ext)
        return _zip(name, data)
    m = media_of(data)
    if m and m != SVG:
        return Material(name, "image", images=[Image("img-1", name, m, data)])
    if m == SVG:
        return Material(name, "image", images=[Image("img-1", name, m, data)])
    if ext in ("txt", "md", "markdown", "text"):
        return Material(name, "text", pages=[data.decode("utf-8", "replace")])
    raise TaskError(415, "unsupported_file", "Napkin reads a PDF, Word or PowerPoint file, a picture, a text file or a zip of them")


def from_text(name: str, text: str | None, images: list | None = None) -> Material:
    """A file the host already read for us (a Word or PowerPoint file: its text and the pictures inside): one page of text, the pictures as they are."""
    ims = [Image(f"m{i}", f"picture-{i}.{EXT_OF.get(x['media_type'], 'bin')}", x["media_type"], x["data"]) for i, x in enumerate(images or [], 1)
           if x.get("media_type") in EXT_OF and MIN_IMAGE <= len(x["data"]) <= MAX_IMAGE][:MAX_IMAGES]
    kind = ext_of(name) if ext_of(name) in ("docx", "pptx") else "text"
    if not (text or "").strip() and not ims:
        raise unreadable("the host could read nothing from the file")
    return Material(name, kind, pages=[text.strip()] if (text or "").strip() else [], images=ims)


def pdf_pages(data: bytes) -> int:
    from pypdf import PdfReader
    try:
        return len(PdfReader(io.BytesIO(data)).pages)
    except Exception:  # noqa: BLE001
        return 0


def _pdf(name: str, data: bytes, prefix: str = "") -> Material:
    from pypdf import PdfReader
    try:
        r = PdfReader(io.BytesIO(data))
        if r.is_encrypted and not r.decrypt(""):
            raise unreadable("the PDF is password protected")
        pages = list(r.pages)
    except TaskError:
        raise
    except Exception:  # noqa: BLE001 - never echo what the parser says about the file
        raise unreadable("the PDF could not be opened") from None
    texts, images = [], []
    for i, p in enumerate(pages, 1):
        try:
            texts.append((p.extract_text() or "").strip())
        except Exception:  # noqa: BLE001
            texts.append("")
        for j, (iname, raw, m) in enumerate(_embedded(p), 1):
            if len(images) >= MAX_IMAGES:
                break
            if MIN_IMAGE <= len(raw) <= MAX_IMAGE:
                images.append(Image(f"{prefix}p{i}-{j}", iname or f"page-{i}-{j}", m, raw, i))
    images.extend(vector_logos(data, texts, prefix, len(images)))
    return Material(name, "pdf", pages=texts, pdf=data, pdf_pages=len(texts), images=images)


def _png(w: int, h: int, channels: int, pixels: bytes) -> bytes:
    """A PNG from 8-bit pixels (pypdf's own image export needs Pillow; this does not)."""
    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
    rows = b"".join(b"\x00" + pixels[y * w * channels:(y + 1) * w * channels] for y in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2 if channels == 3 else 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))


def _embedded(page):
    """(name, bytes, media type) of each picture a PDF page embeds that can be had without a renderer: a JPEG as it is, an 8-bit RGB or grey
    image as a PNG. Anything else (JPX, CMYK, masks, and every vector drawing) is skipped: a logo drawn as vectors is not here."""
    try:
        xo = page["/Resources"].get_object()["/XObject"].get_object()
    except Exception:  # noqa: BLE001 - no pictures on the page
        return
    for key in list(xo):
        try:
            x = xo[key].get_object()
            if x.get("/Subtype") != "/Image":
                continue
            flt = x.get("/Filter")
            flt = flt[0] if isinstance(flt, list) and len(flt) == 1 else flt
            if flt == "/DCTDecode":
                yield str(key).lstrip("/"), x._data, "image/jpeg"
                continue
            cs, w, h = x.get("/ColorSpace"), int(x["/Width"]), int(x["/Height"])
            ch = 3 if cs == "/DeviceRGB" else 1 if cs == "/DeviceGray" else 0
            if ch and int(x.get("/BitsPerComponent", 0)) == 8 and flt in (None, "/FlateDecode"):
                px = x.get_data()
                if len(px) == w * h * ch:
                    yield str(key).lstrip("/"), _png(w, h, ch, px), "image/png"
        except Exception:  # noqa: BLE001 - a picture it cannot read is skipped, the page text stands
            continue


LOGO_PAGE = re.compile(r"\blogo(type)?s?\b|\bwordmark\b|\bbrandmark\b|\bsymbol\b", re.I)
VECTOR_PAGES = 3            # the cover and the next pages are always looked at; others only when their text speaks of a logo
VECTOR_PER_PAGE = 3
VECTOR_SCALE = 2.0
MAX_PATHS = 300             # a page with more drawing than this is an illustration or a chart, not a logo page


def _clusters(boxes: list, gap: float = 10.0) -> list:
    """Boxes (l, b, r, t) merged while they lie within `gap` of each other: the parts of one drawn logo become one region."""
    boxes = [list(b) for b in boxes]
    merged = True
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if a[0] - gap <= b[2] and b[0] - gap <= a[2] and a[1] - gap <= b[3] and b[1] - gap <= a[3]:
                    boxes[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    del boxes[j]
                    merged = True
                    break
            if merged:
                break
    return boxes


def vector_logos(data: bytes, texts: list, prefix: str = "", have: int = 0) -> list:
    """Logos and marks drawn as vectors, which a PDF holds as paths and not as pictures: for the cover and each page that speaks of a logo, the
    regions its drawing occupies (not the page-sized background, not hairlines) rendered to PNG at VECTOR_SCALE and cropped to the region. Needs
    pypdfium2; a page it cannot render is skipped, and the model decides afterwards which regions are logos."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw
    out = []
    try:
        pdf = pdfium.PdfDocument(data)
    except Exception:  # noqa: BLE001
        return out
    try:
        for i in range(len(pdf)):
            if have + len(out) >= MAX_IMAGES:
                break
            if i >= VECTOR_PAGES and not LOGO_PAGE.search(texts[i] if i < len(texts) else ""):
                continue
            try:
                page = pdf[i]
                w, h = page.get_size()
                boxes, n = [], 0
                for o in page.get_objects():
                    if o.type not in (raw.FPDF_PAGEOBJ_PATH, raw.FPDF_PAGEOBJ_SHADING):
                        continue
                    n += 1
                    l, b, r, t = o.get_bounds()
                    bw, bh = r - l, t - b
                    if bw * bh >= 0.5 * w * h or (bw < 2 and bh < 2) or bw <= 0 or bh <= 0:
                        continue          # the background, or a speck; a long hairline is kept only inside a cluster
                    boxes.append((l, b, r, t))
                if not boxes or n > MAX_PATHS:
                    continue
                regions = [c for c in _clusters(boxes) if c[2] - c[0] >= 15 and c[3] - c[1] >= 8 and (c[2] - c[0]) * (c[3] - c[1]) < 0.5 * w * h]
                regions.sort(key=lambda c: -(c[2] - c[0]) * (c[3] - c[1]))
                for k, (l, b, r, t) in enumerate(regions[:VECTOR_PER_PAGE], 1):
                    pad = 4
                    l, b, r, t = max(0, l - pad), max(0, b - pad), min(w, r + pad), min(h, t + pad)
                    bm = page.render(scale=VECTOR_SCALE, crop=(l, b, w - r, h - t), rev_byteorder=True)
                    row = bm.width * bm.n_channels
                    px = b"".join(bytes(bm.buffer[y * bm.stride:y * bm.stride + row]) for y in range(bm.height))
                    png = _png(bm.width, bm.height, bm.n_channels, px) if bm.n_channels in (1, 3) else None
                    if png and len(png) <= MAX_IMAGE:
                        out.append(Image(f"{prefix}v{i + 1}-{k}", f"page-{i + 1}-drawing-{k}.png", "image/png", png, i + 1))
            except Exception:  # noqa: BLE001 - a page that will not render is skipped
                continue
    finally:
        pdf.close()
    return out


def _office(name: str, data: bytes, kind: str) -> Material:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        names = z.namelist()
        if kind == "docx":
            parts = [("word/document.xml")]
            pages = [_xml_text(z.read(parts[0]))] if parts[0] in names else []
        else:
            slides = sorted((n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                            key=lambda n: int(re.findall(r"\d+", n)[-1]))
            pages = [_xml_text(z.read(n)) for n in slides]
        images = []
        for n in names:
            m = IMAGE_EXT.get(ext_of(n))
            if m and n.startswith(("word/media/", "ppt/media/")) and len(images) < MAX_IMAGES:
                raw = z.read(n)
                if MIN_IMAGE <= len(raw) <= MAX_IMAGE and media_of(raw) == m:
                    images.append(Image(f"m{len(images) + 1}", n.rsplit("/", 1)[-1], m, raw))
    except Exception:  # noqa: BLE001
        raise unreadable("the file could not be opened") from None
    return Material(name, kind, pages=pages, images=images)


def _xml_text(raw: bytes) -> str:
    s = re.sub(r"</(w:p|a:p)>", "\n", raw.decode("utf-8", "replace"))
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"[ \t]+", " ", s).strip()


def _zip(name: str, data: bytes) -> Material:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        infos = [i for i in z.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")
                 and not i.filename.rsplit("/", 1)[-1].startswith(".")]
    except Exception:  # noqa: BLE001
        raise unreadable("the zip could not be opened") from None
    if len(infos) > ZIP_MEMBERS or sum(i.file_size for i in infos) > ZIP_BYTES:
        raise unreadable("the zip holds too much to read")
    out = Material(name, "zip", members=[i.filename for i in infos][:ZIP_MEMBERS])
    pdfs, extra = [], []
    for i in infos:
        base, ext = i.filename.rsplit("/", 1)[-1], ext_of(i.filename)
        if ext == "pdf":
            pdfs.append(i)
        elif ext in IMAGE_EXT or ext == "svg":
            if i.file_size > MAX_IMAGE or len(out.images) >= MAX_IMAGES:
                continue
            raw = z.read(i)
            m = media_of(raw)
            if m:
                out.images.append(Image(f"f{len(out.images) + 1}", base, m, raw))
        elif ext in ("txt", "md", "markdown") and i.file_size < 2_000_000:
            extra.append(z.read(i).decode("utf-8", "replace"))
    for i, info in enumerate(pdfs[:3], 1):   # the books in it; the first is the source
        try:
            sub = _pdf(info.filename.rsplit("/", 1)[-1], z.read(info), prefix=f"z{i}-")
        except TaskError:
            continue
        if out.pdf is None:
            out.pdf, out.pdf_pages = sub.pdf, len(sub.pages)
        out.pages.extend(sub.pages)
        out.images.extend(sub.images[: max(0, MAX_IMAGES - len(out.images))])
    out.pages.extend(extra)   # after the books' pages, so a page's number is its place in `pdf`
    if not (out.pages or out.images):
        raise unreadable("the zip holds nothing Napkin can read")
    return out
