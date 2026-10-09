"""Every step on every provider pathway, end to end through the relay (features/harness-pathways.clan).

The pathways are contracts/examples/config.pathway.{runway,fal,heygen,mix}.json. Each case posts a
JobRequest to the Relay, which runs the director, names.py tags, the seam and the REAL fal, Runway
and HeyGen adapters against in-process stand-ins of their APIs, then polls until the job ends.
Every request body an adapter sends is checked against the provider's own published schema
(tests/fixtures/schemas). Nothing here touches the network or spends money.
"""

from __future__ import annotations

import io
import itertools
import json

import httpx
import pytest
from PIL import Image

from conftest import CDN, Harness
from contracts_dir import contracts_dir
from director import new_id
from providers import Registry
from providers._seam import Adapted, Resolver
from providers.fal import FalProvider
from providers.heygen import HeyGenProvider
from providers.runway import RunwayProvider
from provider_schemas import errors as schema_errors

PATHWAYS = ("runway", "fal", "heygen", "mix")
PROVIDER_OPS = ("generate", "view", "frame", "region_edit", "clip", "clip_edit")
VIDEO_HINTS = ("video", "veo", "wan-vace", "ray", "sam2")
ASSET_HOSTS = ("cdn.test", "hack.napkin.ie")  # ours in these tests, and in the recorded director fixtures


def _png(w: int = 64, h: int = 48) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), (90, 120, 200)).save(out, format="PNG")
    return out.getvalue()


PNG = _png()
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64


# ── the provider stand-ins ──────────────────────────────────────────────────
class StandIns:
    """fal's queue, Runway and HeyGen as one httpx MockTransport handler. Records every body sent,
    with the published-schema errors for it, and answers like the real APIs (submit, status, result).
    `refuse` maps a provider to the HTTP status (or 'down') its next submits get."""

    def __init__(self, blobs):
        self.blobs = blobs
        self.sent: list[dict] = []
        self.refuse: dict[str, object] = {}
        self._n = itertools.count(1)
        self._fal: dict[str, str] = {}      # request id -> endpoint
        self._runway: dict[str, str] = {}   # task id -> path
        self.submit_reply: dict[str, httpx.Response] = {}   # provider -> a canned submit answer
        self.status_reply: dict[str, httpx.Response] = {}   # provider -> a canned status answer

    def _output(self, video: bool) -> str:
        url = f"https://out.test/{next(self._n)}.{'mp4' if video else 'png'}"
        self.blobs.remote[url] = MP4 if video else PNG
        return url

    def _record(self, provider: str, endpoint: str, body: dict) -> None:
        self.sent.append({"provider": provider, "endpoint": endpoint, "body": body,
                          "errors": schema_errors(provider, endpoint, body)})

    def _refused(self, provider: str):
        if provider in self.submit_reply:
            return self.submit_reply[provider]
        how = self.refuse.get(provider)
        if how == "down":
            raise httpx.ConnectError("nodename nor servname provided, or not known")
        if how:
            return httpx.Response(int(how), json={"detail": "refused", "error": "refused"})
        return None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host in ASSET_HOSTS:  # our own assets: what the relay stored, else a small picture
            key = path.lstrip("/")
            data = self.blobs.objects.get(key, (MP4 if key.endswith(".mp4") else PNG, ""))[0]
            return httpx.Response(200, content=data)
        body = json.loads(request.content) if request.content else None
        if host == "queue.fal.run":
            return self._fal_call(request.method, path.strip("/"), body)
        if host == "api.dev.runwayml.com":
            return self._runway_call(request.method, path, body)
        if host == "api.heygen.com":
            return self._heygen_call(request.method, path, body)
        raise AssertionError(f"unexpected call {request.method} {request.url}")

    def _fal_call(self, method: str, path: str, body):
        if method == "POST" and "/requests/" not in path:
            refused = self._refused("fal")
            if refused is not None:
                return refused
            self._record("fal", path, body)
            rid = f"r{next(self._n)}"
            self._fal[rid] = path
            app = "/".join(path.split("/")[:2])
            base = f"https://queue.fal.run/{app}/requests/{rid}"
            return httpx.Response(200, json={"request_id": rid, "status_url": f"{base}/status",
                                             "response_url": base, "cancel_url": f"{base}/cancel"})
        rid = path.split("/requests/", 1)[1].split("/")[0]
        if "fal" in self.status_reply:
            return self.status_reply["fal"]
        if path.endswith("/status"):
            return httpx.Response(200, json={"status": "COMPLETED"})
        endpoint = self._fal[rid]
        if any(h in endpoint for h in VIDEO_HINTS):
            return httpx.Response(200, json={"video": {"url": self._output(True), "content_type": "video/mp4"}})
        return httpx.Response(200, json={"images": [{"url": self._output(False), "content_type": "image/png",
                                                     "width": 64, "height": 48}]})

    def _runway_call(self, method: str, path: str, body):
        if method == "POST":
            refused = self._refused("runway")
            if refused is not None:
                return refused
            self._record("runway", f"POST {path}", body)
            tid = f"task_{next(self._n)}"
            self._runway[tid] = path
            return httpx.Response(200, json={"id": tid})
        tid = path.rsplit("/", 1)[1]
        if "runway" in self.status_reply:
            return self.status_reply["runway"]
        video = self._runway[tid] != "/v1/text_to_image"
        return httpx.Response(200, json={"id": tid, "status": "SUCCEEDED", "output": [self._output(video)],
                                         "cost": {"credits": 7}})

    def _heygen_call(self, method: str, path: str, body):
        if method == "POST":
            refused = self._refused("heygen")
            if refused is not None:
                return refused
            self._record("heygen", f"POST {path}", body)
            return httpx.Response(200, json={"data": {"video_id": f"vid_{next(self._n)}"}})
        if "heygen" in self.status_reply:
            return self.status_reply["heygen"]
        return httpx.Response(200, json={"data": {"status": "completed", "video_url": self._output(True),
                                                  "width": 1280, "height": 720, "duration": 5}})

    def to(self, provider: str) -> list[dict]:
        return [s for s in self.sent if s["provider"] == provider]


