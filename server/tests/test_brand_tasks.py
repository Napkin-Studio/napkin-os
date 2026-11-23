"""brand_identify and brand_build through the middleware, with the model answering from recorded outputs and the host a recording writer.
No model, host or network is called."""

import base64
import threading
import time
from pathlib import Path

import httpx
import pytest

from brand_fixtures import BIBLE_PAGES, FakeWriter, fake_png, make_pdf, make_zip, recorded
from conftest import Server
from fakes import FakeModel

CLIENT = {"id": "tidewell", "name": "Tidewell"}
ORIGINAL = {"document_id": "bc-1", "path": "agency/tidewell/original.clan", "name": "Original", "default": True}


def model(piece="piece-1.json", pictures="pictures-logos.json", gate=None):
    def piece_fn(p):
        if gate is not None:
            gate.wait(10)
        return recorded(piece)
    return FakeModel(overrides={"brand_identify": lambda p: recorded("identify-yes.json"), "brand_build_piece": piece_fn,
                                "brand_build_pictures": lambda p: recorded(pictures)})


@pytest.fixture
def writer(monkeypatch):
    w = FakeWriter()
    monkeypatch.setattr("napkin.handlers.brand_build.writer_for", lambda settings, workspace: w)
    return w


def post(s, task, inp, doc="brief-1"):
    return httpx.post(s.url + "/v1/tasks", json={"request_kind": "middleware", "payload": {"task": task, "input": inp}, "clan": {"id": doc, "version": 1}}, timeout=30)


def finish(s, job_id, doc="brief-1"):
    for _ in range(400):
        r = post(s, "job_status", {"job_id": job_id}, doc).json()
        if r["job"]["state"] in ("done", "failed", "cancelled"):
            return r
        time.sleep(0.02)
    raise AssertionError("the job did not finish")


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def kit_zip():
    return make_zip({"logos/light.png": fake_png(seed=1), "logos/dark.png": fake_png(seed=2), "photos/people.png": fake_png(seed=3),
                     "photos/rule.png": fake_png(seed=4), "book.pdf": make_pdf(BIBLE_PAGES)})


def build_input(data, **kw):
    return {"file": {"name": "Tidewell-brand-book-2026.pdf", "data_b64": b64(data)}, "client": CLIENT, "workspace": "ws1", "mode": "new", **kw}


@pytest.fixture
def srv(tmp_path):
    s = Server(tmp_path, model=model(), settings_kw={"runlog_dir": str(tmp_path / "runs"), "runlog_bodies": True})
    yield s
    s.stop()


def test_identify_asks_after_one_haiku_call_counted_in_usage(srv):
    r = post(srv, "brand_identify", {"file": {"name": "Tidewell-brand-book-2026.pdf", "pages": 48, "text": "\n".join(BIBLE_PAGES)},
                                     "client": CLIENT, "brand_clans": [ORIGINAL]}).json()
    assert r["handler"] == "brand_identify@1.0" and r["change"] is None
    out = r["result"]
    assert out["ask"] and out["question"]["update"] == {"document_id": "bc-1", "name": "Original"}
    assert [p for p, *_ in srv.model.calls] == ["brand_identify"]
    assert r["trace"]["usage"]["input_tokens"] > 0 and list(r["trace"]["models"]) == ["claude-haiku-4-5"]   # the Haiku route, counted under Claude spend


def test_identify_reads_the_bytes_when_the_host_sent_no_text(srv):
    r = post(srv, "brand_identify", {"file": {"name": "Tidewell-brand-book-2026.pdf", "data_b64": b64(make_pdf(BIBLE_PAGES))}, "client": CLIENT}).json()
    assert r["result"]["ask"] and r["result"]["pages"] == len(BIBLE_PAGES)
    assert srv.model.calls[0][1]["text"].startswith("Tidewell Brand Guidelines")


def test_identify_a_brief_makes_no_model_call_and_costs_nothing(srv):
    r = post(srv, "brand_identify", {"file": {"name": "Zero-launch-call-notes.docx", "pages": 2, "text": "Kick-off call. Budget 250k."}, "client": CLIENT}).json()
    assert not r["result"]["ask"] and srv.model.calls == [] and r["trace"]["usage"]["input_tokens"] == 0


def test_identify_input_errors_are_400s(srv):
    assert post(srv, "brand_identify", {"file": {"name": "a/b.pdf", "text": "x"}}).status_code == 400
    assert post(srv, "brand_identify", {}).status_code == 400
    assert post(srv, "brand_identify", {"file": {"name": "a.pdf", "data_b64": "!!"}}).status_code == 400


