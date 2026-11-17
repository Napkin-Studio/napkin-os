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
3. **Agency look.** The signed-in person's agency, once the agency has set one up: its ACCENT (``accent``, ``accent_ink``)
   dresses every new deck with no switch, and a deck opts out with ``look.agency_look.use: false`` (Sai, 17 Nov 2026,
   Q3: industry practice, as in Pitch and Canva). Nothing else of the agency look is read: its ``base`` is shell chrome,
   and there is no logo or wordmark. An agency with no look changes nothing, and an existing deck keeps the look it was
   built with (``run_deck`` replays the recorded look; "update to current look" is a person's action). Not behind
   ``inputs.library.enabled``: it adds no word or number.
4. **Default.** The named theme (``napkin``, or ``classic``).

A pale accent (under 3:1 on the paper) is a fill only: thin lines, rules and chart series take ``accent_line``, the default
accent. After merging, an ``ink``, ``paper`` or ``accent_ink`` that cannot be read against the others (4.5:1) is reset to the
default when the clash is between two tiers: the lower tier loses.

A client's logo (the kit's dark-ground logo) is placed only when the kit's brand name matches the brief's client; otherwise it
is held and the deck says so (``meta.theme.held``).

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

    Returns ``{name, colours: {role: hex}, colour_ids: {id: hex}, fonts: {head, body}, type_ids: {id: family}, logos: {light, dark},
    logo_placement, imagery_bans: [], chart: [], kit: {document_id, version}}``. This is the one place that will know
    Contract 6's shape (visual.colours roles, typography, logos, imagery, rules); until Contract 6 is merged and Shrey
    has answered the asks in features/deck-look-kits.clan (design.shrey_asks) it is a stub and returns nothing, with
    or without a kit attached. A deck works without it.
    """
    return {"name": "", "colours": {}, "colour_ids": {}, "fonts": {}, "type_ids": {}, "logos": {}, "logo_placement": None,
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
    logo: dict | None = None                      # {data (svg text or png bytes), name, placement}: the client's logo, cleared to be placed
    held: list = field(default_factory=list)      # what the look held back, with the reason (never dropped silently)


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
    """The agency look as tokens, or None. Only the accent is read (``accent``, ``accent_ink``) and the ``id`` and ``rev`` it is stamped
    with: ``base`` is shell chrome, and the look has no logo or wordmark here."""
    if not agency or not isinstance(agency, dict):
        return None
    out = {}
    for k in ("accent", "accent_ink"):
        if agency.get(k):
            h = _hex(agency[k])
            if h:
                out[k] = h
            else:
                problems.append(f"agency look {k} {agency[k]!r} is not a 6-digit hex colour: ignored")
    return {**out, "id": agency.get("id"), "rev": agency.get("rev")} if out else None


def _pack_pointer(ptr: dict, token: str, brand: dict | None, agency: dict | None, strict: bool, wears_kit: bool = False):
    """One Style Pack deck pointer as a value, or None to fall through."""
    if not isinstance(ptr, dict):
        return None
    if "brand" in ptr:
        if not wears_kit:   # a client kit's colours reach the deck only when it wears the client (Q1): a pointer cannot sidestep that
            return None
        src = (brand or {}).get("colour_ids" if token in COLOUR_TOKENS else "type_ids") or {}
        return src.get(ptr["brand"])
    if "agency" in ptr:
        return (agency or {}).get(ptr["agency"]) if token in COLOUR_TOKENS and ptr["agency"] == "accent" else None
    if strict:
        return None
    if "hex" in ptr:
        return _hex(ptr["hex"])
    if "family" in ptr and token in FONT_TOKENS:
        return str(ptr["family"]).strip() or None
    return None


def resolve(*, theme: str = themes.DEFAULT, wears: str = "agency", strict_brand: bool = False, brand_file: dict | None = None,
            brand: dict | None = None, style=None, agency: dict | None = None, use_agency: bool = True, master: bool = False,
            client: str = "") -> Look:
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

    def tier_value(token: str):
        """(value, tier) for a token: the highest tier that gives it, else None."""
        if wears_kit:
            v = ((kit.get("colours") if token in COLOUR_TOKENS else kit.get("fonts")) or {}).get(token)
            if v:
                return (_hex(v) if token in COLOUR_TOKENS else str(v)), "brand_clan"
        if token in file_t:
            return file_t[token], "brand_file"
        ptr = (pack_colours if token in COLOUR_TOKENS else pack_type).get(token)
        if ptr:
            v = _pack_pointer(ptr, token, kit, ag, strict_brand, wears_kit)
            if v:
                return (_hex(v) if token in COLOUR_TOKENS else str(v)), "style_pack"
        if ag:
            if token == "accent" and ag.get("accent"):
                return ag["accent"], "agency_look"
            if token == "accent_ink" and ag.get("accent_ink"):
                return ag["accent_ink"], "agency_look"
        return None

    won, values = {}, {}
    for token in ("accent", "paper", "accent_ink", "panel", "ink"):
        got = tier_value(token)
        if got and got[0]:
            values[token], won[token] = got
    for token in FONT_TOKENS:
        got = tier_value(token)
        if got and got[0]:
            values[token], won[token] = got

    _reset_unreadable(theme, values, won, problems)

    # A pale accent is a fill only: lines, rules and chart series take the default accent instead.
    default_t = themes.get_theme(theme)
    paper_f = values.get("paper") or default_t.paper
    line = None
    if values.get("accent") and themes.contrast(values["accent"], paper_f) < LINE_MIN:
        line = default_t.accent if themes.contrast(default_t.accent, paper_f) >= LINE_MIN else themes.tune(default_t.accent, paper_f, LINE_MIN)
        problems.append(f"accent {values['accent']} is {themes.contrast(values['accent'], paper_f):.2f}:1 on paper, under {LINE_MIN}:1: "
                        f"used for fills only; lines, rules and chart series use {line}")

    # The brand JSON the renderers read: the --brand file, with any token a higher or lower tier gave beyond it.
    given_by_file = {t for t, tier in won.items() if tier == "brand_file"}
    merged = copy.deepcopy(brand_file) if brand_file else None
    overlay = {t: v for t, v in values.items() if t not in given_by_file}
    if overlay or line:
        merged = merged or {}
        colors = dict(merged.get("colors") or {})
        for t, v in overlay.items():
            if t in COLOUR_TOKENS:
                for k in [k for k in colors if themes.LEGACY_KEYS.get(k, k) == t]:
                    del colors[k]
                colors[t] = v
            else:
                merged[t] = v
        if line:
            colors["accent_line"] = line
        if colors:
            merged["colors"] = colors

    # The client's logo: placed only for a brand the information already names (ADR 0027), else held and said so.
    logos = dict((kit or {}).get("logos") or {})
    logo, held = None, []
    if logos.get("dark"):
        bname = str((kit or {}).get("name") or "")
        if same_name(bname, client):
            logo = {"data": logos["dark"], "name": bname, "placement": (kit or {}).get("logo_placement") or "cover_only"}
        else:
            held.append(f"The brand kit's logo is held: the kit is for \"{bname or 'an unnamed brand'}\" and the brief's client is "
                        f"\"{client or 'not named'}\". A logo is placed only for a brand the information already names.")
    bans = list((kit or {}).get("imagery_bans") or [])

    has_pack = style is not None and getattr(style, "source", "") != "built-in default"
    if not overlay and not line and not has_pack and not logos:
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
    if t.accent_line:
        rec["accent_line"] = t.accent_line
    if held:
        rec["held"] = held
        problems.extend(held)
    if "brand_clan" in tiers and (kit or {}).get("kit"):
        rec["kit"] = kit["kit"]
    if has_pack:
        rec["style_pack"] = {k: v for k, v in (("document_id", style.document_id), ("version", style.version), ("hash", style.hash)) if v is not None}
    if ag and "agency_look" in tiers:
        rec["agency"] = {k: ag[k] for k in ("id", "rev") if ag.get(k) is not None}
    return Look(brand=merged, theme=rec, imagery_bans=bans, logos=logos, problems=problems, won=won, logo=logo, held=held)


#: Below this a colour is a fill only (WCAG's 3:1 for graphical objects and large text).
LINE_MIN = 3.0


def _name_words(name: str) -> list:
    """The words of a name with accents and compatibility forms folded, lower case, nothing stripped."""
    import unicodedata   # noqa: PLC0415
    text = "".join(c for c in unicodedata.normalize("NFKD", str(name or "")) if not unicodedata.combining(c)).casefold()
    return re.findall(r"[a-z0-9]+", text)


def same_name(brand: str, client: str) -> bool:
    """True only when a kit's brand name and the brief's client are the same words (accents folded, case and punctuation ignored). Nothing is
    stripped and a prefix does not match: anything else holds the logo."""
    b, c = _name_words(brand), _name_words(client)
    return bool(b and b == c)


def _reset_unreadable(theme: str, values: dict, won: dict, problems: list) -> None:
    """After the tiers are merged, a pair of tokens from different tiers that cannot be read against each other (4.5:1) is not left to
    a warning: the lower tier's token is reset to the default. A clash inside one tier (a brand's own palette) is left as it is."""
    d = themes.get_theme(theme)
    val = lambda t: values.get(t) or getattr(d, t)   # noqa: E731
    for _ in range(4):
        for a, b, other in (("ink", "paper", None), ("ink", "panel", None), ("accent_ink", "paper", None), ("accent_ink", "panel", None)):
            if a == "accent_ink" and a not in values:   # an accent_ink nobody gave is derived to read: nothing to reset
                continue
            r = themes.contrast(val(a), val(b))
            if r >= themes.AA:
                continue
            given = [t for t in (a, b) if t in values]
            if not given:
                continue
            rank = {t: TIERS.index(won[t]) for t in given}
            if len(given) == 2 and rank[a] == rank[b]:
                if won[a] != "style_pack":   # a brand's own palette is left as it is and named; a pack's is not
                    continue
                gone_all = [a, b]
            else:
                gone_all = [max(given, key=lambda t: rank[t])]
            for gone in gone_all:
                problems.append(f"{gone} {values[gone]} ({won[gone].replace('_', ' ')}) is {r:.2f}:1 against {b if gone == a else a}, under {themes.AA}:1: "
                                f"reset to the default")
                del values[gone], won[gone]
            break
        else:
            return


# ------------------------------------------------------------------ the client's logo: one path, as a deck asset

class LogoError(ValueError):
    pass


_SVG_OK = {"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "lineargradient", "radialgradient",
           "stop", "clippath", "mask", "title", "desc"}
_MAX_LOGO = 2 * 1024 * 1024


def sanitise_svg(text: str) -> str:
    """A logo SVG with nothing active in it, or LogoError: no DOCTYPE or entity, no script, style, image, use or foreignObject
    element, no event attribute, no link that leaves the file, no url() that is not a local reference. A logo that cannot be made safe is
    refused and held (never altered or placed as it is)."""
    import xml.etree.ElementTree as ET   # noqa: PLC0415
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    if re.search(r"<!(DOCTYPE|ENTITY)", text, re.I):
        raise LogoError("the logo SVG has a DOCTYPE or entity")
    if len(text.encode()) > _MAX_LOGO:
        raise LogoError("the logo SVG is over 2 MB")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        raise LogoError(f"the logo SVG does not parse: {e}") from e
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1].lower() if isinstance(el.tag, str) else ""
        if tag not in _SVG_OK:
            raise LogoError(f"the logo SVG holds a <{tag or 'comment'}> element, which is not allowed")
        for k, v in el.attrib.items():
            name = k.rsplit("}", 1)[-1].lower()
            if name.startswith("on"):
                raise LogoError(f"the logo SVG holds an event attribute ({name})")
            if name == "href" and not str(v).startswith("#"):
                raise LogoError("the logo SVG links outside itself")
            if re.search(r"url\(\s*['\"]?(?!#)", str(v), re.I) or re.search(r"javascript:|data:", str(v), re.I):
                raise LogoError(f"the logo SVG holds an external or active reference in {name}")
    return ET.tostring(root, encoding="unicode")


def rasterise_svg(svg: str, height_px: int = 360) -> bytes:
    """PNG bytes of a (sanitised) SVG, with ``rsvg-convert``; LogoError when it is not installed or fails."""
    import shutil, subprocess   # noqa: E401, PLC0415
    exe = shutil.which("rsvg-convert")
    if not exe:
        raise LogoError("no SVG rasteriser (rsvg-convert) is installed, so the logo cannot go into the .pptx")
    try:
        r = subprocess.run([exe, "-h", str(height_px), "-f", "png"], input=svg.encode(), capture_output=True, timeout=60)
    except subprocess.TimeoutExpired as e:
        raise LogoError("the logo SVG took too long to rasterise") from e
    if r.returncode or not r.stdout.startswith(b"\x89PNG"):
        raise LogoError("the logo SVG could not be rasterised")
    return r.stdout


def make_logo_asset(logo: dict, assets_dir) -> tuple[str, dict]:
    """The cleared client logo as a deck asset: ``(asset id, record)``. An SVG is sanitised and rasterised to PNG; a PNG is checked. The
    file is written once at ``assets_dir/<sha256>.png`` (``assets/<sha256>.png`` in the run folder) and the record has rights
    ``client_supplied``. Raises LogoError; the caller holds the logo and says why."""
    import hashlib   # noqa: PLC0415
    from io import BytesIO   # noqa: PLC0415
    from pathlib import Path   # noqa: PLC0415
    data = logo["data"]
    png = rasterise_svg(sanitise_svg(data)) if isinstance(data, str) else bytes(data)
    if len(png) > _MAX_LOGO or not png.startswith(b"\x89PNG"):
        raise LogoError("the logo is not a PNG under 2 MB")
    try:
        from PIL import Image   # noqa: PLC0415
        im = Image.open(BytesIO(png))
        im.verify()
        w, h = Image.open(BytesIO(png)).size
    except Exception as e:   # noqa: BLE001
        raise LogoError(f"the logo image is not readable: {e}") from e
    sha = hashlib.sha256(png).hexdigest()
    d = Path(assets_dir)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{sha}.png").write_bytes(png)
    return "img_" + sha[:12], {"sha256": sha, "file": f"assets/{sha}.png", "mime": "image/png", "width": w, "height": h, "bytes": len(png),
                               "rights": "client_supplied"}
