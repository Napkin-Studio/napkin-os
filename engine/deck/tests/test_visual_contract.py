"""The deck visual contract (docs/contracts/deck-visuals.md, ADR 0036) holds.

Schemas, examples, vocabulary tuples and rules only: nothing here runs a stage, a renderer or a model. jsonschema is imported
plainly, so a missing dependency is an error and never a silent skip. Run from ``engine/``:
``PYTHONPATH=. python3 -m pytest -q deck/tests/test_visual_contract.py``.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import jsonschema
import yaml
from jsonschema import Draft7Validator

from deck import spec, theme

DECK = Path(__file__).resolve().parents[1]
ROOT = DECK.parents[1]
SCHEMAS = DECK / "schemas"
EXAMPLES = SCHEMAS / "examples"
DECK_SCHEMA = json.loads((DECK / "deck.schema.json").read_text())
TEMPLATE_DIR = ROOT / "app" / "templates" / "deck-maker"
TEMPLATE = json.loads((TEMPLATE_DIR / "schema.json").read_text())
FIX = Path(__file__).parent / "fixtures"
NAMES = ("layout", "issue", "golden", "repair_policy", "visual_rubric")


def _schema(name: str) -> dict:
    return json.loads((SCHEMAS / f"{name}.schema.json").read_text())


def _errors(schema: dict, doc) -> list:
    return list(Draft7Validator(schema).iter_errors(doc))


def _walk(node, path=()):
    """Yield (path, dict) for every dict in a schema or document."""
    if isinstance(node, dict):
        yield path, node
        for k, v in node.items():
            yield from _walk(v, path + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, path + (i,))


def _resolve(node, root):
    """A copy of ``node`` with every local $ref replaced by what it points at."""
    if isinstance(node, dict):
        if "$ref" in node:
            target = root
            for part in node["$ref"].lstrip("#/").split("/"):
                target = target[part]
            return _resolve(target, root)
        return {k: _resolve(v, root) for k, v in node.items()}
    if isinstance(node, list):
        return [_resolve(v, root) for v in node]
    return node


def _enum(schema_node: dict) -> tuple:
    return tuple(schema_node["enum"])


# ------------------------------------------------------------------------------------------------ schemas are valid draft-07

def test_every_schema_is_valid_draft07():
    for name in NAMES:
        Draft7Validator.check_schema(_schema(name))
    Draft7Validator.check_schema(DECK_SCHEMA)
    Draft7Validator.check_schema(TEMPLATE)


# ------------------------------------------------------------------------------------------------ examples

#: Where each invalid example breaks, so it fails for the reason its file name states: (validator keyword, path suffix).
INVALID = {
    "layout.invalid_unknown_slot_kind": ("enum", ("slots", "picture", "kind")),
    "issue.invalid_severity_unknown": ("enum", ("severity",)),
    "golden.invalid_source_not_invented": ("const", ("source", "kind")),
    "repair_policy.invalid_rounds_over_two": ("maximum", ("max_rounds",)),
    "visual_rubric.invalid_critic_blocker": ("enum", ("per_slide", 0, "severity_if_fail")),
}


def test_each_schema_has_one_valid_and_one_invalid_example():
    for name in NAMES:
        assert [p.name for p in EXAMPLES.glob(f"{name}.valid.json")] == [f"{name}.valid.json"]
        assert len(list(EXAMPLES.glob(f"{name}.invalid_*.json"))) == 1, name
    assert len(list(EXAMPLES.glob("*.json"))) == 2 * len(NAMES)


def test_valid_examples_pass_and_invalid_ones_fail_for_the_reason_in_their_name():
    for name in NAMES:
        schema = _schema(name)
        assert _errors(schema, json.loads((EXAMPLES / f"{name}.valid.json").read_text())) == [], name
    for stem, (keyword, suffix) in INVALID.items():
        schema = _schema(stem.split(".")[0])
        errs = _errors(schema, json.loads((EXAMPLES / f"{stem}.json").read_text()))
        assert [(e.validator, tuple(e.absolute_path)[-len(suffix):]) for e in errs] == [(keyword, suffix)], (stem, [e.message for e in errs])


# ------------------------------------------------------------------------------------------------ vocabulary parity (spec.py = schema enums)

def test_slot_and_layout_vocabulary_equals_the_layout_schema():
    s = _schema("layout")
    slot = s["definitions"]["slot"]["properties"]
    assert _enum(s["properties"]["group"]) == spec.LAYOUT_GROUPS
    assert _enum(s["properties"]["purpose"]) == spec.LAYOUT_PURPOSES
    assert _enum(s["properties"]["density"]) == spec.DENSITY_LEVELS
    assert _enum(slot["kind"]) == spec.SLOT_KINDS
    assert _enum(slot["role"]) == spec.TYPE_ROLES
    assert tuple(slot["chart"]["properties"]["types"]["items"]["enum"]) == spec.CHART_TYPES
    assert tuple(slot["from_blocks"]["items"]["enum"]) == spec.BLOCK_KINDS
    assert tuple(s["properties"]["when"]["properties"]["blocks_any"]["items"]["enum"]) == spec.BLOCK_KINDS
    img = slot["image"]["properties"]
    assert _enum(img["aspect"]) == spec.IMAGE_ASPECTS and tuple(img["kinds"]["items"]["enum"]) == spec.IMAGE_KINDS
    assert _enum(img["fit"]) == spec.IMAGE_FITS
    assert s["properties"]["id"]["pattern"] == spec.LAYOUT_ID_PATTERN
    for lid in spec.LAYOUT_IDS:
        assert re.match(spec.LAYOUT_ID_PATTERN, lid), lid
    assert len(spec.LAYOUT_IDS) == 25 <= spec.LAYOUT_MAX and spec.LAYOUT_FLOW not in spec.LAYOUT_IDS
    assert set(spec.TYPE_ROLE_SCALE) == set(spec.TYPE_ROLES)
    assert set(spec.TYPE_ROLE_SCALE.values()) <= set(theme.Scale.__dataclass_fields__)


def test_slide_record_vocabulary_equals_the_deck_schema():
    slide = DECK_SCHEMA["definitions"]["slide"]["properties"]
    layout = slide["layout"]["properties"]
    assert _enum(layout["chosen_by"]) == spec.LAYOUT_CHOSEN_BY
    assert _enum(layout["fit"]["properties"]["rung"]) == spec.FIT_RUNGS
    kinds = {}
    for branch in slide["slots"]["additionalProperties"]["oneOf"]:
        kinds[branch["properties"]["kind"]["const"]] = branch
    assert tuple(kinds) == spec.SLOT_KINDS
    assert tuple(DECK_SCHEMA["definitions"]["block"]["properties"]["kind"]["enum"]) == spec.BLOCK_KINDS
    img = DECK_SCHEMA["definitions"]["image_slot"]["properties"]
    assert _enum(img["kind"]) == spec.IMAGE_KINDS and _enum(img["status"]) == spec.IMAGE_STATUSES
    assert _enum(img["aspect"]) == spec.IMAGE_ASPECTS and _enum(img["fit"]) == spec.IMAGE_FITS
    assert _enum(img["from"]["properties"]["kind"]) == spec.IMAGE_SOURCES
    assert _enum(img["approval"]["properties"]["decision"]) == spec.IMAGE_DECISIONS
    asset = DECK_SCHEMA["definitions"]["asset"]["properties"]
    assert _enum(asset["mime"]) == spec.IMAGE_MIMES and _enum(asset["rights"]) == spec.IMAGE_RIGHTS
    assert _enum(DECK_SCHEMA["definitions"]["slide"]["properties"]["type"]) == tuple(spec.SLIDE_TYPES)


def test_the_picture_slide_types_are_slide_types_and_never_evidence():
    assert set(spec.PICTURE_SLIDE_TYPES) <= set(spec.SLIDE_TYPES)
    assert not set(spec.PICTURE_SLIDE_TYPES) & {"chart", "insight", "criterion_answer", "traction", "financials", "investment", "measurement", "requirement_trace"}


def test_theme_vocabulary_equals_the_deck_schema_and_theme_py():
    t = DECK_SCHEMA["properties"]["meta"]["properties"]["theme"]["properties"]
    assert spec.COLOR_ROLES == theme.COLOR_FIELDS
    assert tuple(t["colors"]["required"]) == theme.COLOR_FIELDS
    assert set(t["colors"]["properties"]) == set(theme.COLOR_FIELDS) | {"chart"}
    assert set(t["scale"]["properties"]) <= set(theme.Scale.__dataclass_fields__)
    assert _enum(t["source"]) == spec.THEME_SOURCES and _enum(t["logo"]["properties"]["placement"]) == spec.LOGO_PLACEMENTS
    assert _enum(t["accent_use"]) == spec.ACCENT_USES and _enum(t["header_position"]) == spec.HEADER_POSITIONS
    assert t["canvas"]["properties"]["w_in"]["const"] == 13.333 and t["canvas"]["properties"]["h_in"]["const"] == 7.5
    assert spec.COLOR_ROLES == ("ink", "paper", "panel", "rule", "mute", "accent", "accent_ink", "on_dark", "on_dark_mute", "accent_on_dark")


def test_issue_vocabulary_equals_the_issue_schema_and_policy():
    i = _schema("issue")["properties"]
    assert _enum(i["source"]) == spec.ISSUE_SOURCES and _enum(i["level"]) == spec.ISSUE_LEVELS
    assert _enum(i["severity"]) == spec.ISSUE_SEVERITIES and _enum(i["status"]) == spec.ISSUE_STATUSES
    assert _enum(i["fix"]["properties"]["kind"]) == spec.ISSUE_FIXES
    assert _enum(i["check"]) == spec.ISSUE_CHECKS
    assert i["round"]["maximum"] == spec.REPAIR_MAX_ROUNDS
    assert set(spec.CHECKS) <= set(spec.ISSUE_CHECKS) and set(spec.QA_RENDER_CHECKS) <= set(spec.ISSUE_CHECKS)
    assert len(spec.CHECKS) == 33 and len(set(spec.ISSUE_CHECKS)) == len(spec.ISSUE_CHECKS)
    # a reserved name must not shadow an existing one except placeholder, which validate and qa_render both raise
    assert (set(spec.CHECKS) & set(spec.QA_RENDER_CHECKS)) == {"placeholder"}
    assert not set(spec.RESERVED_CHECKS) & (set(spec.CHECKS) | set(spec.QA_RENDER_CHECKS))
    assert all(c.startswith("slot_") for c in spec.RESERVED_CHECKS if c.startswith("slot"))
    p = _schema("repair_policy")["properties"]
    assert tuple(p["severity"]["propertyNames"]["enum"]) == spec.ISSUE_CHECKS
    assert tuple(p["ladder"]["items"]["enum"]) == spec.REPAIR_LADDER
    assert tuple(p["shorten"]["properties"]["guards"]["items"]["enum"]) == spec.REPAIR_SHORTEN_GUARDS
    assert _enum(p["images"]["properties"]["on_flag"]) == spec.REPAIR_IMAGE_ON_FLAG
    assert tuple(p["critic"]["properties"]["may_fix"]["items"]["enum"]) == spec.REPAIR_CRITIC_FIXES
    assert p["max_rounds"]["maximum"] == spec.REPAIR_MAX_ROUNDS and p["keep_round_if"]["const"] == spec.REPAIR_KEEP_ROUND_IF
    assert tuple(p["repair_on"]["items"]["enum"]) == spec.ISSUE_SEVERITIES


def test_every_policy_severity_key_and_rubric_confirm_name_is_a_known_check():
    example = json.loads((EXAMPLES / "repair_policy.valid.json").read_text())
    assert set(example["severity"]) <= set(spec.ISSUE_CHECKS)
    rubric = json.loads((EXAMPLES / "visual_rubric.valid.json").read_text())
    for item in rubric["per_slide"] + rubric["per_deck"]:
        assert item.get("confirm_with", spec.CHECKS[0]) in spec.ISSUE_CHECKS
    bad = copy.deepcopy(example)
    bad["severity"]["not_a_check"] = "major"
    assert _errors(_schema("repair_policy"), bad)


def test_rubric_and_golden_vocabulary():
    r = _schema("visual_rubric")["definitions"]["item"]["properties"]
    assert _enum(r["fix"]) == spec.RUBRIC_FIXES and _enum(r["pass_is"]) == spec.RUBRIC_PASS_IS
    assert _enum(r["severity_if_fail"]) == spec.RUBRIC_SEVERITIES and "blocker" not in spec.RUBRIC_SEVERITIES
    assert tuple(r["applies_to"]["properties"]["groups"]["items"]["enum"]) == spec.LAYOUT_GROUPS
    assert tuple(_schema("golden")["properties"]["deck_types"]["items"]["enum"]) == spec.DECK_TYPES
    assert tuple(_schema("golden")["properties"]["slots"]["additionalProperties"]["properties"]["kind"]["enum"]) == spec.SLOT_KINDS


def test_layout_example_names_real_slide_types_and_block_kinds():
    ex = json.loads((EXAMPLES / "layout.valid.json").read_text())
    assert set(ex["for_types"]) <= set(spec.SLIDE_TYPES)
    assert ex["id"] in spec.LAYOUT_IDS and set(ex["alternatives"] + [ex["roomier"], ex["without_image"]]) <= set(spec.LAYOUT_IDS)
    for slot in ex["slots"].values():
        assert set(slot.get("from_blocks", [])) <= set(spec.BLOCK_KINDS)
    golden = json.loads((EXAMPLES / "golden.valid.json").read_text())
    assert golden["slide_type"] in spec.SLIDE_TYPES and golden["layout"] in spec.LAYOUT_IDS
    assert golden["source"]["client"] == "Lumen Water"


# ------------------------------------------------------------------------------------------------ preferences

PREFS = TEMPLATE["properties"]


def test_the_six_preferences_have_defaults_and_their_question_in_the_description():
    look, pics = PREFS["look"]["properties"], PREFS["inputs"]["properties"]["pictures"]["properties"]
    six = {
        "look.pictures": (look["pictures"], "Which slides should carry pictures?", ("on", spec.PICTURES_ON), spec.PICTURES_ON[0]),
        "look.density": (look["density"], "How much text should each slide carry?", ("level", spec.DENSITY_LEVELS), "lean"),
        "look.brand": (look["brand"], "Whose brand should the deck wear?", ("wears", spec.BRAND_WEARS), spec.BRAND_WEARS[0]),
        "look.style_pack": (look["style_pack"], "Which Style Pack should the pictures follow?", ("use", spec.STYLE_PACK_USES), spec.STYLE_PACK_USES[0]),
        "inputs.pictures.source": (pics["source"], "Where may the pictures come from?", ("allow", spec.PICTURE_SOURCES), spec.PICTURE_SOURCES[0]),
        "inputs.pictures.approval": (pics["approval"], "Who approves pictures before a client sees them?", ("approver", spec.PICTURE_APPROVERS), spec.PICTURE_APPROVERS[0]),
    }
    assert len(six) == 6
    for path, (node, question, (field, values), default) in six.items():
        assert question in node["description"], path
        assert node["default"] == {**node["default"], field: default}, path
        assert node["properties"][field]["default"] == default and _enum(node["properties"][field]) == values, path
        for k in ("by", "at", "via"):
            assert k in node["properties"], (path, k)
        assert _enum(node["properties"]["via"]) == spec.PREFERENCE_VIA and node["additionalProperties"] is False
    assert pics["source"]["properties"]["cap_usd"]["default"] == spec.PICTURE_CAP_USD_DEFAULT == 2.5
    assert pics["source"]["properties"]["cap_usd"]["maximum"] == spec.PICTURE_CAP_USD_MAX == 10
    assert pics["approval"]["properties"]["label"]["default"] == spec.PICTURE_LABEL == "Illustrative"
    assert spec.DENSITY_DEFAULTS == {"pitch": "lean", "full": "detailed"}
    assert spec.DENSITY_WORDS == {"lean": 30, "standard": 60}
    assert "leave-behind" in look["density"]["description"]
    assert PREFS["inputs"]["properties"]["text_mode"]["default"] == "condense" and _enum(PREFS["inputs"]["properties"]["text_mode"]) == ("condense", "preserve")
    assert _enum(PREFS["inputs"]["properties"]["format"]) == ("pitch", "full")


def test_a_document_with_no_preference_validates_and_one_with_each_set_by_a_person_validates():
    assert _errors(TEMPLATE, {}) == []
    sample = yaml.safe_load((TEMPLATE_DIR / "example" / "data.yaml").read_text())
    for key in ("look", "review", "qa", "repair"):
        assert key not in sample
    assert "pictures" not in sample["inputs"] and "text_mode" not in sample["inputs"]
    who = {"by": "human:sai", "at": "2026-11-17T10:00:00Z"}
    full = {
        "look": {"pictures": {"on": "custom", "slides": {"s05": True, "s09": False}, **who, "via": "review"},
                 "density": {"level": "standard", **who, "via": "start"}, "brand": {"wears": "co_branded", **who, "via": "question"},
                 "style_pack": {"use": "other", "document_id": "sp_01", **who, "via": "question"},
                 "theme": "brand", "strict_brand": True, "layouts": {"s07": "image_left"}},
        "inputs": {"pictures": {"source": {"allow": "generated", "cap_usd": 4, **who, "via": "start"},
                                "approval": {"approver": "named", "user": "human:laurence", "label": "Draft picture", **who, "via": "review"}},
                   "text_mode": "preserve", "library": {"enabled": True}},
        "review": {"pinned": {"s03": {"by": "human:sai", "at": "2026-11-17"}},
                   "images": {"s05": {"picture": {"asset": "img_0123456789ab", "decision": "approve", "by": "human:sai", "at": "2026-11-17", "note": "ok"}}}},
    }
    assert _errors(TEMPLATE, full) == []
    answered = {"intake": {"answers": {"q_pref_density": {"option_id": "lean", "at": "2026-11-17", "by": "human:sai"}},
                           "questions": [{"id": "q_pref_density", "kind": "preference", "address": "look.density", "skippable": True}]}}
    assert _errors(TEMPLATE, answered) == []


def test_bad_preference_values_are_refused():
    def bad(doc):
        return bool(_errors(TEMPLATE, doc))
    assert bad({"inputs": {"pictures": {"approval": {"label": "Draft 2"}}}})            # a digit in the label
    assert bad({"inputs": {"pictures": {"approval": {"label": ""}}}})
    assert bad({"inputs": {"pictures": {"approval": {"label": "x" * 31}}}})
    assert bad({"inputs": {"pictures": {"source": {"cap_usd": 11}}}})                   # a cap over 10
    assert bad({"inputs": {"pictures": {"source": {"cap_usd": -1}}}})
    assert bad({"inputs": {"pictures": {"source": {"allow": "anything"}}}})
    assert bad({"look": {"pictures": {"on": "everywhere"}}})                            # an unknown pictures.on value
    assert bad({"look": {"density": {"level": "airy"}}})
    assert bad({"look": {"pictures": {"on": "creative", "via": "email"}}})
    assert bad({"look": {"pictures": {"on": "creative", "by": "sai"}}})                 # by is human:<id>
    assert bad({"look": {"surprise": 1}})
    assert bad({"look": {"layouts": {"slide7": "cards"}}})
    assert bad({"review": {"images": {"s05": {"picture": {"asset": "not_an_asset", "decision": "approve", "by": "x", "at": "y"}}}}})
    assert bad({"review": {"images": {"s05": {"picture": {"asset": "img_0123456789ab", "decision": "maybe", "by": "x", "at": "y"}}}}})
    assert bad({"review": {"pinned": {"s03": {"by": "human:sai"}}}})
    assert bad({"repair": {"rounds": [{}, {}, {}]}})
    assert bad({"qa": {"issues": {"not_an_issue_id": {}}}})
    assert bad({"intake": {"questions": [{"kind": "surprise"}]}})


# ------------------------------------------------------------------------------------------------ the rules of section 2.0

NEW_KEYS = {"layout", "slots", "pinned", "assets", "theme", "repair_policy", "preferences", "look", "review", "qa", "repair", "pictures", "text_mode"}


def test_x_clan_appearance_is_on_look_and_nowhere_else():
    marks = [path for path, node in _walk(TEMPLATE) if "x-clan-appearance" in node]
    assert marks == [("properties", "look")]
    assert TEMPLATE["properties"]["look"]["x-clan-appearance"] is True
    assert "x-clan-appearance" not in TEMPLATE["properties"]["inputs"]["properties"]["pictures"]
    assert "x-clan-appearance" not in TEMPLATE["properties"]["review"]
    assert not [p for p, n in _walk(DECK_SCHEMA) if "x-clan-appearance" in n]
    assert TEMPLATE["properties"]["look"]["additionalProperties"] is False


def test_collections_are_objects_keyed_by_id_never_arrays():
    sid = r"^s[0-9]{2,3}$"
    slide = DECK_SCHEMA["definitions"]["slide"]["properties"]
    tslide = TEMPLATE["properties"]["deck"]["properties"]["slides"]["additionalProperties"]["properties"]
    tdeck = TEMPLATE["properties"]["deck"]["properties"]
    cases = {
        "slots (engine)": (slide["slots"], r"^[a-z][a-z0-9_]{1,23}$"),
        "slots (template)": (tslide["slots"], r"^[a-z][a-z0-9_]{1,23}$"),
        "assets (engine)": (DECK_SCHEMA["properties"]["assets"], r"^img_[0-9a-f]{12}$"),
        "assets (template)": (tdeck["assets"], r"^img_[0-9a-f]{12}$"),
        "qa.issues": (TEMPLATE["properties"]["qa"]["properties"]["issues"], r"^i_[0-9a-f]{8}$"),
        "review.pinned": (PREFS["review"]["properties"]["pinned"], sid),
        "review.images": (PREFS["review"]["properties"]["images"], sid),
        "review.images.<slide>": (PREFS["review"]["properties"]["images"]["additionalProperties"], r"^[a-z][a-z0-9_]{1,23}$"),
        "look.layouts": (PREFS["look"]["properties"]["layouts"], sid),
        "look.pictures.slides": (PREFS["look"]["properties"]["pictures"]["properties"]["slides"], sid),
    }
    for name, (node, pattern) in cases.items():
        assert node["type"] == "object" and "items" not in node, name
        assert node["propertyNames"]["pattern"] == pattern, name
        assert "additionalProperties" in node and node["additionalProperties"] is not False, name
    # the deck's own maps stay keyed by id too
    assert DECK_SCHEMA["properties"]["slides"]["type"] == "object" and DECK_SCHEMA["properties"]["requirements"]["type"] == "object"


def test_no_asset_id_can_be_read_as_a_ref_and_a_picture_is_never_evidence():
    ref = re.compile(DECK_SCHEMA["definitions"]["ref"]["pattern"])
    asset_id = DECK_SCHEMA["properties"]["assets"]["propertyNames"]["pattern"]
    assert asset_id == r"^img_[0-9a-f]{12}$"
    assert not ref.match("img_0123456789ab")
    assert DECK_SCHEMA["definitions"]["ref"]["pattern"] == r"^(f_|fi_|doc:|brief:|req:|calc:|prompt:|answer:)"
    for prefix in ("img_", "asset:", "image:"):
        assert not ref.match(prefix + "0123456789ab")
    deck = _minimal_deck()
    deck["slides"]["s01"]["blocks"][0]["refs"] = ["img_0123456789ab"]
    assert _errors(DECK_SCHEMA, deck)


def test_requirements_and_issue_ids_match_their_documented_forms():
    issue = _schema("issue")["properties"]
    assert issue["id"]["pattern"] == r"^i_[0-9a-f]{8}$" and issue["slide"]["pattern"] == r"^(s[0-9]{2,3}|deck)$"
    assert DECK_SCHEMA["properties"]["order"]["items"]["pattern"] == r"^s[0-9]{2,3}$"
    assert _schema("golden")["properties"]["id"]["pattern"] == r"^g_[a-z0-9_]{3,40}$"
    assert _schema("visual_rubric")["definitions"]["item"]["properties"]["id"]["pattern"] == r"^v_[a-z_]{3,30}$"


# ------------------------------------------------------------------------------------------------ additive only

#: The schema errors each fixture had on develop before this change, measured: lumen_water 0; investor_seed 3 (one stats block
#: kind, now in the enum, and two ``basis: null``, now ``opinion``: the slice's one approved engine change, Sai 2026-11-17).
def _deck_errors(deck: dict) -> list:
    deck = {**deck}
    deck.setdefault("territories", {})
    deck.setdefault("scoring", [])
    return [(tuple(e.absolute_path), e.message) for e in _errors(DECK_SCHEMA, deck)]


def test_every_golden_deck_has_no_more_schema_errors_than_before():
    lumen = json.loads((FIX / "lumen_water" / "golden_deck.json").read_text())
    assert _deck_errors(lumen) == []
    investor = json.loads((FIX / "types" / "investor_seed" / "golden_deck.json").read_text())
    errs = _deck_errors(investor)
    assert not [e for e in errs if "stats" in e[1]], "stats is in the block kind enum now"
    assert errs == []


def test_the_sample_deck_and_every_state_fixture_still_validate():
    for f in [TEMPLATE_DIR / "example" / "data.yaml", *sorted((TEMPLATE_DIR / "example" / "states").glob("*.yaml"))]:
        data = yaml.safe_load(f.read_text())
        assert _errors(TEMPLATE, data) == [], f.name
    sample = yaml.safe_load((TEMPLATE_DIR / "example" / "data.yaml").read_text())["deck"]
    assert _deck_errors({k: v for k, v in sample.items() if k not in ("appendix_count", "appendix_ids")}) == []


def test_no_added_key_is_required_and_no_existing_enum_lost_a_value():
    for name, schema in (("deck", DECK_SCHEMA), ("template", TEMPLATE)):
        for path, node in _walk(schema):
            if isinstance(node.get("required"), list) and path and path[-1] == "required":
                continue
            for key in node.get("required", []) if isinstance(node.get("required"), list) else []:
                assert key not in NEW_KEYS, (name, path, key)
    assert DECK_SCHEMA["required"] == ["meta", "slides", "order"]
    assert DECK_SCHEMA["properties"]["meta"]["required"] == ["client", "project", "kind"]
    assert DECK_SCHEMA["definitions"]["slide"]["required"] == ["type", "section", "title", "blocks", "claims", "visual", "status", "requirements"]
    assert TEMPLATE.get("required") is None and TEMPLATE["properties"]["deck"].get("required") is None
    kinds_before = {"text", "small", "statement", "quote", "callout", "card", "bullets", "table", "kv", "fromto", "steps", "chart", "sketch", "copy"}
    assert kinds_before < set(DECK_SCHEMA["definitions"]["block"]["properties"]["kind"]["enum"])
    for old in ({"sourced", "creative", "opinion", "proposal", "meta"},):
        assert set(DECK_SCHEMA["definitions"]["block"]["properties"]["basis"]["enum"]) == old
    assert set(DECK_SCHEMA["definitions"]["claim"]["properties"]["basis"]["enum"]) == {"sourced", "creative", "opinion", "proposal"}
    assert set(DECK_SCHEMA["definitions"]["slide"]["properties"]["status"]["enum"]) == set(spec.STATUSES)
    assert {"ask", "supply"} < set(TEMPLATE["properties"]["intake"]["properties"]["questions"]["items"]["properties"]["kind"]["enum"])
    # no additionalProperties: false on an object that exists today
    for path in (("properties",), ("properties", "meta"), ("definitions", "slide"), ("definitions", "block"), ("definitions", "claim")):
        node = DECK_SCHEMA
        for p in path:
            node = node[p] if p in node else node
        assert node.get("additionalProperties") is not False, path
    assert "additionalProperties" not in DECK_SCHEMA and DECK_SCHEMA["definitions"]["slide"].get("additionalProperties") is None
    assert TEMPLATE.get("additionalProperties") is None
    assert TEMPLATE["properties"]["inputs"].get("additionalProperties") is None


def _minimal_deck() -> dict:
    block = {"kind": "text", "text": "A line", "basis": "creative"}
    slide = {"type": "title", "section": "Opening", "title": "A title", "blocks": [block], "claims": [], "visual": {"kind": "layout"},
             "status": "drafted", "requirements": []}
    return {"meta": {"client": "Lumen Water", "project": "Refill", "kind": "pitch"}, "order": ["s01"], "slides": {"s01": copy.deepcopy(slide)}}


def test_an_older_deck_validates_and_a_slide_with_the_new_fields_validates():
    deck = _minimal_deck()
    assert _errors(DECK_SCHEMA, deck) == []
    new = copy.deepcopy(deck)
    new["slides"]["s01"].update(
        layout={"id": "cover_image", "version": 1, "chosen_by": "rule", "alternatives": ["cover"], "why": "A cover with a picture.",
                "fit": {"rung": "as_is", "scale": 1.0, "relaxed": False}, "blocks_sha": "0123456789ab"},
        slots={"title": {"kind": "text", "text": "A title", "blocks": [], "words": 2},
               "subline": {"kind": "text", "text": "A line", "blocks": [0], "basis": "creative", "chars": 6},
               "points": {"kind": "list", "items": [{"text": "One", "refs": ["prompt:1"]}]},
               "stats": {"kind": "stat", "items": [{"value": "12", "text": "farms", "refs": ["prompt:3"]}]},
               "grid": {"kind": "table", "rows": [["a", "b"], ["c", "d"]]},
               "copy": {"kind": "copy", "lines": ["Line one"], "answer": "Because"},
               "picture": {"kind": "image", "image": {"kind": "frame", "status": "made", "aspect": "16:9", "asset": "img_0123456789ab",
                                                      "from": {"kind": "territory_frame", "key": "t1-a-flash", "run": "0123456789ab"},
                                                      "approval": None, "guards": {"no_text": True, "no_logos": True}}}},
        pinned=True)
    new["assets"] = {"img_0123456789ab": {"sha256": "0" * 64, "file": "assets/x.png", "mime": "image/png", "width": 1920, "height": 1080,
                                         "rights": "own", "guard": {"checked": False, "by": "not checked"}}}
    new["meta"]["theme"] = {"name": "napkin", "source": "default", "colors": {r: "0A0A0A" for r in spec.COLOR_ROLES},
                            "fonts": {"head": "Inter", "body": "Inter"}, "scale": {"display": 44, "title": 36}, "grid": {"margin_in": 0.65}}
    new["meta"]["repair_policy"] = json.loads((EXAMPLES / "repair_policy.valid.json").read_text())
    new["meta"]["preferences"] = {"density": {"level": "lean", "source": "default"}, "picture_source": {"allow": "existing", "cap_usd": 2.5, "source": "default"}}
    assert _errors(DECK_SCHEMA, new) == [], [e.message for e in _errors(DECK_SCHEMA, new)]
    # and the new fields are checked
    for mutate in (lambda d: d["slides"]["s01"]["slots"].update(picture={"kind": "image", "image": {"kind": "video", "status": "made", "aspect": "16:9"}}),
                   lambda d: d["slides"]["s01"]["slots"].update(x={"kind": "text"}),
                   lambda d: d["slides"]["s01"]["slots"].update(Bad_Name={"kind": "text", "text": "a"}),
                   lambda d: d["slides"]["s01"]["layout"].update(chosen_by="model"),
                   lambda d: d["slides"]["s01"]["layout"].update(blocks_sha="short"),
                   lambda d: d["slides"]["s01"]["slots"].update(l={"kind": "list", "items": [{"text": "x"}] * 9}),
                   lambda d: d["assets"].update(bad_id={}),
                   lambda d: d["assets"]["img_0123456789ab"].update(rights="stolen"),
                   lambda d: d["meta"]["theme"]["colors"].update(ink="red"),
                   lambda d: d["meta"]["theme"]["colors"].pop("ink"),
                   lambda d: d["meta"]["repair_policy"].update(max_rounds=3)):
        bad = copy.deepcopy(new)
        mutate(bad)
        assert _errors(DECK_SCHEMA, bad), mutate


# ------------------------------------------------------------------------------------------------ the template mirrors the engine schema

def test_the_template_mirror_equals_the_engine_schema_with_refs_inlined():
    slide = _resolve(DECK_SCHEMA["definitions"]["slide"]["properties"], DECK_SCHEMA)
    tslide = TEMPLATE["properties"]["deck"]["properties"]["slides"]["additionalProperties"]["properties"]
    for key in ("layout", "slots", "pinned"):
        assert tslide[key] == slide[key], key
    assert TEMPLATE["properties"]["deck"]["properties"]["assets"] == _resolve(DECK_SCHEMA["properties"]["assets"], DECK_SCHEMA)
    meta, tmeta = DECK_SCHEMA["properties"]["meta"]["properties"], TEMPLATE["properties"]["deck"]["properties"]["meta"]["properties"]
    for key in ("theme", "repair_policy", "preferences"):
        assert tmeta[key] == _resolve(meta[key], DECK_SCHEMA), key
    # the stamped policy is the engine-data policy schema, and the template's issue is the issue schema
    pol = {k: v for k, v in _schema("repair_policy").items() if k not in ("$schema", "title")}
    assert meta["repair_policy"] == pol
    iss = {k: v for k, v in _schema("issue").items() if k not in ("$schema", "title")}
    assert TEMPLATE["properties"]["qa"]["properties"]["issues"]["additionalProperties"] == iss
    assert not [p for p, n in _walk(TEMPLATE) if "$ref" in n], "the template schema has no definitions, so no $ref"


# ------------------------------------------------------------------------------------------------ the template schema's keywords

#: Keywords the app's own checker (app/tests/deckMakerFixtures.test.ts) reads, and annotations that check nothing. A keyword outside
#: both lists would pass unchecked in the frontend test, so the template schema may not use it.
CHECKED = {"type", "enum", "required", "properties", "additionalProperties", "items", "maxItems", "oneOf", "const", "pattern",
           "minimum", "maximum", "minItems", "minLength", "maxLength", "propertyNames", "default", "uniqueItems", "if", "then"}
ANNOTATIONS = {"$schema", "title", "description", "$comment", "x-clan-appearance"}


def test_the_template_schema_uses_only_keywords_the_frontend_checker_reads():
    used = set()
    schema_nodes = []

    def visit(node, is_schema):
        if isinstance(node, dict) and is_schema:
            schema_nodes.append(node)
            for k, v in node.items():
                used.add(k)
                if k in ("properties",):
                    for sub in v.values():
                        visit(sub, True)
                elif k in ("additionalProperties", "items", "propertyNames", "if", "then"):
                    visit(v, isinstance(v, dict))
                elif k == "oneOf":
                    for sub in v:
                        visit(sub, True)
    visit(TEMPLATE, True)
    assert used <= CHECKED | ANNOTATIONS, used - CHECKED - ANNOTATIONS


def test_template_version_is_0_3_0_in_the_packer():
    text = (ROOT / "crates" / "clan-sdk" / "examples" / "make_deck_maker.rs").read_text()
    assert 'version: "0.3.0".into()' in text and 'assert_eq!(app_block.version, "0.3.0"' in text
    assert "0.2.1" not in text


def test_investor_golden_statements_have_a_basis_and_validate_clean():
    """The slice's one noted exception to "no behaviour change" (Sai, 2026-11-17): an unreferenced investor statement is opinion."""
    from deck import validate
    from deck.inputs import load
    golden = json.loads((FIX / "types" / "investor_seed" / "golden_deck.json").read_text())
    statements = [b for s in golden["slides"].values() for b in s["blocks"] if b["kind"] == "statement"]
    assert statements and all(b.get("basis") is not None for b in statements)
    assert {s["type"]: b["basis"] for s in golden["slides"].values() for b in s["blocks"] if b["kind"] == "statement"} == {"problem": "opinion", "ask": "opinion"}
    inp = load(None, prompt_text=(FIX / "types" / "investor_seed" / "prompt.txt").read_text().strip())
    assert validate.run(golden, inp) == json.loads((FIX / "types" / "investor_seed" / "golden_validation.json").read_text()) == []


