import io
import json
import random
import sys
import threading
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from PIL import Image, ImageOps

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import runway_common  # noqa: E402
import runway_report  # noqa: E402
import runway_smoke  # noqa: E402
import runway_testpack  # noqa: E402
from runway_common import Assets, Budget, Runner, Tap, make_client  # noqa: E402

from providers import ProviderJob, ProviderOutput, Status, load_sheet  # noqa: E402
from providers.runway import RunwayProvider  # noqa: E402

KEY = "key_" + "0" * 128
ENV = {"RUNWAYML_API_SECRET": KEY}
IMG = "https://cdn.test/hero.png"
VID = "https://cdn.test/clip.mp4"
SIZE = (256, 256)


class Clock:
    t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def runtime(clock):
    return {"sleep": clock.sleep, "clock": clock, "rng": lambda: 0.0}


def _gradient() -> bytes:
    img = Image.new("RGB", SIZE)
    img.putdata([((x * 7) % 256, (y * 5) % 256, (x + y) % 256) for y in range(SIZE[1]) for x in range(SIZE[0])])
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


class Fake:
    """A stand-in for RunwayProvider: records submits, answers done at once."""
    name = "runway"

    def __init__(self, log, sheet=None, cost=0.05):
        self.log, self._sheet, self.cost = log, sheet or load_sheet("runway"), cost

    def capabilities(self):
        return self._sheet

    def submit(self, job: ProviderJob) -> str:
        with self.log["lock"]:
            self.log["jobs"].append((job, self._sheet["ops"][job.op]["model"]))
            return f"task-{len(self.log['jobs'])}"

    def status(self, rid):
        return Status("done", outputs=[ProviderOutput(f"https://out.test/{rid}.png", "image/png")],
                      cost_usd=self.cost)

    def cancel(self, rid):
        pass

    def organization(self):
        return {"tier": {"maxMonthlyCreditSpend": 100000}, "concurrency": {"veo3.1_fast": 10, "aleph2": None},
                "creditBalance": 500}


def fake_factory(log, cost=0.05):
    def factory(key, assets, tap, sheet=None):
        assert key == KEY
        return Fake(log, sheet, cost)
    return factory


