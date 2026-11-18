"""Deck types: what a deck is for decides its spine, stages, strictness and guidance (deck types: features/deck-maker-intake.clan).

A tender response, a credentials deck, an investor deck and an agency pitch need different things, so
the engine does not guess one shape. Each type is one data file, ``profiles/<id>.yaml``, loaded and
checked here (``load`` fails loudly on an unknown slide type, stage, check or brief field). Code in
this module reads those files; it never rewords a slide. A profile may

* order and filter the slides (``spine``, ``appendix``, ``buyer_order``: assemble._arrange_spine);
* say which model stages run (``stages``);
* set the length (``length``: the most presented slides, minutes, an optional least);
* name the validator checks that are errors rather than warnings (``strict``: validate.run);
* append guidance lines to a stage's prompt (``prompt_guidance``: stages._sysmsg) and ask type-specific
  intake questions (``questions``);
* hold a recipe (deck-types: ``recipe`` and ``length.target / cap``, resolved by ``recipe``, read only when ``recipes_on``).

A profile may not add a fact, a name or a legal line to a slide (ADR 0023, 0028): guidance reaches a
model's prompt, and the model's words are still traced, cited and checked like any other.
``arrange: legacy`` keeps the assembler's own arrangement (agency_pitch and investor_seed build exactly
as they did before types existed); ``arrange: spine`` orders and filters by the profile.

Each profile derives from the research in docs/deck-maker/winning-pitch (GUIDE.md, RUBRIC.md,
rubric.json, NAPKIN-EDGE.md); the source is named in a comment in its file.
"""
from __future__ import annotations

import copy
import re
from pathlib import Path

import yaml

from . import spec
from .inputs import BRIEF_FIELDS

PROFILE_DIR = Path(__file__).parent / "profiles"
#: The ``--kind`` values and the profile each selects (agency and investor are unchanged).
KIND_TO_PROFILE = {"agency": "agency_pitch", "investor": "investor_seed", "tender": "tender_response", "credentials": "credentials",
                   "creative": "creative_work"}
#: Every model stage a profile may run (stages.py). ``fit`` and ``e`` run on the assembled deck.
STAGES = ("a0", "a", "b", "c", "d", "i", "fit", "e")
#: The assemblers a profile's ``kind`` names (spec.KINDS).
KINDS = spec.KINDS
ARRANGE = ("legacy", "spine")
#: The nine criteria of rubric.json, in its order: a profile's ``rubric_weights.weights`` has exactly these.
RUBRIC_IDS = ("compliance_gate", "problem_objective", "insight", "idea_chain", "evidence_trace",
              "headline_fit_limits", "team_proof", "commercials_ask", "presentability")
#: rubric.json (2026-10-16): our own default split, not a published standard and not validated.
DEFAULT_WEIGHTS = {"compliance_gate": 12, "problem_objective": 12, "insight": 14, "idea_chain": 14, "evidence_trace": 14,
                   "headline_fit_limits": 8, "team_proof": 10, "commercials_ask": 6, "presentability": 10}
WEIGHTS_LABEL = "default, not validated"

#: The shape of a profile file: field -> (python type, required). Checked by ``validate_profile``.
SCHEMA = {
    "id": (str, True), "label": (str, True), "one_line": (str, True), "kind": (str, True), "arrange": (str, True),
    "spine": (list, True), "appendix": (list, False), "buyer_order": (list, False), "stages": (list, True),
    "length": (dict, True), "rubric_weights": (dict, True), "strict": (dict, True), "prompt_guidance": (dict, True),
    "questions": (list, True), "sources": (list, False), "recipe": (dict, False),
}
#: deck-types: the keys of a profile's optional ``recipe`` block (design.schema.recipe). ``full`` repeats them for format full.
#: ``graphics`` (deck-graphics): {icons, mockups: bool}, read by graphics.part_on only under spec.GRAPHICS.
RECIPE_KEYS = ("layouts", "density", "pictures", "brand", "titles", "size", "format", "full", "graphics")
#: deck-graphics: the parts a recipe (or a deck's meta.preferences.look.graphics) may turn on or off. Charts and diagrams have no switch:
#: they follow the deck's own data and the fit.
GRAPHICS_PARTS = ("icons", "mockups")


class ProfileError(ValueError):
    """A profile file that is not valid, or an id with no profile."""


def _is_int(v) -> bool:
    """True for a real integer: a bool is not one here."""
    return isinstance(v, int) and not isinstance(v, bool)


