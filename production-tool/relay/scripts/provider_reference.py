#!/usr/bin/env python3
"""Write docs/production-tool/provider-reference.md: what we send each provider and what each
provider says it accepts (features/provider-reference.clan).

    uv run --frozen --python 3.12 python scripts/provider_reference.py           write the file
    uv run --frozen --python 3.12 python scripts/provider_reference.py --check   exit 1 if it is stale

Two sources, so the page cannot drift from the code: the capability sheets
(contracts/capabilities/*.json: our models, prices and limits per step) and the providers' own
published request schemas snapshotted in tests/fixtures/schemas (scripts/refresh_provider_schemas.py).
The hand-written parts (how characters travel, character sheets) live in the HAND section below and
are kept honest by tests/test_pathways.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELAY = HERE.parent
sys.path.insert(0, str(RELAY))
from contracts_dir import contracts_dir, pricing  # noqa: E402

OUT = RELAY.parents[1] / "docs" / "production-tool" / "provider-reference.md"
SCHEMAS = RELAY / "tests" / "fixtures" / "schemas"
PROVIDERS = ("runway",)
OPS = ("generate", "view", "frame", "region_edit", "clip", "clip_edit", "upscale")
STEP = {"generate": "Character (canvas generate)", "view": "Views (turnaround)", "frame": "Storyboard frame",
        "region_edit": "Region edit", "clip": "Clip", "clip_edit": "Clip edit", "upscale": "Upscale (Image editor)"}
TAGS = {"at_tag": "`@tag` (its own name)", "none": "in words (no tag; pictures by order)"}
INTERESTING = ("aspect_ratio", "ratio", "resolution", "duration", "image_size", "num_images", "outputCount",
               "result_type", "edit_strength", "horizontal_angle")

HAND = """## How characters travel

What the relay sends for a character today, per provider. A character is a **key** (`maya`) with
**variants** (`maya_front`, `maya_side`, `maya_jumping`). `@maya` means the whole character: its front
plus up to three other pictures, views first. Each line is proven by a case in
`production-tool/relay/tests/test_pathways.py`.

| Where | What the provider receives |
|---|---|
| Runway, images (Gemini 3 Pro) | Every picture with its own `@tag` (`@maya_front`, `@maya_jumping`), as `human` (characters, at most 5) or `object`. |
| Runway, clips (Veo 3.1) | The storyboard frame only; characters are named in words. |
| Runway, region edits (Ideogram 4.5) | The image, and a black-and-white mask (black = change) from the painted mask or the box; with neither, a preciseEdit of the whole image. |

In a clip, the pose and look come from the storyboard frame, so a frame made strictly from the
right pictures is what keeps a character consistent.

**Planned (features/strict-refs.clan, not approved yet):** a named look such as `@maya_jumping` is
pinned (always sent, never dropped for a limit), and the director must keep its pose and expression.

## Character sheets

| Part | Runway |
|---|---|
| Views (front, three-quarter, side, back) | Gemini 3 Pro: the view described in words, the front sent as a reference |
| A set of looks (expressions, poses) | One Gemini call with 4 outputs |

**Planned (features/strict-refs.clan):** a "Make sheet" action that runs the three views and a look set in one go.
"""


def _sheets() -> dict[str, dict]:
    return {n: json.loads((contracts_dir() / "capabilities" / f"{n}.json").read_text()) for n in PROVIDERS}


def _snapshot(provider: str, endpoint: str) -> dict | None:
    stem = endpoint.split(" ", 1)[-1].strip("/").replace("/", "__")
    path = SCHEMAS / provider / f"{stem}.json"
    return json.loads(path.read_text()) if path.exists() else None


def _input(provider: str, model: str, snap: dict) -> dict:
    """The properties of the request body this model takes, from the provider's own schema."""
    schema = snap["schema"]
    branches = schema.get("oneOf") or [schema]
    for b in branches:
        props = b.get("properties", {})
        if b.get("title") == model or props.get("model", {}).get("const") == model:
            return b
    return branches[0]


def _enum(prop: dict) -> list | None:
    for p in [prop, *prop.get("anyOf", []), *prop.get("oneOf", [])]:
        if "enum" in p:
            return [v for v in p["enum"] if v is not None]
    return None


def _accepts(provider: str, model: str, endpoint: str) -> tuple[str, list[str]]:
    snap = _snapshot(provider, endpoint)
    if snap is None:
        return "", ["no schema snapshot"]
    props = _input(provider, model, snap).get("properties", {})
    lines = []
    for name in INTERESTING:
        if name not in props:
            continue
        values = _enum(props[name])
        if values:
            shown = ", ".join(map(str, values[:12])) + (f" … ({len(values)} in all)" if len(values) > 12 else "")
            lines.append(f"`{name}`: {shown}")
        elif any(k in props[name] for k in ("minimum", "maximum")):
            lines.append(f"`{name}`: {props[name].get('minimum', '…')}-{props[name].get('maximum', '…')}")
    for name, p in props.items():
        if p.get("type") == "array" and "maxItems" in p and ("image" in name.lower() or "reference" in name.lower()):
            lines.append(f"`{name}`: at most {p['maxItems']}")
    prompt = props.get("prompt") or props.get("promptText") or {}
    if "maxLength" in prompt:
        lines.append(f"prompt: at most {prompt['maxLength']} characters")
    return snap["fetched"], lines


