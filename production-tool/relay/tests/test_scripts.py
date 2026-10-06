import io
import json
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
    assert ops == ["generate", "combine", "view", "frame", "region_edit", "clip", "clip_edit"]
    clip = next(j for j, _ in log["jobs"] if j.op == "clip")
    assert clip.audio is False and clip.duration_s == 4
    assert text.count("done") >= 6


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
    code, text = run(runway_smoke, ["--live", "--ops", "generate,combine,view", "--image-url", IMG,
                                    "--max-usd", "0.10"],
                     factory=fake_factory(log, cost=0.07), **runtime)
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

def pack(tmp_path, runtime, only, factory=None, fetch=None, extra=()):
    out = tmp_path / "runway-testpack.json"
    code, text = run(runway_testpack,
                     ["--live", "--only", only, "--image-url", IMG, "--input-url", IMG, "--out", str(out), *extra],
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
        stays, region = self.regions[url.rsplit("/", 1)[1].removesuffix(".png")]
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
