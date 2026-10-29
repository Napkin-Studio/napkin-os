"""The award case library ingest: rules, slice, dedupe, determinism, and that every file it
writes is a contract-valid chunk. Offline; CSV fixtures only (openpyxl is never imported).
Run: cd engine/rag && python3 -m pytest test_awardlib_ingest.py -q
"""
from __future__ import annotations

import csv
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import pytest  # noqa: E402

import chunking  # noqa: E402
import contract  # noqa: E402
import ingest_awardlib as ia  # noqa: E402

COLS = ["case_id", "brand", "title", "agency", "country", "campaign_year", "award_show", "award_year",
        "native_award_wording", "normalized_outcome", "award_family", "problem", "audience", "insight",
        "proposition", "idea", "execution", "reported_results", "results_evidence_status",
        "official_source_url", "campaign_source_url", "rights_status", "rag_text"]


def case(cid, **kw):
    base = {"case_id": cid, "brand": "Acme", "title": f"Title {cid}", "agency": "Agency", "country": "France",
            "campaign_year": "2023", "award_show": "Effie Awards Europe", "award_year": "2024",
            "native_award_wording": "Gold", "normalized_outcome": "gold", "award_family": "effectiveness",
            "problem": "Reconstructed: Sales had stalled in a crowded category.", "audience": "Parents of young children.",
            "insight": "Reconstructed by Napkin: Families trust what other families already buy.",
            "proposition": "Reconstructed: Be the family's default.", "idea": "A neighbourhood sampling scheme.",
            "execution": "Door to door and social.", "reported_results": "The entrant reports 12% growth.",
            "results_evidence_status": "entrant_reported_not_independently_audited",
            "official_source_url": "https://example.org/award", "campaign_source_url": "https://example.org/case",
            "rights_status": "public-facts-only", "rag_text": "Acme: Title. Problem: sales stalled."}
    base.update(kw)
    return base


def write_csv(path: Path, rows: list[dict]) -> Path:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)
    return path


def write_mapping(path: Path, brands: dict) -> Path:
    path.write_text(json.dumps({"brands": {b: {"category": c, "ambiguous": a} for b, (c, a) in brands.items()}}))
    return path


@pytest.fixture
def mapping(tmp_path):
    return write_mapping(tmp_path / "map.json", {"Acme": ("fmcg", False), "Zed Bank": ("financial_services", True),
                                                 "Spotify": ("media_entertainment", False)})


# ---- the small rules ---------------------------------------------------------------------
@pytest.mark.parametrize("status,expected", [
    ("The entrant reports 12% growth.", "entrant_reported"),
    ("Sales rose 4.4 times faster than the category.", "entrant_reported"),
    ("No independently audited sales effect was located.", "none"),
    ("Not independently verified; no figures retained.", "none"),
    ("Effectiveness unknown; source establishes execution, not impact.", "none"),
    ("The campaign reached many people.", "none"),                      # a claim, but no number
    ('{"evidence_grade":"U","independent_validation":false}', "none"),  # a structured blob, not a result
    ("", "none"), (None, "none"),
])
def test_results_evidence_is_read_from_the_text_not_the_status(status, expected):
    assert ia.results_evidence(status) == expected


@pytest.mark.parametrize("raw,expected", [
    ("public-facts-only", "public_facts_only"), ("public_facts_only", "public_facts_only"),
    ("public_reference_only_no_reuse_rights", "public_facts_only"),
    ('{"assets_reused":false,"permission_to_republish_assets":"not_established"}', "public_facts_only"),
    ('{"assets_reused":true}', "unknown"), ("licensed", "unknown"), ("", "unknown"), (None, "unknown"),
])
def test_rights_normalise_and_anything_unclear_is_unknown(raw, expected):
    assert ia.rights(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("effectiveness", "effectiveness"), ("creative", "creative"), ("pr", "pr"), ("public_relations", "pr"),
    ("craft", "craft"), ("Gerety Awards", "unknown"), ("Media Lions", "unknown"), (None, "unknown"),
])
def test_award_family_folds_the_spellings(raw, expected):
    assert ia.award_family(raw) == expected


def test_label_tags_are_stripped_from_the_text():
    assert ia.strip_label("Reconstructed by Napkin: Let species take the logo's place.") == "Let species take the logo's place."
    assert ia.strip_label("[Napkin reconstruction] Applied AI company.") == "Applied AI company."
    assert ia.strip_label("Reconstructed: a   simple  idea") == "a simple idea"
    assert ia.strip_label("Not a label: keep it") == "Not a label: keep it"


