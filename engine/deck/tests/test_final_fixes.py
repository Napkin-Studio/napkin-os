"""The final review fixes (deck-maker session, 2026-11-18): private LibreOffice profiles, a clean out folder per build, the checklist's slot gate,
the shorten ledger and marks guard, the small defaults, and the cover/sparse/execution design fixes."""
from __future__ import annotations

import concurrent.futures
import contextlib
import io
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from deck import run_deck

FX = Path(__file__).with_name("fixtures") / "lumen_water"
BASE = ["--stages", str(FX), "--brief", str(FX / "brief_object.json"), "--client", "Lumen Water", "--project", "National awareness campaign", "--no-qa"]
HAVE_SOFFICE = bool(shutil.which("soffice") or Path("/Applications/LibreOffice.app/Contents/MacOS/soffice").exists())


def _build(out: Path, *extra, spy=None):
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run = spy or (lambda *a, **k: None)
    run_deck._soffice = lambda: "soffice"
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            run_deck.main([*BASE, "--out", str(out), *extra])
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    return out


# ---------------------------------------------------------------- 1: a private LibreOffice profile per call

def test_the_build_converts_in_a_private_profile_and_removes_it(tmp_path):
    calls = []

    def spy(argv, *a, **k):
        if argv and argv[0] == "soffice":
            calls.append(list(argv))
        return None
    _build(tmp_path / "o", spy=spy)
    assert len(calls) == 1, "no retry loop: one conversion"
    prof = [x for x in calls[0] if x.startswith("-env:UserInstallation=file://")]
    assert prof, calls[0]
    assert not Path(prof[0].split("file://", 1)[1]).exists(), "the profile is cleaned up afterwards"


def test_each_conversion_gets_its_own_profile(tmp_path):
    seen = []
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run = lambda argv, *a, **k: seen.append(argv[1])
    run_deck._soffice = lambda: "soffice"
    try:
        run_deck.to_pdf(tmp_path / "a.pptx", tmp_path)
        run_deck.to_pdf(tmp_path / "b.pptx", tmp_path)
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    assert seen[0] != seen[1] and all(s.startswith("-env:UserInstallation=file://") for s in seen)


@pytest.mark.skipif(not HAVE_SOFFICE, reason="LibreOffice not installed")
def test_two_concurrent_conversions_both_make_a_pdf(tmp_path):
    from pptx import Presentation
    jobs = []
    for n in ("a", "b"):
        d = tmp_path / n
        d.mkdir()
        prs = Presentation()
        prs.slides.add_slide(prs.slide_layouts[5]).shapes.title.text = f"deck {n}"
        prs.save(d / "deck.pptx")
        jobs.append(d)
    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        list(ex.map(lambda d: run_deck.to_pdf(d / "deck.pptx", d), jobs))
    assert all((d / "deck.pdf").stat().st_size > 500 for d in jobs)
