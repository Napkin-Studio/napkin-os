"""The evidence track: market-aware, argument-led, and no client name (or rival's name, or brief figure) ever reaches a search.
The blind judging of decks built from real client briefs (20 Nov 2026) scored evidence 3-5/10. Offline: the `claude -p` call is stubbed.
Invented fixtures only. Run: cd engine/agent-server && python3 -m pytest -q test_research_evidence.py
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import research  # noqa: E402

GIST = {"client": "Brightwell Water", "market": "Ireland (a coastal county)", "category": "public_sector",
        "problem": "Brightwell households use 150 litres a day; Brightwell wants a 7% cut", "audience": "Adults 25-54 in the Brightwell region",
        "objective": "Cut Brightwell household use by 7%", "competitors": "Aquaflow, Riverco"}
BRIEF = {"meta": {"client": "Brightwell Water", "project": "Project Tidewater"},
         "loop2_golden": {"fields": {"insight": {"value": "People think Brightwell loses water through leaks, not them"},
                                     "smp": {"value": "Every litre you save, Brightwell saves two"},
                                     "reasons_to_believe": {"value": ["Brightwell fixed 2,000 leaks last year"]}}}}
STORY = {"insight": {"title": "Households blame the supplier for waste, yet they waste most at the tap",
                     "evidence": [{"text": "Aquaflow reported 30% losses"}]},
         "audience": {"primary": "Parents in busy homes in the Brightwell area"},
         "from_to": {"to": "Saving water is something we do together"},
         "proposition": {"rtbs": [{"text": "Riverco cut use by 4% with a meter scheme"}]}}
NAMES = ("Brightwell", "Aquaflow", "Riverco", "Tidewater")


def _stub(seen, items):
    def fake_run(cmd, **kw):
        """Stands in for the headless claude call: records the prompt, returns the given findings."""
        seen.append(cmd[2])
        return types.SimpleNamespace(returncode=0, stdout=json.dumps({"result": json.dumps(items)}))
    return fake_run


def test_no_client_or_rival_name_or_brief_figure_reaches_a_query(monkeypatch):
    seen = []
    monkeypatch.setenv("RESEARCH_WEB", "claude")
    monkeypatch.setattr(research.subprocess, "run", _stub(seen, []))
    ev = research.gather_evidence(GIST, BRIEF, STORY, names=["Project Tidewater"])
    research._web_track(GIST)
    sent = "\n".join(seen + ev["queries"] + [c["claim"] for c in ev["claims"]])
    assert len(seen) == 2 and ev["queries"]
    for name in NAMES:
        assert name.lower() not in sent.lower(), name
    for fig in ("150", "2,000", "30%", "7%", "4%", "25-54"):
        assert fig not in sent, fig


def test_queries_go_local_first_and_cover_the_decks_claims():
    sg = research.sanitise_gist(GIST)
    sg["market"] = research.market_of(sg)
    claims = research.deck_claims(BRIEF, STORY, research._names(GIST))
    roles = {c["role"] for c in claims}
    assert {"insight", "audience", "proposition", "reasons_to_believe"} <= roles
    qs = research.build_queries(sg, claims)
    assert sg["market"] == "Ireland"
    first = [q for q in qs if q["kind"] == "local"][:4]
    assert [q["source_kind"] for q in first] == list(research.LOCAL_SOURCE_KINDS)
    assert all(q["query"].startswith("Ireland") for q in qs if q["kind"] == "local")
    assert any(q["kind"] == "fallback" for q in qs)
    assert qs.index(next(q for q in qs if q["kind"] == "fallback")) > max(i for i, q in enumerate(qs) if q["kind"] == "local")
    prompt = research.evidence_prompt(sg, claims, qs)
    for word in ("national statistics office", "regulator", "trade bodies", "local press", "which market it is from", "metric"):
        assert word in prompt


def test_findings_carry_market_year_units_and_url_and_foreign_ones_are_labelled(monkeypatch):
    items = [{"claim": "Irish households used 133 litres a day in 2023.", "figure": "133 litres", "unit": "litres a day", "market": "Ireland",
              "year": "2023", "source": "Statistics office", "url": "https://stats.example.ie/water", "supports": "insight"},
             {"claim": "Neighbour comparison reports cut use by 5.6%.", "market": "US figure", "date": "2019-04-01",
              "url": "https://journal.example.org/a", "supports": "rtb"},
             {"claim": "No url here", "market": "Ireland"}]
    monkeypatch.setenv("RESEARCH_WEB", "claude")
    monkeypatch.setattr(research.subprocess, "run", _stub([], items))
    ev = research.gather_evidence(GIST, BRIEF, STORY)
    f = ev["findings"]
    assert len(f) == 2 and ev["local"] == 1 and ev["short_of_local"]
    assert f[0]["local"] and f[0]["market"] == "Ireland" and f[0]["year"] == "2023" and f[0]["unit"] == "litres a day"
    assert f[0]["value"] == 133 and f[0]["url"].startswith("https://") and f[0]["supports"] == "insight"
    assert not f[1]["local"] and f[1]["market"] == "US figure" and f[1]["year"] == "2019" and f[1]["supports"] == "reasons_to_believe"
    assert f[1]["source"] == "journal.example.org"
    md = research.evidence_markdown(ev)
    assert "US figure, not local" in md and "under the aim of 3" in md


def test_the_track_is_off_without_the_web_switch(monkeypatch):
    monkeypatch.delenv("RESEARCH_WEB", raising=False)
    ev = research.gather_evidence(GIST, BRIEF, STORY)
    assert ev["findings"] == [] and ev["queries"]