# ------------------------------------------------------------------------------------------------ review findings

def _slot_image(**kw) -> dict:
    img = {"kind": "frame", "status": "made", "aspect": "16:9", "asset": "img_0123456789ab"}
    img.update(kw)
    return {"meta": {"client": "Lumen Water", "project": "Refill", "kind": "pitch"}, "order": ["s01"],
            "slides": {"s01": {**_minimal_deck()["slides"]["s01"], "slots": {"picture": {"kind": "image", "image": img}}}}}


def _approval(**kw) -> dict:
    a = {"asset": "img_0123456789ab", "decision": "approve", "by": "human:sai", "at": "2026-11-17T10:00:00Z"}
    a.update(kw)
    return a


def _image_slot_schemas():
    tpl = TEMPLATE["properties"]["deck"]["properties"]["slides"]["additionalProperties"]["properties"]["slots"]["additionalProperties"]["oneOf"]
    return {"deck": DECK_SCHEMA, "template": None, "tpl_image": next(b for b in tpl if b["properties"]["kind"]["const"] == "image")["properties"]["image"]}


def test_an_approved_picture_needs_a_real_approval_by_a_person():
    """Finding 1. JSON Schema cannot say approval.asset equals the slot's asset: that equality is checked below, in code."""
    ok = _slot_image(status="approved", approval=_approval())
    assert _errors(DECK_SCHEMA, ok) == []
    for img in (dict(status="approved"), dict(status="approved", approval=None), dict(status="approved", approval=_approval(decision="remove")),
                dict(status="approved", approval=_approval(decision="replace")), dict(status="approved", approval=_approval(by="")),
                dict(status="approved", approval=_approval(at="")), dict(status="approved", approval={"asset": "img_0123456789ab", "decision": "approve"})):
        assert _errors(DECK_SCHEMA, _slot_image(**img)), img
    # the other statuses stay free of an approval, and a made slot may carry a null one
    assert _errors(DECK_SCHEMA, _slot_image(status="made", approval=None)) == []
    assert _errors(DECK_SCHEMA, _slot_image(status="flagged")) == []
    assert _errors(_image_slot_schemas()["tpl_image"], {"kind": "frame", "status": "approved", "aspect": "16:9", "asset": "img_0123456789ab"})
    assert _errors(_image_slot_schemas()["tpl_image"], {"kind": "frame", "status": "approved", "aspect": "16:9", "asset": "img_0123456789ab", "approval": _approval()}) == []