def test_award_tier_prefers_the_awarding_bodys_wording_then_the_sheet_outcome_and_never_guesses():
    assert ia.resolve_tier("Gold", "silver") == "Gold"                       # wording names a tier: it wins
    assert ia.resolve_tier("Merit", "shortlist") == "shortlist"              # wording names none: the sheet stands in
    assert ia.resolve_tier("Finalist", "unknown") == "Finalist"              # nothing better: normalises to `other`
    assert ia.resolve_tier(None, "grand_prix") == "grand prix"
    assert ia.resolve_tier(None, "unknown") is None
    assert ia.native_wording('{"archive_section":"AICP Show"}') is None      # a blob is not a wording
    assert ia.native_wording("unknown") is None


# ---- one case ----------------------------------------------------------------------------
def test_slice_admits_effectiveness_and_entrant_reported_only(tmp_path, mapping):
    rows = [case("e1"),                                                               # effectiveness family, with a result
            case("e2", award_family="effectiveness", reported_results="No result adopted."),  # effectiveness, no result: still in
            case("c1", award_family="creative", award_show="One Show"),               # creative with a stated result: in
            case("c2", award_family="creative", reported_results="No independently audited effect."),  # creative, no result: out
            case("c3", award_family="creative", reported_results="")]
    m = ia.run(write_csv(tmp_path / "in.csv", rows), mapping, tmp_path / "no-corpus", tmp_path / "out")
    names = {p.name for p in (tmp_path / "out").glob("lib_*.md")}
    assert names == {ia.doc_id_for(c) + ".md" for c in ("e1", "e2", "c1")}
    assert m["written"] == 3 and m["skipped"] == {"outside_slice": 2}


def test_unknown_rights_and_an_unmapped_brand_are_skipped_and_counted_never_guessed(tmp_path, mapping):
    rows = [case("ok"), case("r1", rights_status="licensed"), case("b1", brand="Nobody Ltd"), case("t1", rag_text="", problem="")]
    m = ia.run(write_csv(tmp_path / "in.csv", rows), mapping, tmp_path / "c", tmp_path / "out")
    assert m["written"] == 1
    assert m["skipped"] == {"no_client_category": 1, "no_text": 1, "rights_not_public_facts_only": 1}


def test_the_mapping_file_in_the_repo_holds_only_contract_categories_and_few_others():
    mp = json.loads(ia.DEFAULT_MAPPING.read_text())
    cats = set(contract.SCHEMA.enum_values("category"))
    brands = mp["brands"]
    assert brands and all(v["category"] in cats for v in brands.values())
    assert sum(v["category"] == "other" for v in brands.values()) / len(brands) < 0.05     # the creative director's ceiling
    assert mp["reviewed_by_creative_director"] is False                                  # honest about what it is


def test_files_are_yaml_safe_and_chunk_into_one_valid_parent(tmp_path, mapping):
    tricky = case("x1", title='He said: "buy it" # not a comment', brand="Zed Bank", award_year="2019",
                  native_award_wording="Merit", normalized_outcome="shortlist")
    ia.run(write_csv(tmp_path / "in.csv", [tricky]), mapping, tmp_path / "c", tmp_path / "out")
    [path] = list((tmp_path / "out").glob("lib_*.md"))
    chunks = chunking.chunk_file(path)
    assert len(chunks) == 1
    md = chunks[0]["metadata"]
    assert contract.validate(md) == []
    assert (md["source"], md["level"], md["bucket"], md["section_role"]) == ("awardlib", "parent", "exemplars", "whole")
    assert md["category"] == "financial_services" and md["doc_kind"] == "award_library_case"
    assert md["year"] == "2019" and md["as_of"] == "2019-01-01"
    assert md["effectiveness_type"] is None                                  # the library carries none
    assert md["award_tier"] == "shortlist" and md["award_tier_raw"] == "Merit"   # native wording kept for display only
    text = chunks[0]["text"]
    assert "Napkin reconstructions" in text.split("\n\n")[0]                 # the label is the first thing the text says
    assert "Reconstructed" not in text.replace("(reconstructed)", "")       # tags in the source text are not repeated
    assert "reconstructed strategy" in chunks[0]["header"]                  # and it travels in the embedded header
    assert 'He said: "buy it" # not a comment' in md["framework_name"]


