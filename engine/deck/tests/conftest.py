"""Shared test setup for the deck suite.

BRIEF_TESTS_OFFLINE=1 (the CI engine job and scripts/check.sh set it): every outbound
socket connection raises, so a test that quietly reaches a hosted endpoint fails instead
of passing on the network. This is a deliberate copy of the block in engine/rag/conftest.py;
keep the two in step.
"""
from __future__ import annotations
import os


def pytest_configure(config):
    from deck import run_deck   # the suite renders client files of fixtures that fail the client gate (placeholders); test_design_fixes sets it back
    run_deck.WITHHOLD_FAILING_CLIENT = False
    if os.environ.get("BRIEF_TESTS_OFFLINE", "").strip() not in ("1", "true", "yes"):
        return
    import socket

    real_connect, real_connect_ex = socket.socket.connect, socket.socket.connect_ex

    def _is_local(self, addr) -> bool:
        """The deck server tests start the engine server on this machine and call it over loopback."""
        if self.family == socket.AF_UNIX:
            return True
        host = addr[0] if isinstance(addr, tuple) and addr else ""
        return host in ("127.0.0.1", "::1", "localhost")

    def refuse(self, addr, *a, **k):
        """Fail fast: this suite must not touch the network (loopback is allowed)."""
        if _is_local(self, addr):
            return real_connect(self, addr, *a, **k)
        raise OSError("network disabled: BRIEF_TESTS_OFFLINE=1")

    def refuse_ex(self, addr, *a, **k):
        if _is_local(self, addr):
            return real_connect_ex(self, addr, *a, **k)
        raise OSError("network disabled: BRIEF_TESTS_OFFLINE=1")
    socket.socket.connect = refuse          # type: ignore[assignment]
    socket.socket.connect_ex = refuse_ex    # type: ignore[assignment]


# ---------------------------------------------------------------- the invented frames demo (deck-frames-in)
import contextlib
import io
import json
import shutil
from pathlib import Path

import pytest

FRAMES_DEMO = Path(__file__).resolve().parent / "fixtures" / "frames_demo"
DEMO_MANIFEST = next((FRAMES_DEMO / "lumen_run.frames").glob("v1-*/manifest.json"))


@pytest.fixture(scope="session")
def demo_stages(tmp_path_factory):
    """A stages folder for the Lumen Water demo: from_territory's c_territories.json, frames.json and assets/ (territory t1 chosen),
    beside the recorded a, b and d stages and the brief. Built once; read-only for tests (copy it to change it)."""
    from deck import from_territory
    root = tmp_path_factory.mktemp("frames_demo")
    st = root / "stages"
    st.mkdir()
    code = from_territory.main([str(FRAMES_DEMO / "lumen_run.json"), "--frames", str(DEMO_MANIFEST), "--stages", str(st), "--chosen", "t1",
                                "--brief", str(FRAMES_DEMO / "base" / "brief_object.json")])
    assert code == 0
    for f in (FRAMES_DEMO / "base").glob("*.json"):
        shutil.copyfile(f, st / f.name)
    return st


@pytest.fixture(scope="session")
def build_demo():
    """``build_demo(stages, out, *args)``: run_deck on the demo with no model and no LibreOffice (geometry only), as the bench does.
    Returns the run folder."""
    from deck import run_deck

    def build(stages, out, *args, soffice=False):
        argv = ["--stages", str(stages), "--brief", str(Path(stages) / "brief_object.json"), "--client", "Lumen Water",
                "--project", "National awareness campaign", "--out", str(out), "--no-qa", "--density", "detailed", *args]
        saved = (run_deck.subprocess.run, run_deck._soffice)
        if not soffice:
            run_deck.subprocess.run = lambda *a, **k: None
            run_deck._soffice = lambda: "soffice"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                run_deck.main(argv)
        finally:
            run_deck.subprocess.run, run_deck._soffice = saved
        return Path(out)
    return build