def new_log():
    return {"jobs": [], "lock": threading.Lock()}


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Every test is offline: a request that reaches the real transport fails the test."""
    def refuse(self, request):
        pytest.fail(f"a test reached the network: {request.method} {request.url.host}")
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)


def test_the_network_guard_stops_the_default_fetch_and_head():
    for call in (runway_common.fetch_bytes, runway_common.head_url):
        with pytest.raises(pytest.fail.Exception):
            call("https://example.test/x.png")


def no_http_factory(key, assets, tap, sheet=None):
    """A real adapter over a transport that fails the test if anything is sent."""
    def refuse(request):
        pytest.fail(f"dry run sent {request.method} {request.url}")
    return RunwayProvider(key, assets, make_client(tap, httpx.MockTransport(refuse)), sheet)


def run(module, argv, env=ENV, **kw):
    lines = []
    code = module.main(argv, env=env, out=lines.append, **kw)
    return code, "\n".join(lines)


# --- dry run

@pytest.mark.parametrize("module,argv", [
    (runway_smoke, ["--image-url", IMG, "--video-url", VID]),
    (runway_testpack, ["--image-url", IMG, "--input-url", IMG]),
])
def test_dry_run_prints_the_plan_and_sends_nothing(module, argv, tmp_path):
    out = tmp_path / "r.json"
    extra = ["--out", str(out)] if module is runway_testpack else []

    def never(*a):
        pytest.fail("dry run fetched an input")

    code, text = run(module, argv + extra, factory=no_http_factory, fetch=never)
    assert code == 0
    assert "estimated cost: $" in text and "dry run" in text
    assert KEY not in text and "set (132 chars)" in text
    assert not out.exists()


def test_dry_run_names_the_missing_inputs():
    _, text = run(runway_smoke, [], env={})
    assert "needs --image-url" in text and "needs --video-url" in text
    _, text = run(runway_testpack, [], env={})
    assert "needs --image-url" in text and "needs --input-url" in text


def test_smoke_cost_estimate_comes_from_the_sheet():
    sheet = load_sheet("runway")
    _, text = run(runway_smoke, ["--ops", "clip,clip_edit"])
    total = sheet["ops"]["clip"]["estimateUsd"] + sheet["ops"]["clip_edit"]["estimateUsd"]
    assert f"estimated cost: ${total:.2f}" in text


# --- the key and the live gate

@pytest.mark.parametrize("module,argv", [
    (runway_smoke, ["--live", "--image-url", IMG, "--video-url", VID]),
    (runway_smoke, ["--org-only"]),
    (runway_testpack, ["--live", "--image-url", IMG, "--input-url", IMG]),
])
def test_live_without_the_key_refuses(module, argv):
    log = new_log()
    code, text = run(module, argv, env={}, factory=fake_factory(log))
    assert code == 2 and "RUNWAYML_API_SECRET is missing" in text and "source .env" in text
    assert log["jobs"] == []


def test_live_without_inputs_refuses_and_says_which():
    log = new_log()
    code, text = run(runway_smoke, ["--live"], factory=fake_factory(log))
    assert code == 2 and "--image-url" in text and "--video-url" in text
    code, text = run(runway_testpack, ["--live", "--only", "a,b"], factory=fake_factory(log))
    assert code == 2 and "--image-url" in text and "--input-url" in text
    assert log["jobs"] == []


def test_org_only_needs_no_live_and_submits_nothing(runtime):
    log = new_log()
    code, text = run(runway_smoke, ["--org-only"], factory=fake_factory(log), **runtime)
    assert code == 0 and "veo3.1_fast" in text and "concurrency 10" in text and "no limit" in text
    assert log["jobs"] == []
    assert KEY not in text


# --- smoke

def test_smoke_runs_each_op_and_sets_audio_off(runtime):
    log = new_log()
    code, text = run(runway_smoke, ["--live", "--image-url", IMG, "--video-url", VID],
                     factory=fake_factory(log), fetch=lambda url: _gradient(), **runtime)
    assert code == 0, text
    ops = [j.op for j, _ in log["jobs"]]
    assert ops == ["generate", "view", "frame", "region_edit", "clip", "clip_edit"]
    clip = next(j for j, _ in log["jobs"] if j.op == "clip")
    assert clip.audio is False and clip.duration_s == 4
    assert text.count("done") >= 5


def test_smoke_exits_non_zero_when_an_op_fails(runtime):
    class Failing(Fake):
        def status(self, rid):
            return Status("failed", error=runway_common.ProviderError("moderated", "no", False))

    code, text = run(runway_smoke, ["--live", "--ops", "generate"],
                     factory=lambda k, a, t, s=None: Failing(new_log(), s), **runtime)
    assert code == 1 and "moderated, not retried" in text


def test_a_moderated_job_is_submitted_once(runtime):
    log = new_log()

    class Moderated(Fake):
        def status(self, rid):
            return Status("failed", error=runway_common.ProviderError("moderated", "no", False))

    runner = Runner(Moderated(log), Budget(15), **runtime)
    rec = runner.run("x", runway_common.make_job(load_sheet("runway"), "generate", "a fox", ratio="1024:1024"))
    assert rec["state"] == "failed" and rec["error"]["code"] == "moderated" and len(log["jobs"]) == 1


def test_max_usd_stops_before_overspending(runtime):
    log = new_log()
    code, text = run(runway_smoke, ["--live", "--ops", "generate,view,frame", "--image-url", IMG,
                                    "--max-usd", "0.10"],
                     factory=fake_factory(log, cost=0.07), fetch=lambda url: _gradient(), **runtime)
    assert len(log["jobs"]) == 1  # a second $0.07 job would pass $0.10
    assert code == 1 and "--max-usd" in text


def test_the_cap_counts_jobs_in_flight():
    budget = Budget(0.10)
    budget.reserve(0.07)
    with pytest.raises(runway_common.BudgetExceeded):
        budget.reserve(0.07)
    budget.settle(0.07, 0.03)  # the first job cost less
    budget.reserve(0.07)


# --- polling and THROTTLED against the real adapter

def test_polls_no_faster_than_5_s_and_times_the_throttle(clock):
    tasks = iter(["THROTTLED", "THROTTLED", "RUNNING", "SUCCEEDED"])
    requests = []

    def handler(request):
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"id": "t1", "estimatedCost": {"credits": 60}})
        status = next(tasks)
        body = {"id": "t1", "status": status}
        if status == "SUCCEEDED":
            body.update(output=["https://r.test/o.mp4"], cost={"credits": 40})
        return httpx.Response(200, json=body)

    tap = Tap(clock)
    provider = RunwayProvider(KEY, Assets(), make_client(tap, httpx.MockTransport(handler)))
    assets = provider._assets
    sha = assets.add_url(IMG, "image/png")
    polls = []
    runner = Runner(provider, Budget(15), sleep=lambda s: (polls.append(s), clock.sleep(s))[1], clock=clock,
                    rng=lambda: 0.5, tap=tap)
    job = runway_common.make_job(provider.capabilities(), "clip", "she smiles", ratio="1280:720",
                                 duration_s=4, first_frame=sha)
    rec = runner.run("clip", job)
    assert rec["state"] == "done" and rec["cost_usd"] == 0.4 and rec["outputs"] == ["https://r.test/o.mp4"]
    assert all(s >= 5 for s in polls) and len(polls) == 4
    assert rec["throttled_s"] == pytest.approx(2 * (5 + 0.5 * runway_common.JITTER_S))
    post = json.loads(requests[0].content)
    assert post["audio"] is False and post["model"] == "veo3.1_fast"
    assert requests[0].headers["Authorization"] == f"Bearer {KEY}"
    assert runner.budget.spent == pytest.approx(0.4)


def test_a_poll_that_runs_out_of_time_cancels_and_fails(clock):
    deleted = []

    def handler(request):
        if request.method == "POST":
            return httpx.Response(200, json={"id": "t1"})
        if request.method == "DELETE":
            deleted.append(request.url.path)
            return httpx.Response(204)
        return httpx.Response(200, json={"id": "t1", "status": "RUNNING"})

    provider = RunwayProvider(KEY, Assets(), make_client(None, httpx.MockTransport(handler)))
    runner = Runner(provider, Budget(15), sleep=clock.sleep, clock=clock, rng=lambda: 0.0)
    rec = runner.run("g", runway_common.make_job(provider.capabilities(), "generate", "a fox", ratio="1024:1024"),
                     timeout_s=30)
    assert rec["state"] == "failed" and "gave up" in rec["error"]["message"]
    assert deleted == ["/v1/tasks/t1"]


# --- test pack

def pack(tmp_path, runtime, only, factory=None, fetch=None, extra=(), image=IMG, input_url=IMG):
    out = tmp_path / "runway-testpack.json"
    code, text = run(runway_testpack,
                     ["--live", "--only", only, "--image-url", image, "--input-url", input_url, "--out", str(out),
                      "--save-dir", str(tmp_path / "outputs"), *extra],
                     factory=factory or fake_factory(new_log()), fetch=fetch or (lambda url: _gradient()),
                     head=lambda url: {"status": 200, "content_type": "image/png", "content_length": "123"},
                     **runtime)
    return code, text, json.loads(out.read_text()) if out.exists() else None, out


def test_results_json_shape(tmp_path, runtime):
    code, text, res, out = pack(tmp_path, runtime, "g,b,a,d,e,f")
    assert code == 0, text
    datetime.fromisoformat(res["generated_at"])
    assert res["live"] is True and res["max_usd"] == 15.0 and res["spent_usd"] > 0
    assert list(res["items"]) == ["a", "b", "d", "e", "f", "g"]
    assert res["items"]["g"]["concurrency"]["veo3.1_fast"] == 10
    assert res["items"]["a"]["status"] == "needs_eyes" and res["items"]["a"]["reference_honoured"] == "needs eyes"
    assert {j["label"] for j in res["items"]["a"]["jobs"]} == {"with_tag", "without_tag"}
    b = res["items"]["b"]
    assert b["head"]["status"] == 200 and b["passed"] is True
    assert len(res["items"]["d"]["jobs"]) == 5 and "per_view" in res["items"]["d"]["cost_usd"]
    f = res["items"]["f"]
    assert f["done"] == 20 and f["p50_s"] is not None and f["p95_s"] >= f["p50_s"] and "throttled_s_total" in f
    for job in res["items"]["f"]["jobs"]:
        assert {"label", "op", "model", "request_id", "state", "latency_s", "throttled_s", "cost_usd",
                "outputs"} <= set(job)
    assert KEY not in out.read_text() and KEY not in text
    assert out.with_suffix(".md").read_text().startswith("Runway test pack")
    assert "(a) @tag" in text and "needs eyes" in text


def test_the_clip_ab_overrides_the_model_and_keeps_audio_off(tmp_path, runtime):
    log = new_log()
    _, _, res, _ = pack(tmp_path, runtime, "e", factory=fake_factory(log))
    assert sorted(m for _, m in log["jobs"]) == sorted(runway_testpack.CLIP_MODELS)
    assert all(j.audio is False for j, _ in log["jobs"])
    assert {j["model"] for j in res["items"]["e"]["jobs"]} == set(runway_testpack.CLIP_MODELS)


def test_the_tag_test_sends_the_same_reference_with_and_without_the_tag(tmp_path, runtime):
    log = new_log()
    pack(tmp_path, runtime, "a", factory=fake_factory(log))
    prompts = {j.prompt: j for j, _ in log["jobs"]}
    tagged = next(p for p in prompts if p.startswith("@hero"))
    plain = next(p for p in prompts if "@" not in p)
    assert prompts[tagged].refs == prompts[plain].refs and len(prompts[tagged].refs) == 1


def test_max_usd_cuts_the_pack_short(tmp_path, runtime):
    log = new_log()
    code, text, res, _ = pack(tmp_path, runtime, "f", factory=fake_factory(log, cost=0.07),
                              extra=["--max-usd", "0.50"])
    assert len(log["jobs"]) == 7 and res["items"]["f"]["status"] == "done"
    assert res["items"]["f"]["submitted"] == 7 and res["spent_usd"] <= 0.5


# --- the region gate

class RegionServer:
    """Answers region edits: the first `good` submits stay inside the box, the rest change nothing."""

    def __init__(self, good, cost=0.05):
        self.good, self.cost, self.regions, self.original = good, cost, {}, _gradient()
        self.log = new_log()

    def factory(self, key, assets, tap, sheet=None):
        server = self

        class Pro(Fake):
            def submit(self, job):
                rid = super().submit(job)
                server.regions[rid] = (len(server.log["jobs"]) <= server.good, job.region)
                return rid
        return Pro(self.log, sheet, self.cost)

    def fetch(self, url):
        if url == IMG:
            return self.original
        rid = url.rsplit("/", 1)[1].removesuffix(".png")
        stays, region = self.regions.get(rid, (False, None))
        if region is None:  # an output saved for a person to look at, not a region edit
            return self.original
        if not stays:
            return self.original
        img = Image.open(io.BytesIO(self.original)).convert("RGB")
        l, t = round(region["x"] * SIZE[0]), round(region["y"] * SIZE[1])
        r, b = round((region["x"] + region["w"]) * SIZE[0]), round((region["y"] + region["h"]) * SIZE[1])
        img.paste(ImageOps.invert(img.crop((l, t, r, b))), (l, t))
        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()


@pytest.mark.parametrize("good,passed", [(7, True), (10, True), (6, False)])
def test_the_region_gate_needs_7_of_10(tmp_path, runtime, good, passed):
    server = RegionServer(good)
    code, text, res, _ = pack(tmp_path, runtime, "c", factory=server.factory, fetch=server.fetch)
    gate = res["items"]["c"]["gate"]
    assert gate == {"passed": passed, "count": good, "need": 7, "of": 10}
    assert len(server.log["jobs"]) == 10  # no retries: the first try counts
    assert all(j.op == "region_edit" for j, _ in server.log["jobs"])
    assert ("PASS" if passed else "FAIL") in text
    assert code == 0


def test_the_region_gate_is_incomplete_when_the_cap_stops_it(tmp_path, runtime):
    server = RegionServer(10, cost=0.20)  # each edit costs its whole estimate, so none frees room
    code, _, res, _ = pack(tmp_path, runtime, "c", factory=server.factory, fetch=server.fetch,
                           extra=["--max-usd", "0.60"])
    item = res["items"]["c"]
    assert item["status"] == "incomplete" and item["skipped"] == 7 and item["gate"]["passed"] is False
    assert code == 1


def test_an_item_that_raises_is_recorded_and_the_batch_goes_on(tmp_path, runtime):
    def broken(url):
        raise OSError("no route")

    code, text, res, _ = pack(tmp_path, runtime, "c,g", fetch=broken)
    assert res["items"]["c"]["status"] == "error" and "no route" in res["items"]["c"]["error"]
    assert res["items"]["g"]["status"] == "done" and code == 1


def test_unknown_items_are_refused():
    code, text = run(runway_testpack, ["--only", "a,z"])
    assert code == 2 and "z" in text


# --- helpers

def test_percentiles():
    assert runway_common.percentile([], 50) is None
    values = list(range(1, 21))
    assert runway_common.percentile(values, 50) == 10 and runway_common.percentile(values, 95) == 19


def test_prepare_image_snaps_to_a_pro_ratio():
    img = Image.new("RGB", (900, 500), (10, 20, 30))
    out = io.BytesIO()
    img.save(out, format="PNG")
    png, ratio = runway_common.prepare_image(out.getvalue())
    assert ratio in runway_common.PRO_RATIOS and ratio == "1344:768"
    assert Image.open(io.BytesIO(png)).size == (1344, 768)


def test_redact_url_drops_the_query():
    assert runway_common.redact_url("https://a.test/x.png?X-Amz-Signature=abc") == "https://a.test/x.png"


# --- images go inline, video inputs need https

LOCAL = "http://127.0.0.1:8765/character.png"


def real_adapter_factory(bodies):
    """The real adapter over a transport that records each POST body and answers a finished task."""
    def handler(request):
        if request.method == "POST":
            bodies.append((request.url.path, json.loads(request.content)))
            return httpx.Response(200, json={"id": f"t{len(bodies)}"})
        return httpx.Response(200, json={"id": "t", "status": "SUCCEEDED", "output": ["https://r.test/o.png"],
                                         "cost": {"credits": 5}})

    def factory(key, assets, tap, sheet=None):
        return RunwayProvider(key, assets, make_client(tap, httpx.MockTransport(handler)), sheet)
    return factory


def uris(body):
    return [r["uri"] for r in body["referenceImages"]]


def test_a_local_image_url_goes_to_the_image_ops_as_a_data_uri(tmp_path, runtime):
    bodies, fetched = [], []

    def fetch(url):
        fetched.append(url)
        return _gradient()

    code, text, res, _ = pack(tmp_path, runtime, "a,d", factory=real_adapter_factory(bodies), fetch=fetch,
                              image=LOCAL)
    assert code == 0, text
    sent = [b for path, b in bodies if path == "/v1/text_to_image"]
    assert len(sent) == 2 + 5
    for body in sent:
        (uri,) = uris(body)
        assert uri.startswith("data:image/png;base64,")
    assert LOCAL not in json.dumps(bodies)
    assert fetched.count(LOCAL) == 1  # fetched once for both items


def _noise() -> bytes:
    img = Image.frombytes("RGB", SIZE, random.Random(0).randbytes(SIZE[0] * SIZE[1] * 3))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def test_a_big_png_falls_back_to_a_jpeg_that_fits(monkeypatch):
    monkeypatch.setattr(runway_common, "DATA_URI_MAX", 150_000)
    source = _noise()  # about 190 KB as a PNG, far less as a JPEG
    assert runway_common._data_uri_len(len(source), "image/png") > 150_000
    data, mime = runway_common.fit_image(source)
    assert mime == "image/jpeg" and Image.open(io.BytesIO(data)).size == SIZE
    assert runway_common._data_uri_len(len(data), mime) <= 150_000
    assert Assets().upload(data, mime).url.startswith("data:image/jpeg;base64,")  # the real cap accepts it


def test_an_image_too_big_even_as_a_jpeg_is_shrunk(monkeypatch):
    monkeypatch.setattr(runway_common, "DATA_URI_MAX", 20_000)
    data, mime = runway_common.fit_image(_noise())
    assert Image.open(io.BytesIO(data)).size[0] < SIZE[0]
    assert runway_common._data_uri_len(len(data), mime) <= 20_000
    Assets().upload(data, mime)


def test_a_small_image_stays_a_full_size_png():
    data, mime = runway_common.fit_image(_gradient())
    assert mime == "image/png" and Image.open(io.BytesIO(data)).size == SIZE


def _transparent() -> bytes:
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))  # hidden pixels are black
    img.paste((200, 30, 30, 255), (16, 16, 48, 48))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def test_a_transparent_source_is_laid_on_white_not_black():
    data, _ = runway_common.fit_image(_transparent())
    img = Image.open(io.BytesIO(data))
    assert img.getpixel((2, 2)) == (255, 255, 255) and img.getpixel((32, 32)) == (200, 30, 30)
    png, _ = runway_common.prepare_image(_transparent())
    assert Image.open(io.BytesIO(png)).getpixel((1, 1)) == (255, 255, 255)


def test_the_url_test_is_blocked_without_an_https_url(tmp_path, runtime):
    bodies = []
    code, text, res, _ = pack(tmp_path, runtime, "b", factory=real_adapter_factory(bodies), image=LOCAL,
                              input_url=LOCAL, fetch=lambda url: pytest.fail("fetched for a blocked item"))
    assert bodies == [] and res["spent_usd"] == 0
    assert res["items"]["b"]["status"] == "blocked"
    assert res["items"]["b"]["reason"].startswith("needs an https")
    assert "blocked" in text and code == 0


def test_the_dry_run_shows_the_blocked_items_and_the_upload_and_spends_nothing():
    _, text = run(runway_testpack, ["--image-url", LOCAL, "--input-url", LOCAL], factory=no_http_factory,
                  fetch=lambda url: pytest.fail("dry run fetched"), transport=refusing_transport())
    assert text.count("BLOCKED: needs an https") == 1 and "dry run" in text
    (e_line,) = [ln for ln in text.splitlines() if ln.startswith("  e ")]
    assert "will upload the first frame to Runway (free, ephemeral)" in e_line and "~$" in e_line
    _, text = run(runway_smoke, ["--image-url", LOCAL, "--video-url", "http://x.test/v.mp4"], factory=no_http_factory,
                  fetch=lambda url: pytest.fail("dry run fetched"), transport=refusing_transport())
    assert text.count("BLOCKED: needs an https") == 1
    (clip_line,) = [ln for ln in text.splitlines() if ln.startswith("  clip ")]
    assert "will upload the first frame to Runway (free, ephemeral)" in clip_line


def test_an_https_url_lets_the_clip_ab_proceed(tmp_path, runtime):
    bodies = []
    code, text, res, _ = pack(tmp_path, runtime, "e", factory=real_adapter_factory(bodies))
    assert res["items"]["e"]["status"] == "needs_eyes" and len(bodies) == 3
    assert all(path == "/v1/image_to_video" and b["promptImage"][0]["uri"] == IMG for path, b in bodies)


def test_smoke_uploads_the_local_first_frame_and_blocks_only_the_clip_edit(runtime):
    bodies, uploads = [], []
    code, text = run(runway_smoke, ["--live", "--ops", "view,clip,clip_edit", "--image-url", LOCAL,
                                    "--video-url", "http://127.0.0.1/v.mp4"],
                     factory=real_adapter_factory(bodies), fetch=lambda url: _gradient(),
                     transport=upload_transport(uploads), **runtime)
    assert [path for path, _ in bodies] == ["/v1/text_to_image", "/v1/image_to_video"]
    assert uris(bodies[0][1])[0].startswith("data:image/png")
    assert bodies[1][1]["promptImage"] == [{"uri": RUNWAY_URI, "position": "first"}]
    assert len(uploads) == 2 and text.count("blocked") == 1 and code == 1
    assert KEY not in text


def test_smoke_clip_with_a_failed_upload_submits_nothing(runtime):
    bodies, uploads = [], []
    code, text = run(runway_smoke, ["--live", "--ops", "clip", "--image-url", LOCAL],
                     factory=real_adapter_factory(bodies), fetch=lambda url: _gradient(),
                     transport=upload_transport(uploads, fail_step=1), **runtime)
    assert bodies == [] and code == 1 and "failed" in text and KEY not in text


# --- the ephemeral upload of a clip's first frame

RUNWAY_URI = "runway://uploads/abc123"
FIELDS = {"key": "tmp/abc/first_frame.png", "policy": "p0l1cy", "x-amz-signature": "s1g"}
UPLOAD_URL = "https://s3.test/bucket"


def refusing_transport():
    def refuse(request):
        pytest.fail(f"sent {request.method} {request.url}")
    return httpx.MockTransport(refuse)


def upload_transport(log, fail_step=None):
    """Runway's two upload steps; every request is appended to `log`."""
    def handler(request):
        log.append(request)
        if request.url.path == "/v1/uploads":
            if fail_step == 1:
                return httpx.Response(403, text="no credits")
            return httpx.Response(200, json={"uploadUrl": UPLOAD_URL, "fields": FIELDS, "runwayUri": RUNWAY_URI})
        if fail_step == 2:
            return httpx.Response(400, text="<Error>bad policy</Error>")
        return httpx.Response(204)
    return httpx.MockTransport(handler)


