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


# job_stage: queued, submitted, provider_done, fetched, landed

def test_a_job_logs_each_stage_with_its_jobid_and_durations(h, caplog):
    caplog.set_level(logging.INFO, logger="relay")
    token = h.as_person()
    _, job = h.post_job(token, "generate")
    jid = job["jobId"]
    prov = next(p for p in h.providers.values() if p.submits)
    rid = f"{prov.name}-1"
    h.clock.tick(4)
    prov.succeed(rid, cost=0.2)
    done = h.poll(token, jid)
    assert done["state"] == "completed"
    stages = [(r["stage"], r) for r in lines(caplog, "job_stage") if r["jobId"] == jid]
    assert [s for s, _ in stages] == ["queued", "submitted", "provider_done", "fetched", "landed"]
    by = dict(stages)
    assert by["submitted"]["taskId"] == rid and by["submitted"]["provider"] == prov.name
    assert by["provider_done"]["ms"] == 4000 and by["provider_done"]["costUsd"] == 0.2
    assert by["fetched"]["outputs"] == 1 and by["landed"]["totalMs"] == 4000
    assert by["landed"]["sinceSubmittedMs"] == 4000 and by["landed"]["taskId"] == rid
    for _, r in stages:
        assert r["op"] == "generate" and r["evt"] == "job_stage"


def test_a_failed_job_logs_its_end_with_the_error(h, caplog):
    caplog.set_level(logging.INFO, logger="relay")
    token = h.as_person()
    for p in h.providers.values():
        p.submit_effect = base.ProviderError("invalid_input", "nope", retryable=False)
    _, job = h.post_job(token, "generate")
    ends = [r for r in lines(caplog, "job_stage") if r["jobId"] == job["jobId"] and r["stage"] == "failed"]
    assert ends and ends[-1]["error"] and ends[-1]["message"]


# Dex: the job's id on its model call, and a rejected answer kept whole in the log

def _claude(reply):
    import copy as _copy
    from director import Director
    from director.claude import ClaudeDirector
    from director.model import ModelPort
    from test_director import PROMPTS, FakeWire
    wire = FakeWire(_copy.deepcopy(reply), _copy.deepcopy(reply))
    d = ClaudeDirector(Director(ModelPort(wire, "claude-haiku-4-5", timeout=5), PROMPTS,
                                {"runway": load_sheet("runway")}, prompt_version="director.v8"))
    return d, wire


def _frame_fixture():
    from pathlib import Path
    return json.loads((Path(__file__).parent / "fixtures" / "director" / "frame_runway_anchor.json").read_text())


def test_dexs_model_call_carries_the_job_id_and_the_director_line_names_it(caplog):
    caplog.set_level(logging.INFO)
    f = _frame_fixture()
    d, wire = _claude(f["reply"])
    d.direct({"jobId": "job_DEX1", "op": "frame", "input": names.to_wire("frame", f["input"])}, load_sheet("runway"))
    assert wire.calls[0]["headers"] == {"X-Napkin-Handler": "relay.director", "X-Napkin-Job": "job_DEX1"}
    [rec] = lines(caplog, "director")
    assert rec["jobId"] == "job_DEX1" and rec["op"] == "frame" and rec["latencyMs"] >= 0 and rec["model"]


def test_a_rejected_answer_is_logged_whole_up_to_8_kb(caplog):
    caplog.set_level(logging.INFO)
    f = _frame_fixture()
    reply = json.loads(json.dumps(f["reply"]))
    reply["providerJob"]["refs"] = [x for x in reply["providerJob"]["refs"] if x["name"] != "hero_front"]
    reply["rationale"] = "r" * 300  # a long answer: the log keeps all of it, the History only a line
    d, _ = _claude(reply)
    out = d.direct({"jobId": "job_DEX2", "op": "frame", "input": names.to_wire("frame", f["input"])}, load_sheet("runway"))
    assert out["_model"] == "passthrough"
    [rec] = lines(caplog, "director_rejected")
    assert rec["jobId"] == "job_DEX2" and rec["error"] == "DirectorError" and rec["fallback"] == "passthrough"
    assert "left out @hero_front" in rec["reason"]
    assert json.loads(rec["answer"])["rationale"] == "r" * 300
    assert len(jobtrace.clip("y" * 20000)) < 8300