def validate_profile(p) -> list:
    """Errors in a profile dict against SCHEMA and the engine's own vocabularies; an empty list means
    valid. Slide types must be in spec.SLIDE_TYPES, stages in STAGES, strict checks in spec.CHECKS,
    guidance stages in STAGES, questions addressed ``brief.<field>``, and the weights must be the
    rubric's nine criteria summing to 100."""
    if not isinstance(p, dict):
        return ["a profile is not an object"]
    errs = []
    for k, (typ, req) in SCHEMA.items():
        if k not in p:
            if req:
                errs.append(f"missing {k}")
        elif not isinstance(p[k], typ):
            errs.append(f"{k} must be a {typ.__name__}")
    errs += [f"unknown field {k}" for k in p if k not in SCHEMA]
    if errs:
        return errs
    if not re.fullmatch(r"[a-z][a-z0-9_]*", p["id"]):
        errs.append(f"id {p['id']!r} must be lower-case words joined by _")
    if p["kind"] not in KINDS:
        errs.append(f"kind {p['kind']!r} must be one of {', '.join(KINDS)}")
    if p["arrange"] not in ARRANGE:
        errs.append(f"arrange {p['arrange']!r} must be one of {', '.join(ARRANGE)}")
    for k in ("spine", "appendix", "buyer_order"):
        for t in p.get(k) or []:
            if not isinstance(t, str) or t not in spec.SLIDE_TYPES:
                errs.append(f"{k}: unknown slide type {t!r}")
    if not p["spine"]:
        errs.append("spine is empty")
    if errs:
        return errs
    if p.get("buyer_order") and not set(p["buyer_order"]) <= set(p["spine"]):
        errs.append("buyer_order may only name types in the spine")
    for s in p["stages"]:
        if s not in STAGES:
            errs.append(f"stages: unknown stage {s!r}")
    L = p["length"]
    for k in ("max_slides", "minutes"):
        if not _is_int(L.get(k)) or L[k] < 1:
            errs.append(f"length.{k} must be a whole number of at least 1")
    if L.get("min_slides") is not None and not (_is_int(L["min_slides"]) and 1 <= L["min_slides"] <= L.get("max_slides", 0)):
        errs.append("length.min_slides must be a whole number from 1 to max_slides")
    errs += _length_target_errors(L)
    if "recipe" in p:
        errs += recipe_errors(p["recipe"], p["spine"])
    w = p["rubric_weights"]
    ws = w.get("weights")
    if not isinstance(ws, dict) or set(ws) != set(RUBRIC_IDS):
        errs.append("rubric_weights.weights must hold exactly the rubric's nine criteria")
    elif not all(_is_int(v) or (isinstance(v, float)) for v in ws.values()) or any(isinstance(v, bool) for v in ws.values()):
        errs.append("rubric_weights.weights must all be numbers")
    elif sum(ws.values()) != 100:
        errs.append(f"rubric_weights.weights sum to {sum(ws.values())}, not 100")
    if w.get("basis") != WEIGHTS_LABEL:
        errs.append(f"rubric_weights.basis must say {WEIGHTS_LABEL!r}")
    for a in w.get("adjustments") or []:
        if not (isinstance(a, dict) and a.get("criterion") in RUBRIC_IDS and a.get("why")):
            errs.append(f"rubric_weights.adjustments: {a!r} needs a rubric criterion and a why")
    for c, lvl in p["strict"].items():
        if c not in spec.CHECKS:
            errs.append(f"strict: unknown check {c!r}")
        if lvl not in ("error", "warn"):
            errs.append(f"strict.{c} must be 'error' or 'warn'")
    for st, lines in p["prompt_guidance"].items():
        if st not in STAGES:
            errs.append(f"prompt_guidance: unknown stage {st!r}")
        if not (isinstance(lines, list) and all(isinstance(x, str) and x.strip() for x in lines)):
            errs.append(f"prompt_guidance.{st} must be a list of lines")
    for q in p["questions"]:
        if not isinstance(q, dict):
            errs.append(f"questions: {q!r} needs a 'q_' id, text, allow_text and a 'brief.<field>' address")
            continue
        addr = str(q.get("address") or "")
        if not (str(q.get("id", "")).startswith("q_") and q.get("text") and addr.startswith("brief.")
                and addr[6:].split(".")[0] in BRIEF_FIELDS and isinstance(q.get("allow_text"), bool)):
            errs.append(f"questions: {q!r} needs a 'q_' id, text, allow_text and a 'brief.<field>' address")
    return errs


