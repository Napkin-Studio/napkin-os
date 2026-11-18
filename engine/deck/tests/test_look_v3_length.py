"""deck-look steps 5-6 (spec.LOOK_V3): the story length (a soft target of 10, the cap of 12 advisory only), the title-None merges ('how it
runs', 'how we will know'), the cheap moves to the appendix and its 'To supply' part, the per-word multiset (nothing dropped), the brief
fields said once and the word windows by role (advisory). Offline: no model, no LibreOffice. With the flag off nothing here changes."""
from __future__ import annotations

import copy
import importlib
import json
import re
from collections import Counter
from pathlib import Path

import pytest
from pptx import Presentation

from deck import assemble, images, inputs, layouts, render_pptx as R, spec, validate
from deck.bench import checklist
from deck.inputs import Inputs

FIX = Path(__file__).parent / "fixtures" / "lumen_water"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
#: design.length.lumen.after_10, in order.
AFTER_10 = ["title", "objective", "real_question", "insight", "audience", "proposition", "idea", "channel_roles", "measurement", "investment"]
#: The Lumen golden's words_sha under LOOK_V3 after step 5. RE-RECORDED DELIBERATELY (deck-look step 5, Fable's fix 1): the merges and the
#: appendix moves change the order, two slides' blocks and notes, and add the 'To supply' divider and count; the per-word multiset tests
#: below prove no word was lost. The flag-off words_sha of every fixture is unchanged (bench/baseline/checklist.json, the goldens).
#: RE-RECORDED AGAIN at step 7 (fix 2, said once): the idea leads with its own stage text and the campaign line it repeated, and the poster's
#: copy that repeated it, go to the notes after spec.SAID_ONCE_NOTE (92bc3896298c -> 54ab781d7dc5); the multiset tests still pass.
V3_WORDS_SHA = "54ab781d7dc5"


@pytest.fixture
def v3(monkeypatch):
    monkeypatch.setattr(spec, "LOOK_V3", True)


def _st() -> dict:
    return {k: json.loads((FIX / f).read_text()) for k, f in FILES.items()}


def _build(st=None, inp=None, fmt="pitch") -> dict:
    return assemble.build(inp or inputs.load(FIX / "brief_object.json"), st or _st(), client="Lumen Water", project="National awareness campaign", fmt=fmt)


def _types(d: dict, sids) -> list:
    return [d["slides"][x]["type"] for x in sids]


def _of(d: dict, typ: str) -> dict:
    return next(d["slides"][x] for x in d["order"] if d["slides"][x]["type"] == typ)


def _presented_no(d: dict, typ: str) -> int:
    return d["order"].index(next(x for x in d["order"] if d["slides"][x]["type"] == typ)) + 1


def _backup(d: dict) -> list:
    return d["order"][len(validate.presented(d)):]


#: Slides the deck derives from the others (slide numbers, footnote numbers): maps, not content.
DERIVED = ("requirement_trace", "appendix_sources", "scoring")


def _deck_words(d: dict) -> Counter:
    """Every word the deck holds, on a slide (presented or appendix) or in its notes: titles, block text, headings, lines, items, rows."""
    out = []
    for sid in d["order"]:
        s = d["slides"][sid]
        if s["type"] in DERIVED:
            continue
        out += [s.get("title", ""), re.sub(r"^Evidence:", " ", s.get("notes", ""), flags=re.M)]
        vis = s.get("visual") or {}
        if vis.get("kind") == "image_prompt":   # drawn on the slide as 'Image prompt (status): prompt'
            out.append(f"Image prompt ({vis.get('status', 'illustrative')}): {vis.get('prompt', '')}")
        for b in s["blocks"]:
            out += [str(b.get(k) or "") for k in ("text", "title", "from", "to", "answer")]
            out += [str(x) for x in b.get("lines") or []]
            for i in b.get("items") or []:
                out += [str(x) for x in i] if isinstance(i, (list, tuple)) else [str(i.get("text", "")) if isinstance(i, dict) else str(i)]
            out += [str(c) for r in b.get("rows") or [] for c in r]
    return Counter(w for t in out for w in re.findall(r"[a-z0-9%€]+", t.lower()))