def test_the_first_build_puts_the_files_up_then_creates_Original(srv, writer):
    r = post(srv, "brand_build", build_input(kit_zip(), file={"name": "Tidewell-kit.zip", "data_b64": b64(kit_zip())})).json()
    assert r["job"]["state"] == "queued" and r["change"] is None
    done = finish(srv, r["job"]["id"])
    assert done["job"]["state"] == "done", done["job"]
    ops = writer.ops()
    assert ops[0] == "create" and set(ops[1:]) == {"asset.put"} and len(ops) == 5     # create first; then 2 logos + 1 example + the source go into the new document
    body = writer.calls[0][2]
    assert body["name"] == "Original" and body["from"] == {"kind": "build", "file": "Tidewell-kit.zip"}
    from napkin.brand.writer import asset_path
    zipped = kit_zip()
    assert body["source"] == {"file": "Tidewell-kit.zip", "kind": "other", "pages": len(BIBLE_PAGES), "asset": asset_path("Tidewell-kit.zip", zipped)} or body["source"]["asset"].endswith("-Tidewell-kit.zip")
    logo = body["candidate"]["visual"]["logos"][0]
    assert logo["asset"].startswith("human/assets/") and "-logo-" in logo["asset"] and "upload:" not in str(body)
    puts = [c for c in writer.calls if c[0] == "asset.put"]
    assert {c[1] for c in puts} == {"agency/tidewell/brand-original.clan"}              # into the document create returned
    assert all(not c[2].startswith("human/") for c in puts)
    res = done["result"]
    assert res["mode"] == "new" and res["pending"] is False and res["document_id"] == "bc-doc-1" and res["actor"] == "process:brand_build"
    assert "Tidewell" not in res["summary"] or "Original" in res["summary"]


def test_an_update_is_a_proposal_never_a_create(srv, writer):
    r = post(srv, "brand_build", build_input(make_pdf(BIBLE_PAGES), mode="update", brand_clan=ORIGINAL)).json()
    done = finish(srv, r["job"]["id"])
    assert done["job"]["state"] == "done"
    assert "create" not in writer.ops() and writer.ops()[-1] == "proposal.set"
    op, doc, body = writer.calls[-1]
    assert doc == "agency/tidewell/original.clan" and body["from"] == {"kind": "upload", "file": "Tidewell-brand-book-2026.pdf"}
    assert body["candidate"]["name"] == "Original" and body["source"]["kind"] == "pdf" and body["source"]["pages"] == len(BIBLE_PAGES)
    assert all(c[1] == "agency/tidewell/original.clan" for c in writer.calls if c[0] == "asset.put")
    assert writer.ops().index("proposal.set") == len(writer.ops()) - 1                  # an update puts its files first
    assert done["result"]["pending"] is True


def test_nothing_is_written_unless_the_build_has_content(tmp_path, writer):
    s = Server(tmp_path, model=model("piece-empty.json", "pictures-none.json"))
    try:
        done = finish(s, post(s, "brand_build", build_input(make_pdf(BIBLE_PAGES))).json()["job"]["id"])
    finally:
        s.stop()
    assert done["job"]["state"] == "failed" and done["job"]["error"]["type"] == "no_content"
    assert "untouched" in done["job"]["error"]["message"] and writer.calls == []


def test_a_refused_write_fails_the_job_with_the_hosts_reason(srv, monkeypatch):
    w = FakeWriter(refuse="create")
    monkeypatch.setattr("napkin.handlers.brand_build.writer_for", lambda settings, workspace: w)
    done = finish(srv, post(srv, "brand_build", build_input(make_pdf(BIBLE_PAGES))).json()["job"]["id"])
    assert done["job"]["state"] == "failed" and done["job"]["error"]["type"] == "host_write_failed"
    assert "409" in done["job"]["error"]["message"] and "changed while you were editing" in done["job"]["error"]["message"]


def test_over_120_pages_asks_before_spending_then_reads_when_told(tmp_path, writer):
    s = Server(tmp_path, model=model())
    try:
        big = make_pdf([f"Page {i}" for i in range(1, 122)])
        r = post(s, "brand_build", build_input(big))
        assert r.status_code == 409 and r.json()["error"]["type"] == "over_cap" and "121 pages" in r.json()["error"]["message"]
        assert s.model.calls == [] and writer.calls == []
        ok = post(s, "brand_build", build_input(big, confirmed_over_cap=True))
        assert ok.status_code == 200
        assert finish(s, ok.json()["job"]["id"])["job"]["state"] == "done"
        assert len([c for c in s.model.calls if c[0] == "brand_build_piece"]) == 9     # 121 pages in runs of 15
        exactly = make_pdf([f"Page {i}" for i in range(1, 121)])
        assert post(s, "brand_build", build_input(exactly, name="Zero")).status_code == 200   # 120 is read without asking
    finally:
        s.stop()


