"""The Runway capability sheet held to what Runway publishes (features/runway-sheet-sync.clan).

Offline: it reads the committed snapshots of openapi.json (tests/fixtures/schemas/runway) and of
guides/pricing.md (tests/fixtures/pricing/runway.json), which scripts/refresh_provider_schemas.py
writes and the weekly runway-sheet-sync workflow re-fetches. Every catalogue model's limits must
equal its schema branch, and every price must have been entered from the verbatim rows it cites.
The same checks refuse a mutated sheet, so they cannot pass by accident. The price vectors in
contracts/examples/pricing-cases.json run here too.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from contracts_dir import contracts_dir, pricing
from providers import load_sheet

FIXTURES = Path(__file__).parent / "fixtures"
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}


def snapshot(endpoint: str) -> dict:
    path = endpoint.split(" ", 1)[-1].strip("/").replace("/", "__")
    return json.loads((FIXTURES / "schemas" / "runway" / f"{path}.json").read_text())


def price_rows() -> dict:
    return json.loads((FIXTURES / "pricing" / "runway.json").read_text())


def branch(endpoint: str, model: str) -> dict | None:
    schema = snapshot(endpoint)["schema"]
    for b in schema.get("oneOf") or schema.get("anyOf") or [schema]:
        if (b.get("properties", {}).get("model") or {}).get("const") == model:
            return b["properties"]
    return None


def tier_by_pixels(ratio: str) -> str:
    w, h = (int(x) for x in ratio.split(":"))
    mp = w * h / 1e6
    return "512" if mp < 0.5 else "1K" if mp < 2 else "2K" if mp < 8 else "4K"


def problems(sheet: dict) -> list[str]:
    """Every way the sheet's catalogue disagrees with the snapshots."""
    out = []
    rows = price_rows()
    credit = rows.get("credit") or ""
    if f"${sheet['usdPerCredit']:g} per credit" not in credit:
        out.append(f"usdPerCredit {sheet['usdPerCredit']} is not what pricing.md says: {credit!r}")
    for name, m in sheet["models"].items():
        if not m.get("endpoint"):
            out.append(f"{name}: no endpoint")
            continue
        p = branch(m["endpoint"], name)
        if p is None:
            out.append(f"{name}: not in the {m['endpoint']} snapshot's oneOf")
            continue
        if "ratios" in m:
            ours = [r["ratio"] for r in m["ratios"]]
            if ours != p.get("ratio", {}).get("enum"):
                out.append(f"{name}: ratios {ours} != the snapshot's {p.get('ratio', {}).get('enum')}")
            for r in m["ratios"]:
                if "tier" in r and r["tier"] != tier_by_pixels(r["ratio"]):
                    out.append(f"{name}: {r['ratio']} is tier {tier_by_pixels(r['ratio'])}, not {r['tier']}")
        if "durationsS" in m and m["durationsS"] != p.get("duration", {}).get("enum"):
            out.append(f"{name}: durations {m['durationsS']} != {p.get('duration', {}).get('enum')}")
        if "promptMax" in m and m["promptMax"] != p.get("promptText", {}).get("maxLength"):
            out.append(f"{name}: promptMax {m['promptMax']} != {p.get('promptText', {}).get('maxLength')}")
        if m.get("promptUnit") == "utf16" and "promptMax" not in m:
            out.append(f"{name}: a promptUnit with no promptMax")
        if "refs" in m:
            ref = p.get("referenceImages") or {}
            if m["refs"]["max"] != ref.get("maxItems"):
                out.append(f"{name}: refs.max {m['refs']['max']} != {ref.get('maxItems')}")
            if "maxCharacter" in m["refs"]:
                said = ref.get("description", "").lower()
                n = next((v for w, v in NUMBER_WORDS.items() if f"up to {w} of those images can pass `subject: \"human\"`" in said), None)
                if n != m["refs"]["maxCharacter"]:
                    out.append(f"{name}: refs.maxCharacter {m['refs']['maxCharacter']} != the description's {n}")
        if "outputs" in m:
            oc = p.get("outputCount") or {}
            theirs = oc.get("enum") or list(range(oc.get("minimum", 1), oc.get("maximum", 0) + 1))
            if m["outputs"] != theirs:
                out.append(f"{name}: outputs {m['outputs']} != {theirs}")
        # Mask polarity is read from the words: Runway says which colour is edited.
        words = (p.get("maskUri") or {}).get("description", "")
        want_mask = ("png_black_edit" if "Black areas are edited" in words else
                     "png_white_edit" if "White areas are edited" in words else "none")
        if m.get("mask", "none") != want_mask:
            out.append(f"{name}: mask {m.get('mask', 'none')} but the schema says {want_mask}")
        if bool(m.get("preciseEdit")) != ("preciseEdit" in p):
            out.append(f"{name}: preciseEdit {m.get('preciseEdit')} but the schema {'has' if 'preciseEdit' in p else 'lacks'} it")
        if "keyframes" in m:
            kf = p.get("keyframes") or {}
            if m["keyframes"]["max"] != kf.get("maxItems"):
                out.append(f"{name}: keyframes.max {m['keyframes']['max']} != {kf.get('maxItems')}")
            variants = kf.get("items", {}).get("anyOf") or [kf.get("items", {})]
            ranged = [v["properties"]["range"] for v in variants if "range" in v.get("properties", {})]
            whole_exclusive = bool(ranged) and all(
                r["properties"]["start_seconds"]["type"] == "integer" and "exclusive" in r["properties"]["end_seconds"]["description"]
                for r in ranged)
            if (m["keyframes"].get("range") == "whole_seconds_end_exclusive") != whole_exclusive:
                out.append(f"{name}: keyframes.range does not match the schema's")
        if "targetAspectRatios" in m and m["targetAspectRatios"] != (p.get("targetAspectRatio") or {}).get("enum"):
            out.append(f"{name}: targetAspectRatios {m['targetAspectRatios']} != {(p.get('targetAspectRatio') or {}).get('enum')}")
        if "audioDefault" in m and m["audioDefault"] != (p.get("audio") or {}).get("default"):
            out.append(f"{name}: audioDefault {m['audioDefault']} != {(p.get('audio') or {}).get('default')}")
        if m.get("firstLastFrame"):
            arrays = [a for a in (p.get("promptImage") or {}).get("anyOf", []) if a.get("type") == "array"]
            positions = arrays[0]["items"]["properties"]["position"]["enum"] if arrays else []
            if sorted(positions) != ["first", "last"] or arrays[0].get("maxItems") != 2:
                out.append(f"{name}: firstLastFrame but the schema takes no first and last frame")
        if "scaleFactors" in m and m["scaleFactors"] != (p.get("scaleFactor") or {}).get("enum"):
            out.append(f"{name}: scaleFactors {m['scaleFactors']} != {(p.get('scaleFactor') or {}).get('enum')}")
        if "resolutions" in m and m["resolutions"] != (p.get("resolution") or {}).get("enum"):
            out.append(f"{name}: resolutions {m['resolutions']} != {(p.get('resolution') or {}).get('enum')}")
        if "inputS" in m and "max" in m["inputS"]:
            said = (p.get("videoUri") or {}).get("description", "")
            if f"{m['inputS']['max']:g} seconds" not in said:
                out.append(f"{name}: inputS.max {m['inputS']['max']} is not in the videoUri description {said!r}")
        # The price: entered from exactly the rows pricing.md has for the model, never invented.
        theirs = rows["rows"].get(name)
        if not theirs:
            out.append(f"{name}: pricing.md has no row for it (never treated as free)")
        elif m["pricing"]["source"] != theirs:
            out.append(f"{name}: pricing.source differs from pricing.md's rows {theirs}")
    for op, spec in sheet["ops"].items():
        for s in [spec, *spec.get("alternates", [])]:
            if s["model"] not in sheet["models"]:
                out.append(f"ops.{op}: {s['model']} is not in the catalogue")
            # A clip from words alone (ui-behaviour 3.5) goes to the textEndpoint, which must take the model.
            if s.get("textEndpoint") and branch(s["textEndpoint"], s["model"]) is None:
                out.append(f"ops.{op}: {s['model']} is not in the {s['textEndpoint']} snapshot's oneOf (textEndpoint)")
    return out


