"""Costs are for the Napkin team only, never in the product (Sai, 19 Nov 2026): no cost figure or field reaches what is delivered, the
deck.pptx and the web deck. (The app side: app/tests/deckMaker.test.ts; the middleware drops the engine's figures: server/tests/test_deck.py.)"""
from __future__ import annotations

import contextlib
import io
import zipfile
from pathlib import Path

from deck import run_deck

FX = Path(__file__).with_name("fixtures") / "lumen_water"
BASE = ["--stages", str(FX), "--brief", str(FX / "brief_object.json"), "--client", "Lumen Water", "--project", "National awareness campaign", "--no-qa"]
COST_WORDS = ("cost_usd", "usd_total", "usd_basis", "engine_usd_total", "list price", "Cost to build")


def _build(out: Path) -> dict:
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run = lambda *a, **k: None
    run_deck._soffice = lambda: "soffice"
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            return run_deck.main([*BASE, "--out", str(out)])
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved


def test_no_cost_reaches_the_delivered_deck_files(tmp_path):
    out = tmp_path / "out"
    rep = _build(out)
    assert "usd_total" in rep   # the engine's own report still has its figure: it is never copied into what is delivered
    with zipfile.ZipFile(out / "deck.pptx") as z:
        pptx = "\n".join(z.read(n).decode("utf-8", "replace") for n in z.namelist())
    web = (out / "deck.html").read_text(errors="replace")
    for name, text in (("deck.pptx", pptx), ("deck.html", web)):
        assert not [w for w in COST_WORDS if w in text], name
