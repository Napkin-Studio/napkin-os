"""What the engine hands the host must be what the host's schema takes (production-spinoff live test 2026-11-22: a finished, paid deck was
refused because two appendix tables ran past the schema's row cap and a QA rule id was missing from its enum)."""
from __future__ import annotations

import json
import re
from pathlib import Path

from jsonschema import Draft7Validator

from deck import assemble, profiles, spec
from deck.tests.test_core import TYPES, _brief_inp, _long_doc, _st
from deck import inputs

DECK = Path(__file__).resolve().parents[1]
TEMPLATE = json.loads((DECK.parents[1] / "app" / "templates" / "deck-maker" / "schema.json").read_text())


def _find(node, key, hits=None):
    hits = [] if hits is None else hits
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                hits.append(v)
            _find(v, key, hits)
    elif isinstance(node, list):
        for v in node:
            _find(v, key, hits)
    return hits


def _table_rows_cap() -> int:
    caps = [n["rows"]["maxItems"] for n in _find(TEMPLATE, "properties") if isinstance(n.get("kind"), dict) and n["kind"].get("const") == "table" and "rows" in n]
    assert caps
    return min(caps)


def _tables(deck):
    return [(sid, b) for sid in deck["order"] for b in (deck["slides"][sid] or {}).get("blocks", []) if b.get("kind") == "table"]


def test_the_long_trace_and_sources_tables_run_on_over_slides_inside_the_schema_cap():
    cap = _table_rows_cap()
    assert assemble.TABLE_DATA_ROWS + 1 <= cap
    inp = inputs.load(None, prompt_text=(TYPES / "tender_response" / "prompt.txt").read_text().strip())
    st = _st(TYPES / "tender_response")
    first = st["a"]["requirements"][0]
    st["a"]["requirements"] = st["a"]["requirements"] + [{**first, "id": f"r{i:03d}", "text": f"Extra requirement {i}"} for i in range(30)]
    deck = assemble.build(_long_doc(inp), st, client="Harbour", project="Recycling", profile=profiles.load("tender_response"))
    trace = [sid for sid in deck["order"] if deck["slides"][sid]["type"] == "requirement_trace"]
    assert len(trace) >= 4 and deck["slides"][trace[1]]["title"].endswith(", continued")
    assert all(len(b["rows"]) <= cap for _, b in _tables(deck))


def test_a_long_sources_list_is_split_into_slides_of_at_most_the_cap():
    cap = _table_rows_cap()

    class R:
        def source_key(self, ref):
            return ref, f"Source {ref}", ""

        def describe(self, ref):
            return ref

    refs = [f"doc:k{i}#p1" for i in range(20)]
    deck = {"order": ["s01"], "slides": {"s01": {"claims": [{"refs": refs}], "blocks": [], "notes": ""}}}
    slides = assemble._sources_slides(deck, R())
    assert len(slides) == 3 and all(len(s["blocks"][0]["rows"]) <= cap for s in slides)
    assert sum(len(s["blocks"][0]["rows"]) - 1 for s in slides) == 20
    assert len(assemble._sources_slides({"order": [], "slides": {}}, R())) == 1   # no source: still one slide


def test_every_check_id_the_engine_emits_is_in_the_host_schemas_rule_enum():
    enums = [n["enum"] for n in _find(TEMPLATE, "check") if isinstance(n, dict) and "enum" in n]
    assert enums
    emitted = set(spec.ISSUE_CHECKS) | set(re.findall(r'_add\(out, "([a-z_0-9]+)"', (DECK / "qa_render.py").read_text())) \
        | set(re.findall(r'\badd\("([a-z_0-9]+)", "(?:error|warn)"', (DECK / "validate.py").read_text()))
    assert "q_no_hole" in emitted
    for enum in enums:
        assert emitted <= set(enum), sorted(emitted - set(enum))