# ---------------------------------------------------------------- deck-types: the recipe (features/deck-types.clan)
#
# A deck type is a full recipe: besides its spine, a profile may hold ``length.target`` / ``length.cap`` and a ``recipe`` block
# (layout preferences per slide type, density, pictures, brand, titles, size, format, and ``full`` overrides). ``recipe`` resolves it
# once into one dict whose every key is present; a profile with neither gives today's constants exactly. Readers use it only when
# ``recipes_on`` (spec.RECIPES and spec.LOOK_V3): with the flag off nothing reads it and a build is byte-identical.

def _length_target_errors(L: dict) -> list:
    """``length.target`` and ``length.cap``: whole numbers or null (null: no target, no advisory cap; tender), with
    min_slides <= target <= cap <= max_slides wherever both sides are given."""
    errs = []
    for k in ("target", "cap"):
        if k in L and L[k] is not None and not (_is_int(L[k]) and L[k] >= 1):
            errs.append(f"length.{k} must be a whole number of at least 1, or null")
    if errs:
        return errs
    chain = [("min_slides", L.get("min_slides")), ("target", L.get("target")), ("cap", L.get("cap")), ("max_slides", L.get("max_slides"))]
    given = [(k, v) for k, v in chain if _is_int(v)]
    for (k1, v1), (k2, v2) in zip(given, given[1:]):
        if v1 > v2:
            errs.append(f"length.{k1} ({v1}) must not be over length.{k2} ({v2})")
    return errs


