"""The picture plan's scene brief and scene cards (spec.PICTURE_PLAN; Claude outputs/pipeline-test/picture-plan.md).

Round 3: over half the pictures were never the described scene (the lint refused 32 of 57 subjects and a mood template replaced each), and
stage g never saw the brief's market, setting, category or audience, so pictures drifted to "a shop" or "a home". Here:

- ``scene_brief``: one per deck, built in code from the inputs and stages: the market (and its code-owned cue pack), the setting locked for
  the deck (from the channels and deliverables), the category as a generic noun, the audience, the key visual (the chosen territory and the
  idea), the near-miss settings it must not be. Stage g gets it with every slot.
- ``slots_for``: 3 to 5 pictures a deck: the cover, the idea, the hero execution (the first presented one) and, when presented, the audience.
- ``subject_of``: stage g answers per slot with a scene card (key_visual, setting, props, person, not); code assembles the subject,
  literal first: the key visual and the setting in one sentence, then props, the person and the "not" list.
- ``names_for``: the per-brief names deny-list for the scene lint (client, brands, competitors, people and places named in the brief).
"""
from __future__ import annotations

import re

#: Code-owned market cue packs: what a camera sees, never readable text (reviewed by PR, linted once, like Style Packs).
CUE_PACKS = {
    "ireland": "traffic on the left, double yellow lines, rendered terraces with slate roofs, painted timber shopfronts with blank fascia "
               "boards, soft overcast light; sign shapes are present and blank or out of focus",
    "romania": "traffic on the right, concrete apartment blocks with enclosed balconies, overhead tram wires, street kiosks, linden trees, "
               "strong continental light; sign shapes are present and blank or out of focus",
    "united kingdom": "traffic on the left, brick terraces, red post boxes, soft grey light; sign shapes are present and blank or out of focus",
}
MARKET_ALIASES = {"ireland": ("ireland", "irish", "dublin", "cork", "galway", "limerick"), "romania": ("romania", "romanian", "bucharest", "cluj",
                  "iasi", "timisoara"), "united kingdom": ("united kingdom", "uk", "britain", "british", "england", "london", "scotland", "wales")}
#: The setting a channel or deliverable puts the work in, first match wins (generic nouns only).
SETTINGS = (
    (r"\bin[- ]store\b|\bshelf\b|\bwobbler\b|\bpoint of sale\b|\bpos\b|\baisle\b|\bsupermarket\b|\bretail\b", "inside a large, bright shop, along a crowded shelf aisle"),
    (r"\bworkplace\b|\boffice\b|\bemployer\b|\bstaff\b", "an ordinary open-plan office"),
    (r"\bbus shelter\b|\boutdoor\b|\bbillboard\b|\bposter\b|\bdooh\b|\bstreet\b", "a busy street of the brief's town"),
    (r"\bdirect mail\b|\bletter\b|\bleaflet\b|\bbill insert\b|\bhousehold\b|\bhome\b|\bkitchen\b", "an ordinary family home"),
    (r"\bstation\b|\btransit\b|\bbike\b|\bcycle\b|\bcommut", "a city street at rush hour"),
)
#: The nearest wrong places for a setting (the "not" list stage g and the fit check read).
NEAR_MISS = {"shop": ["not a home", "not a field", "not a kitchen"], "office": ["not a clinic", "not a hospital", "not a care home", "not a corridor"],
             "home": ["not a shop", "not an office", "not a field"], "street": ["not a field", "not an interior"]}
#: Picture roles in the order the plan fills them, and the most a deck gets.
ROLES = ("title", "idea", "execution", "audience")
MAX_PICTURES = 5
MIN_PICTURES = 3


def _text(v) -> str:
    if isinstance(v, dict):
        return " ".join(_text(x) for x in v.values())
    if isinstance(v, list):
        return " ".join(_text(x) for x in v)
    return str(v or "")


def market_of(inp, evidence_market: str = "") -> str:
    """The brief's market as a cue-pack key ('' when the inputs name none): the evidence track's market first, else the brief and prompt."""
    hay = " ".join([evidence_market or "", _text({k: f.get("value") for k, f in (inp.brief or {}).items()}), str(getattr(inp, "prompt_text", "") or "")]).lower()
    for key, words in MARKET_ALIASES.items():
        if any(re.search(rf"\b{re.escape(w)}\b", hay) for w in words):
            return key
    return ""


def setting_of(texts: list) -> tuple:
    """``(setting, near_miss_key)`` from the channels, deliverables and requirements' words; ('', '') when none names a place."""
    hay = " ".join(map(str, texts)).lower()
    for pat, setting in SETTINGS:
        if re.search(pat, hay):
            key = "shop" if "shop" in setting else "office" if "office" in setting else "home" if "home" in setting else "street"
            return setting, key
    return "", ""


