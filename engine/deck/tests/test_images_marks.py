"""Confidential marks reach the engine (deck-image-gen fix: marks plumbed through brief_from_data and load_brief_clan)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "images"))
from make_brief_marked import build  # noqa: E402

from deck import inputs  # noqa: E402


def test_load_brief_clan_keeps_confidential_fields_and_classify_marks(tmp_path):
    clan = build(tmp_path / "b.clan")
    inp = inputs.load(clan)
    assert isinstance(inp.marks, list)
    by = {m["path"]: m for m in inp.marks}
    assert set(by) == {"budget_and_scope", "mandatories[0]", "audience"}
    assert "Nightjar" in by["budget_and_scope"]["text"] and by["audience"]["kind"] == "classify" and by["mandatories[0]"]["kind"] == "confidential_field"


def test_marked_texts_never_stay_in_the_coverage_that_reaches_a_report(tmp_path):
    inp = inputs.load(build(tmp_path / "b.clan"))
    assert "marks" not in inp.coverage and "Nightjar" not in str(inp.coverage)


def test_a_brief_with_no_mark_data_is_not_an_empty_list(tmp_path):
    inp = inputs.load(None, prompt_text="x")
    assert inp.marks is None


def test_a_checked_brief_with_no_marks_is_an_empty_list(tmp_path):
    import zipfile, yaml
    p = tmp_path / "b.clan"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump({"document_id": "d", "app": {"app_id": "x"}}))
        z.writestr("shared/data.yaml", yaml.safe_dump({"background": "A water brand."}))
    assert inputs.load(p).marks == []


def test_from_upstream_reads_the_same_marks(tmp_path):
    import yaml, zipfile
    data = yaml.safe_load(zipfile.ZipFile(build(tmp_path / "b.clan")).read("shared/data.yaml"))
    inp = inputs.from_upstream({"upstream": {"doc1": data}}, {"decisions": [{"id": "d_1", "kind": "classify", "targets": ["doc1#audience"],
                                                                           "licence": {"model": False, "corpus": False}}]})
    assert {m["path"] for m in inp.marks} == {"budget_and_scope", "mandatories[0]", "audience"}


def _classify(target):
    return {"decisions": [{"id": "d_c", "kind": "classify", "targets": [target], "licence": {"model": True, "corpus": False}}]}


def _brief_and_research(budget):
    """A Deck's upstream (invented): a brief that also has a ``campaign.budget_band``, and research whose field carries provenance."""
    brief = {"background": "Lumen Water serves a region.", "audience": "Households.", "campaign": {"budget_band": "BRIEF-SIDE-TEXT"}}
    research = {"campaign": {"name": "Lumen", "budget_band": {"value": budget, "origin": "extracted", "gate": "brief"}}}
    return {"upstream": {"brief-doc": brief, "res-doc": research}}


def test_a_research_mark_is_read_in_the_research_not_the_brief():
    """The carried chain marks the research document's part: it is looked up there (its value, not its provenance), never in the brief."""
    inp = inputs.from_upstream(_brief_and_research("250k_1m"), _classify("res-doc#campaign.budget_band"))
    assert inp.marks == [{"path": "res-doc#campaign.budget_band", "text": "250k_1m", "kind": "classify"}]


def test_a_research_mark_empty_in_its_own_document_still_refuses():
    """The brief holds text at the same path, but the mark is the research's: empty there, so it is refused, not read from the brief."""
    with pytest.raises(inputs.MarksError, match="res-doc#campaign.budget_band"):
        inputs.from_upstream(_brief_and_research(None), _classify("res-doc#campaign.budget_band"))


def test_a_mark_on_a_document_the_deck_does_not_hold_refuses():
    with pytest.raises(inputs.MarksError, match="does not hold"):
        inputs.from_upstream(_brief_and_research("250k_1m"), _classify("other-doc#campaign.budget_band"))