def test_the_runway_catalogue_matches_the_snapshots():
    assert problems(load_sheet("runway")) == []


def test_the_catalogue_covers_what_the_overhaul_features_need():
    need = {"gemini_image3_pro", "gemini_image3.1_flash", "veo3.1", "veo3.1_fast", "aleph2", "ideogram_4_5",
            "magnific_precision_upscaler_v2", "magnific_video_upscaler_creative"}
    assert need <= set(load_sheet("runway")["models"])


def test_the_facts_the_design_relies_on():
    m = load_sheet("runway")["models"]
    assert m["ideogram_4_5"]["mask"] == "png_black_edit" and m["ideogram_4_5"]["preciseEdit"] is True
    assert "4:5" not in m["aleph2"]["targetAspectRatios"] and len(m["aleph2"]["targetAspectRatios"]) == 8
    assert m["aleph2"]["keyframes"] == {"max": 5, "range": "whole_seconds_end_exclusive"}
    assert m["veo3.1"]["audioDefault"] is True and m["veo3.1"]["durationsS"] == [4, 6, 8]
    assert {k: m[k]["promptMax"] for k in ("gemini_image3_pro", "veo3.1", "aleph2", "ideogram_4_5")} == \
        {"gemini_image3_pro": 5500, "veo3.1": 1000, "aleph2": 1000, "ideogram_4_5": 10000}
    assert m["magnific_precision_upscaler_v2"]["scaleFactors"] == [2, 4, 8, 16]