# ================================================================================================ the story at ten
def test_the_lumen_pitch_presents_ten_in_the_designed_order(v3):
    d = _build()
    assert _types(d, validate.presented(d)) == AFTER_10


def test_flag_off_keeps_sixteen():
    d = _build()
    assert len(validate.presented(d)) == 16 and "merged" not in json.dumps(d)


def test_moved_slides_wait_in_the_appendix_and_its_to_supply_part(v3):
    d = _build()
    back = _types(d, _backup(d))
    assert back[0] == "appendix" and d["slides"][_backup(d)[0]]["title"] == "Appendix"
    assert "timeline" in back[:back.index("appendix", 1)]   # the one-step timeline: thin, to the backup
    i = next(n for n, x in enumerate(_backup(d)) if d["slides"][x]["title"] == spec.TO_SUPPLY_TITLE)
    assert back[i:i + 4] == ["appendix", "competition", "risks", "team"]   # the placeholders, behind their own divider, last before the trace
    assert back[i + 4:] == ["requirement_trace", "appendix_sources"]


def test_nothing_is_dropped_every_slide_type_is_still_there(v3, monkeypatch):
    after = Counter(_types(_build(), _build()["order"]))
    monkeypatch.setattr(spec, "LOOK_V3", False)
    before = Counter(_types(_build(), _build()["order"]))
    assert before - after == Counter({"execution": 1, "guardrails": 1})   # merged, not dropped (their words: below)
    assert after - before == Counter({"appendix": 1})   # the To supply divider


def test_the_close_counts_what_is_to_supply_in_review_only(v3):
    d = _build()
    inv = _of(d, "investment")
    note = [b for b in inv["blocks"] if b.get("internal") and "To supply" in b.get("text", "")]
    assert len(note) == 1 and note[0]["text"] == "To supply: 3 slides in the appendix"
    assert not any("To supply: 3" in str(b) for b in spec.shown_blocks(inv, "client"))
    assert any("To supply: 3" in str(b.get("text")) for b in spec.shown_blocks(inv, "review"))


def test_a_story_already_at_the_target_moves_nothing(v3, monkeypatch):
    monkeypatch.setattr(spec, "PITCH_TARGET", 16)
    d = _build()
    assert len(validate.presented(d)) == 14 and spec.TO_SUPPLY_TITLE not in [d["slides"][x]["title"] for x in d["order"]]


def test_the_target_is_easy_to_change(v3, monkeypatch):
    monkeypatch.setattr(spec, "PITCH_TARGET", 12)
    d = _build()
    assert len(validate.presented(d)) == 12   # two placeholders out; team and the timeline stay
    assert _types(d, validate.presented(d))[-2:] == ["team", "investment"]
    monkeypatch.setenv("DECK_PITCH_TARGET", "14")
    monkeypatch.setenv("DECK_PITCH_CAP", "16")
    try:
        assert (importlib.reload(spec).PITCH_TARGET, spec.PITCH_CAP) == (14, 16)
    finally:
        monkeypatch.delenv("DECK_PITCH_TARGET")
        monkeypatch.delenv("DECK_PITCH_CAP")
        importlib.reload(spec)
    assert (spec.PITCH_TARGET, spec.PITCH_CAP) == (10, 12)


def test_the_target_is_soft_and_the_cap_only_advises(v3, monkeypatch):
    """Nothing but the cheap moves runs: a story the moves cannot bring to the target stays long (routes asked for, three executions),
    and the cap of 12 is a warning that never fails a run or withholds a deck."""
    S = [assemble._slide(t, f"A full sentence title for the {t} slide", [{"kind": "text", "text": f"{t} line", "basis": "opinion"}])
         for t in ("title", "objective", "real_question", "insight", "audience", "proposition")]
    S += [assemble._slide("territory", f"Territory: Route {n}", [{"kind": "statement", "text": f"Route {n}", "basis": "creative"}]) for n in (1, 2, 3)]
    S += [assemble._slide("idea", "One idea", [{"kind": "statement", "text": "The idea", "basis": "creative"}])]
    S += [assemble._slide("execution", ch, [{"kind": "text", "text": f"Role: {ch}"}]) for ch in ("Outdoor", "Radio", "Social")]
    S += [assemble._slide("investment", "What it costs and what we ask today", [{"kind": "text", "text": "Budget given", "basis": "sourced"}])]
    out = assemble._arrange_pitch(S, routes=3)
    story = [x for x in out[:next((i for i, x in enumerate(out) if x["type"] == "appendix"), len(out))]]
    assert len(story) == 14 > spec.PITCH_CAP   # three routes asked for and three executions: nothing trims them
    d = _build()
    monkeypatch.setattr(spec, "PITCH_CAP", 8)
    f = [x for x in validate.run(d, inputs.load(FIX / "brief_object.json")) if x["check"] == "pitch_cap"]
    assert f and all(x["level"] == "warn" for x in f) and validate.summary(f)["pass"]


