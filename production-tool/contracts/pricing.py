"""The one price function for a capability sheet (features/runway-sheet-sync.clan).

A sheet's `models[<id>].pricing` holds the provider's published price, entered by a person from
the verbatim rows in its `source`. Every price the tool uses is computed here, from that and a
job's settings: the relay's reservation (relay/service.py _estimate), the job's recorded cost,
check.py, the cost model (relay/scripts/ad_costs.py) and the provider reference. There is no
second copy of a price anywhere. examples/pricing-cases.json holds the vectors; check.py and the
relay's pytest assert them.

Standard library only: check.py runs with jsonschema alone, and the relay bundles this file with
the contracts in its Lambda zip.

    credits(sheet, model, settings)  -> the provider's credits for one call
    usd(sheet, model, settings)      -> the same in USD (credits x usdPerCredit)
    op_settings(sheet, op, model, settings) -> the op's (or alternate's) defaults under `settings`
    op_usd(sheet, op, model, settings)      -> USD for one job of `op`, or None when unpriced
"""

from __future__ import annotations

import math

__all__ = ["PriceError", "credits", "usd", "op_settings", "op_usd", "model_of", "tier_of"]


class PriceError(ValueError):
    """The model has no price for these settings (or the provider refuses them)."""


def model_of(sheet: dict, model: str) -> dict:
    spec = (sheet.get("models") or {}).get(model)
    if spec is None:
        raise PriceError(f"{model} is not in the {sheet.get('provider', '?')} catalogue")
    if "pricing" not in spec:
        raise PriceError(f"{model} has no price")
    return spec


def tier_of(spec: dict, settings: dict) -> str | None:
    """A resolution tier: settings.resolution, else the tier the catalogue gives settings.ratio."""
    if settings.get("resolution"):
        return str(settings["resolution"])
    ratio = settings.get("ratio")
    for r in spec.get("ratios") or []:
        if r["ratio"] == ratio:
            return r.get("tier")
    return None


def _number(x: float) -> float | int:
    """Credits as Runway states them: a whole number when it is one."""
    r = round(x, 6)
    return int(r) if r == int(r) else r


def _quality(spec: dict, price: dict, settings: dict) -> str:
    q = settings.get("quality")
    precise = bool(settings.get("preciseEdit"))
    refs = int(settings.get("refs") or 0)
    if precise and refs < 1:
        raise PriceError("preciseEdit needs a reference image")
    if q is None:
        d = price.get("defaultQuality") or {}
        q = d.get("preciseEdit", d.get("otherwise")) if precise else (d.get("withRefs") if refs else d.get("otherwise"))
    if q not in price["byQuality"]:
        raise PriceError(f"no price for quality {q!r}")
    if precise and q in (price.get("notWithPreciseEdit") or []):
        raise PriceError(f"quality {q} is not available with preciseEdit")
    if not refs and q in (price.get("needsRefs") or []):
        raise PriceError(f"quality {q} needs reference images")
    return q


def credits(sheet: dict, model: str, settings: dict | None = None) -> float | int:
    """Credits for one call of `model` with `settings` (see capabilities.schema.json $defs/defaults)."""
    settings = settings or {}
    spec = model_of(sheet, model)
    price = spec["pricing"]
    unit = price["unit"]
    if unit == "image":
        if "byQuality" in price:
            each = price["byQuality"][_quality(spec, price, settings)]
        elif "byResolution" in price:
            tier = tier_of(spec, settings)
            if tier not in price["byResolution"]:
                raise PriceError(f"{model}: no price for resolution {tier!r} (ratio {settings.get('ratio')!r})")
            each = price["byResolution"][tier]
        elif "credits" in price:
            each = price["credits"]
        else:
            raise PriceError(f"{model}: pricing names no credits")
        if "overPx" in price:
            if "inputPx" not in settings:
                raise PriceError(f"{model}: the price depends on the input size (inputPx)")
            out_px = settings["inputPx"] * settings.get("scaleFactor", 2)
            if out_px > price["overPx"]:
                each = price["overPxCredits"]
        total = each * int(settings.get("outputs") or 1)
    elif unit == "second":
        # An edit's output is as long as its input; a generated clip is as long as asked.
        seconds = settings.get("inputS") if "inputS" in spec else settings.get("durationS", settings.get("inputS"))
        if seconds is None:
            raise PriceError(f"{model}: the price is per second and no length was given")
        if "byResolution" in price:  # a clip's tier: settings.resolution, else its ratio's (Hailuo 3, WAN 3, Seedance)
            tier = tier_of(spec, settings)
            if tier not in price["byResolution"]:
                raise PriceError(f"{model}: no price for resolution {tier!r} (ratio {settings.get('ratio')!r})")
            per = price["byResolution"][tier]
        else:
            per = price["audioCredits"] if settings.get("audio") and "audioCredits" in price else price["credits"]
        total = per * seconds
        # What some models add on top (features/runway-video-models.clan): each reference picture or
        # keyframe, and each second of the clip an edit reads.
        total += price.get("perRef", 0) * int(settings.get("refs") or 0)
        input_s = settings.get("inputS") or 0
        if "perInputSecondByResolution" in price:
            total += price["perInputSecondByResolution"].get(tier_of(spec, settings), 0) * input_s
        total += price.get("perInputSecond", 0) * input_s
    elif unit == "frame":
        res = settings.get("resolution")
        if res not in (price.get("byResolution") or {}):
            raise PriceError(f"{model}: no price for resolution {res!r}")
        if settings.get("inputS") is None or settings.get("fps") is None:
            raise PriceError(f"{model}: the price is per frame and needs inputS and fps")
        total = price["byResolution"][res] * settings["fps"] * settings["inputS"]
    else:
        raise PriceError(f"{model}: unknown price unit {unit!r}")
    if price.get("round") == "ceil":
        total = math.ceil(round(total, 6))
    total = max(total, price.get("minCredits", 0))
    return _number(total)


def usd(sheet: dict, model: str, settings: dict | None = None) -> float:
    return round(credits(sheet, model, settings) * sheet["usdPerCredit"], 4)


def _spec_for(sheet: dict, op: str, model: str | None) -> dict:
    spec = sheet["ops"][op]
    if model is None or model in (spec["model"], spec.get("regionModel")):
        return spec
    for alt in spec.get("alternates") or []:
        if alt["model"] == model:
            return alt
    raise PriceError(f"{model} is not offered for {op}")


def op_settings(sheet: dict, op: str, model: str | None = None, settings: dict | None = None) -> dict:
    """The op's (or the alternate's) defaults, with `settings` over them (None values dropped)."""
    spec = _spec_for(sheet, op, model)
    return {**(spec.get("defaults") or {}), **{k: v for k, v in (settings or {}).items() if v is not None}}


def op_usd(sheet: dict, op: str, model: str | None = None, settings: dict | None = None) -> float | None:
    """USD for one job of `op` on `model` (default: the op's own), or None when it cannot be priced."""
    try:
        spec = _spec_for(sheet, op, model)
        return usd(sheet, spec["model"] if model is None else model, op_settings(sheet, op, model, settings))
    except (PriceError, KeyError):
        return None
