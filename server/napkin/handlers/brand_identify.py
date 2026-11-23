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


def file_of(inp: dict, need_bytes: bool):
    """(name, data|None, pages|None, text|None, media_type) from input.file, or a 400. Text the host already read is used as sent."""
    f = inp.get("file")
    if not isinstance(f, dict):
        raise bad("input.file must be an object: {name, and data_b64 or text}")
    name = f.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 300 or "/" in name or "\\" in name:
        raise bad("input.file.name must be the file's name")
    data = None
    if f.get("data_b64") is not None:
        d = f["data_b64"]
        if not isinstance(d, str) or not d:
            raise bad("input.file.data_b64 must be the file's bytes as base64")
        if len(d) > MAX_BYTES * 4 // 3 + 4:
            raise TaskError(413, "too_large", f"the file is over {MAX_BYTES // 1_000_000} MB")
        try:
            data = base64.b64decode(d, validate=True)
        except (binascii.Error, ValueError):
            raise bad("input.file.data_b64 is not valid base64") from None
    if need_bytes and not data:
        raise bad("input.file.data_b64 is required")
    text, pages = f.get("text"), f.get("pages")
    if text is not None and not isinstance(text, str):
        raise bad("input.file.text must be text")
    if pages is not None and (not isinstance(pages, int) or isinstance(pages, bool) or pages < 0):
        raise bad("input.file.pages must be a page count")
    return name.strip(), data, pages, text, str(f.get("media_type") or "")


def clans_of(inp: dict) -> list:
    out = []
    for c in inp.get("brand_clans") or []:
        if not isinstance(c, dict) or not isinstance(c.get("name"), str):
            raise bad("input.brand_clans must be a list of {document_id, name, default}")
        out.append({"document_id": c.get("document_id"), "path": c.get("path"), "name": c["name"], "default": c.get("default") is True})
    return out


def run(req, caps):
    inp = req.inp
    name, data, pages, text, _ = file_of(inp, need_bytes=False)
    members = None
    if (text is None or pages is None) and data:
        try:
            m = material.load(name, data)
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