def scene_brief(inp, st: dict, evidence_market: str = "") -> dict:
    """One scene brief per deck: ``{market, cues, setting, must_not, category, audience, key_visual}``. Built from the inputs and the stages
    (code, no model). The setting is locked for every slot; ``must_not`` names the nearest wrong places."""
    a, c, d = st.get("a") or {}, st.get("c") or {}, st.get("d") or {}
    chans = [x.get("channel") for x in d.get("executions") or [] if isinstance(x, dict)] + [r.get("text") for r in a.get("requirements") or [] if isinstance(r, dict)]
    chans += [_text((inp.brief.get(k) or {}).get("value")) for k in ("budget_scope", "mandatories", "tone_world_assets")]
    setting, key = setting_of(chans)
    market = market_of(inp, evidence_market)
    chosen = next((t for t in c.get("territories") or [] if t.get("id") == c.get("chosen")), None) or {}
    kv = (d.get("concept") or {}).get("key_visual") if isinstance(d.get("concept"), dict) else None
    kv = kv.get("description") if isinstance(kv, dict) else kv
    return {"market": market, "cues": CUE_PACKS.get(market, ""), "setting": setting, "must_not": NEAR_MISS.get(key, []),
            "category": _text((inp.brief.get("background") or {}).get("value"))[:200], "audience": _text((inp.brief.get("audience") or {}).get("value"))[:200],
            "key_visual": " ".join(x for x in (str(kv or ""), str(chosen.get("sketch") or ""), str(d.get("idea") or "")) if x)[:500]}


def names_for(inp, client: str = "", extra=()) -> list:
    """The per-brief names deny-list: the client, the brief's brands and competitors, and every capitalised word of the brief that is not a
    common word (people, places, products, job codes)."""
    from visuals import lint   # noqa: PLC0415
    ok = lint.allowed()
    out = [client, *extra]
    for k in ("competitor_context", "background", "audience", "tone_world_assets", "mandatories"):
        t = _text((inp.brief.get(k) or {}).get("value"))
        out += [w for w in re.findall(r"\b[A-Z][A-Za-z'-]{2,}", t) if w.lower() not in ok]
    return [n for n in dict.fromkeys(x.strip() for x in out if x and x.strip())]


def slots_for(deck: dict, cands: list) -> list:
    """The 3 to 5 slots a deck gets pictures in: the cover, the idea, the first presented execution (the hero) and, when presented, the
    audience; a second execution only when the deck would otherwise have fewer than three. Slots of any other slide are left empty."""
    from . import validate   # noqa: PLC0415
    shown = set(validate.presented(deck))
    by_role: dict = {}
    for c in cands:
        s = deck["slides"][c["sid"]]
        t = s["type"]
        if t not in ROLES or c["sid"] not in shown or c["slot"] != "picture":
            continue
        by_role.setdefault(t, []).append(c)
    out = [by_role[r][0] for r in ("title", "idea", "execution", "audience") if by_role.get(r)]
    if len(out) < MIN_PICTURES and len(by_role.get("execution") or []) > 1:
        out.append(by_role["execution"][1])
    return out[:MAX_PICTURES]


def subject_of(card: dict, scene: dict, max_len: int | None = None) -> str:
    """The subject code assembles from a scene card, literal first: the key visual and the setting in one sentence, then the props, the
    person and the 'not' list. '' when the card has no key visual. Held to ``max_len`` characters (images.SUBJECT_MAX by default) by
    dropping the props, then the person, then the later 'not' items, and only then cutting at a word: a word is never cut in two (round 3's
    re-render: a subject cut at the limit left a fragment the lint read as a name)."""
    kv = str((card or {}).get("key_visual") or "").strip().rstrip(".")
    if not kv:
        return ""
    if max_len is None:
        from . import images   # noqa: PLC0415
        max_len = images.SUBJECT_MAX
    setting = str(card.get("setting") or scene.get("setting") or "").strip().rstrip(".")
    head = f"{kv}, {setting}." if setting and setting.lower() not in kv.lower() else f"{kv}."
    extra = {k: str(card.get(k) or "").strip().rstrip(".") for k in ("props", "person")}
    nots = [str(x).strip().rstrip(".") for x in (card.get("not") or scene.get("must_not") or []) if str(x).strip()]
    nots = [x if x.lower().startswith("not ") else f"not {x}" for x in nots][:4]

    def build(props: bool, person: bool, n_not: int) -> str:
        parts = [head] + [extra[k] + "." for k, on in (("props", props), ("person", person)) if on and extra[k]]
        if nots[:n_not]:
            parts.append(", ".join(nots[:n_not]) + ".")
        out = " ".join(parts)
        return out[0].upper() + out[1:]
    for props, person, n in ((True, True, 4), (False, True, 4), (False, False, 4), (False, False, 2), (False, False, 1), (False, False, 0)):
        out = build(props, person, n)
        if len(out) <= max_len:
            return out
    cut = out[:max_len].rsplit(" ", 1)[0].rstrip(" ,;:")
    return cut + "."
