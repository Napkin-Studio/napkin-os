"""The skip guard (engine/pytest_skipguard.py) sees a module skipped while collecting, not only per-test skips.

Each case runs a tiny pytest session in a temp folder with the plugin loaded, so the outer run's own skips are untouched.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[2]


def _run(tmp_path: Path, files: dict, **env) -> subprocess.CompletedProcess:
    for name, body in files.items():
        (tmp_path / name).write_text(body)
    clean = {k: v for k, v in os.environ.items() if not k.startswith("DECK_")}
    clean.update(env)
    clean["PYTHONPATH"] = str(ENGINE) + os.pathsep + clean.get("PYTHONPATH", "")
    return subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "pytest_skipguard", str(tmp_path)],
                          cwd=tmp_path, env=clean, capture_output=True, text=True, timeout=120)


SKIPPED_MODULE = 'import pytest\npytest.skip("some tool went missing", allow_module_level=True)\n\ndef test_never():\n    assert True\n'
PASSING = "def test_ok():\n    assert True\n"


def test_a_module_skipped_at_collection_is_counted(tmp_path):
    r = _run(tmp_path, {"test_gone.py": SKIPPED_MODULE, "test_ok.py": PASSING})
    out = r.stdout + r.stderr
    assert "skipguard: 1 skipped" in out, out
    assert "some tool went missing" in out, out
    assert r.returncode == 0, out  # unguarded: printed, not failed


def test_a_skipped_module_fails_a_guarded_run(tmp_path):
    r = _run(tmp_path, {"test_gone.py": SKIPPED_MODULE, "test_ok.py": PASSING}, DECK_SKIP_GUARD="1")
    out = r.stdout + r.stderr
    assert r.returncode != 0, out
    assert "skip(s) not allowed" in out and "test_gone.py" in out, out


def test_a_module_level_importorskip_is_counted(tmp_path):
    body = 'import pytest\npytest.importorskip("no_such_module_xyz")\n\ndef test_never():\n    assert True\n'
    r = _run(tmp_path, {"test_dep.py": body, "test_ok.py": PASSING}, DECK_SKIP_GUARD="1")
    out = r.stdout + r.stderr
    assert "skipguard: 1 skipped" in out and r.returncode != 0, out


def test_an_allowed_module_skip_passes_a_guarded_run(tmp_path):
    body = 'import pytest\npytest.skip("Arial (the fallback) is not on this machine", allow_module_level=True)\n'
    r = _run(tmp_path, {"test_font.py": body, "test_ok.py": PASSING}, DECK_SKIP_GUARD="1")
    out = r.stdout + r.stderr
    assert "skipguard: 1 skipped" in out and r.returncode == 0, out


def test_a_render_tool_module_skip_fails_when_soffice_is_required(tmp_path):
    body = 'import pytest\npytest.skip("no LibreOffice here", allow_module_level=True)\n'
    r = _run(tmp_path, {"test_render.py": body, "test_ok.py": PASSING}, DECK_REQUIRE_SOFFICE="1")
    out = r.stdout + r.stderr
    # Either the session start refuses (no LibreOffice on this machine) or the skip itself is refused: never a pass.
    assert r.returncode != 0, out
