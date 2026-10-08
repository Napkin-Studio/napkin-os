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
from contracts_dir import contracts_dir  # noqa: E402

OUT = RELAY.parents[1] / "docs" / "production-tool" / "provider-reference.md"
SCHEMAS = RELAY / "tests" / "fixtures" / "schemas"
PROVIDERS = ("fal", "runway", "heygen")
OPS = ("generate", "view", "frame", "region_edit", "clip", "clip_edit")
STEP = {"generate": "Character (canvas generate)", "view": "Views (turnaround)", "frame": "Storyboard frame",
        "region_edit": "Region edit", "clip": "Clip", "clip_edit": "Clip edit"}
TAGS = {"at_tag": "`@tag` (its own name)", "at_image_n": "`@Image1…` by position, `@Element1…` for a character element",
        "picture_n": "`<Picture 1>` by position", "figure_n": "`Figure 1` by position", "image_n": "`image 1` by position",
        "none": "not named (by order only)"}
INTERESTING = ("aspect_ratio", "ratio", "resolution", "duration", "image_size", "num_images", "outputCount",
               "result_type", "edit_strength", "horizontal_angle")

HAND = """## How characters travel

What the relay sends for a character today, per provider. A character is a **key** (`maya`) with
**variants** (`maya_front`, `maya_side`, `maya_jumping`). `@maya` means the whole character: its front
plus up to three other pictures, views first. Each line is proven by a case in
`production-tool/relay/tests/test_pathways.py`.

| Where | What the provider receives |
|---|---|
| fal, characters and frames (Nano Banana Pro, the default) | Every picture as its own image, named `image 1`, `image 2`… in the prompt. |
| fal, frames picked on Kling O3 | The front and up to three other pictures of one character as one **Kling element** (`@Element1`); other pictures as `@Image1…`. A pose picture inside the element is not told apart from the front. |
| fal, clips (Kling v3 Pro) | The storyboard frame as the first frame, plus each character as an element (front + 1-3 other pictures). A character with only a front cannot be an element. |
| fal, clips on Veo 3.1 (a pick) | The storyboard frame only; characters are named in words. |
| Runway, images (Gemini 3 Pro) | Every picture with its own `@tag` (`@maya_front`, `@maya_jumping`), as `human` (characters, at most 5) or `object`. |
| Runway, clips (Veo 3.1) | The storyboard frame only; characters are named in words. |
| HeyGen, clips | The storyboard frame only (image-to-video); characters are named in words. |
| Region edits | fal: the image, a mask (converted to black = edit) and up to 3 refs. Runway: the image and a copy with the box drawn on it. |

In a clip, the pose and look come from the storyboard frame, so a frame made strictly from the
right pictures is what keeps a character consistent on every provider.

**Planned (features/strict-refs.clan, not approved yet):** a named look such as `@maya_jumping` is
pinned (always sent, never dropped for a limit), goes outside the Kling element as its own picture,
and the director must keep its pose and expression.

## Character sheets

| Part | fal | Runway |
|---|---|---|
| Views (front, three-quarter, side, back) | Qwen multi-angle: the exact camera angle (0, 45, 90, 180°) from the front | Gemini 3 Pro: the view described in words, the front sent as a reference |
| A set of looks (expressions, poses) | One Nano Banana call with up to 4 outputs, or Kling O3 `series` (2-9 consistent frames) on a pick | One Gemini call with 4 outputs |

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
    if provider == "fal":
        return schema["$defs"][schema["$ref"].split("/")[-1]] if "$ref" in schema else schema
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
    ("fal", "qwen-image-edit-2511-multiple-angles"): "the source picture only, with the exact camera angle",
    ("fal", "ideogram-v4.5-edit"): "the image, a mask (converted to black = edit) and up to 3 unnamed references",
    ("fal", "veo3.1-fast-i2v"): "the storyboard frame only; characters named in words",
    ("fal", "veo3.1-i2v"): "the storyboard frame only; characters named in words",
    ("fal", "luma-ray-3.2-v2v"): "the clip and the change in words; a boxed region goes to SAM 2 then Wan VACE inpainting",
    ("runway", "gemini_image3_pro@region_edit"): "the image and a copy with the box drawn on it, each with its own @tag",
    ("runway", "veo3.1"): "the storyboard frame (and a last frame) only; characters named in words",
    ("runway", "veo3.1_fast"): "the storyboard frame (and a last frame) only; characters named in words",
    ("runway", "aleph2"): "the clip, the change in words and an optional keyframe",
    ("heygen", "heygen-video-1"): "the storyboard frame only (image to video); characters named in words",
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
    if "minS" in spec or "maxS" in spec:
        return [f"lengths: {spec.get('minS', '…'):g}-{spec.get('maxS', '…'):g} s"]
    return []


def _named(sheet: dict, spec: dict) -> list[str]:
    refs = spec.get("refs") or sheet["refs"]
    tag = spec.get("tagSyntax") or sheet["tagSyntax"]
    out = [f"refs: up to {refs['max']}" + (f", {refs['maxCharacter']} characters" if refs.get("maxCharacter") is not None else "")
           + ("; characters as elements" if refs.get("element") else ""),
           f"named {TAGS.get(tag, tag)}"]
    return out


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
                ours = _ours(sheet, {**spec, **m} if i else spec, op)
                label = f"**{m.get('label', m['model'])}** (`{m['model']}`)" + (" default" if i == 0 else "")
                parts.append(f"| {STEP[op] if i == 0 else ''} | {label} | {_usd(m.get('estimateUsd'))} | "
                             f"{'; '.join(ours)} | {'; '.join(accepts) or '—'}" + (f" (schema {fetched[:10]})" if fetched else "") + " |")
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


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
