"""The relay's trace lines (features/pt-relay-trace.clan): one JSON line per event, each with evt and jobId,
and never a key, an auth header or a presigned query string."""

import json
import logging

import httpx
import pytest

import jobtrace
import names
from providers import AssetRef, CapabilityMissing, ProviderJob, Ref, load_sheet
from providers import base
from providers._seam import trace_submit
from providers.runway import RunwayProvider
from providers.types import check_capabilities, effective_sheet

SIGNED = "https://bucket.s3.amazonaws.com/in/a.png?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA123"


def lines(caplog, evt=None):
    out = []
    for r in caplog.records:
        try:
            rec = json.loads(r.getMessage())
        except ValueError:
            continue
        if isinstance(rec, dict) and "evt" in rec and (evt is None or rec["evt"] == evt):
            out.append(rec)
    return out


def test_uri_of_keeps_scheme_host_and_path_only():
    assert jobtrace.uri_of(SIGNED) == "https://bucket.s3.amazonaws.com/in/a.png"
    assert jobtrace.uri_of("https://user:pw@h.test/p#frag") == "https://h.test/p"
    assert jobtrace.uri_of("data:image/png;base64," + "A" * 100) == "data:image/png,122 chars"
    assert jobtrace.uri_of(None) is None


def test_clip_cuts_at_the_limit_and_says_so():
    assert jobtrace.clip("abc") == "abc"
    cut = jobtrace.clip("x" * 9000)
    assert cut.startswith("x" * 8192) and "9000 chars" in cut and len(cut) < 8300
    assert jobtrace.clip({"a": 1}) == '{"a": 1}'


# provider_submit: what the Runway adapter sent, as sent

def runway(handler):
    def resolve(sha):
        return AssetRef(sha, SIGNED if sha.endswith("a") else f"https://cdn.test/{sha[-4:]}.png", "image/png")
    return RunwayProvider("key_secret_123", resolve, client=httpx.Client(transport=httpx.MockTransport(handler)),
                          on_submit=trace_submit)


SHA = "sha256:" + "a" * 64
SHB = "sha256:" + "b" * 64


def test_provider_submit_logs_the_request_as_sent_with_the_task_id(caplog):
    caplog.set_level(logging.INFO, logger="relay")
    base.set_job_context("generate", [], "job_TRACE1")
    adapter = runway(lambda req: httpx.Response(200, json={"id": "task_42"}))
    job = ProviderJob(op="generate", provider="runway", model="x", ratio="1024:1024",
                      prompt="@hero holds @prop_one", refs=[Ref(SHA, "hero", "character"), Ref(SHB, "prop_one", "object")])
    assert adapter.submit(job) == "task_42"
    [rec] = lines(caplog, "provider_submit")
    assert rec["jobId"] == "job_TRACE1" and rec["op"] == "generate" and rec["provider"] == "runway"
    assert rec["model"] == "gemini_image3_pro" and rec["endpoint"] == "/v1/text_to_image"
    assert rec["promptText"] == "@hero holds @prop_one" and rec["ratio"] == "1024:1024"
    assert rec["taskId"] == "task_42" and rec["status"] == 200
    assert rec["refs"] == [{"tag": "hero", "subject": "human", "uri": "https://bucket.s3.amazonaws.com/in/a.png"},
                           {"tag": "prop_one", "subject": "object", "uri": "https://cdn.test/bbbb.png"}]
    text = json.dumps(rec)
    for secret in ("X-Amz-Signature", "AKIA123", "key_secret_123", "Bearer", "Authorization"):
        assert secret not in text


def test_provider_submit_logs_a_refused_request_and_a_clip_with_its_frame(caplog):
    caplog.set_level(logging.INFO, logger="relay")
    base.set_job_context("clip", [], "job_TRACE2")
    adapter = runway(lambda req: httpx.Response(400, json={"error": "bad ratio"}))
    job = ProviderJob(op="clip", provider="runway", model="x", ratio="1280:720", prompt="she runs",
                      first_frame=SHA, duration_s=8)
    with pytest.raises(Exception):
        adapter.submit(job)
    [rec] = lines(caplog, "provider_submit")
    assert rec["jobId"] == "job_TRACE2" and rec["status"] == 400 and "bad ratio" in rec["error"]
    assert rec["duration"] == 8 and rec["promptText"] == "she runs" and "taskId" not in rec
    assert rec["frames"] == [{"position": "first", "uri": "https://bucket.s3.amazonaws.com/in/a.png"}]
    assert "X-Amz-Signature" not in json.dumps(rec)


def test_a_trace_that_raises_never_fails_the_submit():
    def boom(**_):
        raise RuntimeError("no")
    adapter = RunwayProvider("k", lambda sha: AssetRef(sha, "https://cdn.test/a.png", "image/png"),
                             client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"id": "t"}))),
                             on_submit=boom)
    assert adapter.submit(ProviderJob(op="generate", provider="runway", model="x", ratio="1024:1024", prompt="a cat")) == "t"


# Object refs: the sheet and the adapter agree (refs.maxObject)

def test_the_sheet_says_nine_object_refs_where_the_adapter_refuses_ten():
    sheet = load_sheet("runway")
    assert sheet["refs"] == {"max": 14, "maxCharacter": 5, "maxObject": 9}
    assert sheet["models"]["gemini_image3_pro"]["refs"]["maxObject"] == 9
    refs = [Ref(f"sha256:{i:064d}", f"obj{i}", "object") for i in range(10)]
    job = ProviderJob(op="generate", provider="runway", model="x", ratio="1024:1024", prompt="things", refs=refs)
    with pytest.raises(CapabilityMissing, match="at most 9 object refs"):
        check_capabilities(effective_sheet(sheet, "generate", None), job)
    ok = ProviderJob(op="generate", provider="runway", model="x", ratio="1024:1024", prompt="things",
                     refs=refs[:9] + [Ref(f"sha256:{i:064d}", f"c{i}", "character") for i in range(20, 25)])
    check_capabilities(effective_sheet(sheet, "generate", None), ok)  # 14: five people and nine things
    adapter = RunwayProvider("k", lambda sha: AssetRef(sha, "https://cdn.test/a.png", "image/png"),
                             client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"id": "t"}))))
    with pytest.raises(CapabilityMissing, match="at most 9 object refs"):
        adapter.submit(job)


def test_fit_refs_leaves_out_object_views_over_max_object():
    sheet = {"refs": {"max": 14, "maxCharacter": 5, "maxObject": 9}}
    refs = [{"id": f"r{i}", "name": f"prop_{i}", "role": "object"} for i in range(11)]
    out, dropped = names.fit_refs("generate", {"text": "a table", "refs": refs}, sheet)
    assert len(out["refs"]) == 9 and dropped == ["prop_10", "prop_9"]
    # a character is never dropped for the objects' limit
    refs = [{"id": "c", "name": "maya_side", "role": "character"}] + refs
    out, dropped = names.fit_refs("generate", {"text": "a table", "refs": refs}, sheet)
    assert out["refs"][0]["name"] == "maya_side" and "maya_side" not in dropped
