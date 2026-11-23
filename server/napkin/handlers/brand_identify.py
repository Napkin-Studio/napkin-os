"""brand_identify@1 — is the file a person just added a brand bible? (Brand Clan lane B, middleware-api.md section 13).

Free rules over the file's name and text first; one Claude Haiku call only when they are unsure or positive (about a cent,
counted in `trace.usage`). The answer says whether to ask the one question and what it offers. It writes nothing: the document
named by `clan` is only the one the file was added to. A detection that fails asks nothing (`ask: false`, `reason: detection_failed`)."""

import base64
import binascii

from ..brand import material
from ..brand.identify import identify
from ..util import TaskError, bad

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "brand_identify", "brand_identify", "1.0", "short", 1
MAX_BYTES = 64_000_000


class FileIn:
    """The file a task is about: its display name, the bytes when it has them, the host-read text, a page count, the pictures the host cut out of it."""

    def __init__(self, name, data=None, pages=None, text=None, media="", images=None):
        self.name, self.data, self.pages, self.text, self.media, self.images = name, data, pages, text, media, images or []


def decode(d) -> bytes:
    if not isinstance(d, str) or not d:
        raise bad("the file's bytes must be base64")
    if len(d) > MAX_BYTES * 4 // 3 + 4:
        raise TaskError(413, "too_large", f"the file is over {MAX_BYTES // 1_000_000} MB")
    try:
        return base64.b64decode(d, validate=True)
    except (binascii.Error, ValueError):
        raise bad("the file's bytes are not valid base64") from None


def file_of(inp: dict) -> FileIn:
    """The file, from `input.file {name, data_b64?, text?, pages?}` or from the one attachment the host has read for us
    (`input.attachments[0] {name, label?}`: the host splices `text`, a PDF as `document {media_type, data}`, a Word or PowerPoint file's
    pictures as `images`; see napkin-host ops/read.rs). A 400 when neither is there."""
    f = inp.get("file")
    if f is None:
        atts = inp.get("attachments")
        if not isinstance(atts, list) or len(atts) != 1 or not isinstance(atts[0], dict):
            raise bad("input.file {name, ...} or exactly one input.attachments entry is required")
        a = atts[0]
        name = a.get("label") or a.get("name")
        doc = a.get("document") if isinstance(a.get("document"), dict) else None
        data = decode(doc.get("data")) if doc else None
        images = [{"media_type": i.get("media_type"), "data": decode(i.get("data"))} for i in a.get("images") or [] if isinstance(i, dict)]
        f = {"name": name, "text": a.get("text"), "media_type": (doc or {}).get("media_type"), "pages": a.get("pages")}
    else:
        if not isinstance(f, dict):
            raise bad("input.file must be an object: {name, and data_b64 or text}")
        data = decode(f["data_b64"]) if f.get("data_b64") is not None else None
        images = []
    name = f.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 300 or "/" in name or "\\" in name:
        raise bad("the file's name must be given, without a path")
    text, pages = f.get("text"), f.get("pages")
    if text is not None and not isinstance(text, str):
        raise bad("input.file.text must be text")
    if pages is not None and (not isinstance(pages, int) or isinstance(pages, bool) or pages < 0):
        raise bad("input.file.pages must be a page count")
    return FileIn(name.strip(), data, pages, text, str(f.get("media_type") or ""), images)


def clans_of(inp: dict) -> list:
    out = []
    for c in inp.get("brand_clans") or []:
        if not isinstance(c, dict) or not isinstance(c.get("name"), str):
            raise bad("input.brand_clans must be a list of {document_id, name, default}")
        out.append({"document_id": c.get("document_id"), "path": c.get("path"), "name": c["name"], "default": c.get("default") is True})
    return out


def run(req, caps):
    inp = req.inp
    f = file_of(inp)
    name, text, pages, members = f.name, f.text, f.pages, None
    if (text is None or pages is None) and f.data:
        try:
            m = material.load(name, f.data)
        except TaskError:
            m = None   # a file Napkin cannot read is not asked about
        if m is not None:
            text = m.text if text is None else text
            pages = m.page_count if pages is None else pages
            members = m.members
    client = inp.get("client") if isinstance(inp.get("client"), dict) else {}
    out = identify(caps.model, name, text, pages, members, client, clans_of(inp))
    out["summary"] = "looks like a brand bible" if out["ask"] else "not asked about: " + str(out["reason"])
    return out, None, []