def pack_e(tmp_path, runtime, transport, jobs=None, **kw):
    bodies = jobs if jobs is not None else []
    out = tmp_path / "runway-testpack.json"
    code, text = run(runway_testpack, ["--live", "--only", "e", "--image-url", kw.get("image", LOCAL),
                                       "--out", str(out), "--save-dir", str(tmp_path / "outputs")],
                     factory=real_adapter_factory(bodies), fetch=lambda url: _gradient(), transport=transport,
                     **runtime)
    return code, text, json.loads(out.read_text()), out, bodies


def multipart_parts(request):
    """The (name, body) of each part of a multipart request, in order."""
    boundary = request.headers["content-type"].split("boundary=")[1].encode()
    parts = [p for p in request.content.split(b"--" + boundary) if b"Content-Disposition" in p]
    out = []
    for p in parts:
        head, _, body = p.partition(b"\r\n\r\n")
        name = head.split(b'name="')[1].split(b'"')[0].decode()
        out.append((name, body.rsplit(b"\r\n", 1)[0]))
    return out


def test_clip_ab_uploads_a_local_first_frame_and_uses_the_runway_uri(tmp_path, runtime):
    log = []
    code, text, res, out, bodies = pack_e(tmp_path, runtime, upload_transport(log))
    assert code == 0 and res["items"]["e"]["status"] == "needs_eyes", text
    step1, step2 = log
    assert step1.method == "POST" and step1.url == "https://api.dev.runwayml.com/v1/uploads"
    assert json.loads(step1.content) == {"filename": "first_frame.png", "type": "ephemeral"}
    assert step1.headers["authorization"] == f"Bearer {KEY}" and step1.headers["x-runway-version"] == "2024-11-06"
    assert str(step2.url) == UPLOAD_URL and "authorization" not in step2.headers
    assert step2.headers["content-type"].startswith("multipart/form-data")
    parts = multipart_parts(step2)
    assert [n for n, _ in parts] == [*FIELDS, "file"]  # every field, the file last
    assert dict(parts[:-1]) == {k: v.encode() for k, v in FIELDS.items()}
    assert parts[-1][1].startswith(b"\x89PNG")
    assert len(bodies) == 3
    for path, b in bodies:
        assert path == "/v1/image_to_video" and b["promptImage"] == [{"uri": RUNWAY_URI, "position": "first"}]
        assert b["audio"] is False
    blob = out.read_text() + out.with_suffix(".md").read_text() + (tmp_path / "index.html").read_text() + text
    assert KEY not in blob and "x-amz-signature" not in blob


