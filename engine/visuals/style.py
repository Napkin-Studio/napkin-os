"""The Style Pack reader: the one place the picture style is read, hashed and decided for both tools.

A Style Pack is the only thing Laurence controls about how pictures look. It comes in two forms, and both read
into the same ``Style`` with the same ``hash`` when the content is the same:

* a **folder** holding ``style.yaml`` (the six look keys, and optionally ``references``, ``models`` and ``deck``)
  and the reference images beside it (the Territory tool's ``--style DIR``);
* a **document** of the template ``ie.napkin.style-pack`` (``app/templates/style-pack``): a ``.clan`` path, or its
  data (the frozen copy a Deck holds at ``upstream.<id>``) plus the bytes of its reference images.

``load(None)`` is the built-in default style, used until a pack arrives.

Who may send what outside (Sai, 17 Nov 2026): only a reference whose rights are ``own`` or ``licensed`` is ever
sent to an image model (``sendable``), and only a pack steward (``kit.stewards``) may mark one so, with a reason
(``why``); ``licensed`` also needs a holder and terms. ``client_supplied`` and ``reference_only`` are for eyes
only, and a folder image the pack does not list is withheld. The reader refuses a pack that breaks these rules.

The guard rails and their version stay in code: a pack cannot loosen them. Models are chosen by tier (``draft``,
``hero``) from ``MODEL_IDS`` only; prices and the per-deck cap live elsewhere and still gate every spend.

The hash is computed here, every time. ``kit.published.style_hash`` is a stamp for display: a stamp that
disagrees gives a warning and the computed hash wins.
"""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import yaml

MAX_REFERENCES = 14                      # Runway: referenceImages holds up to 14 for the gemini image models
MAX_HELD = 24                            # a pack may hold more than it sends
MAX_DATA_URI = 5 * 1024 * 1024           # Runway: a data URI may be at most 5MB (the encoded string)
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
FINISHES = ("rough", "photo-real")
KNOWN_KEYS = ("look", "palette", "this_not_that", "finish", "banned_imagery", "notes")
#: Keys a folder's style.yaml may add (deck-look-kits). An unknown key is still an error.
EXTRA_KEYS = ("references", "models", "deck")
GUARD_VERSION = "1"                      # bump when the guard rails below change: it moves the style hash

#: always in the prompt, whatever the style pack says (a "Guinness" logo once slipped into a frame)
GUARD_RAILS = "No logos, no brand names, no readable signage or text anywhere in the frame."

DEFAULT = {"look": ["natural light", "unstaged", "documentary stills"], "palette": [], "this_not_that": [],
           "finish": "photo-real", "banned_imagery": [], "notes": ""}

#: The model catalogue's ids (the Territory tool's ``runway.MODELS``: quick and best). A pack picks from these only;
#: when ``runway`` moves beside this module (deck-image-gen) a test pins the two to the same list.
MODEL_IDS = ("gemini_image3.1_flash", "gemini_image3_pro")
DEFAULT_MODELS = {"draft": "gemini_image3.1_flash", "hero": "gemini_image3_pro"}

RIGHTS = ("own", "licensed", "client_supplied", "reference_only")
SENT_RIGHTS = ("own", "licensed")
DECK_COLOUR_ROLES = ("accent", "paper", "ink", "panel")
DECK_TYPE_ROLES = ("head", "body")
MAX_TNN = 8


class StyleError(ValueError):
    pass


@dataclass
class Reference:
    """One reference image of a pack: its name, bytes, rights and who decided them."""
    name: str
    data: bytes
    rights: str
    sha256: str = ""
    mime: str = "image/png"
    licence: dict | None = None
    why: str = ""
    by: str = ""

    def read_bytes(self) -> bytes:
        return self.data


@dataclass
class Style:
    look: list = field(default_factory=list)
    palette: list = field(default_factory=list)
    this_not_that: list = field(default_factory=list)
    finish: str = "photo-real"
    banned_imagery: list = field(default_factory=list)
    notes: str = ""
    references: list = field(default_factory=list)          # Reference objects actually sent: own or licensed, at most 14, by name
    ignored_references: list = field(default_factory=list)  # sendable names beyond the cap
    withheld: list = field(default_factory=list)            # [{name, rights, why}]: held, never sent, never hashed
    models: dict = field(default_factory=lambda: dict(DEFAULT_MODELS))
    deck: dict = field(default_factory=dict)                # the pack's deck colour and type pointers (may be empty)
    source: str = "default until Laurence answers"      # the built-in default's label on the board and in the manifest (not hashed)
    hash: str = ""
    document_id: str | None = None
    version: int | None = None
    name: str = ""
    warnings: list = field(default_factory=list)

    def summary(self) -> dict:
        out = {"source": self.source, "hash": self.hash, "finish": self.finish, "look": self.look, "palette": self.palette,
               "this_not_that": self.this_not_that, "banned_imagery": self.banned_imagery, "notes": self.notes,
               "references": [r.name for r in self.references], "ignored_references": self.ignored_references,
               "sent_references": [r.name for r in self.references], "withheld_references": self.withheld}
        if self.document_id:
            out.update(document_id=self.document_id, version=self.version)
        return out


