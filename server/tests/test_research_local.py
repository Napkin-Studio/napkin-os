"""The local research port the way scripts/territories-local.sh wires it: the middleware's own ResearchPort
(the client NAPKIN_RESEARCH_URL builds) against mock-backend's research family, whose `claude` is a fake on PATH
(mock-backend/tests/fake_claude.py) that prints a canned web-search answer. Nothing is spent and nothing in the
middleware knows it is local; what is checked is the shape the middleware reads and that only URLs the search
returned come back."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest

from napkin.research import ResearchPort

MOCK = Path(__file__).resolve().parents[2] / "mock-backend"


@pytest.fixture(scope="module")
def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        p = s.getsockname()[1]
    tmp = tempfile.TemporaryDirectory(prefix="research-local-")
    bindir = Path(tmp.name) / "bin"
    bindir.mkdir()
    fake = MOCK / "tests" / "fake_claude.py"
    os.chmod(fake, 0o755)
    (bindir / "claude").symlink_to(fake)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("MOCK_", "FAKE_"))}
    env.update(PATH=f"{bindir}{os.pathsep}{env['PATH']}", MOCK_FAKES="research", MOCK_BACKEND_PORT=str(p),
               MOCK_DATA=str(Path(tmp.name) / "data"), MOCK_NO_CACHE="1")
    proc = subprocess.Popen([sys.executable, str(MOCK / "server.py")], env=env, cwd=tmp.name,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{p}"
    try:
        for _ in range(200):
            try:
                urllib.request.urlopen(base + "/healthz", timeout=1).read()
                break
            except OSError:
                time.sleep(0.05)
        else:
            raise RuntimeError("the mock backend did not start")
        yield ResearchPort(base, 30)
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        tmp.cleanup()


def search(port, mode, **kw):
    return port.search(f"do families book table seats? MODE:{mode}", "consumer_culture", "IE", **kw)


def test_the_middleware_reads_titles_urls_snippets_and_retrieved_at(port):
    out = search(port, "ok", max_sources=3)
    assert 1 <= len(out["sources"]) <= 3
    today = time.strftime("%Y-%m-%d", time.gmtime())
    for s in out["sources"]:
        assert s["url"].startswith(("http://", "https://")) and s["title"] and s["excerpts"]
        assert s["retrieved_at"] == today
    cso = out["sources"][0]
    assert cso["url"] == "https://www.cso.ie/en/stats" and cso["publisher"] == "Central Statistics Office"
    assert cso["excerpts"][0] == "1,234 new electric cars were licensed."
    assert out["trace"]["backend"] == "claude-code-websearch"


def test_a_url_the_web_search_never_returned_is_not_passed_on(port):
    out = search(port, "invented")
    assert [s["url"] for s in out["sources"]] == ["https://www.cso.ie/en/real"]
    assert search(port, "invented-all")["sources"] == []


def test_nothing_found_is_none(port):
    assert search(port, "empty")["sources"] == []


def test_a_look_up_with_no_market_is_answered(port):
    out = port.search("how many 16 to 24s? MODE:ok", "consumer_culture", "", max_sources=2)
    assert len(out["sources"]) == 2
