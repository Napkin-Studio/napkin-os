"""The invented fixture decks the checklist baseline is made from, built offline from their recorded stages.

    python3 -m deck.bench fixtures OUT_DIR [--geometry-only]

Each deck goes through ``run_deck.main`` (no model: the stages are recorded; no network), so a run folder holds the same
files a real run does: deck.json, validation.json, deck.pptx, layouts.json, qa.json, report.json. With LibreOffice and
pdftoppm on the machine the QA includes pixels; ``--geometry-only`` stubs the PDF step (no LibreOffice), which is how
the CI test rebuilds them. Only invented fixtures: no client material.
"""
from __future__ import annotations

import contextlib
import io
from pathlib import Path

FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "tests" / "fixtures"

#: name -> (stage folder under tests/fixtures, run_deck arguments; "{fx}" is the fixture root)
FIXTURES = {
    "lumen_water": ("lumen_water", ["--brief", "{fx}/lumen_water/brief_object.json", "--client", "Lumen Water",
                                    "--project", "National awareness campaign"]),
    "investor_seed": ("types/investor_seed", ["--kind", "investor", "--prompt-file", "{fx}/types/investor_seed/prompt.txt",
                                              "--client", "Fenwick Labs", "--project", "Seed round"]),
    "agency_pitch": ("types/agency_pitch", ["--prompt-file", "{fx}/types/agency_pitch/prompt.txt", "--client", "Lumen Water",
                                            "--project", "Fixture Project"]),
    "tender_response": ("types/tender_response", ["--kind", "tender", "--prompt-file", "{fx}/types/tender_response/prompt.txt",
                                                  "--client", "Harbour County Council", "--project", "Recycling awareness"]),
    "credentials": ("types/credentials", ["--kind", "credentials", "--prompt-file", "{fx}/types/credentials/prompt.txt",
                                          "--client", "Ardent Foods", "--project", "Credentials"]),
    "lumen_water_prompt": ("lumen_water_prompt", ["--prompt-file", "{fx}/lumen_water_prompt/prompt.txt", "--client", "Lumen Water",
                                                  "--project", "National awareness campaign"]),
}
#: The names the phase gallery uses for the same decks.
GALLERY_SLUGS = {"lumen_water": "lumen-water", "investor_seed": "investor-seed", "agency_pitch": "agency-pitch",
                 "tender_response": "tender-response", "credentials": "credentials"}


def build_one(name: str, out: Path, geometry_only: bool = False, density: str | None = "detailed", extra: tuple = ()) -> Path:
    """Build one fixture deck into ``out`` (a run folder) through run_deck.main; returns ``out``. ``density`` is the tests' and goldens' setting
    (detailed, for parity with the recorded runs); ``None`` lets the engine resolve it by format, the look a person gets. ``extra`` adds run_deck arguments."""
    from .. import run_deck
    stages, args = FIXTURES[name]
    argv = ["--stages", str(FIXTURE_ROOT / stages), "--out", str(out), *[a.replace("{fx}", str(FIXTURE_ROOT)) for a in args],
            *(["--density", density] if density else []), *extra]
    saved = (run_deck.subprocess.run, run_deck._soffice)
    if geometry_only:   # no PDF, no PNG: qa_render then reports "pixels skipped: no PDF"
        run_deck.subprocess.run = lambda *a, **k: None
        run_deck._soffice = lambda: "soffice"
    try:
        with contextlib.redirect_stdout(io.StringIO()):   # run_deck prints its report; the bench wants quiet
            run_deck.main(argv)
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    return out


def build_all(out_dir: Path, geometry_only: bool = False, names=None, density: str | None = "detailed") -> dict:
    """Build every fixture into ``out_dir/<name>``; returns ``{name: run folder}``."""
    out_dir = Path(out_dir)
    return {n: build_one(n, out_dir / n, geometry_only, density) for n in (names or FIXTURES)}
