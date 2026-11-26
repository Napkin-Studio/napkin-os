"""brand_build@1 — build or update a Brand Clan from an uploaded brand bible, in the background (Brand Clan lane B, middleware-api.md section 14).

A long job. input {file {name, data_b64}, client {id, name}, workspace, mode new | update, name?, brand_clan {document_id, path, name}?,
confirmed_over_cap?}. A stronger model reads the file in pieces (build.py); the result is written through the host as
`process:brand_build` (writer.py), never to the document the job runs on (`clan`), which only holds the job:
  new     `create {name, candidate, source, from {kind build, file}}` with each file named `human/assets/<sha10>-<name>`, then `asset.put` each into the new document;
  update  `asset.put` each into the existing one, then `proposal.set {candidate, source, from {kind upload, file}}`: a new version waiting for a person.
Nothing is written unless the build has content; a failure leaves the source with the person and creates nothing. A file over 120
pages is refused 409 `over_cap` until the person says yes (`confirmed_over_cap`)."""

import re

from ..brand import HARD_CAP, PAGE_CAP, material
from ..brand.build import Build
from ..brand.merge import resolve_assets, safe_name
from ..brand.writer import ACTOR, HostWriteError, asset_path, writer_for
from ..jobs import Cancelled
from ..util import TaskError, bad
from .brand_identify import clans_of, file_of

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "brand_build", "brand_build", "1.0", "long", 1
SOURCE_MEDIA = {"pdf": "application/pdf", "zip": "application/zip", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text": "text/plain"}


def check(inp: dict) -> dict:
    f = file_of(inp)
    if not f.data and not f.text and not f.images:
        raise bad("the file's bytes are required (input.file.data_b64, or an attachment the host could read)")
    client = inp.get("client")
    if not isinstance(client, dict) or not isinstance(client.get("id"), str) or not client["id"]:
        raise bad("input.client.id is required: a Brand Clan belongs to a client")
    mode = inp.get("mode")
    if mode not in ("new", "update"):
        raise bad("input.mode must be new or update")
    clan = inp.get("brand_clan")
    if mode == "update":
        if not isinstance(clan, dict) or not isinstance(clan.get("path"), str) or not clan["path"] or not isinstance(clan.get("name"), str):
            raise bad("input.brand_clan {path, name} is required to update one")
        label = clan["name"]
    else:
        label = inp.get("name") if inp.get("name") is not None else "Original"
        if not isinstance(label, str) or not label.strip() or len(label.strip()) > 60:
            raise bad("input.name must be a name of up to 60 characters")
        label = label.strip()
    ws = inp.get("workspace")
    if not isinstance(ws, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", ws):
        raise bad("input.workspace must be the workspace id the host's routes name")
    over = inp.get("confirmed_over_cap", False)
    if not isinstance(over, bool):
        raise bad("input.confirmed_over_cap must be true or false")
    return {"file": f.name, "data": f.data, "media": f.media, "text": f.text, "images": f.images, "client": client["id"], "workspace": ws, "mode": mode, "label": label, "clan": clan, "confirmed": over}


def over_cap(pages: int, confirmed: bool):
    if pages > HARD_CAP:
        raise TaskError(413, "too_large", f"the file has {pages} pages; Napkin reads at most {HARD_CAP}")
    if pages > PAGE_CAP and not confirmed:
        raise TaskError(409, "over_cap", f"the file has {pages} pages; Napkin reads {PAGE_CAP} without asking. Say yes to read all of it")


def prepare(req, caps, settings):
    c = check(req.inp)
    writer = writer_for(settings, c["workspace"])
    if writer is None:
        raise TaskError(503, "host_unavailable", "no host is configured to write a Brand Clan to (NAPKIN_BRAND_HOST_URL, NAPKIN_BRAND_HOST_TOKEN)")
    if (c["data"] or b"")[:4] == b"%PDF":
        over_cap(material.pdf_pages(c["data"]), c["confirmed"])   # a 409 before any job: the person is asked first

    def work():
        return run(c, caps, writer), None, []
    return 2, work   # the real count is known once the file is read (run)


def run(c: dict, caps, writer):
    m = material.load(c["file"], c["data"]) if c["data"] else material.from_text(c["file"], c["text"], c["images"])
    over_cap(m.page_count, c["confirmed"])
    build = Build(caps.model, m, c["label"])
    caps.jobs.progress(0, build.units() + 1)
    bundle = build.read(progress=lambda d: caps.jobs.progress(d))
    if caps.jobs.cancelled:
        raise Cancelled()
    if not bundle.has_content:
        raise TaskError(422, "no_content", "The file held no brand rules Napkin could read, so nothing was made. The file is untouched.")
    doc = c["clan"]["path"] if c["mode"] == "update" else None
    # every file is named as the host will name it, so the candidate can say so before the file is there (contract 7)
    files = [(n, data, media, asset_path(n, data)) for n, (data, media) in bundle.uploads.items()]
    src = {"file": c["file"][:200], "kind": m.source_kind()}
    if m.page_count:
        src["pages"] = m.page_count
    if c["data"]:     # the file itself is kept as the source; a Word or PowerPoint file the host only read for us is not re-sent
        sn = safe_name(c["file"])
        sm = c["media"] or SOURCE_MEDIA.get(m.kind, "application/octet-stream")
        src["asset"] = asset_path(sn, c["data"])
        files.append((sn, c["data"], sm, src["asset"]))
    cand = resolve_assets(bundle.candidate, {n: p for n, _, _, p in files})
    try:
        def put(into):
            for n, data, media, want in files:
                if writer.put_asset(into, n, data, media) != want:
                    raise HostWriteError(502, "the host named a file differently from the Brand Clan")
        if c["mode"] == "new":
            view = writer.create(c["client"], {"name": c["label"], "candidate": cand, "source": src, "from": {"kind": "build", "file": c["file"][:200]}})
            put(view["path"])
        else:
            put(doc)
            view = writer.proposal_set(doc, {"candidate": cand, "source": src, "from": {"kind": "upload", "file": c["file"][:200]}})
    except HostWriteError as e:
        raise TaskError(502, "host_write_failed", f"the Brand Clan could not be saved ({e.status}): {e.message}") from None
    counts = {"logos": len((cand.get("visual") or {}).get("logos") or []), "colours": len((cand.get("visual") or {}).get("colours") or []),
              "typography": len((cand.get("visual") or {}).get("typography") or []), "rules": len((cand.get("voice") or {}).get("rules") or [])}
    word = "Built" if c["mode"] == "new" else "A new version of"
    return {"summary": f"{word} the Brand Clan “{c['label']}”: {counts['colours']} colours, {counts['typography']} typefaces, {counts['logos']} logos, {counts['rules']} rules.",
            "mode": c["mode"], "document_id": view.get("document_id"), "path": view.get("path"), "name": c["label"],
            "pending": c["mode"] == "update", "counts": counts, "gaps": [g["area"] for g in cand.get("gaps") or []], "actor": ACTOR}