def test_a_stated_limit_still_wins(v3):
    S = [assemble._slide(t, f"A full sentence title for the {t} slide", [{"kind": "text", "text": f"{t} line", "basis": "opinion"}])
         for t in ("title", "objective", "insight", "process", "timeline", "investment")]
    out = assemble._arrange_pitch(S, limit=4)
    assert [x["type"] for x in out][:4] == ["title", "objective", "insight", "investment"] and spec.TO_SUPPLY_TITLE not in [x["title"] for x in out]


# ================================================================================================ the merges (title None)
def test_how_it_runs_keeps_its_own_title_and_heads_the_execution_with_its_title(v3):
    d = _build()
    cr = _of(d, "channel_roles")
    assert cr["title"] == "Each channel has one job" and cr["merged"] == [{"type": "execution", "title": "Outdoor"}]
    assert [b["kind"] for b in cr["blocks"]] == ["table", "text"]   # the poster's copy is the line the proposition said: said once (fix 2)
    assert cr["blocks"][1] == {"kind": "text", "text": "Role: Make the line famous", "title": "Outdoor"}
    n = _presented_no(d, "proposition")
    assert f"{spec.SAID_ONCE_NOTE.format(n=n)} Every drop has a story. (Poster)" in cr["notes"]
    assert not any(d["slides"][x]["type"] == "execution" for x in d["order"])


def test_how_we_will_know_keeps_its_title_and_the_guardrails_title_goes_to_the_notes(v3):
    d = _build()
    ms = _of(d, "measurement")
    assert ms["title"] == "How we will know it worked" and ms["merged"] == [{"type": "guardrails", "title": "What the work must never do"}]
    gb = ms["blocks"][1]
    assert gb["kind"] == "bullets" and gb["title"] == "What the work must always carry, and never do"   # its own heading, kept
    assert "Merged here from the slide 'What the work must never do'." in ms["notes"]   # the absorbed title: said once, in the notes
    assert "req:r_03" in json.dumps(gb) and set(ms["requirements"]) >= set(_of(_build_off(), "guardrails")["requirements"])


def _build_off():
    old = spec.LOOK_V3
    spec.LOOK_V3 = False
    try:
        return _build()
    finally:
        spec.LOOK_V3 = old


def test_the_titled_merges_are_unchanged():
    k = assemble._slide("team", "Team", [{"kind": "bullets", "items": [{"text": "a", "human": True}]}], status="needs_human")
    m = assemble._slide("credentials", "Work we have done", [{"kind": "bullets", "items": [{"text": "b", "human": True}]}], status="needs_human")
    assemble._merge(k, m, spec.PITCH_MERGES[0][2])
    assert k["title"] == spec.PITCH_MERGES[0][2] and k["blocks"][1]["title"] == "Work we have done" and "merged" not in k


def test_the_merges_need_the_flag():
    assert spec.PITCH_MERGES_V3 == (("channel_roles", "execution", None), ("measurement", "guardrails", None))
    d = _build()
    assert {"execution", "guardrails"} <= set(_types(d, d["order"]))


def test_the_first_presented_execution_is_absorbed(v3):
    st = _st()
    st["d"] = copy.deepcopy(st["d"])
    ex = st["d"]["executions"]
    ex.insert(0, {**copy.deepcopy(ex[0]), "channel": "radio", "role": "Reach, if budget allows"})   # first in the stage, but optional
    d = _build(st=st)
    cr = _of(d, "channel_roles")
    assert cr["merged"][0]["title"] == "Outdoor"   # the optional radio execution is not the presented one