def approval_matches_asset(image: dict) -> bool:
    """The rule a schema cannot state: an approval is for one picture, so an approved slot's approval names its own asset."""
    return image.get("status") != "approved" or (image.get("approval") or {}).get("asset") == image.get("asset")


def test_an_approval_names_the_slots_own_asset():
    assert approval_matches_asset(_slot_image(status="approved", approval=_approval())["slides"]["s01"]["slots"]["picture"]["image"])
    mismatched = _slot_image(status="approved", approval=_approval(asset="img_ffffffffffff"))["slides"]["s01"]["slots"]["picture"]["image"]
    assert not approval_matches_asset(mismatched)
    assert "approval.asset" in (ROOT / "docs" / "contracts" / "deck-visuals.md").read_text()


def test_a_picture_is_creative_and_the_label_is_derived_not_stored():
    """Finding 2."""
    assert _errors(DECK_SCHEMA, _slot_image(basis="creative")) == []
    for basis in ("sourced", "opinion", "proposal", "meta", None):
        assert _errors(DECK_SCHEMA, _slot_image(basis=basis)), basis
    assert _errors(DECK_SCHEMA, _slot_image(label="Illustrative"))          # no stored label field
    doc = (ROOT / "docs" / "contracts" / "deck-visuals.md").read_text()
    assert "status != approved" in doc and "no stored label" in doc


