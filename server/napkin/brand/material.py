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