# ================================================================================================ every word survives (fix 1)
def test_every_word_before_is_in_a_slide_the_appendix_or_the_notes(v3, monkeypatch):
    """The per-word multiset: every word of the v3 deck before step 5 (no merges, no target) is still in the deck after, on a presented
    slide, in the appendix or in the notes, as many times."""
    after = _deck_words(_build())
    monkeypatch.setattr(spec, "PITCH_MERGES_V3", ())
    monkeypatch.setattr(spec, "PITCH_TARGET", 99)
    before = _deck_words(_build())
    lost = before - after
    assert not lost, dict(lost)
    assert set(after - before) <= set(re.findall(r"[a-z0-9%€]+", (spec.TO_SUPPLY_TITLE + " " + spec.TO_SUPPLY_TEXT
                                                                    + " To supply: 3 slides in the appendix merged here from the slide").lower()))


#: Engine marks a slide carries for its place, not its content: the band (its section), the page number, the watermark, the footnote numbers.
MARKS = ("Band", "Section", "SlideNumber", "Watermark", "Footer", "Footnotes")


def _rendered_words(prs) -> Counter:
    """Every word a rendered deck holds on its slides and in its notes, less the engine's place marks (MARKS) and the notes' generated
    lines (the slide id and status line, the 'Evidence:' header, which the refs regenerate for the merged slide)."""
    out = Counter()
    for sl in prs.slides:
        txt = " ".join(sh.text_frame.text for sh in sl.shapes if sh.has_text_frame and not sh.name.startswith(MARKS))
        notes = re.sub(r"Slide id s\d+ · status \w+ · requirements [^\n]*|^Evidence:", " ", sl.notes_slide.notes_text_frame.text, flags=re.M)
        out.update(re.findall(r"[a-z0-9%€]+", (txt + " " + notes).lower()))
    return out


def test_every_rendered_word_survives_the_merges(tmp_path, monkeypatch):
    """The same on the rendered decks (pptx slides and notes): the v3 deck before step 5 against the v3 deck now, both planned."""
    def render(name):
        planned, _, _ = layouts.plan(_build(), prefs={"density": "lean"})
        R.Renderer(planned, Inputs(brief={}), theme="napkin").render(tmp_path / name)
        return _rendered_words(Presentation(str(tmp_path / name)))
    monkeypatch.setattr(spec, "LOOK_V3", True)
    after = render("after.pptx")
    monkeypatch.setattr(spec, "PITCH_MERGES_V3", ())
    monkeypatch.setattr(spec, "PITCH_TARGET", 99)
    before = render("before.pptx")
    lost = before - after
    assert not lost, dict(lost)


def test_the_v3_words_sha_is_re_recorded_deliberately(v3):
    d = _build()
    assert checklist.words_sha(d) == V3_WORDS_SHA


# ================================================================================================ layouts for the merged slides
def test_rows_aside_takes_one_table_and_a_block_beside_it():
    t = {"kind": "table", "rows": [["A", "B"], ["x", "y"]]}
    assert layouts.rows_aside({"type": "measurement"}, [t, {"kind": "bullets", "items": [{"text": "z"}]}])
    assert layouts.rows_aside({"type": "channel_roles"}, [t, {"kind": "text", "text": "z"}, {"kind": "copy", "lines": ["c"]}])
    assert not layouts.rows_aside({"type": "measurement"}, [t])   # a table alone keeps its own layout
    assert not layouts.rows_aside({"type": "measurement"}, [t, t, {"kind": "text", "text": "z"}])
    assert not layouts.rows_aside({"type": "measurement"}, [t, {"kind": "chart", "chart": {}}])
    assert not layouts.rows_aside({"type": "measurement"}, [{"kind": "table", "rows": [["A"] * 5, ["x"] * 5]}, {"kind": "text", "text": "z"}])


def test_the_merged_slides_take_rows_aside_without_a_picture(v3):
    planned, issues, _ = layouts.plan(_build(), prefs={"density": "lean"})
    ids = {planned["slides"][x]["type"]: planned["slides"][x]["layout"] for x in validate.presented(planned)}
    for t in ("channel_roles", "measurement"):
        assert ids[t]["id"] == "rows_aside" and ids[t]["fit"]["rung"] == "as_is" and not ids[t]["fit"]["moved"]
    assert not [i for i in issues if i["check"] in ("block_unbound", "slot_missing")]


