"""The end-to-end deck gate (the pre-push hardening, scripts/check.sh suite_engine): the Lumen Water demo rendered twice, LOOK_V3 off and
on, each ONCE (module fixtures, reused by every assertion), with ``--images plan`` from the fixture's picture cache: no network, no money,
real LibreOffice (QA pixels and the text-free render). It holds what a deck must never ship with: a QA error, a text run under WCAG AA
(text over pictures included, at the 10th percentile), a sentence said twice, a lost word, a story over the cap, an unreported hole gate,
a shape past the canvas, and a regression of a gate item of the bench checklist against fixtures/lumen_gate/checklist_baseline.json.

The fixture (fixtures/lumen_gate) is the invented Lumen Water demo, our own brief, not client material: the brief, stages a to d, the
recorded picture subjects and the 18 Nov live-demo remake's picture cache, each slot's latest draft scaled to 960 px JPEG so it stays
small. The cache answers every slot, so ``--images plan`` sends nothing and spends nothing (the ledger is a temp file).

Re-record the baseline deliberately (a look change that moves an item): from engine/, ``PYTHONPATH=. python3 deck/tests/test_lumen_gate.py --record``.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "lumen_gate"
BASELINE = FIX / "checklist_baseline.json"
ENGINE = HERE.parents[1]
SOFFICE = shutil.which("soffice") or ("/Applications/LibreOffice.app/Contents/MacOS/soffice"
                                      if Path("/Applications/LibreOffice.app/Contents/MacOS/soffice").exists() else None)
PDFTOPPM = shutil.which("pdftoppm") or ("/opt/homebrew/bin/pdftoppm" if Path("/opt/homebrew/bin/pdftoppm").exists() else None)
#: Engine marks a slide carries for its place, not its content (never a lost word): the band, the footer, the page number, the marks.
MARKS = ("Band", "Section", "SlideNumber", "Watermark", "Footer", "Footnotes", "CheckFailed")
#: Words of the old look's engine furniture the look replaces with its own (the placeholder card's PROPOSED tag and TO SUPPLY chip: the
#: close's dashed rows say To supply, and the words themselves still begin 'Proposed (not given by the client)'). The old look's kicker labels over the idea and the real question ('THE IDEA', 'THE REAL QUESTION') are replaced by the section band.
FURNITURE = {"proposed", "real", "question", "idea"}

needs_render = pytest.mark.skipif(not (SOFFICE and PDFTOPPM), reason="no LibreOffice or pdftoppm: the end-to-end deck gate cannot render")


def render(work: Path, v3: bool) -> Path:
    """One build of the Lumen demo into ``work``/out (a fresh copy of the fixture's stages; the cache answers every picture)."""
    work.mkdir(parents=True, exist_ok=True)
    st = work / "stages"
    if st.exists():
        shutil.rmtree(st)
    shutil.copytree(FIX / "stages", st)
    out = work / "out"
    env = {**os.environ, "PYTHONPATH": str(ENGINE), "DECK_LOOK_V3": "1" if v3 else "", "NAPKIN_DECK_LEDGER": str(work / "ledger.jsonl"),
           "BRIEF_TESTS_OFFLINE": "1"}
    for k in ("ANTHROPIC_API_KEY", "RUNWAYML_API_SECRET", "RUNWAY_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"):
        env.pop(k, None)   # nothing can be sent: no key reaches the build
    cmd = [sys.executable, "-m", "deck.run_deck", "--brief", str(st / "brief_object.json"), "--stages", str(st), "--client", "Lumen Water",
           "--project", "National awareness campaign", "--picture-source", "generated", "--cap-usd", "2.5", "--marks", str(FIX / "marks.json"),
           "--images", "plan", "--out", str(out)]
    res = subprocess.run(cmd, cwd=str(ENGINE), env=env, capture_output=True, text=True, timeout=400)
    (work / "run.log").write_text(res.stdout + "\n" + res.stderr)
    assert res.returncode == 0, res.stdout[-2000:] + res.stderr[-2000:]
    assert not re.search(r"\b[1-9]\d* new x", res.stdout), "a picture would be made: the fixture cache must answer every slot"
    return out


def _json(p: Path):
    return json.loads(p.read_text())


def presented_slides(out: Path):
    from pptx import Presentation
    prs = Presentation(str(out / "deck.pptx"))
    return prs, [(n, sl) for n, sl in enumerate(prs.slides, 1) if sl._element.get("show") != "0"]


def rendered_words(prs) -> Counter:
    """Every word of a rendered deck on its slides and in its notes, less the place marks and the notes' generated lines."""
    out = Counter()
    gen = r"Slide id s\d+ · status \w+ · requirements [^\n]*|^Evidence:|^Moved from the slide:|\[refs: [^\]]*\]"
    for sl in prs.slides:
        txt = " ".join(sh.text_frame.text for sh in sl.shapes if sh.has_text_frame and not (sh.name or "").startswith(MARKS))
        notes = re.sub(gen, " ", sl.notes_slide.notes_text_frame.text, flags=re.M)
        out.update(re.findall(r"[a-z0-9%€]+", (txt + " " + notes).lower()))
    return out


def checklist(out: Path) -> dict:
    sys.path.insert(0, str(ENGINE)) if str(ENGINE) not in sys.path else None
    from deck.bench.checklist import run_checklist
    return run_checklist(out)


# ------------------------------------------------------------------------------------------------ one render each, reused
@pytest.fixture(scope="module")
def off(tmp_path_factory):
    return render(tmp_path_factory.mktemp("gate_off"), v3=False)


@pytest.fixture(scope="module")
def on(tmp_path_factory):
    return render(tmp_path_factory.mktemp("gate_on"), v3=True)


@pytest.fixture(params=["off", "on"])
def run(request):
    return request.param, request.getfixturevalue(request.param)


@needs_render
def test_qa_reports_no_error(run):
    name, out = run
    q = _json(out / "qa.json")
    errs = [(n, f["check"], f["message"]) for n, fs in q["slides"].items() for f in fs if f["level"] == "error"]
    assert q["summary"]["errors"] == 0 and not errs, (name, errs)
    assert not (q["summary"].get("notes") or []), (name, q["summary"]["notes"])   # pixels and the text-free render both ran


@needs_render
def test_every_text_run_meets_aa_including_text_on_pictures(run):
    from deck import qa_render
    name, out = run
    prs, pres = presented_slides(out)
    bad = [(n, r["shape"], r["text"][:30], r["ratio"], r["need"]) for n, sl in pres for r in qa_render.text_contrasts(sl) if r["ratio"] < r["need"]]
    assert not bad, (name, bad)
    q = _json(out / "qa.json")
    assert not [f for fs in q["slides"].values() for f in fs if f["check"] == "text_on_image_contrast"], name
    if name == "on":   # the look measures every run on a picture at the 10th percentile on a text-free render
        recs = q.get("text_on_image") or []
        words = [r for r in recs if r["name"] not in ("Caption", "Watermark")]
        assert words, "the Lumen cover and idea set their words on their pictures"
        assert all(r["pass"] and r["p10"] >= r["need"] for r in recs), recs


@needs_render
def test_a_sentence_is_said_once_on_the_presented_slides(run):
    name, out = run
    v = _json(out / "validation.json")
    assert not [f for f in v if f["check"] == "repeated_line"], name
    if name == "on":
        d = _json(out / "deck.json")
        from deck import validate
        said = []
        for sid in validate.presented(d):
            for t, _ in validate._texts(d["slides"][sid], internal=False, human=False):
                said += [re.sub(r"\W+", " ", x.lower()).strip() for x in re.split(r"(?<=[.!?])\s+", str(t))]
        assert said.count("every drop has a story") == 1


@needs_render
def test_no_word_is_lost_between_the_looks(off, on):
    p_off, _ = presented_slides(off)
    p_on, _ = presented_slides(on)
    lost = rendered_words(p_off) - rendered_words(p_on)
    lost -= Counter({k: v for k, v in lost.items() if k in FURNITURE})
    section = Counter(w for sl in p_off.slides for sh in sl.shapes if (sh.name or "") == "Section" for w in re.findall(r"[a-z0-9%€]+", sh.text_frame.text.lower()))
    assert not (lost - section), dict(lost - section)


@needs_render
def test_the_story_is_within_the_cap(run):
    from deck import spec
    name, out = run
    _, pres = presented_slides(out)
    v = _json(out / "validation.json")
    assert not [f for f in v if f["check"] == "pitch_length" and f["level"] == "error"], name
    if name == "on":
        assert len(pres) <= spec.PITCH_CAP and len(pres) == 10, len(pres)


@needs_render
def test_the_hole_gate_is_reported(run):
    from deck import spec
    name, out = run
    q = _json(out / "qa.json")
    holes = q["summary"].get("holes")
    if name == "off":
        assert holes is None   # q_no_hole is measured under the look only
        return
    _, pres = presented_slides(out)
    assert holes and holes["over_gate"] == 0 and holes["max"] <= spec.HOLE_GATE, holes
    assert all("hole" in q["pixels"][str(n)] for n, _ in pres)


@needs_render
def test_no_slide_grows_past_the_canvas(run):
    name, out = run
    prs, pres = presented_slides(out)
    W, H = prs.slide_width, prs.slide_height
    tol = 0.01 * 914400
    past = [(n, sh.name) for n, sl in pres for sh in sl.shapes if sh.left is not None and
            (sh.left < -tol or sh.top < -tol or sh.left + sh.width > W + tol or sh.top + sh.height > H + tol)]
    assert not past, (name, past)
    q = _json(out / "qa.json")
    assert not [f for fs in q["slides"].values() for f in fs if f["check"] in ("off_slide", "text_overflow")], name


@needs_render
def test_no_gate_item_of_the_checklist_regresses(off, on):
    from deck.bench.compare import compare
    base = _json(BASELINE)
    now = {"version": base["version"], "items_version": base["items_version"], "decks": {"lumen_off": checklist(off), "lumen_v3": checklist(on)}}
    diff = compare(base, now)
    assert diff["regressions"] == 0 and diff["metric_regressions"] == 0 and diff["lost_coverage"] == 0, json.dumps(
        {d: v.get("changes") for d, v in diff["decks"].items()}, indent=1)[:3000]


def _record(work: Path) -> None:
    from deck.bench.checklist import load_items
    decks = {"lumen_off": checklist(render(work / "off", False)), "lumen_v3": checklist(render(work / "on", True))}
    BASELINE.write_text(json.dumps({"version": 1, "items_version": load_items()["version"], "decks": decks}, indent=1, ensure_ascii=False) + "\n")
    print("recorded", BASELINE)


if __name__ == "__main__" and "--record" in sys.argv:
    import tempfile
    _record(Path(tempfile.mkdtemp(prefix="lumen_gate_")))