# ------------------------------------------------------------------ normalising the six keys

def _list(raw, key) -> list:
    if raw is None or raw == "":
        return []
    if isinstance(raw, str):
        return [raw.strip()]
    if isinstance(raw, list):
        out = []
        for x in raw:
            if isinstance(x, dict):                       # this_not_that entries may be {this: .., not: ..}
                this, nope = x.get("this"), x.get("not")
                if not (this and nope):
                    raise StyleError(f"style.yaml: each {key} entry given as a map needs both 'this' and 'not'")
                out.append(f"{this}, not {nope}")
            else:
                out.append(str(x).strip())
        return [x for x in out if x]
    raise StyleError(f"style.yaml: {key} must be a list of words or lines")


def _this_not_that(raw) -> list:
    """A pack document keeps this_not_that as tn01..tn08 ({this, not}), read in key order; a folder keeps a list."""
    if isinstance(raw, dict):
        rows = []
        for k in raw:                                     # key order is the list order (the hash needs it)
            v = raw[k] or {}
            rows.append({"this": v.get("this"), "not": v.get("not")})
        return _list(rows, "this_not_that")
    return _list(raw, "this_not_that")


def _finish(raw) -> str:
    finish = str(raw or DEFAULT["finish"]).strip().lower().replace("_", "-").replace("photoreal", "photo-real")
    if finish not in FINISHES:
        raise StyleError(f"style: finish must be one of {FINISHES}, got {finish!r}")
    return finish


def _models(raw) -> dict:
    models = dict(DEFAULT_MODELS)
    if raw in (None, {}):
        return models
    if not isinstance(raw, dict):
        raise StyleError("style: models must be a map of draft and hero")
    for tier, model in raw.items():
        if tier not in DEFAULT_MODELS:
            raise StyleError(f"style: models has an unknown tier {tier!r}; the tiers are {list(DEFAULT_MODELS)}")
        if model not in MODEL_IDS:
            raise StyleError(f"style: model {model!r} is not in the catalogue {list(MODEL_IDS)}")
        models[tier] = model
    return models


def _deck(raw) -> dict:
    """The pack's deck section, checked for shape only: pointers and literals, never a word that reaches a slide."""
    if raw in (None, {}):
        return {}
    if not isinstance(raw, dict) or set(raw) - {"colours", "type"}:
        raise StyleError("style: deck holds only colours and type")
    colours, types = raw.get("colours") or {}, raw.get("type") or {}
    for role, ptr in colours.items():
        if role == "chart":
            continue
        if role not in DECK_COLOUR_ROLES or not isinstance(ptr, dict) or len(ptr) != 1 or next(iter(ptr)) not in ("brand", "agency", "hex"):
            raise StyleError(f"style: deck.colours.{role} must be one of {DECK_COLOUR_ROLES} and a {{brand}}, {{agency}} or {{hex}} pointer")
    for role, ptr in types.items():
        if role not in DECK_TYPE_ROLES or not isinstance(ptr, dict) or not ({"brand", "family"} & set(ptr)):
            raise StyleError(f"style: deck.type.{role} must be head or body and a {{brand}} or {{family}} pointer")
    return {k: v for k, v in raw.items() if v}


def _fold(text: str) -> str:
    """Lower case with accents and compatibility forms folded away (``Nestlé`` and ``Nestle`` are one word)."""
    return "".join(c for c in unicodedata.normalize("NFKD", str(text)) if not unicodedata.combining(c)).casefold()


_QUOTES = set("\"'`\u00ab\u00bb\u201e\u201a\u2039\u203a\u300c\u300d\u300e\u300f")


