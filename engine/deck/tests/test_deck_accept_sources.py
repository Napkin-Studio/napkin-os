"""Acceptance A35 and A36 (Copperell, a fictional brand). A35: gate 1 labelled the gap chart "No source: our proposal" though each of its bars
cites a research fact (``series[].ref``). A36: Read the inputs said "Research 87 pins, 31 sources" beside a research page of 45 and 16; both are
right (the deck carries the research's pins and the brief's own), and the row now says so."""

from __future__ import annotations

from deck import run_state as rs


def test_a_chart_beat_cited_by_its_series_is_from_research():
    b = {"gap_chart": {"title": "Most Britons want more refills, yet over half cannot tell which cleaning products are sustainable.",
                       "series": [{"label": "Want more refill options (2021)", "ref": "f_GMRO6MHF3CGJ"},
                                  {"label": "Struggle to tell (2024)", "ref": "f_GRU6Y5ZNIPE6"}]},
         "reframe": {"title": "Refill wins by being wanted on the worktop.", "claims": [{"text": "x", "refs": ["fi_G4JSTTWR7UAW"]}]},
         "proposition": {"title": "Our proposal, with nothing cited."}}
    beats = {x["title"][:20]: x for x in rs.beats(b)}
    chart = next(x for x in rs.beats(b) if x["title"].startswith("Most Britons"))
    assert chart["basis"] == "research" and chart["src"] == "Cites research · 2 refs"   # A35: "No source: our proposal"
    assert next(x for x in rs.beats(b) if x["title"].startswith("Our proposal"))["basis"] == "proposal"
    assert len(beats) == 3


def test_the_research_row_says_when_its_counts_include_the_briefs_own_pins(tmp_path):
    summary = {"prompt_sentences": 1, "brief_given": True, "brief_filled": 11, "brief_total": 11, "facts": 87, "findings": 3, "sources": 31}
    items = [i["text"] for i in rs.items_for("inputs", tmp_path, summary, None, None, [])]
    assert "Brief · 11 of 11 fields filled" in items
    assert "Research · 87 pins, 3 findings, 31 sources (the research's and the brief's own together)" in items
    alone = [i["text"] for i in rs.items_for("inputs", tmp_path, {**summary, "brief_given": False}, None, None, [])]
    assert "Research · 87 pins, 3 findings, 31 sources" in alone