@pytest.mark.parametrize("step,message", [(1, "request failed: HTTP 403"), (2, "transfer failed: HTTP 400")])
def test_a_failed_upload_errors_the_item_and_submits_no_job(tmp_path, runtime, step, message):
    log = []
    code, text, res, out, bodies = pack_e(tmp_path, runtime, upload_transport(log, fail_step=step))
    e = res["items"]["e"]
    assert e["status"] == "error" and message in e["error"] and "ProviderError" in e["error"]
    assert bodies == [] and res["spent_usd"] == 0 and code == 1
    assert len(log) == step
    assert KEY not in out.read_text() + text


def test_a_dry_run_makes_no_upload_request(tmp_path):
    code, text = run(runway_testpack, ["--image-url", LOCAL, "--only", "e", "--out", str(tmp_path / "r.json")],
                     transport=refusing_transport(), factory=no_http_factory,
                     fetch=lambda url: pytest.fail("dry run fetched"))
    assert code == 0 and "will upload the first frame" in text


def test_an_https_image_url_skips_the_upload(tmp_path, runtime):
    log = []
    code, text, res, out, bodies = pack_e(tmp_path, runtime, upload_transport(log), image=IMG)
    assert log == [] and len(bodies) == 3
    assert all(b["promptImage"][0]["uri"] == IMG for _, b in bodies)


