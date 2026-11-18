"""Render parity: with no --pictures and no --image, the six fixture decks render exactly as before pictures existed.

Each fixture deck is built through run_deck.main (recorded stages, no model, geometry-only: no LibreOffice). Its pptx is
reduced to a signature (per slide: shape names, kinds, geometry rounded to 0.01 in, text) and compared with the signatures
recorded at the merge base, before any renderer change (fixtures/render_parity.json). The deck.html is compared by its
sha256 and layouts.json by its bytes. A stages folder holding a frames.json and no --pictures changes nothing either.
To record again after a change you meant to make: ``RECORD_PARITY=1 python3 -m pytest deck/tests/test_render_parity.py``.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from pathlib import Path

import pytest
from pptx import Presentation
from pptx.util import Emu

from deck.bench import fixtures

RECORDED = Path(__file__).with_name("fixtures") / "render_parity.json"


def pptx_signature(path: Path) -> list:
    """Per slide, per shape: name, class, geometry in inches rounded to 0.01, and the text."""
    out = []
    for sl in Presentation(str(path)).slides:
        shapes = []
        for sh in sl.shapes:
            geo = [round(Emu(v).inches, 2) if v is not None else None for v in (sh.left, sh.top, sh.width, sh.height)]
            shapes.append([sh.name, type(sh).__name__, geo, sh.text_frame.text if sh.has_text_frame else None])
        out.append(shapes)
    return out


def fingerprint(run_dir: Path) -> dict:
    # deck.html carries the build time in a comment or meta line: hash it with digit runs of a timestamp shape removed
    html = (run_dir / "deck.html").read_text()
    html = re.sub(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", "T", html)
    return {"pptx": pptx_signature(run_dir / "deck.pptx"), "html_sha256": hashlib.sha256(html.encode()).hexdigest(),
            "layouts_sha256": hashlib.sha256((run_dir / "layouts.json").read_bytes()).hexdigest()}


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root = tmp_path_factory.mktemp("parity")
    return {n: fixtures.build_one(n, root / n, geometry_only=True) for n in fixtures.FIXTURES}


def test_the_fixture_decks_keep_their_recorded_render_signatures(built):
    got = {n: fingerprint(d) for n, d in built.items()}
    if os.environ.get("RECORD_PARITY") == "1":
        RECORDED.write_text(json.dumps(got, indent=1, ensure_ascii=False, sort_keys=True))
    want = json.loads(RECORDED.read_text())
    assert set(got) == set(want) == set(fixtures.FIXTURES)
    for n in got:
        assert got[n] == want[n], f"{n}: a deck built with no pictures no longer renders as it did at the merge base"