# ── a relay on one pathway, with the real adapters ──────────────────────────
def pathway_config(name: str) -> dict:
    cfg = json.loads((contracts_dir() / "examples" / f"config.pathway.{name}.json").read_text())
    cfg["flags"] = {**cfg["flags"], "regionEditCanvas": True, "regionEditFrames": True, "videoRegionEdit": True,
                    "feelEdit": True, "storyboard": True, "video": True, "stitch": True}
    cfg["inFlightPerParticipant"] = 6
    cfg["quotas"] = {"image": 1000, "video": 1000, "render": 1000}
    return cfg


def pathway(name: str, **cfg_over) -> tuple[Harness, StandIns]:
    h = Harness({**pathway_config(name), **cfg_over}, providers=())
    stand = StandIns(h.blobs)
    client = httpx.Client(transport=httpx.MockTransport(stand))
    reg = Registry()
    for adapter in (FalProvider("fal_test_key", Resolver(), client=client),
                    RunwayProvider("rw_test_key", Resolver(), client=client),
                    HeyGenProvider("hg_test_key", Resolver(), client=client)):
        reg.register(Adapted(adapter))
    h.relay.registry = reg
    return h, stand


def asset(n: int, mime: str = "image/png") -> dict:
    import hashlib
    sha = "sha256:" + hashlib.sha256(f"{n}{mime}".encode()).hexdigest()
    return {"sha256": sha, "url": f"{CDN}/in/{sha}", "mime": mime}


def named(n: int, name: str, role: str = "character") -> dict:
    return {"id": new_id("ref"), "name": name, "role": role, "kind": "picture", "asset": asset(n)}


SHOT = {"id": new_id("shot", "pathways"), "order": 1, "duration_s": 5, "composition": "medium",
        "action": "@maya waves at the camera", "camera_move": "static", "refs": ["maya"]}
MAYA = [named(1, "maya_front"), named(2, "maya_side")]
BOX = {"x": 0.2, "y": 0.2, "w": 0.3, "h": 0.3}

INPUTS = {
    "generate": {"text": "@maya_front waves", "refs": [named(1, "maya_front")], "ratio": "4:5"},
    "view": {"view": "side", "image": asset(1), "ratio": "4:5"},
    "frame": {"shot": SHOT, "refs": MAYA, "ratio": "16:9", "anchorFrame": asset(5), "previousFrame": asset(5)},
    "region_edit": {"image": asset(6), "region": BOX, "mask": asset(7), "text": "make the hat red", "ratio": "16:9"},
    "clip": {"shot": SHOT, "image": asset(6), "refs": MAYA, "ratio": "16:9"},
    "clip_edit": {"video": asset(8, "video/mp4"), "feel": {"strength": "flex"}, "text": "warmer light"},
}