def test_a_host_that_names_a_file_differently_fails_the_job(srv, monkeypatch):
    w = FakeWriter(rename=True)
    monkeypatch.setattr("napkin.handlers.brand_build.writer_for", lambda settings, workspace: w)
    done = finish(srv, post(srv, "brand_build", build_input(make_pdf(BIBLE_PAGES))).json()["job"]["id"])
    assert done["job"]["state"] == "failed" and "named a file differently" in done["job"]["error"]["message"]


def test_the_writer_sends_the_service_credential_to_the_workspace_and_no_cookie():
    import httpx
    from napkin.brand.writer import HttpWriter, asset_path
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json={"path": asset_path("a.png", b"abc"), "document_id": "d", "version": 1})
    w = HttpWriter("http://host.test/", "ws1", "t" * 32, transport=httpx.MockTransport(handler))
    w.create("tidewell", {"name": "Original"})
    w.put_asset("agency/doc.clan", "a.png", b"abc", "image/png")
    w.proposal_set("agency/doc.clan", {"candidate": {}})
    assert [(r.method, r.url.path) for r in seen] == [("POST", "/api/t/ws1/clients/tidewell/brand-clans"), ("POST", "/api/t/ws1/brand-clans/agency/doc.clan/assets"), ("POST", "/api/t/ws1/brand-clans/agency/doc.clan/proposal")]
    assert all(r.headers["authorization"] == "Bearer " + "t" * 32 and r.headers["x-napkin-actor"] == "process:brand_build" and "cookie" not in r.headers for r in seen)
    assert seen[1].url.params["name"] == "a.png"


def test_asset_names_follow_the_hosts_rule():
    import hashlib
    from napkin.brand.writer import asset_path
    assert asset_path("logo.png", b"abc") == "human/assets/" + hashlib.sha256(b"abc").hexdigest()[:10] + "-logo.png"


def test_a_short_token_is_no_host():
    from napkin.brand.writer import writer_for
    from types import SimpleNamespace as S
    assert writer_for(S(brand_host_url="http://h", brand_host_token="short"), "ws") is None
    assert writer_for(S(brand_host_url="http://h", brand_host_token="x" * 32), "ws") is not None


def test_no_host_configured_is_a_503_before_any_spend(srv, monkeypatch):
    monkeypatch.setattr("napkin.handlers.brand_build.writer_for", lambda settings, workspace: None)
    r = post(srv, "brand_build", build_input(make_pdf(BIBLE_PAGES)))
    assert r.status_code == 503 and r.json()["error"]["type"] == "host_unavailable" and srv.model.calls == []


@pytest.mark.parametrize("patch,etype", [
    ({"workspace": "a/b"}, "invalid_input"), ({"mode": "x"}, "invalid_input"), ({"client": {}}, "invalid_input"), ({"mode": "update"}, "invalid_input"),
    ({"name": ""}, "invalid_input"), ({"confirmed_over_cap": "yes"}, "invalid_input"),
])
def test_build_input_errors_are_400s(srv, writer, patch, etype):
    r = post(srv, "brand_build", {**build_input(make_pdf(BIBLE_PAGES)), **patch})
    assert r.status_code == 400 and r.json()["error"]["type"] == etype


def test_an_unreadable_file_fails_the_job_and_creates_nothing(srv, writer):
    r = post(srv, "brand_build", {"file": {"name": "a.zip", "data_b64": b64(b"PK\x03\x04junk")}, "client": CLIENT, "workspace": "ws1", "mode": "new"})
    done = finish(srv, r.json()["job"]["id"])
    assert done["job"]["state"] == "failed" and done["job"]["error"]["type"] == "unreadable_file" and writer.calls == []


def test_one_build_at_a_time_per_document(tmp_path, writer):
    gate = threading.Event()
    s = Server(tmp_path, model=model(gate=gate))
    try:
        first = post(s, "brand_build", build_input(make_pdf(BIBLE_PAGES))).json()
        second = post(s, "brand_build", build_input(make_pdf(BIBLE_PAGES)))
        assert second.status_code == 409 and second.json()["error"]["type"] == "job_state"
        assert post(s, "brand_build", build_input(make_pdf(BIBLE_PAGES)), doc="brief-2").status_code == 200   # another document is free
        gate.set()
        assert finish(s, first["job"]["id"])["job"]["state"] == "done"
    finally:
        gate.set()
        s.stop()


def test_a_cancelled_build_writes_nothing(tmp_path, writer):
    gate = threading.Event()
    s = Server(tmp_path, model=model(gate=gate))
    try:
        job = post(s, "brand_build", build_input(make_pdf(BIBLE_PAGES))).json()["job"]["id"]
        post(s, "cancel_job", {"job_id": job})
        gate.set()
        time.sleep(0.3)
        assert finish(s, job)["job"]["state"] == "cancelled" and writer.calls == []
    finally:
        gate.set()
        s.stop()