def recipe_errors(r, spine: list, _nested: bool = False) -> list:
    """Errors in a ``recipe`` block against the engine's closed sets (design.schema.recipe); an empty list means valid.

    * ``layouts``: ``{slide type in the spine: [layout id, ...]}``, at most spec.RECIPE_MAX_PREFS each; an id must be a layout the engine
      knows (spec.LAYOUT_IDS, LAYOUT_IDS_V3, or one deck-look has named and not built yet, spec.LAYOUT_IDS_PLANNED). An id that exists
      but does not take that slide type yet is not an error: ``recipe`` lists it as not built and the general rules take the slide.
    * ``density``: ``level`` in spec.DENSITY_LEVELS, ``roles`` {slide type: statement | argument}, ``windows`` {role: [lo, hi]}, 1 <= lo < hi
      and hi at most the largest slide budget.
    * ``pictures``: ``on`` in spec.PICTURES_ON except custom, ``generate`` in spec.RECIPE_GENERATE, ``types`` within spec.PICTURE_SLIDE_TYPES.
    * ``brand`` {strict: bool}, ``titles`` {form: spec.RECIPE_TITLE_FORMS}, ``size`` in spec.RECIPE_SIZES, ``format`` in spec.FORMATS,
      ``full``: the same keys again (no ``full`` or ``format`` inside).
    * ``graphics`` (deck-graphics): {icons, mockups: true | false}; only graphics.part_on reads it, under spec.GRAPHICS."""
    if not isinstance(r, dict):
        return ["recipe must be an object"]
    errs = []
    allowed = [k for k in RECIPE_KEYS if not (_nested and k in ("full", "format"))]
    errs += [f"recipe: unknown key {k!r}" for k in r if k not in allowed]
    known = set(spec.LAYOUT_IDS) | set(spec.LAYOUT_IDS_V3) | set(spec.LAYOUT_IDS_PLANNED)
    lay = r.get("layouts")
    if lay is not None:
        if not isinstance(lay, dict):
            errs.append("recipe.layouts must be an object of slide type -> layout ids")
        else:
            for t, ids_ in lay.items():
                if t not in spec.SLIDE_TYPES:
                    errs.append(f"recipe.layouts: unknown slide type {t!r}")
                elif t not in spine:
                    errs.append(f"recipe.layouts: {t} is not in the spine")
                if not (isinstance(ids_, list) and ids_ and all(isinstance(x, str) for x in ids_)):
                    errs.append(f"recipe.layouts.{t} must be a list of layout ids")
                    continue
                if len(ids_) > spec.RECIPE_MAX_PREFS:
                    errs.append(f"recipe.layouts.{t}: at most {spec.RECIPE_MAX_PREFS} layouts")
                if len(set(ids_)) != len(ids_):
                    errs.append(f"recipe.layouts.{t}: a layout is listed twice")
                errs += [f"recipe.layouts.{t}: unknown layout {x!r}" for x in ids_ if x not in known]
    d = r.get("density")
    if d is not None:
        if not isinstance(d, dict) or set(d) - {"level", "roles", "windows"}:
            errs.append("recipe.density must be an object of level, roles and windows")
        else:
            if "level" in d and d["level"] not in spec.DENSITY_LEVELS:
                errs.append(f"recipe.density.level must be one of {', '.join(spec.DENSITY_LEVELS)}")
            roles = d.get("roles") or {}
            if not isinstance(roles, dict):
                errs.append("recipe.density.roles must be an object of slide type -> role")
            else:
                for t, role in roles.items():
                    if t not in spec.SLIDE_TYPES:
                        errs.append(f"recipe.density.roles: unknown slide type {t!r}")
                    elif t not in spine:
                        errs.append(f"recipe.density.roles: {t} is not in the spine")
                    if role not in spec.ROLE_WINDOWS:
                        errs.append(f"recipe.density.roles.{t} must be one of {', '.join(spec.ROLE_WINDOWS)}")
            wins = d.get("windows") or {}
            top = max(v["words"] for v in spec.SLIDE_TYPES.values())
            if not isinstance(wins, dict):
                errs.append("recipe.density.windows must be an object of role -> [lo, hi]")
            else:
                for role, w in wins.items():
                    if role not in spec.ROLE_WINDOWS:
                        errs.append(f"recipe.density.windows: unknown role {role!r}")
                    if not (isinstance(w, list) and len(w) == 2 and all(_is_int(x) for x in w) and 1 <= w[0] < w[1] <= top):
                        errs.append(f"recipe.density.windows.{role} must be [lo, hi] whole numbers, 1 <= lo < hi <= {top}")
    pc = r.get("pictures")
    if pc is not None:
        if not isinstance(pc, dict) or set(pc) - {"on", "generate", "types"}:
            errs.append("recipe.pictures must be an object of on, generate and types")
        else:
            if "on" in pc and (pc["on"] not in spec.PICTURES_ON or pc["on"] == "custom"):
                errs.append(f"recipe.pictures.on must be one of {', '.join(x for x in spec.PICTURES_ON if x != 'custom')}")
            if "generate" in pc and pc["generate"] not in spec.RECIPE_GENERATE:
                errs.append(f"recipe.pictures.generate must be one of {', '.join(spec.RECIPE_GENERATE)}")
            if "types" in pc and isinstance(pc["types"], list) and not pc["types"]:
                errs.append("recipe.pictures.types must name at least one slide type (leave it out for the default; pictures.on: none turns pictures off)")
            elif "types" in pc and not (isinstance(pc["types"], list) and set(pc["types"]) <= set(spec.PICTURE_SLIDE_TYPES)):
                errs.append("recipe.pictures.types must be picture slide types (spec.PICTURE_SLIDE_TYPES): an evidence slide takes no picture")
    b = r.get("brand")
    if b is not None and not (isinstance(b, dict) and set(b) <= {"strict"} and isinstance(b.get("strict", False), bool)):
        errs.append("recipe.brand must be {strict: true | false}")
    ti = r.get("titles")
    if ti is not None and not (isinstance(ti, dict) and set(ti) <= {"form"} and ti.get("form", "claim") in spec.RECIPE_TITLE_FORMS):
        errs.append(f"recipe.titles must be {{form: {' | '.join(spec.RECIPE_TITLE_FORMS)}}}")
    gr = r.get("graphics")
    if gr is not None and not (isinstance(gr, dict) and set(gr) <= set(GRAPHICS_PARTS) and all(isinstance(v, bool) for v in gr.values())):
        errs.append(f"recipe.graphics must be an object of {', '.join(GRAPHICS_PARTS)}: true | false")
    if "size" in r and r["size"] not in spec.RECIPE_SIZES:
        errs.append(f"recipe.size must be one of {', '.join(spec.RECIPE_SIZES)}")
    if "format" in r and r["format"] not in spec.FORMATS:
        errs.append(f"recipe.format must be one of {', '.join(spec.FORMATS)}")
    if "full" in r and not _nested:
        errs += [e.replace("recipe", "recipe.full", 1) for e in recipe_errors(r["full"], spine, _nested=True)]
    return errs


def recipes_on() -> bool:
    """True when the recipe readers run: spec.RECIPES (env DECK_RECIPES=1) and spec.LOOK_V3 both on (design.rules: LOOK_V3)."""
    return bool(spec.RECIPES and spec.LOOK_V3)


