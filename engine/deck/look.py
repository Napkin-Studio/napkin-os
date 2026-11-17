"""How a deck gets its look: tokens resolved one at a time from the tiers that can give them (deck-look-kits).

Facts never change here (ADR 0023 as amended by ADR 0027). A look input is colour, type, a logo and picture bans:
nothing in this module adds, removes or rewords a word, a number, a name or a legal line, and a Style Pack has no
field that reaches a slide's words.

Precedence, per token (docs/contracts/deck-visuals.md section 6.5):

1. **Brand tier.** An explicit ``--master`` (the .potx is the renderer's); the attached Brand Clan's colours and type,
   only when the deck wears the client or both (``wears`` ``client`` / ``co_branded``); the ``--brand`` JSON as the CLI
   stand-in. With ``wears: agency`` (the default) a client's Brand Clan gives only its logo for the cover and its
   imagery bans, never its colours or type (Sai, 17 Nov 2026, Q1).
2. **Style Pack.** Its ``deck`` section (empty in every pack by default). A pointer into the brand
   (``{brand: <id>}``) only picks which of the brand's own colours to use; with no kit attached it falls through. A
   literal (``{hex}``, ``{family}``) applies below the brand tier and is ignored under ``strict_brand``.
3. **Agency look.** The signed-in person's agency, once the agency has set one up: it dresses every new deck with no
   switch, and a deck opts out with ``look.agency_look.use: false`` (Sai, 17 Nov 2026, Q3: industry practice, as in
   Pitch and Canva). An agency with no look changes nothing. Not behind ``inputs.library.enabled``.
4. **Default.** The named theme (``napkin``, or ``classic``).

Tokens nobody gave are derived by ``theme.Theme.with_brand`` (``accent_ink``, ``accent_on_dark``, ``on_dark_mute``)
and named in ``derived``. Each token's winner is recorded in ``meta.theme.from``.

When no tier above the default contributed anything and no Style Pack is attached, ``resolve`` returns ``theme=None``
and the deck is exactly today's: nothing is stamped, ``meta.brand`` is the ``--brand`` JSON untouched. That is what
keeps every golden byte-identical. The result is handed to the renderers through ``meta.brand``, which they already read.

The Brand Clan joins through one function, ``brand_tokens``, the only place that will know Contract 6's shape. It is
a seam for now: Contract 6 is unmerged, so it returns nothing.

Stdlib only.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field

from . import spec, theme as themes

COLOUR_TOKENS = ("accent", "paper", "ink", "panel", "accent_ink")
FONT_TOKENS = ("head", "body")
WEARS = ("agency", "client", "co_branded")
#: The brand tier outranks everything below it; the order is the precedence.
TIERS = spec.THEME_TIERS


def brand_tokens(frozen_brand: dict | None = None) -> dict:
    """The seam: a frozen Brand Clan (``data.upstream.<brand document id>``) as the tokens the deck reads.

    Returns ``{colours: {role: hex}, colour_ids: {id: hex}, fonts: {head, body}, type_ids: {id: family}, logos: {light, dark},
    logo_placement, imagery_bans: [], chart: [], kit: {document_id, version}}``. This is the one place that will know
    Contract 6's shape (visual.colours roles, typography, logos, imagery, rules); until Contract 6 is merged and Shrey
    has answered the asks in features/deck-look-kits.clan (design.shrey_asks) it is a stub and returns nothing, with
    or without a kit attached. A deck works without it.
    """
    return {"colours": {}, "colour_ids": {}, "fonts": {}, "type_ids": {}, "logos": {}, "logo_placement": None,
            "imagery_bans": [], "chart": [], "kit": {}}


@dataclass
class Look:
    """The resolved look: ``brand`` (the JSON the renderers read as ``meta.brand``), ``theme`` (the ``meta.theme`` record, or
    None when the deck is exactly today's), and what the pictures and the cover take from a brand."""
    brand: dict | None = None
    theme: dict | None = None
    imagery_bans: list = field(default_factory=list)
    logos: dict = field(default_factory=dict)
    problems: list = field(default_factory=list)
    won: dict = field(default_factory=dict)       # token -> tier


def _hex(v) -> str | None:
    v = str(v or "").strip().lstrip("#")
    return v.upper() if themes.HEX.match(v) else None


def _present(brand: dict | None) -> bool:
    return bool(brand) and any(brand.get(k) for k in ("colours", "colour_ids", "fonts", "type_ids", "logos", "imagery_bans"))


def _file_tokens(brand_file: dict | None) -> dict:
    """The tokens the ``--brand`` JSON gives, by Theme field and font role."""
    out = {}
    for k, v in ((brand_file or {}).get("colors") or {}).items():
        f = themes.LEGACY_KEYS.get(k, k if k in themes.COLOR_FIELDS else None)
        if f in COLOUR_TOKENS and _hex(v):
            out[f] = _hex(v)
    for k in FONT_TOKENS:
        if isinstance((brand_file or {}).get(k), str) and brand_file[k].strip():
            out[k] = brand_file[k].strip()
    return out


def _agency_of(agency: dict | None, problems: list) -> dict | None:
    """The agency look as tokens, or None. Reads accent, accent_ink, accent_use, surface, base (and id, rev)."""
    if not agency or not isinstance(agency, dict):
        return None
    out = {}
    for k in ("accent", "accent_ink", "base"):
        if agency.get(k):
            h = _hex(agency[k])
            if h:
                out[k] = h
            else:
                problems.append(f"agency look {k} {agency[k]!r} is not a 6-digit hex colour: ignored")
    if agency.get("accent_use") in ("fill", "line"):
        out["accent_use"] = agency["accent_use"]
    if agency.get("surface") in ("warm", "mono"):
        out["surface"] = agency["surface"]
    return {**out, "id": agency.get("id"), "rev": agency.get("rev")} if out else None


def _pack_pointer(ptr: dict, token: str, brand: dict | None, agency: dict | None, strict: bool):
    """One Style Pack deck pointer as a value, or None to fall through."""
    if not isinstance(ptr, dict):
        return None
    if "brand" in ptr:
        src = (brand or {}).get("colour_ids" if token in COLOUR_TOKENS else "type_ids") or {}
        return src.get(ptr["brand"])
    if "agency" in ptr:
        return (agency or {}).get(ptr["agency"]) if token in COLOUR_TOKENS else None
    if strict:
        return None
    if "hex" in ptr:
        return _hex(ptr["hex"])
    if "family" in ptr and token in FONT_TOKENS:
        return str(ptr["family"]).strip() or None
    return None


def resolve(*, theme: str = themes.DEFAULT, wears: str = "agency", strict_brand: bool = False, brand_file: dict | None = None,
            brand: dict | None = None, style=None, agency: dict | None = None, use_agency: bool = True, master: bool = False) -> Look:
    """Resolve the deck's look token by token. ``brand``: ``brand_tokens()``'s output; ``style``: a ``visuals.style.Style``
    (or None); ``agency``: the agency look JSON (None when the agency has none); ``use_agency``: False when the deck opts out
    (``look.agency_look.use``); ``brand_file``: the ``--brand`` JSON. See the module docstring for the order."""
    if wears not in WEARS:
        raise ValueError(f"wears must be one of {WEARS}, got {wears!r}")
    problems: list = []
    kit = brand if _present(brand) else None
    ag = _agency_of(agency, problems) if (use_agency and not strict_brand) else None
    pack = getattr(style, "deck", None) or {}
    pack_colours, pack_type = (pack.get("colours") or {}), (pack.get("type") or {})
    file_t = _file_tokens(brand_file)
    wears_kit = kit is not None and wears in ("client", "co_branded")

    def tier_value(token: str, paper: str | None):
        """(value, tier) for a token: the highest tier that gives it, else None."""
        if wears_kit:
            v = ((kit.get("colours") if token in COLOUR_TOKENS else kit.get("fonts")) or {}).get(token)
            if v:
                return (_hex(v) if token in COLOUR_TOKENS else str(v)), "brand_clan"
        if token in file_t:
            return file_t[token], "brand_file"
        ptr = (pack_colours if token in COLOUR_TOKENS else pack_type).get(token)
        if ptr:
            v = _pack_pointer(ptr, token, kit, ag, strict_brand)
            if v:
                return (_hex(v) if token in COLOUR_TOKENS else str(v)), "style_pack"
        if ag:
            if token == "accent" and ag.get("accent"):
                return ag["accent"], "agency_look"
            if token == "accent_ink" and ag.get("accent_ink"):
                return ag["accent_ink"], "agency_look"
            if token == "paper" and ag.get("surface") == "mono":
                return "FFFFFF", "agency_look"
            if token == "ink" and ag.get("base"):
                ground = paper or themes.get_theme(theme).paper
                r = themes.contrast(ag["base"], ground)
                if r >= themes.AA:
                    return ag["base"], "agency_look"
                problems.append(f"agency look base {ag['base']} is not used as ink: {r:.2f}:1 on paper, under {themes.AA}:1")
        return None

    won, values = {}, {}
    for token in ("accent", "paper", "accent_ink", "panel", "ink"):    # paper before ink: ink checks its contrast on paper
        got = tier_value(token, values.get("paper"))
        if got and got[0]:
            values[token], won[token] = got
    for token in FONT_TOKENS:
        got = tier_value(token, None)
        if got and got[0]:
            values[token], won[token] = got

    # The brand JSON the renderers read: the --brand file, with any token a higher or lower tier gave beyond it.
    given_by_file = {t for t, tier in won.items() if tier == "brand_file"}
    merged = copy.deepcopy(brand_file) if brand_file else None
    overlay = {t: v for t, v in values.items() if t not in given_by_file}
    if overlay:
        merged = merged or {}
        colors = dict(merged.get("colors") or {})
        for t, v in overlay.items():
            if t in COLOUR_TOKENS:
                for k in [k for k in colors if themes.LEGACY_KEYS.get(k, k) == t]:
                    del colors[k]
                colors[t] = v
            else:
                merged[t] = v
        if colors:
            merged["colors"] = colors
    logos = dict((kit or {}).get("logos") or {})
    if logos.get("dark") and merged is not None and not merged.get("logo_dark_svg") and str(logos["dark"]).lstrip().startswith("<svg"):
        merged["logo_dark_svg"] = logos["dark"]       # a client's logo for the cover (its own, never recoloured)
    bans = list((kit or {}).get("imagery_bans") or [])

    has_pack = style is not None and getattr(style, "source", "") != "built-in default"
    if not overlay and not has_pack and not logos:
        return Look(brand=brand_file, theme=None, imagery_bans=bans, logos=logos, problems=problems, won=won)

    t = themes.get_theme(theme, merged)
    tokens_from = {f: ("derived" if f in t.derived else won.get(f, "default")) for f in themes.COLOR_FIELDS}
    tokens_from.update({f: won.get(f, "default") for f in FONT_TOKENS})
    if strict_brand and t.derived:
        problems.append("strict_brand: derived only to reach contrast: " + ", ".join(t.derived))
    for p in themes.check_palette(t):
        if p not in problems:
            problems.append(p)
    tiers = [tier for tier in TIERS if tier in set(won.values())]
    fonts = {"head": t.head, "body": t.body}
    fall = []
    for token in FONT_TOKENS:
        ptr = pack_type.get(token) or {}
        if won.get(token) == "style_pack" and isinstance(ptr.get("fallback"), list):
            fall += [str(x) for x in ptr["fallback"]][:2]
    if fall:
        fonts["fallback"] = fall[:2]
    s, g = t.scale, t.grid
    rec = {"name": t.name, "source": tiers[0] if tiers else "default",
           "colors": {f: getattr(t, f) for f in themes.COLOR_FIELDS},
           "fonts": fonts,
           "scale": {k: getattr(s, k) for k in ("display", "title", "title_min", "lead", "body", "small", "caption", "body_floor", "caption_floor", "foot_floor")},
           "grid": {"margin_in": g.M, "gutter_in": g.G, "unit_in": g.unit},
           "from": tokens_from, "derived": list(t.derived), "problems": problems}
    if "brand_clan" in tiers and (kit or {}).get("kit"):
        rec["kit"] = kit["kit"]
    if has_pack:
        rec["style_pack"] = {k: v for k, v in (("document_id", style.document_id), ("version", style.version), ("hash", style.hash)) if v is not None}
    if ag and "agency_look" in tiers:
        rec["agency"] = {k: ag[k] for k in ("id", "rev") if ag.get(k) is not None}
        if ag.get("accent_use"):
            rec["accent_use"] = "outline" if ag["accent_use"] == "line" else "fill"
    return Look(brand=merged, theme=rec, imagery_bans=bans, logos=logos, problems=problems, won=won)