def test_ephemeral_upload_errors_do_not_carry_the_key():
    def handler(request):
        return httpx.Response(500, text="boom")
    with pytest.raises(runway_common.ProviderError) as info:
        runway_common.ephemeral_upload(make_client(transport=httpx.MockTransport(handler)), KEY, b"x", "image/png",
                                       "first_frame.png")
    err = info.value
    assert err.code == "provider_failed" and err.retryable is False and KEY not in err.message


# --- saved outputs and the results page

def test_outputs_are_saved_and_recorded(tmp_path, runtime):
    code, text, res, _ = pack(tmp_path, runtime, "a")
    jobs = {j["label"]: j for j in res["items"]["a"]["jobs"]}
    assert jobs["with_tag"]["files"] == ["outputs/a/with_tag.png"]
    assert (tmp_path / "outputs" / "a" / "without_tag.png").read_bytes() == _gradient()


def test_several_outputs_get_numbered_names_and_a_clip_gets_mp4(tmp_path):
    rec = {"label": "x", "outputs": ["https://o.test/1", "https://o.test/2"], "output_mimes": ["image/jpeg", "image/png"]}
    runway_common.save_outputs(rec, "d", tmp_path / "out", tmp_path, lambda u: b"1")
    assert rec["files"] == ["out/d/x_1.jpg", "out/d/x_2.png"]
    clip = {"label": "veo", "outputs": ["https://o.test/c"], "output_mimes": ["application/octet-stream"]}
    runway_common.save_outputs(clip, "e", tmp_path / "out", tmp_path, lambda u: b"1", "mp4")
    assert clip["files"] == ["out/e/veo.mp4"]


