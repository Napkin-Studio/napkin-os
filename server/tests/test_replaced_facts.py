"""A corrected fact reaches a model as replaced, not as a second truth (features/replaced-facts.clan).

When a person corrects a fact, the host adds the new fact and marks the old one `replaced_by`
(Contract 4 §4); its status stays `active`. Every path that hands facts to a model to write or
check from reads `doc.current_facts`; only lookups by id, duplicate checks and whole-document
copies read every row (`doc.ctx_facts`)."""
import ast
from pathlib import Path

from napkin.brief.fill import research_view
from napkin.doc import ctx_facts, current_facts
from napkin.pipeline.synthesise import usable_pins

from conftest import Server
from test_brief import Host, retrieval, run
from test_planned_brief import THIN, HeldJev, planned_model

OLD, NEW = "f_01JA0B4A1B", "f_01JA0B4A1BC"


def pin(fid, value, **extra):
    return {"id": fid, "entity": "category/drinks.nolo", "key": "market.value_growth_yoy", "value": value,
            "unit": "proportion", "market": "IE", "as_of": "2026-06-30", "retrieved_at": "2026-09-20",
            "sources": ["src_bordbia"], "quotes": {"src_bordbia": "no/low value grew"}, "confidence": "high",
            "status": "active", "version": 1, "layer": "category", "decision": "d_PIN", "licence": "open",
            "origin": f"fact://category/drinks.nolo/market.value_growth_yoy@{fid}", **extra}


def corrected():
    """24% replaced by a person's 9%, as review.rs correct_fact leaves the members."""
    return [pin(OLD, 0.24, replaced_by={"fact_id": NEW, "decision": "d_CORRECT"}),
            pin(NEW, 0.09, decision="d_CORRECT", sources=["src_person"], confidence="medium")]


def test_current_facts_leaves_out_replaced_superseded_and_rejected_rows():
    rows = corrected() + [pin("f_SUPERSEDED1", 1, status="superseded"),
                          pin("f_REJECTED01", 2, status="rejected"), pin("f_PLAIN0001", 3)]
    clan = {"facts": {"facts": rows}}
    assert [f["id"] for f in current_facts(clan)] == [NEW, "f_PLAIN0001"]
    assert len(ctx_facts(clan)) == 5, "lookups still see every row"


def test_a_planned_brief_drafts_from_the_correction_alone(tmp_path):
    seen = {}
    s = Server(tmp_path, model=planned_model(seen), retrieval=retrieval(), jev=HeldJev(),
               settings_kw={"brief_flow": "planned", "brief_research_max": 3, "brief_judge": "review"})
    try:
        host = Host()
        host.facts = corrected()
        host.sources = [{"id": "src_bordbia", "uri": "https://www.bordbia.ie/nolo", "publisher": "Bord Bia",
                         "title": "No/low", "tier": "primary", "domain": "bordbia.ie", "licence": "open"},
                        {"id": "src_person", "uri": "human:u_aoife", "publisher": "Aoife",
                         "title": "a person's correction", "tier": "reviewer-verified", "domain": "napkin",
                         "licence": "open"}]
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    for call in ("plan", "draft"):
        ids = {f["id"] for f in seen[call]["facts"]}
        assert NEW in ids, f"{call}: the person's value reaches the model"
        assert OLD not in ids, f"{call}: the replaced value never does"


def test_research_and_synthesis_read_the_correction_alone():
    clan = {"facts": {"facts": corrected()}}
    assert [f["id"] for f in research_view(clan, {})["facts"]] == [NEW]
    assert [f["id"] for f in usable_pins(clan)] == [NEW]


# The places that may read every fact row: they look a row up by id, check for duplicates, copy the
# whole document, or hash it. Anything else that reads facts hands them to a model and must use
# current_facts. A new caller of ctx_facts fails here until it is one or the other.
LOOKUPS = {
    ("napkin/doc.py", "current_facts"),                 # the definition
    ("napkin/handlers/correct_fact.py", "run"),         # refuses a second correction by replaced_by
    ("napkin/pipeline/reconsider.py", "run"),           # looks the fact up by id
    ("napkin/pipeline/reconsider.py", "validate"),      # the fact must exist, replaced or not
    ("napkin/brief/planned.py", "_research"),           # dedup: what is held, by id and measure
    ("napkin/pipeline/research.py", "merge"),           # dedup: what is held, by id and measure
    ("napkin/pipeline/campaign.py", "sync"),            # the whole document, copied
    ("napkin/pipeline/campaign.py", "working_clan"),    # the whole document, copied
    ("napkin/pipeline/ask.py", "run"),                  # the whole document, copied for the researcher
    ("napkin/pipeline/report.py", "based_on"),          # the facts hash: every row
}


def test_only_lookups_read_every_fact_row():
    root = Path(__file__).resolve().parents[1]
    found = set()
    for path in sorted((root / "napkin").rglob("*.py")):
        tree = ast.parse(path.read_text(), str(path))
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for node in ast.walk(fn):
                if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ctx_facts":
                    found.add((str(path.relative_to(root)), fn.name))
    unexpected = found - LOOKUPS
    assert not unexpected, f"these read every fact row, replaced ones included; use current_facts: {sorted(unexpected)}"
