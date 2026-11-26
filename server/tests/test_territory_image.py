"""territories-engine-server: the middleware image carries what Territories reads (LESSONS 1, 3).

The image is built from server/Dockerfile. This test reads its COPY lines, lays the same files out under a temporary /srv/napkin, and runs the
runner from there with only this environment's packages (the middleware's own). If a COPY goes missing, a path moves, or the package starts to
need something the middleware does not have, it fails here, not on the first person's first run."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = ROOT / "server" / "Dockerfile"
WORKDIR = "/srv/napkin/server"

#: What Territories reads at run time, relative to the repository root (and so to /srv/napkin in the image).
NEEDED = ["engine/territory/__init__.py", "engine/territory/runner.py", "engine/territory/prompts", "engine/brief_llm.py", "engine/price_table.py",
          "engine/prices.json", "engine/deck/packs", "engine/visuals/runway.py", "engine/visuals/jobs.py", "engine/visuals/lint.py", "engine/visuals/data/common_words.txt", "engine/visuals/words/visual.txt", "app/templates/territories/schema.json", "app/templates/territories/seed.json",
          "app/templates/territories/example/data.json", "server/napkin/model_routes.py"]


def copies() -> list[tuple[list[str], str]]:
    """(sources, destination) of every plain COPY line, with the destination made absolute against the WORKDIR."""
    text = DOCKERFILE.read_text().replace("\\\n", " ")
    out = []
    for line in text.splitlines():
        m = re.match(r"\s*COPY\s+(?!--from)(.+)", line)
        if not m:
            continue
        *srcs, dest = m.group(1).split()
        out.append((srcs, str((Path(WORKDIR) / dest).resolve()) if not dest.startswith("/") else dest))
    return out


def test_the_dockerfile_copies_every_path_territories_reads():
    landed = []
    for srcs, dest in copies():
        for s in srcs:
            assert (ROOT / s).exists(), f"server/Dockerfile copies {s}, which is not in the repository"
            multi = len(srcs) > 1 or dest.endswith("/")
            landed.append(str(Path(dest) / Path(s).name) if multi else dest)
    for need in NEEDED:
        want = "/srv/napkin/" + need
        if need.startswith("server/"):
            want = want.replace("/srv/napkin/server/", WORKDIR + "/")
        assert any(want == l or want.startswith(l.rstrip("/") + "/") for l in landed), f"server/Dockerfile does not carry {need}"
    assert "PYTHONPATH=/srv/napkin/engine" in DOCKERFILE.read_text()
    assert "NAPKIN_TERRITORY_DATA=" in DOCKERFILE.read_text()


def test_territories_runs_from_the_image_layout_with_only_the_middlewares_packages(tmp_path):
    base = tmp_path / "srv" / "napkin"
    for srcs, dest in copies():
        d = tmp_path / dest.lstrip("/")
        for s in srcs:
            src = ROOT / s
            to = d / src.name if (len(srcs) > 1 or dest.endswith("/") or d.is_dir()) else d
            to.parent.mkdir(parents=True, exist_ok=True)
            if src.is_dir():
                shutil.copytree(src, to, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
            else:
                shutil.copy(src, to)
    code = r'''
import json, sys
from pathlib import Path
from territory import contract, runner, world
from territory.llm import FakeLLM
from brief_llm import bedrock_model_id
assert bedrock_model_id("claude-opus-5-5") != "claude-opus-5-5"            # ids map through napkin/model_routes.py
packs = list(world.packs_dir().glob("*.yaml"))
assert packs, "develop refuses without the category safety packs"
doc = {"upstream": contract.example("data")["upstream"]}
llm = FakeLLM({"insights": {"insights": [
    {"kind": "tension", "text": "They want the break to start sooner, but the drive makes them work for it first.", "cites": ["brief:audience"]},
    {"kind": "truth", "text": "Sitting down on a train is the first minute of the weekend.", "cites": ["brief:insight"]}]}})
res = runner.run(doc, llm=llm, store=runner.Store(Path(sys.argv[1])))
assert res.doc["run"]["gate"]["id"] == "pick" and not res.error, res.error
from territory import frames                                                # the pictures step: the shared picture library must be in the image too
import tempfile
tmp = Path(tempfile.mkdtemp())
f = frames.Frames(contract.example("data"), runner.Store(tmp / "s"), None, doc_id="d", environ={})
f.declare("invented", "Shrey")
card = f.ask(["t_started"])[3]["card"]
assert card["frames"] == 4 and card["plan_call"], card
print(json.dumps({"ok": True, "packs": len(packs), "contract": str(contract.TEMPLATE)}))
'''
    env = {"PATH": "/usr/bin:/bin", "PYTHONPATH": str(base / "engine"), "HOME": str(tmp_path)}
    out = subprocess.run([sys.executable, "-c", code, str(tmp_path / "store")], cwd=base / "server", env=env, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[-1500:]
    got = json.loads(out.stdout.strip().splitlines()[-1])
    assert got["ok"] and got["packs"] >= 1 and got["contract"].startswith(str(base))        # read from the image layout, not from the repository
