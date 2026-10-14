"""Every step on every provider pathway, end to end through the relay (features/harness-pathways.clan).

The pathways are contracts/examples/config.pathway.*.json (Runway alone since
features/drop-hackathon-extras.clan). Each case posts a JobRequest to the Relay, which runs the
director, names.py tags, the seam and the REAL Runway adapter against an in-process stand-in of its
API, then polls until the job ends.
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

from conftest import CDN, Harness, envelope
from contracts_dir import contracts_dir, pricing
from director import new_id
from providers import Registry
from providers._seam import Adapted, Resolver
from providers.runway import RunwayProvider
from provider_schemas import errors as schema_errors

PATHWAYS = ("runway",)
PROVIDER_OPS = ("generate", "view", "frame", "region_edit", "clip", "clip_edit")
ASSET_HOSTS = ("cdn.test", "hack.napkin.ie")  # ours in these tests, and in the recorded director fixtures


def _png(w: int = 64, h: int = 48) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), (90, 120, 200)).save(out, format="PNG")
    return out.getvalue()


PNG = _png()
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64


# ── the provider stand-ins ──────────────────────────────────────────────────
class StandIns:
    """Runway as an httpx MockTransport handler. Records every body sent,
    with the published-schema errors for it, and answers like the real APIs (submit, status, result).
    `refuse` maps a provider to the HTTP status (or 'down') its next submits get."""

    def __init__(self, blobs):
        self.blobs = blobs
        self.sent: list[dict] = []
        self.refuse: dict[str, object] = {}
        self._n = itertools.count(1)
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
        if host == "api.dev.runwayml.com":
            return self._runway_call(request.method, path, body)
        raise AssertionError(f"unexpected call {request.method} {request.url}")

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
    reg.register(Adapted(RunwayProvider("rw_test_key", Resolver(), client=client)))
    h.relay.registry = reg
    return h, stand


def asset(n: int, mime: str = "image/png") -> dict:
    import hashlib
    sha = "sha256:" + hashlib.sha256(f"{n}{mime}".encode()).hexdigest()
    return {"sha256": sha, "url": f"{CDN}/in/{sha}", "mime": mime}


def named(n: int, name: str, role: str = "character") -> dict:
    return {"id": new_id("ref"), "name": name, "role": role, "kind": "picture", "asset": asset(n)}


SHOT = {"id": new_id("shot", "pathways"), "kind": "shot", "duration_s": 5, "camera": {"size": "medium", "movement": "static"},
        "action": "@maya waves at the camera", "refs": ["maya"]}
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


def sent_settings(op: str, body: dict) -> dict:
    """The settings a Runway body carries that its price depends on."""
    if op == "clip":
        return {"durationS": body["duration"], "audio": body["audio"]}
    if op == "clip_edit":
        return {}  # priced at the op's default input length: the request does not carry the clip's
    return {"outputs": body.get("outputCount", 1), "ratio": body["ratio"]}


def expected_provider(cfg: dict, h: Harness, op: str) -> str:
    return next(p for p in cfg["routing"][op] if h.relay.registry.supports(p, op))


def run(h: Harness, op: str, inp: dict, **req_over) -> dict:
    """POST the job, then poll as the browser does until it ends."""
    token = h.as_person()
    req = {**envelope(op, new_id("job")), "input": inp, **req_over}
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
    # The reservation is the sheet's price (contracts/pricing.py) at the settings the body really sent.
    want = pricing().op_usd(sheet, op, None, sent_settings(op, sent[-1]["body"]))
    assert want is not None and job["cost"]["estimate"] == want and not job["cost"]["unknown"]


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


def test_clips_that_cannot_take_refs_send_the_frame_and_name_the_character_in_words():
    h, stand = pathway("runway")
    run(h, "clip", INPUTS["clip"])
    body = stand.to("runway")[0]["body"]
    assert "referenceImages" not in body
    assert "@" not in body["promptText"]


def test_runway_region_edits_send_the_image_and_a_copy_with_the_box_drawn():
    h, stand = pathway("runway")
    run(h, "region_edit", INPUTS["region_edit"])
    refs = stand.to("runway")[0]["body"]["referenceImages"]
    assert [r["tag"] for r in refs[:2]] == ["current", "marked"]
    assert refs[1]["uri"].startswith("data:image/png;base64,")


# ── when something goes wrong ───────────────────────────────────────────────
@pytest.mark.parametrize("op", ["frame", "clip"])
def test_a_single_provider_pathway_fails_clearly_with_nothing_to_fall_back_to(op):
    h, stand = pathway("runway")
    stand.refuse["runway"] = "down"
    job = run(h, op, INPUTS[op])
    assert job["state"] == "failed" and job["error"]["code"] == "provider_unavailable" and job["error"]["retryable"]


@pytest.mark.parametrize("op", ["frame", "clip"])
def test_a_permanent_status_error_ends_the_job_at_once_not_at_the_timeout(op):
    h, stand = pathway("runway")
    stand.status_reply["runway"] = httpx.Response(404, json={"error": "no such task"})
    token = h.as_person()
    req = {**envelope(op, new_id("job")), "input": INPUTS[op]}
    _, job = h.call("POST", "/jobs", req, token, expect=200)
    h.clock.tick(10)
    job = h.poll(token, job["jobId"])  # one poll, well inside the 600 s timeout
    assert job["state"] == "failed", job
    assert job["error"]["code"] != "timeout"


# ── the real director, replayed ─────────────────────────────────────────────
# The recorded answers for a routed provider (the mock sheet's are the director's own tests).
DIRECTOR_FIXTURES = sorted(p.stem for p in (contracts_dir().parent / "relay" / "tests" / "fixtures" / "director").glob("*.json")
                           if json.loads(p.read_text())["provider"] != "mock")


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
    h, stand = pathway("runway")
    sheets = {n: load_sheet(n) for n in ("mock", "runway")}
    h.relay.director = ClaudeDirector(Director(ModelPort(FakeWire(f["reply"]), "claude-haiku-4-5", timeout=5),
                                               PROMPTS, sheets))
    job = run(h, f["op"], f["input"])
    if f["reply"].get("question"):  # the director asked: the job waits for a person, nothing is sent
        assert job["state"] == "needs_input" and job["question"]["id"].startswith("q_") and not stand.sent
        return
    assert job["state"] == "completed", (fixture_name, job.get("error"), stand.sent)
    if f["op"] == "shot_list":
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


def test_the_cost_of_an_ad_is_pinned():
    """A price change in a capability sheet shows up here, so it is seen in review
    (contracts/cost-model.json, features/runway-sheet-sync.clan)."""
    costs = {c["id"]: (c["credits"], c["usd"]) for c in _script("ad_costs").costs()}
    assert costs == {"typical": (1089, 10.89), "typical_takes": (2769, 27.69), "typical_audio": (1809, 18.09),
                     "typical_audio_takes": (4929, 49.29), "heavy": (8863, 88.63)}


def test_a_price_change_in_the_sheet_moves_the_ad_totals():
    ad_costs = _script("ad_costs")
    sheet = json.loads((contracts_dir() / "capabilities" / "runway.json").read_text())
    sheet["models"]["veo3.1"]["pricing"]["credits"] = 25  # no-audio Veo 3.1 up from 20 to 25 a second
    moved = {c["id"]: c["credits"] for c in ad_costs.costs(the_sheet=sheet)}
    assert moved["typical"] == 1089 + 6 * 6 * 5 and moved["typical_audio"] == 1809  # audio-on lines unchanged
    assert ad_costs.main(["--check"]) == 0  # the committed sheet still gives the expected totals


def test_an_unpriced_line_fails_loudly_never_free():
    ad_costs = _script("ad_costs")
    sheet = json.loads((contracts_dir() / "capabilities" / "runway.json").read_text())
    del sheet["models"]["aleph2"]
    with pytest.raises(ad_costs.pricing().PriceError):
        ad_costs.costs(the_sheet=sheet)


def test_the_smoke_script_sends_nothing_without_live(monkeypatch, capsys):
    def no_network(*a, **k):
        raise AssertionError("the dry run made a network call")
    monkeypatch.setattr(httpx.Client, "send", no_network)
    assert _script("pathway_smoke").main(["--video"], env={"RUNWAY_API_KEY": "secret-x"}) == 0
    out = capsys.readouterr().out
    assert "dry run: nothing sent" in out and "RUNWAY_API_KEY: set" in out and "secret-x" not in out
    assert "needs --mask-url" in out
    assert _script("pathway_smoke").main([], env={}) == 0
    assert "no RUNWAY_API_KEY" in capsys.readouterr().out


def test_the_smoke_script_runs_only_the_steps_asked_for(capsys):
    _script("pathway_smoke").main(["--video", "--steps", "frame,clip", "--pathways", "runway"], env={})
    out = capsys.readouterr().out
    assert "runway  frame" in out and "runway  clip " in out and "generate" not in out and "view" not in out