def expected_provider(cfg: dict, h: Harness, op: str) -> str:
    return next(p for p in cfg["routing"][op] if h.relay.registry.supports(p, op))


def run(h: Harness, op: str, inp: dict, **req_over) -> dict:
    """POST the job, then poll as the browser does until it ends."""
    token = h.sign_in()
    req = {"contractVersion": "2", "jobId": new_id("job"), "op": op, "parentIds": [], "input": inp, **req_over}
    _, job = h.call("POST", "/jobs", req, token, expect=200)
    for _ in range(12):
        if job["state"] in ("completed", "failed", "cancelled", "uncertain"):
            break
        h.clock.tick(10)
        job = h.poll(token, job["jobId"])
    return job


# ── every step on every pathway ─────────────────────────────────────────────
@pytest.mark.parametrize("name", PATHWAYS)
@pytest.mark.parametrize("op", PROVIDER_OPS)
def test_every_step_runs_on_its_pathway(name, op):
    h, stand = pathway(name)
    job = run(h, op, INPUTS[op])
    provider = expected_provider(h.cfg, h, op)
    sheet = h.relay.registry.sheet(provider)
    assert job["state"] == "completed", (name, op, job.get("error"), stand.sent)
    assert job["provider"] == provider
    assert job["model"] == sheet["ops"][op]["model"]
    assert job["outputs"] and all(o["url"].startswith(CDN) for o in job["outputs"])
    sent = stand.to(provider)
    assert sent, f"{provider} received nothing for {op}"
    for s in sent:
        assert not s["errors"], f"{provider} {s['endpoint']} body breaks its published schema: {s['errors']}"
    assert job["cost"]["estimate"] == (sheet["ops"][op]["estimateUsd"] or 0) or job["cost"]["unknown"]


@pytest.mark.parametrize("name", PATHWAYS)
def test_shot_list_and_stitch_do_not_depend_on_the_pathway(name):
    h, stand = pathway(name)
    job = run(h, "shot_list", {"script": "Maya walks in. She waves. The logo shows.", "targetS": 15,
                               "refs": [named(1, "maya_front")]})
    assert job["state"] == "completed" and job["shots"]
    assert not stand.sent


# ── what reaches each provider ──────────────────────────────────────────────
def test_runway_frames_keep_each_reference_with_its_own_tag():
    h, stand = pathway("runway")
    run(h, "frame", INPUTS["frame"])
    body = stand.to("runway")[0]["body"]
    tags = [r["tag"] for r in body["referenceImages"]]
    assert tags[:2] == ["maya_front", "maya_side"] and "previous" in tags
    assert "@maya_front" in body["promptText"]


def test_fal_frames_default_to_nano_banana_pro_with_each_picture_numbered():
    """features/default-models.clan: every picture is its own image n, so none is lost in an element."""
    h, stand = pathway("fal")
    run(h, "frame", INPUTS["frame"])
    sent = stand.to("fal")[0]
    assert sent["endpoint"] == "fal-ai/nano-banana-pro/edit" and not sent["errors"]
    urls = sent["body"]["image_urls"]
    assert [u.rsplit("/", 1)[1] for u in urls[:2]] == [r["asset"]["sha256"] for r in INPUTS["frame"]["refs"]]
    assert "image 1" in sent["body"]["prompt"] and "elements" not in sent["body"]


def test_fal_frames_picked_on_kling_send_a_character_as_one_element():
    h, stand = pathway("fal")
    run(h, "frame", INPUTS["frame"], modelChoice={"provider": "fal", "model": "kling-image-o3"})
    body = stand.to("fal")[0]["body"]
    assert body["elements"][0]["frontal_image_url"].endswith(INPUTS["frame"]["refs"][0]["asset"]["sha256"])
    assert len(body["elements"][0]["reference_image_urls"]) == 1
    assert "@Element1" in body["prompt"]


@pytest.mark.parametrize("name,provider", [("runway", "runway"), ("heygen", "heygen")])
def test_clips_that_cannot_take_refs_send_the_frame_and_name_the_character_in_words(name, provider):
    h, stand = pathway(name)
    run(h, "clip", INPUTS["clip"])
    body = stand.to(provider)[0]["body"]
    assert "referenceImages" not in body and "reference_images" not in body
    assert "@" not in (body.get("promptText") or body.get("prompt"))