def test_review_entries_are_attributed_to_a_person_and_closed():
    """Finding 3."""
    review = TEMPLATE["properties"]["review"]["properties"]
    entry = {"by": "human:sai", "at": "2026-11-17"}
    ok = {"review": {"pinned": {"s03": entry}, "images": {"s05": {"picture": {"asset": "img_0123456789ab", "decision": "approve", **entry}}}}}
    assert _errors(TEMPLATE, ok) == []
    pins = lambda e: {"review": {"pinned": {"s03": e}}}
    imgs = lambda e: {"review": {"images": {"s05": {"picture": {"asset": "img_0123456789ab", "decision": "approve", **e}}}}}
    for e in ({"by": "", "at": "x"}, {"by": "sai", "at": "x"}, {"by": "human:", "at": "x"}, {"by": "human:sai", "at": ""}, {**entry, "extra": 1}):
        assert _errors(TEMPLATE, pins(e)), e
        assert _errors(TEMPLATE, imgs(e)), e
    assert _errors(TEMPLATE, {"review": {"images": {"s05": {"picture": {"asset": "img_0123456789ab", "decision": "approve", **entry}, "Bad": {}}}}})
    assert review["pinned"]["additionalProperties"]["additionalProperties"] is False
    # a named approver must say who
    approval = lambda **kw: {"inputs": {"pictures": {"approval": kw}}}
    assert _errors(TEMPLATE, approval(approver="named"))
    assert _errors(TEMPLATE, approval(approver="named", user="human:laurence")) == []
    assert _errors(TEMPLATE, approval(approver="owner")) == []
    # the stamp on the deck's own approval says who and when too
    assert _errors(DECK_SCHEMA, _slot_image(status="made", approval=_approval(by="sai")))