def test_the_bible_never_reaches_a_run_log_body(srv, writer, tmp_path):
    finish(srv, post(srv, "brand_build", build_input(make_pdf(BIBLE_PAGES))).json()["job"]["id"])
    post(srv, "brand_identify", {"file": {"name": "Tidewell-brand-book.pdf", "pages": 48, "text": "\n".join(BIBLE_PAGES)}, "client": CLIENT})
    logs = list((tmp_path / "runs").rglob("*.jsonl"))
    text = "\n".join(p.read_text() for p in logs)
    assert logs and "brand_build_piece" in text and "brand_identify" in text       # the calls are logged (counts and seconds) ...
    for secret in ("Warm, plain", "Tide blue", "Tidewell Serif", "Colour palette", "Tidewell Brand Guidelines", "#0A6BA0"):
        assert secret not in text                                                                                     # ... the bible is not


def test_detection_is_haiku_on_bedrock_by_default_and_a_routes_file_wins():
    from napkin.model_routes import Routes
    r = Routes("bedrock", "global.anthropic.claude-opus-5-5")
    h = r.resolve("brand_identify")
    assert h.model == "global.anthropic.claude-haiku-4-5-20251001-v1:0" and h.effort is None
    assert r.resolve("brand_build_piece").model == "global.anthropic.claude-sonnet-5-5"
    assert r.resolve("extract").model == "global.anthropic.claude-opus-5-5"          # nothing else moved
    routed = Routes("bedrock", "x", source='{"purposes": {"brand_identify": {"model": "sonnet-5.5"}}}')
    assert routed.resolve("brand_identify").model == "global.anthropic.claude-sonnet-5-5"


def test_the_tasks_resolve_for_a_document_whose_pipeline_predates_them():
    from napkin import registry
    clan = {"pipeline": {"tasks": {"extract_ask": {"handler": "extract_ask@1"}}}}
    assert registry.resolve("brand_identify", clan)[1] == "brand_identify@1.0" and registry.resolve("brand_build", clan)[1] == "brand_build@1.0"


def spliced(data=None, text=None, images=None, name="document-173-0.pdf", label="Tidewell-brand-book-2026.pdf"):
    """An attachment as the host hands it to a task (napkin-host ops/read.rs): the stored name, the person's name for it, the text, the PDF itself."""
    a = {"name": name, "label": label}
    if text is not None:
        a["text"] = text
    if data is not None:
        a["document"] = {"media_type": "application/pdf", "data": b64(data)}
    if images:
        a["images"] = [{"media_type": "image/png", "data": b64(i)} for i in images]
    return {"attachments": [a]}


def test_identify_takes_the_attachment_the_host_read_and_names_it_by_the_persons_name(srv):
    r = post(srv, "brand_identify", {**spliced(make_pdf(BIBLE_PAGES), text="\n".join(BIBLE_PAGES)), "client": CLIENT}).json()
    assert r["result"]["ask"] and r["result"]["pages"] == len(BIBLE_PAGES)
    assert srv.model.calls[0][1]["file_name"] == "Tidewell-brand-book-2026.pdf"      # the label, not document-173-0.pdf


def test_build_takes_the_attachment_the_host_read(srv, writer):
    done = finish(srv, post(srv, "brand_build", {**spliced(make_pdf(BIBLE_PAGES)), "client": CLIENT, "workspace": "ws1", "mode": "new"}).json()["job"]["id"])
    assert done["job"]["state"] == "done", done["job"]
    assert writer.calls[0][2]["source"]["file"] == "Tidewell-brand-book-2026.pdf" and writer.calls[0][2]["from"]["file"] == "Tidewell-brand-book-2026.pdf"


def test_a_word_file_the_host_only_read_builds_from_its_text_and_pictures(srv, writer):
    inp = {**spliced(text="\n".join(BIBLE_PAGES), images=[fake_png(seed=1), fake_png(seed=2)], name="document-1-0.docx", label="Tidewell-brand-book.docx"),
           "client": CLIENT, "workspace": "ws1", "mode": "new"}
    done = finish(srv, post(srv, "brand_build", inp).json()["job"]["id"])
    assert done["job"]["state"] == "done", done["job"]
    body = writer.calls[0][2]
    assert body["source"] == {"file": "Tidewell-brand-book.docx", "kind": "docx", "pages": 1}     # no asset: the host keeps the file it already holds
    assert body["candidate"]["visual"]["colours"]


def test_build_with_nothing_to_read_is_a_400(srv, writer):
    r = post(srv, "brand_build", {"attachments": [{"name": "x.pdf"}], "client": CLIENT, "workspace": "ws1", "mode": "new"})
    assert r.status_code == 400