def _usd(v) -> str:
    return "unpublished" if v is None else f"${v:.3f}" if v < 0.1 else f"${v:.2f}"


# Where the adapter sends something other than named references, say what it sends
# (production-tool/relay/providers/*.py; proven in tests/test_pathways.py).
SENDS = {
    ("runway", "gemini_image3_pro@region_edit"): "the image and a copy with the box drawn on it, each with its own @tag",
    ("runway", "ideogram_4_5@region_edit"): "the image first (refs by order, no @tag) and a black-edit mask, or preciseEdit with no mask",
    ("runway", "magnific_precision_upscaler_v2"): "the image and the scale (2x or 4x)",
    ("runway", "veo3.1"): "the storyboard frame (and a last frame) only; characters named in words",
    ("runway", "veo3.1_fast"): "the storyboard frame (and a last frame) only; characters named in words",
    ("runway", "aleph2"): "the clip, the change in words and an optional keyframe",
    # features/runway-video-models.clan
    ("runway", "klingO3_pro@clip"): "the frame (and a last frame) plus up to 6 character pictures, 7 in all; with no frame, words alone",
    ("runway", "klingO3_standard@clip"): "the frame (and a last frame) plus up to 6 character pictures, 7 in all; with no frame, words alone",
    ("runway", "kling3.0_pro@clip"): "the storyboard frame (and a last frame) only; characters named in words",
    ("runway", "kling3.0_standard@clip"): "the storyboard frame (and a last frame) only; characters named in words",
    ("runway", "hailuo3@clip"): "the frame (and a last frame) alone; with no frame, up to 9 character pictures as references",
    ("runway", "gemini_omni_flash_1.1@clip"): "the frame (and a last frame) alone; with no frame, up to 5 character pictures as references",
    ("runway", "wan3@clip"): "the frame (and a last frame) alone, ratio auto_<tier>; with no frame, up to 10 character pictures",
    ("runway", "seedance2_5@clip"): "the frame (and a last frame) alone; with no frame, up to 30 pictures (stylised only)",
    ("runway", "seedance2_fast@clip"): "the frame (and a last frame) alone; with no frame, up to 9 pictures (stylised only)",
    ("runway", "klingO3_pro@clip_edit"): "the clip, the change in words and up to 4 pictures; keeps the clip's sound",
    ("runway", "klingO3_standard@clip_edit"): "the clip, the change in words and up to 4 pictures; keeps the clip's sound",
    ("runway", "gemini_omni_flash_1.1@clip_edit"): "the clip (mode edit), the change in words and up to 5 pictures",
    ("runway", "seedance2_5@clip_edit"): "the clip (mode edit, duration auto), the change in words and up to 30 pictures (stylised only)",
}


def _ours(sheet: dict, spec: dict, op: str = "") -> list[str]:
    said = SENDS.get((sheet["provider"], f"{spec['model']}@{op}")) or SENDS.get((sheet["provider"], spec["model"]))
    if said:
        lengths = [x for x in _lengths(spec)]
        return [said, *lengths]
    return _named(sheet, spec) + _lengths(spec)


def _lengths(spec: dict) -> list[str]:
    if "durationsS" in spec:
        return [f"lengths: {', '.join(f'{d:g}' for d in spec['durationsS'])} s"]
    if "minS" in spec and "maxS" in spec:
        return [f"lengths: {spec['minS']:g}-{spec['maxS']:g} s"]
    if "maxS" in spec:
        return [f"lengths: up to {spec['maxS']:g} s"]
    if "minS" in spec:
        return [f"lengths: from {spec['minS']:g} s"]
    return []


def _named(sheet: dict, spec: dict) -> list[str]:
    refs = spec.get("refs") or sheet["refs"]
    tag = spec.get("tagSyntax") or sheet["tagSyntax"]
    limit = f"refs: up to {refs['max']}" + (f", {refs['maxCharacter']} characters" if refs.get("maxCharacter") is not None else "")
    return [limit, f"named {TAGS.get(tag, tag)}"]