def test_rows_aside_draws_every_word_of_both_slides(v3, tmp_path):
    planned, _, _ = layouts.plan(_build(), prefs={"density": "lean"})
    r = R.Renderer(planned, Inputs(brief={}), theme="napkin")
    r.render(tmp_path / "d.pptx")
    prs = Presentation(str(tmp_path / "d.pptx"))
    for typ, words in (("channel_roles", ["Each channel has one job", "Channel", "Its one job", "Outdoor", "Fame", "Radio", "Reach", "Role: Make the line famous"]),
                       ("measurement", ["How we will know it worked", "What we measure", "Household use", "Utility meter data",
                                        "What the work must always carry, and never do", "Show the Lumen Water logo on every execution"])):
        sid = next(x for x in planned["order"] if planned["slides"][x]["type"] == typ)
        sl = prs.slides[planned["order"].index(sid)]
        txt = " ".join(sh.text_frame.text for sh in sl.shapes if sh.has_text_frame).replace("\xa0", " ")
        assert all(w in txt for w in words), (typ, [w for w in words if w not in txt])
        names = {sh.name for sh in sl.shapes}
        assert {"slot:rows", "slot:aside", "Hairline", "Band"} <= names


def test_the_never_move_merged_slide_switches_instead_of_moving_points(v3, monkeypatch, tmp_path):
    """measurement (and guardrails) never move points to the notes: when rows_aside cannot hold the merged slide, the fit ladder
    switches to its tested alternative (cards: the table and the list stacked) and every point stays on the slide."""
    def nofit(self, sl, s):
        raise R.NoFit("forced")
    monkeypatch.setattr(R.Renderer, "_lay_rows_aside", nofit)
    planned, _, _ = layouts.plan(_build(), prefs={"density": "lean"})
    ms = next(planned["slides"][x] for x in planned["order"] if planned["slides"][x]["type"] == "measurement")
    assert "measurement" in layouts.NEVER_MOVE_TYPES
    lay = ms["layout"]
    assert lay["id"] not in ("rows_aside", "flow") and lay["fit"]["rung"] == "switched" and lay["fit"]["moved"] == [] and not lay["fit"]["relaxed"]
    monkeypatch.undo()
    monkeypatch.setattr(spec, "LOOK_V3", True)
    r = R.Renderer(planned, Inputs(brief={}), theme="napkin")
    r.render(tmp_path / "d.pptx")
    sid = next(x for x in planned["order"] if planned["slides"][x]["type"] == "measurement")
    sl = Presentation(str(tmp_path / "d.pptx")).slides[planned["order"].index(sid)]
    txt = " ".join([sh.text_frame.text for sh in sl.shapes if sh.has_text_frame] + [c.text for sh in sl.shapes if sh.has_table
                                                                                    for row in sh.table.rows for c in row.cells]).replace("\xa0", " ")
    assert lay["id"] == layouts.load()["rows_aside"]["alternatives"][0] == "cards"   # the tested alternative: the table and the list stacked
    assert r.layouts[sid] == lay["id"] and all(w in txt for w in ("Household use", "Utility meter data", "Show the Lumen Water logo on every execution"))


def test_how_it_runs_carries_the_executions_picture(v3):
    """With pictures the merged slide takes the absorbed execution's slot and anchor, so its picture (made or cached) is drawn there:
    the picture column, the channel rows beside it."""
    d = _build()
    sid = next(x for x in d["order"] if d["slides"][x]["type"] == "channel_roles")
    s = d["slides"][sid]
    assert spec.picture_of(s) == ("execution", "Outdoor")
    assert images.anchors(d)[sid] == {"type": "execution", "ref": "outdoor"}
    assert images.slot_specs(s) == [("picture", images.EXECUTION_ASPECT[spec.frame_for("Outdoor")])]
    assert images.add_empty_slots(d, "creative") >= 1 and "picture" in s["slots"]
    assert layouts.pick(s, ready=frozenset({"picture"})) == "picture_column"
    assert layouts.pick(_of(_build_off(), "channel_roles")) == "role_grid"   # unmerged: unchanged