def test_a_failed_download_is_recorded_and_the_run_goes_on(tmp_path, runtime):
    def fetch(url):
        if url.startswith("https://out.test/"):
            raise httpx.ConnectError(f"no route to {url}")
        return _gradient()

    code, text, res, _ = pack(tmp_path, runtime, "a", fetch=fetch)
    job = res["items"]["a"]["jobs"][0]
    assert code == 0 and job["state"] == "done" and job["files"] == []
    assert "ConnectError" in job["download_errors"][0]


def test_a_download_error_does_not_keep_the_signed_query(tmp_path):
    url = "https://o.test/x.png?X-Amz-Signature=SECRET"

    def fetch(u):
        raise httpx.ConnectError(f"no route to {u}")

    rec = {"label": "x", "outputs": [url], "output_mimes": ["image/png"]}
    runway_common.save_outputs(rec, "a", tmp_path / "out", tmp_path, fetch)
    assert rec["files"] == [] and "SECRET" not in rec["download_errors"][0] and "https://o.test/x.png" in rec["download_errors"][0]


def test_region_edits_save_the_original_the_raw_output_the_final_and_the_metrics(tmp_path, runtime):
    server = RegionServer(10)
    code, text, res, _ = pack(tmp_path, runtime, "c", factory=server.factory, fetch=server.fetch)
    row = res["items"]["c"]["edits"][0]
    assert set(row["files"]) == {"original", "raw_edit", "final", "metrics"}
    folder = tmp_path / "outputs" / "c" / "edit_01"
    assert row["files"]["final"] == "outputs/c/edit_01/final.png"
    for name in ("original.png", "raw_edit.png", "final.png"):
        Image.open(folder / name).verify()
    assert (folder / "raw_edit.png").read_bytes() != (folder / "original.png").read_bytes()
    saved = json.loads((folder / "metrics.json").read_text())
    assert saved["metrics"] == row["metrics"] and saved["ok"] is True
    assert "thresholds untuned, judged on the raw model output" in text
    assert res["items"]["c"]["gate_note"] in text