def recipe_defaults(fmt: str = "pitch") -> dict:
    """The recipe of a type with no ``recipe`` block and no ``length.target / cap``: today's constants, every key present."""
    return {
        "type": None, "format": fmt, "default_format": "pitch",
        "length": {"target": spec.PITCH_TARGET, "cap": spec.PITCH_CAP},
        "layouts": {}, "not_built": {},
        "density": {"level": spec.DENSITY_DEFAULTS.get(fmt, "detailed"), "roles": dict(spec.ROLE_OF_TYPE),
                    "windows": {k: list(v) for k, v in spec.ROLE_WINDOWS.items()}},
        "pictures": {"on": spec.PICTURES_ON[0], "generate": "all", "types": list(spec.PICTURE_SLIDE_TYPES)},
        "brand": {"strict": False}, "titles": {"form": "claim"}, "size": spec.RECIPE_SIZES[0],
    }


def recipe(profile: dict | None, fmt: str = "pitch") -> dict:
    """The resolved recipe of a deck type for a format (pitch | full): a fresh dict with every key present (``recipe_defaults`` for any
    key the profile leaves out; ``full`` overrides apply for format full). ``length``: the profile's ``length.target / cap`` (null: none),
    except that an env DECK_PITCH_TARGET / CAP set for the run wins (spec.PITCH_LENGTH_FROM_ENV). ``layouts``: the preferences the
    catalogue can draw today (the layout exists and takes the slide type), in the profile's order; ``not_built``: the ones it cannot
    yet (a layout deck-look has not built, or one that does not take that slide type), which the general rules stand in for.
    Pure data: no reader branches on the type's id."""
    out = recipe_defaults(fmt)
    if not profile:
        return out
    out["type"] = profile.get("id")
    L = profile.get("length") or {}
    for k in ("target", "cap"):
        if k in L and not spec.PITCH_LENGTH_FROM_ENV[k]:
            out["length"][k] = L[k]
    r = copy.deepcopy(profile.get("recipe") or {})
    parts = [r] + ([r["full"]] if fmt == "full" and isinstance(r.get("full"), dict) else [])
    for part in parts:
        if "layouts" in part:
            out["layouts"] = {t: list(v) for t, v in part["layouts"].items()}
        d = part.get("density") or {}
        if "level" in d:
            out["density"]["level"] = d["level"]
        out["density"]["roles"].update(d.get("roles") or {})
        out["density"]["windows"].update({k: list(v) for k, v in (d.get("windows") or {}).items()})
        out["pictures"].update(part.get("pictures") or {})
        out["brand"].update(part.get("brand") or {})
        out["titles"].update(part.get("titles") or {})
        for k in ("size",):
            if k in part:
                out[k] = part[k]
    if "format" in r:
        out["default_format"] = r["format"]
    from . import layouts   # late: layouts imports images (Pillow); a profile check without a recipe never needs it
    cat = layouts.catalogue()
    usable, missing = {}, {}
    for t, ids_ in out["layouts"].items():
        for x in ids_:
            (usable if t in cat.get(x, ()) else missing).setdefault(t, []).append(x)
    out["layouts"], out["not_built"] = usable, missing
    return out


def title_guidance(profile: dict | None) -> list:
    """deck-types slice 4: the stage e lines the type's title form selects (spec.TITLE_FORM_GUIDANCE), only when ``recipes_on``. ``claim`` (today's
    titles, agency and investor) and ``criterion`` (the tender's own stage e line already says it) select none, so recorded runs replay."""
    if not profile or not recipes_on():
        return []
    return list(spec.TITLE_FORM_GUIDANCE.get(recipe(profile)["titles"]["form"], ()))


def label_titles(profile: dict | None, fmt: str = "pitch") -> bool:
    """True when the type's titles are labels (recipe titles.form ``label``, read only when ``recipes_on``): the claim check (validate action_title)
    does not apply to them. A title is never rewritten either way."""
    return bool(profile) and recipes_on() and recipe(profile, fmt)["titles"]["form"] == "label"


def picture_policy(profile: dict | None, fmt: str = "pitch") -> dict | None:
    """deck-types slice 4: the recipe's picture policy ``{on, generate, types}`` (None with the recipes off: today's behaviour). ``on`` is only the
    default of the person's picture preference; ``types`` narrows which slides get empty slots; ``generate`` narrows which empty slots generation
    may plan (all, the cover only, none). A recipe never opens an evidence slide, raises the money cap or approves anything."""
    if not profile or not recipes_on():
        return None
    return dict(recipe(profile, fmt)["pictures"])


# ---------------------------------------------------------------- deck-types slice 6: changing the type later