def lint(norm: dict, forbid=()) -> None:
    """The pack's free text goes into an image prompt, so it carries no figure, no quotation and no name (ADR 0027): every free-text field
    (``look``, ``palette``, ``this_not_that``, ``banned_imagery``, ``notes``) holds no number (any Unicode category N) and no quotation mark
    (the ASCII ones, the Unicode quote categories Pi, Pf, Ps and Pe, and the guillemets and low quotes); none holds a forbidden name (the
    deck's client, a brand's), compared with accents folded, as a word."""
    fields = ("look", "palette", "this_not_that", "banned_imagery", "notes")
    for key in fields:
        text = " ".join(norm[key]) if isinstance(norm[key], list) else norm[key]
        for ch in text:
            cat = unicodedata.category(ch)
            if cat.startswith("N"):
                raise StyleError(f"style: {key} holds a digit or number ({ch!r}); a prompt carries no figure (say it in words)")
            if ch in _QUOTES or cat in ("Pi", "Pf", "Ps", "Pe"):
                raise StyleError(f"style: {key} holds a quotation mark; a prompt carries no quoted text")
    for name in forbid:
        words = re.findall(r"[a-z0-9]+", _fold(name))
        if not words:
            continue
        pattern = r"(?<![a-z0-9])" + r"[^a-z0-9]+".join(map(re.escape, words)) + r"(?![a-z0-9])"
        for key in fields:
            text = " ".join(norm[key]) if isinstance(norm[key], list) else norm[key]
            if re.search(pattern, _fold(text)):
                raise StyleError(f"style: {key} names {name!r}; no client or brand name reaches a picture prompt")


# ------------------------------------------------------------------ references and their rights

def _check_rights(name: str, row: dict, stewards: list | None) -> Reference:
    """One reference's rights, enforced: own or licensed need a reason and a person (a steward, when the pack names
    them); licensed also needs a holder and terms."""
    rights = row.get("rights", "reference_only")
    if rights not in RIGHTS:
        raise StyleError(f"reference {name}: rights must be one of {RIGHTS}, got {rights!r}")
    why, by, lic = str(row.get("why") or "").strip(), str(row.get("by") or "").strip(), row.get("licence")
    if rights in SENT_RIGHTS:
        if not why:
            raise StyleError(f"reference {name}: marking an image {rights} sends it to an image model, so a steward must give a reason (why)")
        if not by:
            raise StyleError(f"reference {name}: marking an image {rights} must name the person who decided it (by)")
        if stewards is not None and by not in stewards:
            raise StyleError(f"reference {name}: {by} is not a steward of this pack, so cannot mark an image {rights}")
    if rights == "licensed":
        if not (isinstance(lic, dict) and str(lic.get("holder") or "").strip() and str(lic.get("terms") or "").strip()):
            raise StyleError(f"reference {name}: licensed needs a licence with a holder and terms")
    return Reference(name=name, data=b"", rights=rights, licence=lic if rights == "licensed" else None, why=why, by=by)


def _finish_refs(refs: list, held_extra: list) -> tuple[list, list, list]:
    """Split the held references into (sent, ignored names, withheld). Sent: own and licensed, sorted by name
    (lower case), at most 14."""
    held = sorted(refs, key=lambda r: r.name.lower())
    sendable = [r for r in held if r.rights in SENT_RIGHTS]
    withheld = [{"name": r.name, "rights": r.rights, "why": r.why or ("not sent: " + r.rights)} for r in held if r.rights not in SENT_RIGHTS]
    withheld += held_extra
    withheld.sort(key=lambda w: w["name"].lower())
    return sendable[:MAX_REFERENCES], [r.name for r in sendable[MAX_REFERENCES:]], withheld


# ------------------------------------------------------------------ hashing

def canonical(style: Style) -> dict:
    """What the hash covers: the six keys, the guard version, [name, sha256] of each SENT reference (sorted by name), and
    the models only when they are not the default. Not hashed: deck tokens, stewards, changelog, withheld references,
    reasons, licence text. The same content gives the same dict from a folder or a document."""
    out = {"style": {"look": style.look, "palette": style.palette, "this_not_that": style.this_not_that, "finish": style.finish,
                     "banned_imagery": style.banned_imagery, "notes": style.notes},
           "guard": GUARD_VERSION,
           "refs": [[r.name, hashlib.sha256(r.data).hexdigest()] for r in style.references]}
    if style.models != DEFAULT_MODELS:
        out["models"] = style.models
    return out