def test_runway_region_edits_send_the_image_and_a_copy_with_the_box_drawn():
    h, stand = pathway("runway")
    run(h, "region_edit", INPUTS["region_edit"])
    refs = stand.to("runway")[0]["body"]["referenceImages"]
    assert [r["tag"] for r in refs[:2]] == ["current", "marked"]
    assert refs[1]["uri"].startswith("data:image/png;base64,")


# ── when something goes wrong ───────────────────────────────────────────────
@pytest.mark.parametrize("how", ["503", "429", "down"])
def test_mix_moves_to_the_next_provider_when_fal_cannot_take_the_job(how):
    h, stand = pathway("mix")
    stand.refuse["fal"] = how
    image = run(h, "frame", INPUTS["frame"])
    clip = run(h, "clip", INPUTS["clip"])
    assert (image["state"], image["provider"]) == ("completed", "runway")
    assert (clip["state"], clip["provider"]) == ("completed", "heygen")


@pytest.mark.parametrize("name,provider,op", [("runway", "runway", "frame"), ("fal", "fal", "clip"), ("heygen", "heygen", "clip")])
def test_a_single_provider_pathway_fails_clearly_with_nothing_to_fall_back_to(name, provider, op):
    h, stand = pathway(name)
    stand.refuse[provider] = "down"
    job = run(h, op, INPUTS[op])
    assert job["state"] == "failed" and job["error"]["code"] == "provider_unavailable" and job["error"]["retryable"]


def test_a_pick_runs_its_model_and_falls_back_to_runway_default_on_the_mix():
    h, stand = pathway("mix")
    pick = {"provider": "fal", "model": "kling-image-o3"}
    job = run(h, "frame", INPUTS["frame"], modelChoice=pick)
    assert (job["provider"], job["model"]) == ("fal", "kling-image-o3")
    assert stand.to("fal")[-1]["endpoint"] == "fal-ai/kling-image/o3/image-to-image" and not stand.to("fal")[-1]["errors"]
    stand.refuse["fal"] = "503"
    job = run(h, "frame", INPUTS["frame"], modelChoice=pick)
    assert (job["provider"], job["model"], job["fallbackFrom"]) == ("runway", "gemini_image3_pro", pick)


def test_a_clip_heygen_may_already_have_is_made_on_runway_and_says_heygen_may_charge():
    # Was "is never sent anywhere else": Runway is the floor since 2026-10-09 (features/runway-fallback.clan).
    # HeyGen is never sent it again; Runway makes it, and the job says HeyGen may still charge.
    h, stand = pathway("mix", routing={**pathway_config("mix")["routing"], "clip": ["heygen", "runway"]})
    stand.submit_reply["heygen"] = httpx.Response(409, json={"error": {"message": "in progress"}})
    job = run(h, "clip", INPUTS["clip"])
    assert (job["state"], job["provider"], job["fallbackFrom"]["provider"]) == ("completed", "runway", "heygen")
    assert "HeyGen may still charge" in job["fallbackReason"]
    assert len(stand.to("runway")) == 1


def test_a_clip_heygen_may_already_have_is_never_sent_anywhere_else_without_a_floor():
    h, stand = pathway("heygen")
    stand.submit_reply["heygen"] = httpx.Response(409, json={"error": {"message": "in progress"}})
    job = run(h, "clip", INPUTS["clip"])
    assert job["state"] == "uncertain"
    assert not stand.to("runway")


@pytest.mark.parametrize("name", ["fal", "mix"])
def test_moderated_content_is_never_sent_to_another_provider(name):
    h, stand = pathway(name)
    stand.submit_reply["fal"] = httpx.Response(422, json={"detail": [{"type": "content_policy_violation", "msg": "flagged"}]})
    job = run(h, "frame", INPUTS["frame"])
    assert job["state"] == "failed" and job["error"]["code"] == "moderated"
    assert not stand.to("runway")


@pytest.mark.parametrize("name,provider,reply", [
    ("runway", "runway", httpx.Response(404, json={"error": "no such task"})),
    ("heygen", "heygen", httpx.Response(200, json={"data": {"status": "completed"}})),  # done, no video
    ("fal", "fal", httpx.Response(200, json={"status": "WEIRD"})),
])
def test_a_permanent_status_error_ends_the_job_at_once_not_at_the_timeout(name, provider, reply):
    h, stand = pathway(name)
    stand.status_reply[provider] = reply
    op = "clip" if name == "heygen" else "frame"
    token = h.sign_in()
    req = {"contractVersion": "2", "jobId": new_id("job"), "op": op, "parentIds": [], "input": INPUTS[op]}
    _, job = h.call("POST", "/jobs", req, token, expect=200)
    h.clock.tick(10)
    job = h.poll(token, job["jobId"])  # one poll, well inside the 600 s timeout
    assert job["state"] == "failed", job
    assert job["error"]["code"] != "timeout"


