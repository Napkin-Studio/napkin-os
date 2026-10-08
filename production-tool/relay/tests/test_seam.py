"""The seam: the relay's job flow through the harness lane's director and adapters.

No network: the model is a recorded reply under the real ModelPort, and Runway
is an httpx MockTransport under the real RunwayProvider.
"""

from __future__ import annotations

import json

import httpx
import pytest

from conftest import CDN, Harness, base_config
from contracts import Contracts
from director import PassthroughDirector, load_director
from director.claude import ClaudeDirector, make as make_director
from director.model import ModelPort, Reply  # noqa: F401
from providers import base, load_registry, types
from providers._seam import Adapted, Resolver
from providers.runway import RunwayProvider

A, B, C = ("sha256:" + ch * 64 for ch in "abc")
REPLY = {
    "op": "generate",
    "providerJob": {
        "provider": "runway", "model": "gemini_image3.1_flash",
        "prompt": "Full-body front view of the character drawn in @in_1. Eyes shaped like @maya_eyes. Colour palette of @in_2.",
        "refs": [{"sha256": A, "name": "in_1", "role": "character"},
                 {"sha256": B, "name": "maya_eyes", "role": "object"},
                 {"sha256": C, "name": "in_2", "role": "object"}],
        "ratio": "896:1152", "outputs": 1,
    },
    "needsUser": None, "rationale": "The drawing as the character; the eyes and the palette as object refs.", "confidence": 0.8,
}
OUT_URL = "https://dnznrvs05pmza.cloudfront.net/front.png?_jwt=x"


class FakeWire:
    api = "bedrock"

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def send(self, **kw):
        self.calls.append(kw)
        return Reply(json.dumps(self.replies.pop(0)), "ok", (100, 50))