class NeedsStages(Exception):
    """A type change that needs a model stage not yet run: the app names the stages and asks first (design.precedence.changing_later)."""

    def __init__(self, to_type: str, stages: list):
        """The type asked for and the model stages it needs, named in the message the app shows before anything runs."""
        self.to_type, self.stages = to_type, list(stages)
        super().__init__(f"changing to {to_type} needs new writing: stage{'s' if len(stages) != 1 else ''} {', '.join(stages)} "
                         f"{'have' if len(stages) != 1 else 'has'} not run for this deck. Confirm to run {'them' if len(stages) != 1 else 'it'} "
                         f"(--confirm-stages); pictures are kept either way")


#: Stages a type change never needs recorded first: a0 (intake) adds nothing when the brief supplies everything, and fit / e run on the assembled
#: deck (a recorded copy is re-applied by title; one that is missing only means no copy edit, never a wrong slide).
CHANGE_OPTIONAL = ("a0", "fit", "e")


def type_change(profile: dict, recorded: set) -> dict:
    """What building as ``profile`` costs, given the stage outputs already recorded (stage ids): ``{free, needs}``. ``free``: every stage the type
    runs is recorded (or optional, CHANGE_OPTIONAL), so the change is code only: re-arrange, re-plan, re-check, in seconds, no model call.
    ``needs``: the stages that must run first (the app asks; run_deck refuses a live run of them without --confirm-stages). Pictures are never
    part of it: no type, format or size change makes, re-makes or un-approves a picture."""
    needs = [s for s in profile["stages"] if s not in CHANGE_OPTIONAL and s not in recorded]
    return {"free": not needs, "needs": needs}


def change_sheet(old: dict | None, new: dict, recorded: set, slides: int | None = None) -> dict:
    """The Change sheet's message before a type change happens (design.ui.later): ``{free, needs, line}``. Free: 'Re-arranges N slides. No new
    writing. Pictures kept.' Otherwise: 'Needs new writing: <stages>. Pictures kept.' Engine words only; no slide word is read or written."""
    tc = type_change(new, recorded)
    if tc["free"]:
        n = f"{slides} slides" if slides else "the slides"
        line = f"Re-arranges {n} as {'an' if new['label'][0].lower() in 'aeiou' else 'a'} {new['label'].lower()}. No new writing. Pictures kept."
    else:
        line = f"Needs new writing: {', '.join(STAGE_WORDS.get(s, s) for s in tc['needs'])}. Pictures kept."
    return {**tc, "from": (old or {}).get("id"), "to": new["id"], "line": line}


#: What each model stage writes, in the Change sheet's words.
STAGE_WORDS = {"a": "the requirements", "b": "the storyline", "c": "the routes", "d": "the idea and executions", "i": "the investor story"}


# ---------------------------------------------------------------- deck-types slice 7: what the picker shows (generated, never hand-written)

#: The most mini slides a card's spine thumbnail draws (design.ui.thumbnail).
CARD_SPINE_MAX = 12
#: The picture word on a card: what the recipe's picture policy means to a person.
_PICTURE_WORDS = {"all": "many", "cover": "cover only", "none": "none generated"}


def _merged_away(spine: list) -> set:
    """Slide types a legacy pitch folds into another presented slide (spec.PITCH_MERGES, PITCH_MERGES_V3: recipes need the look), when both are in the spine."""
    return {into for keep, into, _ in spec.PITCH_MERGES + spec.PITCH_MERGES_V3 if keep in spine and into in spine}


def card_spine(profile: dict) -> tuple:
    """``(slide types, more)``: the presented spine a card draws, in story order, and how many more types the spine presents beyond
    CARD_SPINE_MAX. A ``spine`` type's spine is already its presented order (minus its appendix types). A ``legacy`` type's spine lists every
    type its assembler may use, so it is cut to what a pitch presents: the target's keeps (spec.TARGET_KEEPS), the slides that keep a merged one
    (channel_roles, measurement, team) and the types the recipe prefers a layout for; merged-away types are left out."""
    appx = set(profile.get("appendix") or [])
    pres = [t for t in profile["spine"] if t not in appx]
    if profile["arrange"] == "legacy":
        gone = _merged_away(profile["spine"])
        keep = set(spec.TARGET_KEEPS) | {k for k, into, _ in spec.PITCH_MERGES + spec.PITCH_MERGES_V3 if into in gone} \
            | set((profile.get("recipe") or {}).get("layouts") or {})
        pres = [t for t in pres if t in keep and t not in gone]
        if "team" in pres and "investment" in pres and pres.index("team") > pres.index("investment"):   # as _arrange_pitch: the team before the ask
            pres.remove("team")
            pres.insert(pres.index("investment"), "team")
    return pres[:CARD_SPINE_MAX], max(0, len(pres) - CARD_SPINE_MAX)