def hash_of(style: Style) -> str:
    """The 8-hex style hash. One function, called by both tools."""
    return hashlib.sha256(json.dumps(canonical(style), sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:8]


def sendable(style: Style) -> list:
    """The references that may leave the building: own and licensed, at most 14. The only gate (a fake client test
    asserts the Runway ``referenceImages`` is exactly this)."""
    return [r for r in style.references if r.rights in SENT_RIGHTS][:MAX_REFERENCES]


# ------------------------------------------------------------------ loading

def _build(norm: dict, refs: list, withheld_extra: list, models: dict, deck: dict, **meta) -> Style:
    sent, ignored, withheld = _finish_refs(refs, withheld_extra)
    st = Style(**norm, references=sent, ignored_references=ignored, withheld=withheld, models=models, deck=deck, **meta)
    st.hash = hash_of(st)
    return st


def _norm(raw: dict) -> dict:
    return {"look": _list(raw.get("look"), "look"), "palette": _list(raw.get("palette"), "palette"),
            "this_not_that": _this_not_that(raw.get("this_not_that")), "finish": _finish(raw.get("finish")),
            "banned_imagery": _list(raw.get("banned_imagery"), "banned_imagery"), "notes": str(raw.get("notes") or "").strip()}


def _folder(d: Path, forbid=()) -> Style:
    if not d.is_dir():
        raise StyleError(f"style folder not found: {d}")
    yml = d / "style.yaml"
    if not yml.is_file():
        raise StyleError(f"{d} has no style.yaml")
    raw = yaml.safe_load(yml.read_text()) or {}
    if not isinstance(raw, dict):
        raise StyleError("style.yaml must be a map of look, palette, this_not_that, finish, banned_imagery, notes")
    unknown = sorted(set(raw) - set(KNOWN_KEYS) - set(EXTRA_KEYS))
    if unknown:
        raise StyleError(f"style.yaml: unknown key(s) {unknown}; known keys are {list(KNOWN_KEYS) + list(EXTRA_KEYS)}")
    listed = raw.get("references") or {}
    if not isinstance(listed, dict):
        raise StyleError("style.yaml: references must be a map of file name to its rights")
    files = {p.name: p for p in d.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_TYPES and not p.name.startswith(".")}
    missing = sorted(set(listed) - set(files))
    if missing:
        raise StyleError(f"style.yaml: references names file(s) that are not in the folder: {missing}")
    refs = []
    for name in sorted(listed):
        row = listed[name] or {}
        ref = _check_rights(name, row, None)          # a folder names no stewards: it needs a person (by) and a reason (why)
        data = files[name].read_bytes()
        ref.data, ref.sha256 = data, hashlib.sha256(data).hexdigest()
        ref.mime = IMAGE_TYPES[files[name].suffix.lower()]
        refs.append(ref)
    extra = [{"name": n, "rights": "reference_only", "why": "not listed in style.yaml references"} for n in sorted(files) if n not in listed]
    norm = _norm(raw)
    lint(norm, forbid)
    return _build(norm, refs, extra, _models(raw.get("models")), _deck(raw.get("deck")), source=str(d))


def from_document(data: dict, assets=None, source: str = "style pack", forbid=()) -> Style:
    """A Style Pack's data (``shared/data.yaml``, or ``data.upstream.<id>`` in a Deck) into a Style. ``assets`` gives the
    bytes of each reference image: a dict of ``asset path -> bytes`` or a function of the path."""
    if not isinstance(data, dict):
        raise StyleError("a Style Pack's data must be a map")
    unknown = sorted(set(data) - set(KNOWN_KEYS) - set(EXTRA_KEYS) - {"pack", "kit", "$schema"})
    if unknown:
        raise StyleError(f"a Style Pack has no key(s) {unknown}: the guard rails and their version stay in code")
    kit = data.get("kit") or {}
    stewards = list(kit.get("stewards") or [])
    if not stewards:
        raise StyleError("a Style Pack names at least one steward (kit.stewards): who may change it and mark an image own or licensed")
    get = assets if callable(assets) else (lambda p, a=assets or {}: a.get(p))
    refs = []
    rows = data.get("references") or {}
    if len(rows) > MAX_HELD:
        raise StyleError(f"a Style Pack holds at most {MAX_HELD} references, this one has {len(rows)}")
    for rid in rows:
        row = rows[rid] or {}
        name = str(row.get("name") or rid)
        ref = _check_rights(name, row, stewards)
        blob = get(row.get("asset"))
        if blob is None:
            raise StyleError(f"reference {name}: the image at {row.get('asset')!r} is not in the document")
        digest = hashlib.sha256(blob).hexdigest()
        if row.get("sha256") and row["sha256"] != digest:
            raise StyleError(f"reference {name}: the image does not match its recorded sha256")
        ref.data, ref.sha256, ref.mime = blob, digest, row.get("mime") or mimetypes.guess_type(name)[0] or "image/png"
        refs.append(ref)
    norm = _norm(data)
    lint(norm, forbid)
    st = _build(norm, refs, [], _models(data.get("models")), _deck(data.get("deck")), source=source,
                version=kit.get("version"), name=str((data.get("pack") or {}).get("name") or ""))
    stamp = ((kit.get("published") or {}).get("style_hash"))
    if stamp and stamp != st.hash:
        st.warnings.append(f"the published style hash {stamp} does not match the computed {st.hash}: the computed one is used")
    return st


def _clan(path: Path, forbid=()) -> Style:
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise StyleError(f"{path} is not a .clan file") from e
    names = set(z.namelist())
    if "shared/data.yaml" not in names:
        raise StyleError(f"{path} has no shared/data.yaml")
    man = yaml.safe_load(z.read("manifest.yaml")) if "manifest.yaml" in names else {}
    app = ((man or {}).get("app") or {}).get("app_id")
    if app and app != "ie.napkin.style-pack":
        raise StyleError(f"{path} is a {app} document, not a Style Pack")
    st = from_document(yaml.safe_load(z.read("shared/data.yaml")) or {}, lambda p: z.read(p) if p in names else None, source=str(path), forbid=forbid)
    st.document_id = (man or {}).get("document_id") or (man or {}).get("id")
    return st


def load(source=None, assets=None, forbid=()) -> Style:
    """Read a Style Pack. ``None``: the built-in default (no references): the first run, before Laurence's pack arrives.
    A folder (style.yaml and images), a ``.clan`` path, or a dict (a document's data, with ``assets``). ``forbid``: names (the deck's
    client, a brand's) that may not appear in the pack's text."""
    if source is None:
        return _build(dict(DEFAULT), [], [], dict(DEFAULT_MODELS), {})
    if isinstance(source, dict):
        return from_document(source, assets, forbid=forbid)
    p = Path(source)
    if p.is_dir():
        return _folder(p, forbid)
    if p.is_file():
        return _clan(p, forbid)
    raise StyleError(f"style folder not found: {p}")


# ------------------------------------------------------------------ the prompt

def reference_images(style: Style) -> list[dict]:
    """The Runway ``referenceImages`` array: data URIs, tagged ref01.., of ``sendable`` references only, each under the 5MB limit."""
    out = []
    for i, r in enumerate(sendable(style), 1):
        uri = f"data:{r.mime};base64," + base64.b64encode(r.data).decode()
        if len(uri) > MAX_DATA_URI:
            raise StyleError(f"reference image {r.name} is too large for Runway as a data URI (over 5MB encoded): shrink it")
        out.append({"uri": uri, "tag": f"ref{i:02d}"})
    return out


def style_block(style: Style, extra_banned: list[str] | None = None) -> str:
    parts = []
    if style.look:
        parts.append("Look: " + ", ".join(style.look) + ".")
    if style.palette:
        parts.append("Palette: " + ", ".join(style.palette) + ".")
    parts.append("Finish: " + ("rough, unpolished, like a quick storyboard frame." if style.finish == "rough" else "photo-real, like a real photograph or film still."))
    if style.this_not_that:
        parts.append("This, not that: " + "; ".join(style.this_not_that) + ".")
    if style.notes:
        parts.append(style.notes if style.notes.endswith(".") else style.notes + ".")
    if sendable(style):
        # worded so the picture-prompt lint passes it: "style of" reads as a request for someone's style (visuals.lint.STYLE_OF), which refused
        # every pack that sends a reference image (review 18 Nov 2026). Not hashed: the style hash does not move.
        parts.append("Match the look, light, colour and finish of the reference images, not their subject.")
    banned = list(dict.fromkeys([*style.banned_imagery, *(extra_banned or [])]))
    if banned:
        parts.append("Never show: " + ", ".join(banned) + ".")
    return " ".join(parts)


def frame_prompt(shot: dict, style: Style, extra_banned: list[str] | None = None) -> str:
    """Shot description + style + guard rails. The on-screen line is NOT in the prompt: asking a picture model for
    words puts words in the picture (the deck puts the line on the slide)."""
    desc = " ".join(s.rstrip(".") + "." for s in (shot.get("framing"), shot.get("camera"), shot.get("action")) if s)
    return f"{desc} {style_block(style, extra_banned)} {GUARD_RAILS}"
