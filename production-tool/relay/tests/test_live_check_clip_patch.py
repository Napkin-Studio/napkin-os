"""scripts/live_check_clip_patch.py (features/clip-moment-edit.clan): the person's live check of Fix this
moment. Here Runway is a fake; the stitch cut and splice are the real ones, so a paid run cannot fail after
Runway has billed it for a reason these tests would have caught."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import live_check_clip_patch as check  # noqa: E402

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="needs ffmpeg")


@pytest.fixture
def take(tmp_path) -> Path:
    p = tmp_path / "take.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=6",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-shortest", "-c:v", "libx264", "-g", "24",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", str(p)], check=True)
    return p


def test_a_dry_run_prints_the_range_plan_and_sends_nothing(take, capsys, monkeypatch):
    monkeypatch.delenv("RUNWAYML_API_SECRET", raising=False)
    monkeypatch.setattr(check, "Runner", lambda *a, **k: pytest.fail("a dry run never builds a runner"))
    assert check.main(["--take", str(take), "--window", "2-4", "--at", "3", "--text", "eyes open"]) == 0
    out = capsys.readouterr().out
    assert "send range" in out and "range 2-4 s" in out and "estimate $0.56" in out and "nothing sent" in out


def test_live_without_the_key_refuses(take, monkeypatch):
    monkeypatch.delenv("RUNWAYML_API_SECRET", raising=False)
    with pytest.raises(SystemExit, match="needs RUNWAYML_API_SECRET"):
        check.main(["--take", str(take), "--window", "2-4", "--at", "3", "--text", "x", "--live"])


def test_a_window_outside_the_take_is_refused(take):
    with pytest.raises(SystemExit, match="inside"):
        check.main(["--take", str(take), "--window", "5-8", "--at", "6", "--text", "x"])


def test_a_live_run_sends_the_relays_job_and_splices_what_comes_back(take, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("RUNWAYML_API_SECRET", "key_" + "x" * 40)
    sent = {}

    class FakeRunner:
        def __init__(self, *a, **k):
            pass

        def run(self, label, job, est=None):
            sent.update(job=job, est=est)
            return {"state": "completed", "outputs": ["https://runway.test/aleph.mp4"], "latency_s": 1.0, "cost_usd": 0.56}

    monkeypatch.setattr(check, "Runner", FakeRunner)
    monkeypatch.setattr(check, "default_factory", lambda *a, **k: None)
    monkeypatch.setattr(check, "ephemeral_upload", lambda client, key, data, mime, name: f"runway://{name}")
    monkeypatch.setattr(check, "fetch_bytes", lambda url: take.read_bytes())  # Aleph gives the take back
    out = tmp_path / "out"
    assert check.main(["--take", str(take), "--window", "2-4", "--at", "3", "--text", "eyes open.", "--live", "--out", str(out)]) == 0
    job = sent["job"]
    assert job.op == "clip_edit" and job.model == "aleph2" and sent["est"] == 0.56
    assert [r.role for r in job.refs] == ["current"]
    assert job.keyframe["atS"] == 3 and (job.keyframe["startS"], job.keyframe["endS"]) == (2, 4)
    assert job.prompt.startswith("eyes open. Everything else stays exactly as it is")
    report = json.loads((out / "report.json").read_text())
    assert report["splice"]["ok"] and report["outAudio"] and report["aleph"]["audio"]
    assert (out / "out.mp4").exists() and "summary: aleph2 range send completed" in capsys.readouterr().out
