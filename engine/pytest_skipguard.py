"""No silent skips (the pre-push hardening): a pytest plugin scripts/check.sh loads into the deck and visuals runs (``-p pytest_skipguard``).

It prints how many tests (and whole modules, skipped while collecting) skipped, and why, at the end of the run. With ``DECK_SKIP_GUARD=1`` a skip whose reason is not on ALLOW fails the
run (a missing dependency, a missing tool, a test that quietly stopped running). With ``DECK_REQUIRE_SOFFICE=1`` LibreOffice, pdftoppm and pdffonts
must be there: their absence fails the run at once, and a skip for either is never allowed. check.sh sets both locally; CI (no LibreOffice
on its runner) sets neither, so its skips are printed, not failed. Pure stdlib; it changes no test's outcome, only the session's status.
"""
from __future__ import annotations

import os
import re
import shutil
from collections import Counter
from pathlib import Path

#: Skips that are fine on a machine that has everything the deck needs: a tool the deck itself never needs, or a font check that depends
#: on what the machine happens to have installed. Anything else that skips fails a guarded run.
ALLOW = (r"no SVG rasteriser", r"no headless browser", r"Arial \(the fallback\) is not on this machine")
RENDER_TOOLS = re.compile(r"libre ?office|soffice|pdftoppm|pdftotext|pdffonts", re.I)
_skips: list = []


def _on(name: str) -> bool:
    return os.environ.get(name, "").strip() in ("1", "true", "yes")


def _soffice() -> str | None:
    mac = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    return shutil.which("soffice") or (mac if Path(mac).exists() else None)


def _poppler(tool: str):
    return shutil.which(tool) or (Path(f"/opt/homebrew/bin/{tool}").exists() or None)


def pytest_sessionstart(session):
    if _on("DECK_REQUIRE_SOFFICE"):
        missing = [t for t, found in (("LibreOffice (soffice)", _soffice()), ("pdftoppm", _poppler("pdftoppm")),
                                      ("pdffonts", _poppler("pdffonts"))) if not found]
        if missing:
            import pytest
            pytest.exit(f"skipguard: DECK_REQUIRE_SOFFICE=1 and {', '.join(missing)} is not installed: the render tests would skip silently", returncode=3)


def _reason(report) -> str:
    lr = report.longrepr
    if isinstance(lr, tuple) and len(lr) == 3:
        return str(lr[2]).removeprefix("Skipped: ")
    return str(lr)


def pytest_runtest_logreport(report):
    if report.skipped and not hasattr(report, "wasxfail"):
        _skips.append((report.nodeid, _reason(report)))


def pytest_collectreport(report):
    """A whole module (or class) skipped at collection: ``pytest.skip(..., allow_module_level=True)``, a module-level
    ``importorskip`` or a ``pytestmark`` that skips while collecting. Its tests never reach ``runtest_logreport``, so without
    this a skipped file reads as "0 skipped". Recorded once per collector (its tests are not known), under the same ALLOW
    list and fail rules as a test's skip."""
    if report.skipped:
        _skips.append((report.nodeid or ".", _reason(report)))


def _bad() -> list:
    out = []
    for nid, why in _skips:
        if _on("DECK_REQUIRE_SOFFICE") and RENDER_TOOLS.search(why):
            out.append((nid, why))
        elif _on("DECK_SKIP_GUARD") and not any(re.search(a, why) for a in ALLOW):
            out.append((nid, why))
    return out


def pytest_sessionfinish(session, exitstatus):
    if _bad() and session.exitstatus == 0:
        session.exitstatus = 1


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    suites = Counter(nid.split("::")[0].rsplit("/", 1)[0] or "." for nid, _ in _skips)
    why = Counter(w for _, w in _skips)
    tr = terminalreporter
    tr.write_line(f"skipguard: {len(_skips)} skipped" + ("" if not suites else " (" + ", ".join(f"{k} {v}" for k, v in sorted(suites.items())) + ")"))
    for w, n in why.most_common():
        tr.write_line(f"  {n} x {w[:160]}")
    bad = _bad()
    if bad:
        tr.write_line(f"skipguard: FAIL, {len(bad)} skip(s) not allowed (DECK_SKIP_GUARD / DECK_REQUIRE_SOFFICE):", red=True)
        for nid, w in bad[:40]:
            tr.write_line(f"  {nid}: {w[:160]}", red=True)