def test_ambiguous_categories_are_flagged_in_the_file(tmp_path, mapping):
    ia.run(write_csv(tmp_path / "in.csv", [case("a1", brand="Zed Bank"), case("a2", brand="Acme")]), mapping,
           tmp_path / "c", tmp_path / "out")
    by_brand = {}
    for p in (tmp_path / "out").glob("lib_*.md"):
        meta, _ = chunking.parse_frontmatter(p.read_text())
        by_brand[meta["client"]] = meta["category_confidence"]
    assert by_brand == {"Zed Bank": "ambiguous", "Acme": "derived"}


# ---- determinism, dedupe, provenance of the run ---------------------------------------------
def test_ingest_is_deterministic_idempotent_and_order_independent(tmp_path, mapping):
    rows = [case(f"k{i}", brand=random.Random(i).choice(["Acme", "Zed Bank"])) for i in range(8)]
    shuffled = rows[:]
    random.Random(3).shuffle(shuffled)
    a, b = tmp_path / "a", tmp_path / "b"
    ia.run(write_csv(tmp_path / "1.csv", rows), mapping, tmp_path / "c", a)
    ia.run(write_csv(tmp_path / "2.csv", shuffled), mapping, tmp_path / "c", b)
    ia.run(write_csv(tmp_path / "1.csv", rows), mapping, tmp_path / "c", a)           # run twice into the same folder
    files = sorted(p.name for p in a.glob("lib_*.md"))
    assert files == sorted(p.name for p in b.glob("lib_*.md")) and len(files) == 8
    assert all((a / n).read_bytes() == (b / n).read_bytes() for n in files)
    ids = lambda d: sorted(c["id"] for n in files for c in chunking.chunk_file(d / n))  # noqa: E731
    assert ids(a) == ids(b)                                                                # stable chunk ids across rebuilds


def existing_corpus(tmp_path):
    d = tmp_path / "corpus" / "ipa" / "cases"
    d.mkdir(parents=True)
    (d / "ipa_0001.md").write_text('---\nsource: ipa\nframework_id: ipa_0001\nframework_name: "Daylist (2023)"\n'
                                   "client: Spotify AB\nyear: 2023\ncategory: ipa_effectiveness_case\n---\n# Daylist\n\nbody text here for the case.\n")
    return tmp_path / "corpus"


def test_dedupe_against_the_existing_corpus_needs_a_matching_title_and_a_brand_or_year(tmp_path, mapping):
    corpus = existing_corpus(tmp_path)
    rows = [case("d1", brand="Spotify", title="Daylist", award_year="2023"),                       # same title and brand: duplicate
            case("d2", brand="Acme", title="Daylist", award_year="2023"),                          # same title, other brand, same year: duplicate
            case("d3", brand="Acme", title="Daylist", award_year="2011"),                          # same title, other brand, far year: kept
            case("d4", brand="Spotify", title="Daylist for everyone", award_year="2030")]          # different title: kept
    m = ia.run(write_csv(tmp_path / "in.csv", rows), mapping, corpus, tmp_path / "out")
    kept = {chunking.parse_frontmatter(p.read_text())[0]["case_id"] for p in (tmp_path / "out").glob("lib_*.md")}
    assert kept == {"d3", "d4"}
    assert {d["case_id"]: d["matches"] for d in m["duplicates"]} == {"d1": "ipa_0001", "d2": "ipa_0001"}


def test_manifest_records_the_input_the_rule_and_every_count(tmp_path, mapping):
    src = write_csv(tmp_path / "in.csv", [case("m1"), case("m2", rights_status="licensed")])
    m = ia.run(src, mapping, tmp_path / "c", tmp_path / "out")
    on_disk = json.loads((tmp_path / "out" / "_manifest.json").read_text())
    assert on_disk == json.loads(json.dumps(m))
    assert on_disk["input_sha256"] == ia.sha256(src) and on_disk["mapping_sha256"] == ia.sha256(mapping)
    assert on_disk["slice"] == "effectiveness_results" and on_disk["rows_read"] == 2 and on_disk["written"] == 1


def test_dry_run_writes_nothing_and_prune_removes_stale_files(tmp_path, mapping):
    src = write_csv(tmp_path / "in.csv", [case("p1")])
    ia.run(src, mapping, tmp_path / "c", tmp_path / "out", dry_run=True)
    assert not (tmp_path / "out").exists()
    (tmp_path / "out").mkdir()
    stale = tmp_path / "out" / "lib_0000000000.md"
    stale.write_text("old")
    ia.run(src, mapping, tmp_path / "c", tmp_path / "out")
    assert stale.exists()                                                              # kept without --prune
    ia.run(src, mapping, tmp_path / "c", tmp_path / "out", prune=True)
    assert not stale.exists() and len(list((tmp_path / "out").glob("lib_*.md"))) == 1
