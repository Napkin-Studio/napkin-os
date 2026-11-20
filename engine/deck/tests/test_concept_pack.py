"""The concept pack (deck/concept_pack.py): the chosen concept as concept_pack.json and concept_pack.md beside the deck, and one "The concept
on a page" slide (presented when it fits the target, else first in the appendix). Built from stage c and d only; a part stage d did not
write is listed as missing, never filled in. Offline; every stage output is invented."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from deck import assemble, concept_pack, inputs, profiles, show_work, spec, validate

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "lumen_water"
FILES = {"a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
MANIFESTO = " ".join(["Every home has water it never chose to use."] * 15) + " Stop the water nobody used."
CONCEPT = {"platform": {"name": "The Water Nobody Used", "how_it_lasts": "Every season has its own hidden water."},
           "key_visual": {"description": "A kitchen at night, one bead of water on a tap, the meter dial turning."},
           "manifesto": MANIFESTO,
           "script": {"length_s": 30, "title": "Night shift", "scenes": [
               {"time": "0-6s", "visual": "An empty kitchen at night.", "vo": "Everyone is asleep.", "super": "", "sfx": "a slow drip"},
               {"time": "6-20s", "visual": "The meter dial turning.", "vo": "The house is not.", "super": "", "sfx": "a hiss"},
               {"time": "20-30s", "visual": "Morning light, a hand on the tap.", "vo": "One check tonight.", "super": "Stop the water nobody used.", "sfx": ""}]},
           "stretch": {"years": [{"year": "Year 1", "what": "Find the hidden leaks."}, {"year": "Year 2", "what": "The street that checked."},
                                 {"year": "Year 3", "what": "A town with no hidden water."}],
                       "channels": [{"channel": "radio", "how": "the drip as a sound logo"}], "where_it_breaks": "If homes cannot check easily."}}


def _st(concept=CONCEPT, n_exec=4):
    st = {k: json.loads((FIX / f).read_text()) for k, f in FILES.items()}
    st["b"]["proposition"]["line"] = "Your home's hidden water is yours to stop"
    st["c"] = {"chosen": "t2", "chosen_by": "test", "territories": [{"id": f"t{i}", "name": n, "thought": f"{n} thought", "why": "fits", "sketch": f"{n} sketch"}
                                                                   for i, n in enumerate(["Tap Tells", "Meter Moments", "Quiet Pipes"], 1)],
               "ranking": {"order": ["t2", "t1", "t3"], "reasons": {"t2": "Closest"}, "by": "test"}}
    st["d"] = {**st["d"], "campaign_line": "Stop the water nobody used.", "idea": "Show every home the water it never chose to use.",
               "executions": [{"channel": c, "role": "a job", "copy": [f"{c} line"], "answer": "x"} for c in ["outdoor", "radio", "social", "direct mail"][:n_exec]]}
    if concept is not None:
        st["d"]["concept"] = copy.deepcopy(concept)
    return st


def test_the_pack_holds_every_part():
    pack = concept_pack.build(_st())
    assert pack["platform"]["name"] == "The Water Nobody Used" and pack["campaign_line"] == "Stop the water nobody used."
    assert pack["key_visual"]["description"].startswith("A kitchen at night")
    assert 120 <= len(pack["manifesto"].split()) <= 180 + 20
    assert [s["time"] for s in pack["script"]["scenes"]] == ["0-6s", "6-20s", "20-30s"] and pack["script"]["length_s"] == 30
    assert len(pack["executions"]) == 4 and len(pack["stretch"]["years"]) == 3
    assert [t["chosen"] for t in pack["territories"]] == [False, True, False] and pack["chosen"] == "Meter Moments"
    assert pack["missing"] == [] and not [c for c in pack["checks"] if c["check"] != "manifesto_length"]


def test_markdown_and_json_are_written(tmp_path):
    j, m = concept_pack.write(concept_pack.build(_st()), tmp_path)
    md = m.read_text()
    for h in ("**Platform:**", "## Key visual", "## Manifesto", "## 30-second script", "| 0-6s |", "## Channel executions",
              "## Stretch test", "## Territories considered", "**Meter Moments** (chosen)"):
        assert h in md, h
    assert json.loads(j.read_text())["campaign_line"] == "Stop the water nobody used."


def test_an_old_stage_d_lists_what_is_missing_and_invents_nothing():
    pack = concept_pack.build(_st(concept=None))
    assert {"platform", "manifesto", "script", "stretch", "key_visual"} <= set(pack["missing"])
    assert pack["manifesto"] == "" and "(not written)" in concept_pack.markdown(pack)


def test_the_stage_d_prompt_asks_for_the_pack():
    text = (Path(spec.__file__).parent / "prompts" / "d_idea.md").read_text()
    for w in ("manifesto", "120 to 180 words", "30-second", "stretch", "key_visual", "platform"):
        assert w in text, w


def test_the_concept_slide_goes_first_in_the_appendix_when_the_ten_are_full(monkeypatch):
    for f in ("SHOW_WORK", "FINISH", "BRIEF_GAPS", "LOOK_V3"):
        monkeypatch.setattr(spec, f, True)
    inp = inputs.load(FIX / "brief_object.json")
    inp.brief_issues = [{"id": "bi_01", "kind": "missing", "topic": "timing", "what": "x", "why_it_matters": "y", "question": "When does it go live?",
                         "quote": "", "source": "rule"}]
    d = assemble.build(inp, _st(), client="Lumen Water", project="Water saving", fmt="pitch", profile=profiles.load("agency_pitch"))
    pres = validate.presented(d)
    assert len(pres) == 10 and not any(d["slides"][x]["type"] == "concept" for x in pres)
    after = d["order"][len(pres) + 1]   # the first slide behind the Appendix divider
    assert d["slides"][after]["type"] == "concept" and d["slides"][after]["title"] == concept_pack.TITLE


def test_the_concept_slide_is_presented_when_there_is_room(monkeypatch):
    for f in ("SHOW_WORK", "FINISH", "BRIEF_GAPS", "LOOK_V3"):
        monkeypatch.setattr(spec, f, True)
    inp = inputs.load(FIX / "brief_object.json")
    inp.brief_issues = []
    d = assemble.build(inp, _st(n_exec=2), client="Lumen Water", project="Water saving", fmt="pitch", profile=profiles.load("agency_pitch"))
    roles = [show_work.role(d["slides"][x]) for x in validate.presented(d)]
    assert "concept" in roles and roles.index("concept") > roles.index("execution") and roles[-1] == "next_step"