def test_a_failed_edit_saves_the_raw_output_the_metrics_and_an_ungated_paste_back(tmp_path, runtime):
    server = RegionServer(0)
    _, _, res, _ = pack(tmp_path, runtime, "c", factory=server.factory, fetch=server.fetch)
    row = res["items"]["c"]["edits"][0]
    assert row["ok"] is False and "raw_edit" in row["files"] and row["metrics"]
    assert row["final_ungated"] is True and row["files"]["final"] == "outputs/c/edit_01/final.png"
    final = Image.open(tmp_path / "outputs" / "c" / "edit_01" / "final.png")
    assert final.size == Image.open(tmp_path / "outputs" / "c" / "edit_01" / "original.png").size


def test_a_passing_edit_is_not_marked_ungated(tmp_path, runtime):
    server = RegionServer(10)
    _, _, res, _ = pack(tmp_path, runtime, "c", factory=server.factory, fetch=server.fetch)
    assert "final_ungated" not in res["items"]["c"]["edits"][0]


def test_a_failed_model_download_costs_one_edit_not_the_item(tmp_path, runtime):
    server = RegionServer(10)

    def fetch(url):
        if url.startswith("https://out.test/") and url.endswith("task-3.png"):
            raise httpx.ConnectError(f"no route to {url}?X-Amz-Signature=SECRET")
        return server.fetch(url)

    code, text, res, out = pack(tmp_path, runtime, "c", factory=server.factory, fetch=fetch)
    item = res["items"]["c"]
    assert item["status"] == "done" and len(item["edits"]) == 10
    bad = [r for r in item["edits"] if "error" in r]
    assert len(bad) == 1 and bad[0]["ok"] is False and "ConnectError" in bad[0]["error"]["message"]
    assert "SECRET" not in out.read_text()
    assert sum(r["ok"] for r in item["edits"]) == 9 and res["spent_usd"] > 0