def _purpose(t: str, rec: dict, info: dict) -> str:
    """The layout purpose a thumbnail draws for a slide type: the first drawable preferred layout's, else the highest-priority rule layout that
    takes the type, else ``statement``."""
    for lid in rec["layouts"].get(t) or []:
        if info.get(lid, {}).get("purpose") in spec.LAYOUT_PURPOSES:
            return info[lid]["purpose"]
    rule = sorted((v["priority"], k) for k, v in info.items() if t in v["for_types"] and v["pick"] == "rule" and v["priority"])
    got = info[rule[-1][1]]["purpose"] if rule else None
    return got if got in spec.LAYOUT_PURPOSES else "statement"


def card_data() -> list:
    """What the picker shows, one card per type in ids() order (design.schema.resolver): ``{id, label, one_line, kind, flag, default_format, target,
    cap, max, size, pictures, stages, recipe_only, spine: [{type, section, purpose}], more}`` (``stages``: the model stages a change to this type needs
    recorded; ``recipe_only``: a type the picker hides unless the engine offers it). Generated into the Deck Maker template (``write_cards``) and compared with it
    by a test, so the app and the engine never disagree on types. Read from the profiles alone: the flags do not change a card."""
    from . import layouts   # late, as in recipe()
    info = layouts.purposes()
    out = []
    for pid in ids():
        p = load(pid)
        rec = recipe(p, "pitch")
        kinds = {v: k for k, v in KIND_TO_PROFILE.items()}
        spine, more = card_spine(p)
        pics = rec["pictures"]
        word = "none" if pics["on"] == "none" else _PICTURE_WORDS[pics["generate"]]
        if pics["generate"] == "all" and set(pics["types"]) != set(spec.PICTURE_SLIDE_TYPES):
            word = "few"
        out.append({"id": pid, "label": p["label"], "one_line": p["one_line"], "kind": p["kind"], "flag": kinds.get(pid),
                    "default_format": rec["default_format"], "target": rec["length"]["target"], "cap": rec["length"]["cap"],
                    "max": p["length"]["max_slides"], "size": rec["size"], "pictures": word,
                    "stages": [s for s in p["stages"] if s not in CHANGE_OPTIONAL],   # what a change to this type needs recorded (type_change)
                    "recipe_only": pid in spec.RECIPE_ONLY_TYPES,   # shown only when the engine says the recipes are on (run.types)
                    "spine": [{"type": t, "section": spec.SLIDE_TYPES[t]["section"], "purpose": _purpose(t, rec, info)} for t in spine],
                    "more": more})
    return out


#: The template the picker lives in, and the markers of its generated block.
TEMPLATE = Path(__file__).resolve().parents[2] / "app" / "templates" / "deck-maker" / "index.html"
CARDS_OPEN = "/* @generated deck-type-cards (python3 -m deck.profiles cards, from engine/): do not edit by hand */ "
CARDS_CLOSE = " /* @end deck-type-cards */"


def cards_json() -> str:
    """The generated block's text: card_data() as stable, compact JSON (one card per line)."""
    import json   # noqa: PLC0415
    return "[\n" + ",\n".join(json.dumps(c, ensure_ascii=False, separators=(",", ":")) for c in card_data()) + "\n]"


def write_cards(template: Path | None = None) -> bool:
    """Write card_data() into the template's generated block (between CARDS_OPEN and the next CARDS_CLOSE, a JS literal inside the page's pure
    block, so app/tests read it too). Returns True when it changed.
    ``python3 -m deck.profiles cards`` from engine/ runs it; a test fails when the block and the profiles differ."""
    path = Path(template or TEMPLATE)
    t = path.read_text(encoding="utf-8")
    i = t.index(CARDS_OPEN) + len(CARDS_OPEN)
    j = t.index(CARDS_CLOSE, i)
    new = t[:i] + cards_json() + t[j:]
    if new != t:
        path.write_text(new, encoding="utf-8")
    return new != t


def cards_in_template(template: Path | None = None) -> str:
    """The generated block as the template holds it now."""
    t = Path(template or TEMPLATE).read_text(encoding="utf-8")
    i = t.index(CARDS_OPEN) + len(CARDS_OPEN)
    return t[i:t.index(CARDS_CLOSE, i)]