def test_qa_and_repair_are_closed_and_later_slices_are_told_to_enforce_the_stamps():
    """Finding 4: no fixture or app code writes an extra key, so both are closed; the rest is a note for later slices."""
    for node in (TEMPLATE["properties"]["qa"], TEMPLATE["properties"]["qa"]["properties"]["summary"],
                 TEMPLATE["properties"]["repair"], TEMPLATE["properties"]["repair"]["properties"]["rounds"]["items"]):
        assert node["additionalProperties"] is False
    assert _errors(TEMPLATE, {"qa": {"surprise": 1}}) and _errors(TEMPLATE, {"repair": {"rounds": [{"surprise": 1}]}})
    doc = (ROOT / "docs" / "contracts" / "deck-visuals.md").read_text()
    assert "Later slices must enforce" in doc and "models never write `review.*`" in doc.lower()
    assert "runner stamps only" in doc


def test_counts_and_sizes_have_sensible_minimums():
    """Finding 5."""
    img = DECK_SCHEMA["definitions"]["image_slot"]["properties"]
    assert img["target_px"]["items"]["minimum"] == 1
    assert _errors(DECK_SCHEMA, _slot_image(target_px=[0, 1080])) and _errors(DECK_SCHEMA, _slot_image(target_px=[1920, -5]))
    assert _errors(DECK_SCHEMA, _slot_image(target_px=[1920, 1080])) == []
    assert _errors(DECK_SCHEMA, _slot_image(reference_images=["img_0123456789ab"] * 15))
    assert img["reference_images"]["uniqueItems"] is True and _errors(DECK_SCHEMA, _slot_image(reference_images=["img_0123456789ab"] * 2))
    assert _errors(DECK_SCHEMA, _slot_image(attempts=-1))
    made = DECK_SCHEMA["definitions"]["asset"]["properties"]["made"]["properties"]
    assert made["credits"]["minimum"] == 0 and made["usd"]["minimum"] == 0
    summary = TEMPLATE["properties"]["qa"]["properties"]["summary"]["properties"]
    assert all(summary[k]["minimum"] == 0 for k in summary)
    rnd = TEMPLATE["properties"]["repair"]["properties"]["rounds"]["items"]["properties"]
    assert rnd["n"]["minimum"] == 1 and all(rnd[k]["minimum"] == 0 for k in ("fixed", "open", "usd", "seconds"))
    assert TEMPLATE["properties"]["repair"]["properties"]["left_for_person"]["minimum"] == 0
    assert _errors(TEMPLATE, {"repair": {"rounds": [{"n": 0}]}}) and _errors(TEMPLATE, {"qa": {"summary": {"minor": -1}}})


def test_the_golden_slot_handoff_is_recorded():
    """Finding 6: no schema change; slice 4 must validate golden slots against their layout on load, with a test."""
    record = (ROOT / "features" / "deck-visual-contract.clan")
    import subprocess
    text = subprocess.run(["unzip", "-p", str(record), "shared/data.yaml"], capture_output=True, text=True, check=True).stdout
    assert "validate golden slots against their layout on load" in text
    assert "validate golden slots against their layout on load" in (ROOT / "docs" / "contracts" / "deck-visuals.md").read_text()
