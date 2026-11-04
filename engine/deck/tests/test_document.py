"""``run_deck --document``: a Deck document's carried brief and research, as the host prints them, read by from_upstream
(features/deck-maker-spinoff-inputs.clan). No model call: recorded stages, the renderers stubbed. Run from ``engine/``:
``PYTHONPATH=. python3 -m pytest -q deck/tests/test_document.py``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from deck import inputs, run_deck
from test_intake import _brief_clan_data, _research_rows

BRIEF = Path(__file__).parent / "fixtures" / "lumen_water"


def document(tmp_path: Path, **drop) -> Path:
    facts, findings, sources, chain = _research_rows()
    data = {"upstream": {"brief-1": _brief_clan_data(), "res-1": {"campaign": {"name": "Lumen"}}}}
    members = {"facts": facts, "findings": findings, "sources": sources, "decisions": chain}
    for k in drop:
        data["upstream"].pop(k, None)
    p = tmp_path / "document.json"
    p.write_text(json.dumps({"data": data, "members": members}))
    return p


def test_a_document_is_read_like_from_upstream_with_the_runs_own_prompt_and_answers(tmp_path):
    p = document(tmp_path)
    facts, findings, sources, chain = _research_rows()
    ref = inputs.from_upstream({"upstream": {"brief-1": _brief_clan_data(), "res-1": {"campaign": {"name": "Lumen"}}}},
                               {"facts": facts, "findings": findings, "sources": sources, "decisions": chain})
    got = inputs.load_document(p, prompt_text="Cut use by 5%.", answers={"q_a": {"text": "Under 100,000"}})
    assert got.brief == ref.brief and got.facts == ref.facts and got.rejected_pins == {"f_2"}
    assert got.findings["fi_bad"]["status"] == "rejected", "a finding rejected upstream stays rejected"
    assert got.prompt_text == "Cut use by 5%." and got.answers["q_a"]["text"] == "Under 100,000"
    assert got.has_brief() and got.has_research()


def test_a_document_with_the_research_only_has_an_empty_brief(tmp_path):
    got = inputs.load_document(document(tmp_path, **{"brief-1": 1}))
    assert not got.has_brief() and got.has_research()


def args(doc: Path, stages: Path, out: Path, *more: str) -> list[str]:
    return ["--document", str(doc), "--stages", str(stages), "--client", "Lumen Water", "--project", "National awareness campaign",
            "--out", str(out), "--no-qa", "--until", "deck", *more]


def recorded(tmp_path: Path) -> Path:
    d = tmp_path / "stages"
    d.mkdir()
    for f in ("a_requirements.json", "b_storyline.json", "c_territories.json", "d_idea.json"):
        (d / f).write_text((BRIEF / f).read_text())
    return d


def test_run_deck_builds_from_the_carried_brief_and_research_with_no_prompt_at_all(tmp_path):
    out = tmp_path / "out"
    rep = run_deck.main(args(document(tmp_path), recorded(tmp_path), out))
    deck = json.loads((out / "deck.json").read_text())
    assert deck["order"] and rep["until"] == "deck"
    assert deck["meta"]["built_from"]["tier"] == "brief+research", deck["meta"].get("built_from")


def test_a_document_and_a_brief_file_together_are_refused(tmp_path, capsys):
    with pytest.raises(SystemExit) as e:
        run_deck.main(args(document(tmp_path), recorded(tmp_path), tmp_path / "out", "--brief", str(BRIEF / "brief_object.json")))
    assert e.value.code == 2 and "not both" in capsys.readouterr().err


def test_without_a_document_nothing_changes(tmp_path):
    out = tmp_path / "out"
    rep = run_deck.main(["--brief", str(BRIEF / "brief_object.json"), "--stages", str(recorded(tmp_path)), "--client", "Lumen Water",
                         "--project", "P", "--out", str(out), "--no-qa", "--until", "deck"])
    assert json.loads((out / "deck.json").read_text())["meta"]["built_from"]["tier"] == "brief" and rep["until"] == "deck"