def test_a_save_error_keeps_the_verdict(tmp_path, runtime, monkeypatch):
    def broken(path, data):
        raise OSError("disk full")

    monkeypatch.setattr(runway_testpack, "write_file", broken)
    server = RegionServer(10)
    _, _, res, _ = pack(tmp_path, runtime, "c", factory=server.factory, fetch=server.fetch)
    item = res["items"]["c"]
    assert item["status"] == "done" and item["gate"]["count"] == 10
    assert all("disk full" in r["save_error"] and r["files"] == {} for r in item["edits"])


def test_the_results_keep_no_signed_output_url(tmp_path, runtime):
    class Signed(Fake):
        def status(self, rid):
            return Status("done", outputs=[ProviderOutput(f"https://out.test/{rid}.png?Signature=SECRET", "image/png")],
                          cost_usd=self.cost)

    log = new_log()
    _, text, res, out = pack(tmp_path, runtime, "a", factory=lambda k, a, t, s=None: Signed(log, s))
    job = res["items"]["a"]["jobs"][0]
    assert job["outputs"][0].startswith("https://out.test/task-") and "?" not in job["outputs"][0]
    assert "SECRET" not in out.read_text() and "SECRET" not in out.with_suffix(".md").read_text()
    assert "outputs/a/with_tag.png" in out.with_suffix(".md").read_text()


def test_the_results_page_links_the_saved_files(tmp_path, runtime):
    server = RegionServer(9)  # item a's two jobs count among the submits
    pack(tmp_path, runtime, "a,c", factory=server.factory, fetch=server.fetch, input_url=LOCAL)
    page = (tmp_path / "index.html").read_text()
    assert 'src="outputs/a/with_tag.png"' in page and 'src="outputs/c/edit_01/raw_edit.png"' in page
    assert "thresholds untuned" in page and "needs eyes" in page and "PASS" in page
    assert KEY not in page and "http" not in page.replace("https://", "")  # no external asset


def test_report_only_rebuilds_the_page_without_a_key_or_the_network(tmp_path, runtime):
    server = RegionServer(20)  # every edit passes: which ones do depends on thread order
    _, _, _, out = pack(tmp_path, runtime, "b,c", factory=server.factory, fetch=server.fetch,
                        image=LOCAL, input_url=LOCAL)  # LOCAL is not IMG: the server fetches it as an output
    (tmp_path / "index.html").unlink()
    code, text = run(runway_testpack, ["--report-only", "--out", str(out)], env={}, factory=no_http_factory,
                     fetch=lambda url: pytest.fail("report-only fetched"))
    page = (tmp_path / "index.html").read_text()
    assert code == 0 and "outputs/c/edit_01/final.png" in page
    assert "blocked" in page and "needs an https" in page
    code, text = run(runway_testpack, ["--report-only", "--out", str(tmp_path / "none.json")], env={})
    assert code == 2


def test_the_results_page_shows_every_item_kind(tmp_path, runtime):
    _, _, res, out = pack(tmp_path, runtime, "a,d,e,f")
    code, _ = run(runway_testpack, ["--report-only", "--out", str(out)], env={})
    page = (tmp_path / "index.html").read_text()
    for needle in ("outputs/d/sheet.png", "outputs/d/view_back.png", "outputs/f/job_20.png", "p50", "One sheet"):
        assert needle in page


def test_the_page_plays_a_saved_clip_and_shows_a_failure_reason():
    res = {"generated_at": "2026-10-06T10:00:00+00:00", "spent_usd": 0.4, "max_usd": 15.0, "items": {
        "e": {"status": "needs_eyes", "jobs": [
            {"label": "veo3.1_fast", "op": "clip", "model": "veo3.1_fast", "state": "done", "latency_s": 61.0,
             "cost_usd": 0.4, "files": ["outputs/e/veo3.1_fast.mp4"]},
            {"label": "gen4.5", "op": "clip", "model": "gen4.5", "state": "failed",
             "error": {"code": "invalid_input", "message": "Runway answered 400: <bad>"}}]}}}
    page = runway_report.build_report(res, runway_testpack.TITLES)
    assert '<video controls preload="metadata" src="outputs/e/veo3.1_fast.mp4">' in page
    assert "61.0 s" in page and "$0.40" in page and "Runway answered 400: &lt;bad&gt;" in page