def test_masked_clip_edits_on_fal_run_the_segment_then_inpaint_chain():
    h, stand = pathway("fal")
    job = run(h, "clip_edit", {"video": asset(8, "video/mp4"), "region": BOX, "mask": asset(7), "atS": 1,
                               "text": "make the car red"})
    assert job["state"] == "completed", (job.get("error"), stand.sent)
    assert [s["endpoint"] for s in stand.to("fal")] == ["fal-ai/sam2/video", "fal-ai/wan-vace-14b/inpainting"]
    assert all(not s["errors"] for s in stand.to("fal"))


# ── the real director, replayed ─────────────────────────────────────────────
DIRECTOR_FIXTURES = sorted(p.stem for p in (contracts_dir().parent / "relay" / "tests" / "fixtures" / "director").glob("*.json"))


# Fixtures the relay cannot reach yet, with why. They stay listed so they show in every run.
UNREACHABLE = {
    "clip_edit_runway": "the director sends a keyframe of the edited frame at atS, and nothing in the relay makes "
                        "that frame yet (video region edits, flag videoRegionEdit, off)",
}


@pytest.mark.parametrize("fixture_name", [
    pytest.param(n, marks=pytest.mark.xfail(reason=UNREACHABLE[n], strict=True)) if n in UNREACHABLE else n
    for n in DIRECTOR_FIXTURES])
def test_the_recorded_director_output_runs_on_its_pathway(fixture_name):
    """The Claude director's recorded answers (tests/fixtures/director) through the relay and the real
    adapter: the job completes and the body it makes validates against the provider's schema."""
    from director import Director
    from director.claude import ClaudeDirector, PROMPTS
    from director.model import ModelPort
    from providers import load_sheet
    from test_director import FakeWire, fixture

    f = fixture(fixture_name)
    name = f["provider"] if f["provider"] in ("runway", "fal") else "fal"
    h, stand = pathway(name)
    sheets = {n: load_sheet(n) for n in ("mock", "runway", "fal", "heygen")}
    h.relay.director = ClaudeDirector(Director(ModelPort(FakeWire(f["reply"]), "claude-haiku-4-5", timeout=5),
                                               PROMPTS, sheets))
    job = run(h, f["op"], f["input"])
    assert job["state"] == "completed", (fixture_name, job.get("error"), stand.sent)
    if f["op"] == "shot_list" or job.get("needsUser"):
        assert not stand.sent
        return
    assert job["provider"] == f["provider"]
    sent = stand.to(f["provider"])
    assert sent and all(not s["errors"] for s in sent), [s["errors"] for s in sent]


# ── the scripts ─────────────────────────────────────────────────────────────
def _script(name: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, contracts_dir().parent / "relay" / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_cost_of_a_reference_production_per_pathway_is_pinned():
    """A price change in a capability sheet shows up here, so it is seen in review."""
    costs = {c["pathway"]: (c["totalUsd"], c["bestTotalUsd"], c["unknown"]) for c in
             (_script("pathway_costs").costs(n) for n in PATHWAYS)}
    assert costs == {  # features/default-models.clan: a good model always
        "runway": (11.0, 11.0, []),
        "fal": (5.535, 16.575, []),
        "heygen": (2.175, 2.175, ["clip on heygen"]),
        "mix": (5.535, 16.575, []),
    }


def test_the_smoke_script_sends_nothing_without_live(monkeypatch, capsys):
    def no_network(*a, **k):
        raise AssertionError("the dry run made a network call")
    monkeypatch.setattr(httpx.Client, "send", no_network)
    assert _script("pathway_smoke").main(["--video"], env={"FAL_KEY": "x"}) == 0
    out = capsys.readouterr().out
    assert "dry run: nothing sent" in out and "FAL_KEY: set" in out and "x" not in out.split("FAL_KEY: set")[0]
    assert "no RUNWAY_API_KEY" in out and "needs --mask-url" in out


def test_the_smoke_script_runs_only_the_steps_asked_for(capsys):
    _script("pathway_smoke").main(["--video", "--steps", "frame,clip", "--pathways", "runway"], env={})
    out = capsys.readouterr().out
    assert "runway  frame" in out and "runway  clip " in out and "generate" not in out and "view" not in out