def _mutated(change) -> dict:
    sheet = copy.deepcopy(load_sheet("runway"))
    change(sheet)
    return sheet


@pytest.mark.parametrize("change,says", [
    (lambda s: s["models"]["gemini_image3_pro"]["ratios"].append({"ratio": "1280:720", "tier": "1K"}), "ratios"),
    (lambda s: s["models"]["veo3.1"]["pricing"]["source"].__setitem__(0, "`veo3.1 (audio)` | 30 credits per second"), "pricing.source"),
    (lambda s: s["models"]["ideogram_4_5"].__setitem__("mask", "png_white_edit"), "mask"),
    (lambda s: s["models"]["aleph2"]["targetAspectRatios"].append("4:5"), "targetAspectRatios"),
    (lambda s: s["models"]["veo3.1"].__setitem__("promptMax", 2000), "promptMax"),
    (lambda s: s["models"]["gemini_image3_pro"]["refs"].__setitem__("maxCharacter", 9), "maxCharacter"),
    (lambda s: s["models"]["gemini_image3.1_flash"]["ratios"][0].__setitem__("tier", "1K"), "tier"),
    (lambda s: s["models"].__setitem__("kling3.0_pro", {**s["models"]["veo3.1"], "label": "Kling"}), "kling3.0_pro"),
    (lambda s: s.__setitem__("usdPerCredit", 0.02), "usdPerCredit"),
    (lambda s: s["ops"]["clip"].__setitem__("model", "gen4.5"), "not in the catalogue"),
    (lambda s: s["ops"]["clip"].__setitem__("textEndpoint", "POST /v1/text_to_image"), "textEndpoint"),
])
def test_a_sheet_that_disagrees_with_runway_is_refused(change, says):
    found = problems(_mutated(change))
    assert found and any(says in p for p in found), found


@pytest.mark.parametrize("case", json.loads((contracts_dir() / "examples" / "pricing-cases.json").read_text())["cases"],
                         ids=lambda c: f"{c['sheet']}:{c['model']}:{json.dumps(c['settings'], sort_keys=True)}")
def test_the_price_vectors(case):
    sheet = load_sheet(case["sheet"])
    if case.get("refused"):
        with pytest.raises(pricing().PriceError):
            pricing().credits(sheet, case["model"], case["settings"])
    else:
        assert pricing().credits(sheet, case["model"], case["settings"]) == case["credits"]


def test_usd_is_credits_times_the_sheet_rate():
    sheet = load_sheet("runway")
    assert pricing().usd(sheet, "aleph2", {"inputS": 30}) == 8.4
    assert pricing().op_usd(sheet, "clip") == 1.2 and pricing().op_usd(sheet, "clip", "veo3.1_fast") == 0.6
    assert pricing().op_usd(sheet, "clip_edit") == 1.4
    assert {op: pricing().op_usd(sheet, op) for op in ("generate", "view", "frame")} == \
        {"generate": 0.2, "view": 0.2, "frame": 0.2}
    # region_edit on ideogram_4_5 (features/image-editor.clan): a mask edit with the frame as its reference
    # is medium (8 cr), a preciseEdit high (25 cr); the Gemini 3 Pro alternate 20 cr. Upscale 25 / 150 cr.
    assert pricing().op_usd(sheet, "region_edit") == 0.08
    assert pricing().op_usd(sheet, "region_edit", settings={"preciseEdit": True}) == 0.25
    assert pricing().op_usd(sheet, "region_edit", "gemini_image3_pro") == 0.2
    assert pricing().op_usd(sheet, "upscale") == 0.25
    assert pricing().op_usd(sheet, "upscale", settings={"scaleFactor": 4}) == 1.5
    assert pricing().op_usd(sheet, "frame", "gemini_image3.1_flash") == 0.07
    assert pricing().op_usd(sheet, "clip", "not-offered") is None


def test_the_relay_bundle_carries_the_price_function():
    """The relay's Lambda zip copies the contracts it reads (deploy-production-tool.yml): the sheets and
    pricing.py, without which every reservation would be the unknown price."""
    workflow = (contracts_dir().parents[1] / ".github" / "workflows" / "deploy-production-tool.yml").read_text()
    assert 'cp production-tool/contracts/pricing.py "$build/pkg/contracts/"' in workflow
    assert 'cp -r production-tool/contracts/capabilities "$build/pkg/contracts/"' in workflow
    # each agency's defaults and the makers' names (features/tenant-limits.clan): the relay reads both at import
    assert ('cp production-tool/contracts/spend-policy.json production-tool/contracts/subprocessors.json '
            '"$build/pkg/contracts/"') in workflow