def render() -> str:
    sheets = _sheets()
    parts = ["# Production Tool: provider reference", "",
             "<!-- Generated by production-tool/relay/scripts/provider_reference.py. Do not edit by hand:",
             "     change the capability sheets, the schema snapshots or the HAND text in the script. -->", "",
             "What we send each provider, per step, and what each provider's own published schema says it",
             "accepts. Our side comes from `production-tool/contracts/capabilities/*.json`; theirs from the",
             "snapshots in `production-tool/relay/tests/fixtures/schemas` (refresh them with",
             "`scripts/refresh_provider_schemas.py`). Prices are our per-job estimates. Background research,",
             "with sources and open questions, is in `providers.md`.", "", HAND.strip(), ""]
    for provider in PROVIDERS:
        sheet = sheets[provider]
        parts += [f"## {provider} (sheet checked {sheet['checked']})", "",
                  "| Step | Model | Price | We send | The provider accepts |", "|---|---|---|---|---|"]
        for op in OPS:
            spec = sheet["ops"].get(op)
            if not spec:
                continue
            for i, m in enumerate([spec, *spec.get("alternates", [])]):
                fetched, accepts = _accepts(provider, m["model"], m["endpoint"])
                lengths = ("durationsS", "minS", "maxS")  # an alternate's lengths replace the op's (effective_sheet)
                own = {k: v for k, v in spec.items() if not (any(x in m for x in lengths) and k in lengths)}
                ours = _ours(sheet, {**own, **m} if i else spec, op)
                label = f"**{m.get('label', m['model'])}** (`{m['model']}`)" + (" default" if i == 0 else "")
                price = pricing().op_usd(sheet, op, m["model"] if i else None)
                parts.append(f"| {STEP[op] if i == 0 else ''} | {label} | {_usd(price)} | "
                             f"{'; '.join(ours)} | {'; '.join(accepts) or '—'}" + (f" (schema {fetched[:10]})" if fetched else "") + " |")
        parts.append("")
        parts += _catalogue(sheet)
    parts += _cost_table()
    return "\n".join(parts).rstrip() + "\n"


def _catalogue(sheet: dict) -> list[str]:
    """The models catalogue: each model's checked limits and its published price rows."""
    out = [f"### {sheet['provider']} models catalogue", "",
           "Every model a step uses or a planned feature needs, held to the snapshots by",
           "`tests/test_runway_sheet.py`. Prices are computed from `pricing` by `contracts/pricing.py`;",
           f"1 credit = ${sheet['usdPerCredit']:g}.", "",
           "| Model | Endpoint | Limits | Published price |", "|---|---|---|---|"]
    for name, m in sheet.get("models", {}).items():
        limits = []
        if m.get("ratios"):
            tiers = sorted({r["tier"] for r in m["ratios"] if r.get("tier")})
            limits.append(f"{len(m['ratios'])} ratios" + (f" ({', '.join(tiers)})" if tiers else ""))
        for key, words in (("durationsS", "lengths {} s"), ("outputs", "outputs {}"), ("scaleFactors", "scale {}"),
                           ("resolutions", "resolutions {}"), ("targetAspectRatios", "expand to {}")):
            if m.get(key):
                limits.append(words.format(", ".join(str(x) for x in m[key])))
        if m.get("inputS"):
            limits.append("input " + "-".join(f"{m['inputS'][k]:g}" for k in ("min", "max") if k in m["inputS"]) + " s")
        if m.get("promptMax"):
            limits.append(f"prompt ≤ {m['promptMax']} UTF-16 units")
        if m.get("refs"):
            limits.append(f"refs ≤ {m['refs']['max']}")
        if m.get("mask") and m["mask"] != "none":
            limits.append(f"mask {m['mask']}")
        for flag in ("preciseEdit", "firstLastFrame"):
            if m.get(flag):
                limits.append(flag)
        if m.get("keyframes"):
            limits.append(f"keyframes ≤ {m['keyframes']['max']}" + (" with range" if m["keyframes"].get("range") else ""))
        rows = "<br>".join(r.replace("|", "·") for r in m["pricing"]["source"]) or "—"
        out.append(f"| {m['label']} (`{name}`) | {m.get('endpoint', '—')} | {'; '.join(limits) or '—'} | {rows} |")
    return out + [""]


def _cost_table() -> list[str]:
    """What one ad costs at list prices (contracts/cost-model.json through scripts/ad_costs.py)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("ad_costs", HERE / "ad_costs.py")
    ad_costs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ad_costs)
    return ["## What one ad costs", "",
            "At today's list prices, from `contracts/cost-model.json` priced by `scripts/ad_costs.py`. For Napkin's",
            "planning only: the tool shows no price to people; each job's cost is recorded and shown in History.", "",
            ad_costs.table(), ""]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if the committed page is out of date")
    args = ap.parse_args(argv)
    text = render()
    if args.check:
        current = OUT.read_text() if OUT.exists() else ""
        if current != text:
            print(f"{OUT} is out of date: run scripts/provider_reference.py")
            return 1
        print("up to date")
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
