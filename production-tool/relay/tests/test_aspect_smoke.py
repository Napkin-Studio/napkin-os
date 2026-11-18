"""scripts/aspect_smoke.py, offline: the dry run sends nothing, and the live path (on a fake Runway that
returns the size it was asked for) reports the relay's crop as the true shape."""

import io
import sys
import threading
from pathlib import Path

import httpx
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import aspect_smoke  # noqa: E402

from providers import ProviderOutput, Status, load_sheet  # noqa: E402

KEY = "key_" + "0" * 128
ENV = {"RUNWAYML_API_SECRET": KEY}


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    def refuse(self, request):
        pytest.fail(f"a test reached the network: {request.method} {request.url.host}")
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)


class Clock:
    t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


def png(w, h):
    out = io.BytesIO()
    Image.new("RGB", (w, h), (90, 140, 60)).save(out, format="PNG")
    return out.getvalue()


class FakeRunway:
    """Answers done at once with a picture of the size the job asked for (or `wrong`)."""
    name = "runway"

    def __init__(self, wrong=None):
        self.sizes, self.lock, self.wrong = {}, threading.Lock(), wrong

    def capabilities(self):
        return load_sheet("runway")

    def submit(self, job):
        with self.lock:
            rid = f"task-{len(self.sizes) + 1}"
            self.sizes[rid] = self.wrong or tuple(int(x) for x in job.ratio.split(":"))
            return rid

    def status(self, rid):
        return Status("done", outputs=[ProviderOutput(f"https://out.test/{rid}.png", "image/png")], cost_usd=0.2)

    def cancel(self, rid):
        pass


def run(argv, provider=None, env=ENV):
    lines, clock = [], Clock()
    provider = provider or FakeRunway()
    fetch = lambda url: png(*provider.sizes[url.rsplit("/", 1)[1][:-4]])  # noqa: E731
    code = aspect_smoke.main(argv, env=env, out=lines.append, factory=lambda k, a, t, s=None: provider, fetch=fetch,
                             sleep=clock.sleep, clock=clock, rng=lambda: 0.0)
    return code, "\n".join(lines)


def test_the_dry_run_prints_the_plan_and_sends_nothing():
    code, text = run([])
    assert code == 0
    assert "generate 16:9" in text and "at 1344:768" in text and "at 768:1344" in text
    assert "dry run: nothing was sent" in text


def test_live_reports_the_true_shape(tmp_path):
    code, text = run(["--live", "--save", str(tmp_path)])
    assert code == 0, text
    assert "16:9   ok    runway 1344x768 (asked 1344x768) -> 1344x756, cropped from 1344x768" in text
    assert "9:16   ok    runway 768x1344 (asked 768x1344) -> 756x1344" in text
    assert Image.open(tmp_path / "16x9-cropped.png").size == (1344, 756)


def test_a_size_runway_did_not_ask_for_fails():
    code, text = run(["--live", "--shapes", "16:9"], provider=FakeRunway(wrong=(1024, 1024)))
    assert code == 1 and "FAIL" in text


def test_live_needs_the_key():
    code, text = run(["--live"], env={})
    assert code == 2 and "refusing to go live" in text