def test_picture_column_reads_the_channel_rows(v3):
    d = _build()
    s = _of(d, "channel_roles")
    r = R.Renderer(d, Inputs(brief={}), theme="napkin")
    assert r._column_points([b for b in s["blocks"] if b["kind"] == "table"]) == [("Channel", "Its one job"), ("Outdoor", "Fame"), ("Radio", "Reach")]
    assert "table" in layouts.load()["picture_column"]["slots"]["points"]["from_blocks"] and "channel_roles" in layouts.load()["picture_column"]["for_types"]


# ================================================================================================ the insight's left column (phase 13 s04)
def test_the_insight_anchors_its_quote_in_the_title_column(v3, tmp_path):
    planned, _, _ = layouts.plan(_build(), prefs={"density": "lean"})
    sid = next(x for x in planned["order"] if planned["slides"][x]["type"] == "insight")
    assert planned["slides"][sid]["layout"]["id"] == "statement_points"
    r = R.Renderer(planned, Inputs(brief={}), theme="napkin")
    r.render(tmp_path / "d.pptx")
    sl = Presentation(str(tmp_path / "d.pptx")).slides[planned["order"].index(sid)]
    title = next(sh for sh in sl.shapes if sh.name == "Title")
    anchor = [sh for sh in sl.shapes if sh.name == "slot:figure"]
    assert anchor and "I care about water" in anchor[0].text_frame.text.replace("\xa0", " ")
    assert anchor[0].left == title.left and anchor[0].top > title.top + title.height   # under the title, in its column: no empty half
    pts = [sh for sh in sl.shapes if sh.name == "slot:points"]
    assert len(pts) == 2 and all(p.left > title.left + title.width for p in pts)


# ================================================================================================ step 6: one field one home, windows advisory
def test_density_by_role_keeps_argument_points_on_screen(v3):
    planned, _, _ = layouts.plan(_build(), prefs={"density": "lean"})
    ins = _of(planned, "insight")
    assert ins["layout"]["fit"]["moved"] == []   # 'People care about water...' stays (lean 30 moved it): an argument shows up to 70


def test_word_windows_are_advisory_and_no_sentence_is_repeated(v3):
    planned, _, _ = layouts.plan(_build(), prefs={"density": "lean"})
    F = validate.run(planned, inputs.load(FIX / "brief_object.json"))
    rw = [x for x in F if x["check"] == "role_words"]
    assert rw and all(x["level"] == "warn" for x in rw)
    assert not [x for x in F if x["check"] == "repeated_line"]
    assert not [x for x in F if x["level"] == "error"]


def test_each_brief_field_has_one_home_after_the_merges(v3):
    d = _build()
    b = json.loads((FIX / "brief_object.json").read_text())["loop2_golden"]["fields"]
    for text in (b["objectives"]["value"]["attitudinal"], b["background"]["value"], b["desired_response"]["value"]):
        hits = [x for x in validate.presented(d) if any(text in json.dumps(bl) for bl in d["slides"][x]["blocks"])]
        assert len(hits) == 1, (text, hits)


# ================================================================================================ DECK_PITCH_TARGET / CAP from the environment
@pytest.mark.parametrize("raw", ["ten", "0", "-4", "1000", "7.5"])
def test_a_bad_pitch_target_falls_back_with_a_warning(monkeypatch, capsys, raw):
    monkeypatch.setenv("DECK_PITCH_TARGET", raw)
    assert spec._env_count("DECK_PITCH_TARGET", 10) == 10
    assert "DECK_PITCH_TARGET" in capsys.readouterr().err


def test_a_good_pitch_target_is_read(monkeypatch):
    monkeypatch.setenv("DECK_PITCH_TARGET", " 14 ")
    assert spec._env_count("DECK_PITCH_TARGET", 10) == 14
    monkeypatch.delenv("DECK_PITCH_TARGET")
    assert spec._env_count("DECK_PITCH_TARGET", 10) == 10


def test_a_bad_pitch_target_never_breaks_the_import():
    import os
    import subprocess
    import sys
    engine = Path(spec.__file__).resolve().parents[1]
    env = {**os.environ, "DECK_PITCH_TARGET": "ten", "DECK_PITCH_CAP": "0", "PYTHONPATH": str(engine)}
    r = subprocess.run([sys.executable, "-c", "from deck import spec; print(spec.PITCH_TARGET, spec.PITCH_CAP)"], env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and r.stdout.split() == ["10", "12"], r.stderr