class FakeRunway:
    """Runway's HTTP API as a MockTransport: what the test queues, and every request it got."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.submit = lambda req: httpx.Response(200, json={"id": "task_1"})
        self.task = {"id": "task_1", "status": "RUNNING"}

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if req.method == "POST":
            return self.submit(req)
        if req.method == "GET" and req.url.path == "/v1/tasks/task_1":
            return httpx.Response(200, json=self.task)
        return httpx.Response(404, json={"error": "not found"})

    def adapter(self) -> Adapted:
        return Adapted(RunwayProvider("rw-key", Resolver(), client=httpx.Client(transport=httpx.MockTransport(self))))


def generate_input() -> dict:
    def ref(sha, mime="image/png"):
        return {"sha256": sha, "url": f"{CDN}/in/{sha}", "mime": mime}
    return {"text": "eyes from @maya_eyes, colours from the last picture", "chips": [], "ratio": "4:5",
            "refs": [{"id": "node_01K6XA6Z0000000000000000AA", "role": "character", "kind": "drawing", "asset": ref(A)},
                     {"id": "ref_01K6XA6Z0000000000000000AB", "name": "maya_eyes", "role": "shape", "kind": "picture",
                      "asset": ref(B, "image/jpeg")},
                     {"id": "node_01K6XA6Z0000000000000000AC", "role": "colour", "kind": "picture", "asset": ref(C)}]}


@pytest.fixture
def seam():
    cfg = base_config()
    cfg["routing"]["generate"] = ["runway"]
    h = Harness(cfg, providers=("runway",))
    runway = FakeRunway()
    h.relay.registry.register(runway.adapter(), h.providers["runway"].sheet)
    wire = FakeWire(REPLY)
    h.relay.director = make_director(wire=wire)
    return h, runway, wire


def run_job(h):
    token = h.sign_in()
    _, job = h.post_job(token, "generate", **generate_input())
    return token, job


def test_relay_job_reaches_runway_in_its_own_request_shape(seam):
    h, runway, wire = seam
    token, job = run_job(h)
    assert job["state"] in ("submitted", "running", "queued"), job

    (post,) = [r for r in runway.requests if r.method == "POST"]
    assert post.url.path == "/v1/text_to_image"
    assert post.headers["Authorization"] == "Bearer rw-key"
    body = json.loads(post.content)
    assert body["model"] == "gemini_image3.1_flash" and body["ratio"] == "896:1152" and body["outputCount"] == 1
    assert [(r["uri"], r["tag"], r["subject"]) for r in body["referenceImages"]] == [
        (f"{CDN}/in/{A}", "in_1", "human"), (f"{CDN}/in/{B}", "maya_eyes", "object"), (f"{CDN}/in/{C}", "in_2", "object")]
    # the director ran on config.json's model, and saw the routed sheet
    assert wire.calls[0]["model"] == base_config()["director"]["perClickModel"]
    assert '"provider":"runway"' in wire.calls[0]["turns"][0]["text"]

    runway.task = {"id": "task_1", "status": "SUCCEEDED", "output": [OUT_URL], "cost": {"credits": 5}}
    h.blobs.remote[OUT_URL] = b"\x89PNG front view"
    h.clock.tick(6)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed", done
    (out,) = done["outputs"]
    assert out["url"].startswith(f"{CDN}/out/sha256:") and out["mime"] == "image/png"
    assert done["director"]["model"] == base_config()["director"]["perClickModel"]
    assert done["director"]["promptVersion"] == "director.v4"


def test_director_wrapper_output_validates_against_the_contract():
    d = make_director(wire=FakeWire(REPLY))
    assert isinstance(d, ClaudeDirector)
    sheet = types.load_sheet("runway")
    out = d.direct({"jobId": "job_01K6XA7Q3M9V2D4R8T0B5C1E6F", "op": "generate", "input": generate_input()}, sheet)
    assert out.pop("_model") == d.director.per_click_model
    assert out.pop("_promptVersion") == "director.v4"
    assert Contracts().errors("director.schema.json", out) == []


def test_director_takes_model_ids_from_config():
    wire = FakeWire(REPLY)
    d = make_director(wire=wire)
    d.use_config({"perClickModel": "eu.anthropic.claude-test", "promptVersion": "director.v9"})
    d.direct({"jobId": "job_01K6XA7Q3M9V2D4R8T0B5C1E6F", "op": "generate", "input": generate_input()},
             types.load_sheet("runway"))
    assert wire.calls[0]["model"] == "eu.anthropic.claude-test"
    assert d.director.prompt_version == "director.v4"  # v9 is not bundled


def test_load_director_is_passthrough_without_a_model(monkeypatch):
    monkeypatch.delenv("NAPKIN_MODEL_API", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert isinstance(load_director(), PassthroughDirector)


def test_load_director_builds_the_bedrock_wire(monkeypatch):
    monkeypatch.setenv("NAPKIN_MODEL_API", "bedrock")
    monkeypatch.setenv("AWS_REGION", "eu-west-1")
    d = load_director()
    assert isinstance(d, ClaudeDirector)
    assert d.director.port.api == "bedrock"
    assert type(d.director.port.wire.client).__name__ == "AnthropicBedrock"


def test_registry_wraps_the_harness_adapters(monkeypatch):
    monkeypatch.setenv("RUNWAY_API_KEY", "rw-key")
    monkeypatch.delenv("FAL_KEY", raising=False)
    reg = load_registry()
    assert isinstance(reg.get("runway"), Adapted) and isinstance(reg.get("mock"), Adapted)
    assert reg.get("fal") is None  # no key, not registered
    assert isinstance(reg.get("runway"), base.Provider)


# --- error mapping -------------------------------------------------------------

def submit_with(runway: FakeRunway, op="generate"):
    base.set_job_context(op, [{"sha256": s, "url": f"{CDN}/in/{s}", "mime": "image/png"} for s in (A, B, C)])
    return runway.adapter().submit(REPLY["providerJob"])


def test_a_400_on_submit_is_invalid_input_and_not_accepted():
    rw = FakeRunway()
    rw.submit = lambda req: httpx.Response(400, json={"error": "bad ratio"})
    with pytest.raises(base.ProviderError) as e:
        submit_with(rw)
    assert (e.value.code, e.value.accepted, e.value.retryable) == ("invalid_input", False, False)


def test_a_429_on_submit_is_unavailable_so_the_relay_may_route_on():
    rw = FakeRunway()
    rw.submit = lambda req: httpx.Response(429, headers={"Retry-After": "3"}, json={"error": "slow down"})
    with pytest.raises(base.ProviderError) as e:
        submit_with(rw)
    assert (e.value.code, e.value.accepted, e.value.retryable) == ("provider_unavailable", False, True)


def test_a_read_timeout_on_submit_may_have_been_accepted():
    rw = FakeRunway()

    def timeout(req):
        raise httpx.ReadTimeout("timed out", request=req)
    rw.submit = timeout
    with pytest.raises(base.ProviderError) as e:
        submit_with(rw)
    assert e.value.accepted is True


def test_capability_missing_maps_to_the_relays():
    rw = FakeRunway()
    base.set_job_context("generate", [])
    job = {**REPLY["providerJob"], "mask": A}  # Runway takes no mask
    with pytest.raises(base.CapabilityMissing):
        rw.adapter().submit(job)
    assert rw.requests == []


def test_task_states_map_onto_the_relays():
    rw = FakeRunway()
    a = rw.adapter()
    assert a.status("task_1").state == "running"
    rw.task = {"id": "task_1", "status": "FAILED", "failureCode": "SAFETY.INPUT.IMAGE", "failure": "no", "cost": {"credits": 5}}
    st = a.status("task_1")
    assert (st.state, st.error_code, st.provider_code, st.cost_usd) == ("moderated", "moderated", "SAFETY.INPUT.IMAGE", 0.05)
    rw.task = {"id": "task_1", "status": "FAILED", "failureCode": "THIRD_PARTY.UNAVAILABLE", "failure": "down"}
    st = a.status("task_1")
    assert (st.state, st.error_code) == ("failed", "provider_unavailable")
    rw.task = {"id": "task_1", "status": "SUCCEEDED", "output": [OUT_URL]}
    st = a.status("task_1")
    assert st.state == "succeeded" and st.outputs == [{"url": OUT_URL, "mime": "image/png"}]


def test_a_moderated_task_fails_the_relay_job_as_moderated(seam):
    h, runway, _ = seam
    token, job = run_job(h)
    runway.task = {"id": "task_1", "status": "FAILED", "failureCode": "SAFETY.INPUT.TEXT", "failure": "refused"}
    h.clock.tick(6)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "failed" and done["error"]["code"] == "moderated", done



def test_local_reader_inlines_localhost_assets(monkeypatch):
    from providers import _seam, base
    sha = "sha256:" + "c" * 64
    url = "http://localhost:8787/in/" + sha
    seen = []
    monkeypatch.setattr(_seam, "LOCAL_READER", lambda u: seen.append(u) or b"\x89PNG-bytes")
    base.set_job_context("generate", [{"sha256": sha, "url": url, "mime": "image/png"}])
    ref = _seam.Resolver()(sha)
    assert ref.url == "data:image/png;base64," + __import__("base64").b64encode(b"\x89PNG-bytes").decode()
    assert seen == [url]


def test_deployed_urls_are_left_alone(monkeypatch):
    from providers import _seam, base
    sha = "sha256:" + "d" * 64
    url = "https://d1kyxuk8u2ulz5.cloudfront.net/in/" + sha
    monkeypatch.setattr(_seam, "LOCAL_READER", None)
    base.set_job_context("generate", [{"sha256": sha, "url": url, "mime": "image/png"}])
    assert _seam.Resolver()(sha).url == url