_CACHE: dict = {}


def load(pid: str) -> dict:
    """The profile with this id (a copy, so a caller may change it), checked against the schema.
    Raises ProfileError for an unknown id, a file that is not valid YAML, or any error validate_profile finds."""
    if not isinstance(pid, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", pid):
        raise ProfileError(f"no deck type {pid!r}")
    path = PROFILE_DIR / f"{pid}.yaml"
    if not path.exists():
        raise ProfileError(f"no deck type {pid!r}: known types are {', '.join(ids())}")
    if pid not in _CACHE:
        try:
            p = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            raise ProfileError(f"{path.name}: not valid YAML: {e}") from e
        errs = validate_profile(p)
        if not errs and p["id"] != pid:
            errs.append(f"id {p['id']!r} does not match the file name")
        if errs:
            raise ProfileError(f"{path.name}: " + "; ".join(errs))
        _CACHE[pid] = p
    return copy.deepcopy(_CACHE[pid])


def ids() -> list:
    """The ids of the profiles on disk: the four known types first, in their question order, then any added."""
    found = sorted(p.stem for p in PROFILE_DIR.glob("*.yaml"))
    return [t for t in spec.DECK_TYPES if t in found] + [t for t in found if t not in spec.DECK_TYPES]


def offered() -> list:
    """The types the q_deck_type card, the inference and a typed answer offer: every type, except those that joined with the recipes
    (spec.RECIPE_ONLY_TYPES) while the recipes are off (byte identity). A pick or a --kind may still name any type in ids()."""
    return [t for t in ids() if recipes_on() or t not in spec.RECIPE_ONLY_TYPES]


def all_profiles() -> list:
    """Every profile, loaded and checked."""
    return [load(i) for i in ids()]


def for_kind(kind: str) -> dict:
    """The profile a ``--kind`` value selects (agency, investor, tender, credentials)."""
    if kind not in KIND_TO_PROFILE:
        raise ProfileError(f"no --kind {kind!r}: choose one of {', '.join(KIND_TO_PROFILE)}")
    return load(KIND_TO_PROFILE[kind])


def default_for_kind(kind: str) -> dict:
    """The profile a deck of this assembler kind (spec.KINDS) gets when nothing chose one: agency_pitch or investor_seed."""
    return load("investor_seed" if kind == "investor" else spec.DEFAULT_TYPE)


def guidance(profile: dict | None, stage: str) -> list:
    """The profile's guidance lines for a stage (empty when there is no profile or none for the stage)."""
    return list(((profile or {}).get("prompt_guidance") or {}).get(stage) or [])


def stage_names(profile: dict | None, base: dict) -> dict:
    """``base`` (stage -> recorded file) cut to the stages the profile runs; all of it with no profile.
    A stage the profile drops is not needed, so its recorded file is not either."""
    if not profile:
        return dict(base)
    return {k: v for k, v in base.items() if k in profile["stages"]}


def runs(profile: dict | None, stage: str) -> bool:
    """True when the profile runs the stage (always true with no profile)."""
    return not profile or stage in profile["stages"]


_NUM = re.compile(r"(\d+(?:\.\d+)?)")


def weights(profile: dict, scoring: list | None) -> dict:
    """The criterion weights a deck is judged on: ``{source, label, weights}``. A tender's scoring
    (the buyer's criteria with their weights, from stage a) wins when it states a weight for every
    criterion (``source: brief``); otherwise the profile's split, labelled as our default
    (``source: default_assumption``, 'default, not validated': GUIDE.md section 3.2, never assume)."""
    rows = [(c.get("criterion"), c.get("weight")) for c in scoring or []]
    parsed = {}
    for name, w in rows:
        m = _NUM.search(str(w))
        if name and m:
            parsed[str(name)] = float(m.group(1))
    if rows and len(parsed) == len(rows) and sum(parsed.values()) > 0:
        return {"source": "brief", "label": "the buyer's own weights", "weights": parsed}
    return {"source": "default_assumption", "label": WEIGHTS_LABEL, "weights": dict(profile["rubric_weights"]["weights"])}


if __name__ == "__main__":   # python3 -m deck.profiles cards: regenerate the picker's card block in the Deck Maker template
    import sys
    if sys.argv[1:] == ["cards"]:
        print("deck-type cards: " + ("written" if write_cards() else "unchanged") + f" ({TEMPLATE})")
    else:
        raise SystemExit("usage: python3 -m deck.profiles cards")
