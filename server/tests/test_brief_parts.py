"""The job, the barrier and the objection to beat: parts the brief writes and Jude judges (ADR 0034's
sibling, feature brief-grid-template). The server's declaration, the template's and the schema must agree."""

import json
import re
from pathlib import Path

import pytest

from napkin.brief import checks
from napkin.brief.fields import ARRAY_KEYS, BUILTIN_FIELD_MAP, KEYS, LABELS, RUBRIC_FIELDS
from napkin.brief.rubric import rubric_value

REPO = Path(__file__).resolve().parents[2]
NEW = ("job", "barrier", "objection")


def test_the_three_parts_are_drafted_fields_in_the_brief_in_reading_order():
    for k in NEW:
        assert k in KEYS and k in LABELS
        assert BUILTIN_FIELD_MAP[k]["class"] == "drafted" and BUILTIN_FIELD_MAP[k]["rubric"] == k
    # the job opens the brief, the barrier follows the background, the objection follows the proposition
    assert KEYS.index("job") < KEYS.index("background") < KEYS.index("barrier")
    assert KEYS.index("single_minded_proposition") < KEYS.index("objection")


def test_every_field_map_rubric_exists_and_the_new_parts_are_required_with_a_limit_and_tests_from_the_skill():
    for k, v in BUILTIN_FIELD_MAP.items():
        if v.get("rubric"):
            assert v["rubric"] in RUBRIC_FIELDS, f"{k} names a rubric the schema does not have"
    for k in NEW:
        f = RUBRIC_FIELDS[k]
        assert f["required"] and f["max_words"] and f["prompt"] and f["good_example"] and f["bad_example"]
        ids = [c["id"] for c in f["rubric"]]
        assert "plain_words" in ids and "within_limit" in ids, "the skill's 'a word a normal person would not say'"
        assert all(c["method"] in ("auto", "llm") for c in f["rubric"])
    # the objection is judged against the proposition it has to be answered by
    assert "smp" in RUBRIC_FIELDS["objection"]["depends_on"]
    assert any(c["id"] == "answered_by_proposition" and c.get("tolerance") == "hard"
               for c in RUBRIC_FIELDS["objection"]["rubric"])


def test_the_values_are_read_from_the_apps_keys():
    vals = {"job": "J", "barrier": "B", "objection": "O"}
    assert [rubric_value(k, vals) for k in NEW] == ["J", "B", "O"]


def test_the_template_declares_the_same_parts():
    schema = json.loads((REPO / "app/templates/brief-maker/schema.json").read_text())
    props = schema["properties"]
    assert all(props[k] == {"type": "string"} for k in NEW)
    text = (REPO / "app/templates/brief-maker/app/pipeline.yaml").read_text()
    declared = dict(re.findall(r"^  ([\w.]+):\s+\{ class: (\w+)", text, re.M))
    assert {k: v["class"] for k, v in BUILTIN_FIELD_MAP.items()} == declared, "pipeline.yaml and fields.py declare one map"
    assert re.search(r"edits: \[[^\]]*\bjob\b[^\]]*\bbarrier\b[^\]]*\bobjection\b", text), "their edits carry reasoning"


# -- the role of each medium and how we will know it worked (feature brief-media-measure) --------------------

LISTS = ("media_roles", "measurement")


def test_both_new_parts_are_drafted_required_lists_in_reading_order_after_the_budget():
    for k in LISTS:
        assert k in KEYS and k in LABELS and k in ARRAY_KEYS
        assert BUILTIN_FIELD_MAP[k]["class"] == "drafted" and BUILTIN_FIELD_MAP[k]["rubric"] == k
        assert BUILTIN_FIELD_MAP[k]["rubric"] in RUBRIC_FIELDS and RUBRIC_FIELDS[k]["required"]
        f = RUBRIC_FIELDS[k]
        ids = {c["id"] for c in f["rubric"]}
        assert {"max_items", "within_limit", "plain_words"} <= ids and f["max_words"] and f["max_items"]
        assert f["prompt"] and f["good_example"] and f["bad_example"]
    assert KEYS.index("budget_and_scope") < KEYS.index("media_roles") < KEYS.index("measurement") < KEYS.index("mandatories")


def test_every_list_or_limited_part_has_the_limits_the_checks_read():
    """The code's limits come from the schema, for every part that has one: nothing is a second copy."""
    for k, v in BUILTIN_FIELD_MAP.items():
        f = RUBRIC_FIELDS.get(v.get("rubric") or "")
        if not f or k not in checks.APP_RUBRIC:
            continue
        assert checks.limit(k) == f.get("max_words") and checks.max_items(k) == f.get("max_items")
    assert checks.max_items("media_roles") == 4 and checks.limit("media_roles") == 55
    assert checks.max_items("measurement") == 5 and checks.limit("measurement") == 70


@pytest.mark.parametrize("k", LISTS)
def test_the_values_are_read_from_the_apps_keys_as_lists(k):
    assert rubric_value(k, {k: ["a", "b"]}) == ["a", "b"], "a list part stays a list for the rubric's item cap"
    assert rubric_value(k, {}) is None


def test_the_template_declares_both_lists_and_their_reasoning():
    schema = json.loads((REPO / "app/templates/brief-maker/schema.json").read_text())
    assert all(schema["properties"][k] == {"type": "array", "items": {"type": "string"}} for k in LISTS)
    text = (REPO / "app/templates/brief-maker/app/pipeline.yaml").read_text()
    for k in LISTS:
        assert re.search(rf"^  {k}:\s+\{{ class: drafted, rubric: {k}, loop: \w+ \}}", text, re.M)
        assert re.search(rf"edits: \[[^\]]*\b{k}\b", text), f"{k} edits carry reasoning"
    # every rubric field with a type of list is an array in the template
    for f in RUBRIC_FIELDS.values():
        if f.get("type") == "list":
            ks = [k for k, v in BUILTIN_FIELD_MAP.items() if v.get("rubric") == f["id"]]
            assert all(k in ARRAY_KEYS for k in ks), f"{f['id']} is a list in the document"
