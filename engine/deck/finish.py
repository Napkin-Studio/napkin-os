"""The finish fixes (spec.FINISH): what a blind review of six decks marked down on finish rather than thinking, fixed in code.

Pure helpers the assembler and the renderers call. No model, no network. Every move keeps the words: what leaves a slide goes to its
speaker notes, verbatim, with the reason, and nothing is written that the inputs do not hold, except the fixed engine phrases below.

* the title and objective state only what the brief states (``scope_checked``, ``objectives``);
* a thought is said once (``near``, ``merge_repeats``, ``sections``);
* bracketed placeholders in the work are filled from the brief or a neutral phrase, with a to-supply note (``fill_brackets``);
* the proposition never argues against the alternative the deck rejects (``contradictions``);
* evidence in a metric market reads in metric units, labelled with its own market (``metric_text``, render time only).
"""
from __future__ import annotations

import re

from . import spec
from .refs import numbers_in

#: Words that state a campaign's reach. A title or objective may say one only when the brief does.
SCOPE_WORDS = ("national", "nationwide", "nationally", "countrywide", "global", "globally", "international", "worldwide", "pan-european", "european")
_NEGATED = re.compile(r"\b(?:not|no|never|rather than|instead of)\s+(?:a\s+|an\s+|the\s+)?$", re.I)

_STOP = frozenset("a an and are as at be but by for from has have he her his i in is it its of on or our she so that the their them then there "
                  "these they this those to us was we were what when which who will with you your within into than".split())


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def words(text) -> set:
    """The content words of a text, lower case, plurals folded: what near-duplicates are compared on."""
    return {_stem(w) for w in re.findall(r"[a-z0-9]+(?:['’][a-z]+)?", str(text or "").lower()) if w not in _STOP}


def near(a, b, threshold: float = 0.6, least: int = 3) -> bool:
    """True when the shorter text's content words lie mostly (``threshold``) inside the longer's: the same thought said twice."""
    wa, wb = words(a), words(b)
    if min(len(wa), len(wb)) < least:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= threshold


def stated_text(inp, lower: bool = True) -> str:
    """What the brief states, as one lower-case text (``lower`` False: as written): its fields, the person's prompt and the brief's own
    source sentences. A research document is not the brief (it may echo a project label back), so it is not read here."""
    parts = [str((f or {}).get("value") or "") for f in (inp.brief or {}).values()]
    parts.append(str(getattr(inp, "prompt_text", "") or ""))
    parts += [str(v) for v in (getattr(inp, "brief_source", None) or {}).values()]
    text = " \n ".join(parts)
    return text.lower() if lower else text


def scope_checked(project: str, inp) -> tuple:
    """``(project, dropped)``: the project label without a scope word the brief never states ('National' for a regional client). A
    negated mention ('not a national splash') does not state it. The label is otherwise kept as given."""
    hay = stated_text(inp)
    dropped = []
    out = str(project or "")
    for w in SCOPE_WORDS:
        if not re.search(rf"\b{re.escape(w)}\b", out, re.I):
            continue
        said = [m for m in re.finditer(rf"\b{re.escape(w)}\b", hay) if not _NEGATED.search(hay[max(0, m.start() - 20):m.start()])]
        if said:
            continue
        dropped.append(re.search(rf"\b{re.escape(w)}\b", out, re.I).group(0))
        out = re.sub(rf"\b{re.escape(w)}\b\s*", "", out, flags=re.I).strip(" -:,")
    if dropped and out:
        out = out[:1].upper() + out[1:]
    return (out or str(project or "")), dropped


# ------------------------------------------------------------------------------------------------------------ the objective slide
#: A sentence that is a note to the agency, not the client's objective ("Taken from the research summary of the brief, not the brief itself,
#: so check it against the original."). It leaves the slide for the notes.
_AGENCY_SENTENCE = re.compile(r"(?i)\b(?:check (?:it|this|them|that) against|taken from the research|not the brief itself|against the original"
                              r"|to confirm with the client|(?:our|an) internal note)\b")
#: The brief's objective kinds, the primary (commercial) first: the hero number of the objective slide is the first item's.
OBJECTIVE_ORDER = ("commercial", "business", "behavioural", "behavioral", "attitudinal")


def _sentences(text) -> list:
    return [x for x in re.split(r"(?<=[.!?])\s+", str(text or "").strip()) if x.strip()]


def _brief_objectives(inp) -> list:
    """``[(kind, text)]``: the brief's objectives in primary-first order (a dict of kinds; a list or one text keeps its order)."""
    o = ((inp.brief or {}).get("objectives") or {}).get("value")
    if isinstance(o, dict):
        rank = lambda k: OBJECTIVE_ORDER.index(k) if k in OBJECTIVE_ORDER else len(OBJECTIVE_ORDER)
        return [(k, str(v).strip()) for k, v in sorted(o.items(), key=lambda kv: rank(kv[0])) if isinstance(v, str) and v.strip()]
    vals = o if isinstance(o, list) else [o] if o else []
    return [("", str(v).strip()) for v in vals if str(v or "").strip()]


def objectives(inp, items: list) -> tuple:
    """``(items, notes)``: the objective slide's items held to the brief. A sentence written for the agency leaves the item; an item that
    restates a brief objective (a shared figure and most of its words) but drops a figure the brief states (the 12 months) takes the
    brief's own words; an item that says what an earlier one said, or restates the background with no figure while another item holds
    one, leaves; and the items run primary first (commercial, behavioural, attitudinal), so the hero number is the primary objective's."""
    brief = _brief_objectives(inp)
    notes, out = [], []
    if brief:   # the brief states its objectives: the slide is those, in its words, primary first; an item adds only a figure the brief lacks
        base = [{"text": bt, "refs": [f"brief:objectives.{kind}" if kind else "brief:objectives"]} for kind, bt in brief]
        for it in items:
            text = " ".join(x for x in _sentences(it.get("text")) if not _AGENCY_SENTENCE.search(x))
            reqs = [r for r in it.get("refs") or [] if str(r).startswith("req:")]
            home = next((b_ for b_ in base if (numbers_in(text) & numbers_in(b_["text"]) and near(text, b_["text"], 0.4, 2)) or near(text, b_["text"], 0.5)), None)
            if home is not None:
                home["refs"] += [r for r in reqs if r not in home["refs"]]
            elif numbers_in(text) and not any(near(text, b_["text"], 0.6) for b_ in base):
                base.append({**it, "text": text})
            elif text.strip():
                notes.append(f"Left the objective slide (the brief's objectives say it, or it is not an objective): '{text}'.")
        return base, notes
    for it in items:
        text = str(it.get("text") or "")
        keep = [x for x in _sentences(text) if not _AGENCY_SENTENCE.search(x)]
        if len(keep) < len(_sentences(text)):
            notes.append("A note for the agency left the objective: " + " ".join(x for x in _sentences(text) if _AGENCY_SENTENCE.search(x)))
            text = " ".join(keep)
        rank, refs = len(OBJECTIVE_ORDER) + 1, list(it.get("refs") or [])
        for i, (kind, bt) in enumerate(brief):
            shared = numbers_in(text) & numbers_in(bt)
            if not (shared and near(text, bt, 0.4, 2)):
                continue
            rank = i
            if numbers_in(bt) - numbers_in(text):   # the item dropped a figure the brief states: the brief's words, with the brief's ref
                notes.append(f"The objective is in the brief's words (the item read: '{text}').")
                text = bt
                refs = [f"brief:objectives.{kind}" if kind else "brief:objectives"] + [r for r in refs if str(r).startswith("req:")]
            break
        else:
            for i, (kind, bt) in enumerate(brief):
                if near(text, bt, 0.6):
                    rank = i
                    break
        if text.strip():
            out.append(({**it, "text": text, "refs": refs}, rank))
    kept = []
    for it, rank in out:
        dup = next((k for k in kept if near(k[0]["text"], it["text"], 0.6)), None)
        if dup is not None:
            notes.append(f"Said once: '{it['text']}' repeats '{dup[0]['text']}'.")
            if len(numbers_in(it["text"])) > len(numbers_in(dup[0]["text"])):   # keep the one that states more figures, at the better rank
                kept[kept.index(dup)] = (it, min(rank, dup[1]))
            continue
        kept.append((it, rank))
    has_fig = any(numbers_in(k[0]["text"]) for k in kept)
    final = []
    for it, rank in kept:
        bg = [r for r in it.get("refs") or [] if str(r).startswith(("brief:background", "brief:desired_response"))]
        obj = [r for r in it.get("refs") or [] if str(r).startswith("brief:objectives")]
        if has_fig and bg and not obj and not numbers_in(it["text"]):
            notes.append(f"Background, not an objective (it is on the real-question slide): '{it['text']}'.")
            continue
        final.append((it, rank))
    final.sort(key=lambda x: x[1])   # stable: equal ranks keep their order
    return [x[0] for x in final], notes


# ------------------------------------------------------------------------------------------------------------ said once, sections
#: Spine slides that say one thought each; a pair whose titles say the same thing becomes one slide (the keeper first in this list).
REPEAT_KEEP = ("insight", "real_question", "chart")
#: A presented slide's section when the slide before it already carries the same one (two 'The real question' bands in a row).
ROLE_SECTIONS = {"chart": "The barrier", "audience": "Audience", "channel_roles": "Channels", "innovation": "Innovation", "guardrails": "Guardrails",
                 "measurement_plan": "Measurement plan", "credentials": "Our work", "investment": "Investment", "territory_choice": "Our pick",
                 "process": "Process", "competition": "Competition"}


def _is_barrier(sl: dict) -> bool:
    return sl["type"] == "chart" and not any(b["kind"] == "chart" for b in sl["blocks"])


def repeats(story: list) -> list:
    """``[(kept, gone)]``: pairs of presented spine slides (the real question, the barrier, the insight) whose titles say the same thing.
    The keeper is the insight over the real question over the barrier."""
    spine = [x for x in story if x["type"] in ("real_question", "insight") or _is_barrier(x)]
    out, gone = [], set()
    for i, a in enumerate(spine):
        for b in spine[i + 1:]:
            if id(a) in gone or id(b) in gone or a["type"] == b["type"]:
                continue
            if near(a["title"], b["title"], 0.5):
                k, g = sorted((a, b), key=lambda x: REPEAT_KEEP.index(x["type"]))
                out.append((k, g))
                gone.add(id(g))
    return out


def merge_repeat(kept: dict, gone: dict) -> None:
    """One slide from two that say the same thing: the gone slide's lead line joins the kept slide (after its own lead) when it adds
    words the kept slide does not already say; its title and the rest go to the kept slide's notes, verbatim."""
    have = [kept["title"]] + [str(b.get("text") or "") for b in kept["blocks"]]
    lead = next((b for b in gone["blocks"] if b["kind"] in ("statement", "text") and str(b.get("text") or "").strip()), None)
    said = set().union(*(words(h) for h in have))
    lw = words((lead or {}).get("text"))
    if lead is not None and lw and len(lw & said) / len(lw) < 0.7:   # it adds a thought the kept slide does not hold
        at = next((i + 1 for i, b in enumerate(kept["blocks"]) if b["kind"] == "statement"), 0)
        kept["blocks"] = kept["blocks"][:at] + [{"kind": "text", "text": str(lead["text"]).strip(), **({"refs": lead["refs"]} if lead.get("refs") else {})}] + kept["blocks"][at:]
        kept["claims"] = list(kept.get("claims") or []) + [c for c in gone.get("claims") or [] if c not in (kept.get("claims") or [])]
    kept["notes"] = "\n\n".join([x for x in [kept.get("notes") or ""] if x.strip()] + [
        f"Said once: the slide '{gone['title']}' said the same thing, so it is one slide here (the other is in the appendix)."])
    kept["merged"] = list(kept.get("merged") or []) + [{"type": gone["type"], "title": gone["title"]}]
    kept["requirements"] = list(kept.get("requirements") or []) + [r for r in gone.get("requirements") or [] if r not in (kept.get("requirements") or [])]


def sections(story: list) -> None:
    """Give a presented slide its own section when the one before it has the same section and is of another type."""
    for prev, sl in zip(story, story[1:]):
        if sl["section"] == prev["section"] and sl["type"] != prev["type"] and sl["type"] in ROLE_SECTIONS:
            sl["section"] = ROLE_SECTIONS[sl["type"]]


def sentence_said(sent: str, said_keys: dict, said_words: list) -> int | None:
    """The slide number that already said ``sent`` (its comparison key, or 85% of its content words in one earlier sentence); None."""
    key = re.sub(r"\W+", " ", sent.lower()).strip()
    if len(key.split()) >= 4 and key in said_keys:
        return said_keys[key]
    w = words(sent)
    if len(w) >= 4:
        for n, ws in said_words:
            if len(w & ws) / len(w) >= 0.85:
                return n
    return None


# ------------------------------------------------------------------------------------------------------------ the supply line
SUPPLY_WORDS = {"team": "the team", "credentials": "two case studies", "investment": "the investment split", "competition": "the alternatives you are weighing",
                "risks": "the risks you already see", "next_step": "the decision date", "why_now": "why now", "what_we_know": "what we know"}


def supply_line(slides: list, more: list | None = None) -> str:
    """The one presented line that keeps the gaps in view: what only the client or the agency can give (the To supply part's slides, then
    ``more``: the ask's own placeholders, such as the decision date)."""
    names = list(dict.fromkeys([SUPPLY_WORDS.get(x["type"], str(x.get("title") or x["type"]).lower()) for x in slides] + list(more or [])))
    if not names:
        return ""
    said = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    return f"What we need from you: {said}."


def placeholder_only(x: dict) -> bool:
    """A slide still waiting for a person: needs_human and every item it shows a labelled placeholder. The investment slide's
    'Budget given' read-back does not count as content (the split is still to supply)."""
    if x.get("status") != "needs_human" or x["type"] == "title":
        return False
    seen = False
    for b in x["blocks"]:
        for i in b.get("items") or []:
            seen = True
            if not (isinstance(i, dict) and i.get("human")):
                return False
        t = str(b.get("text") or "").strip()
        if t and not (x["type"] == "investment" and t.startswith("Budget given:")):
            seen = True
            if not (b.get("human") or t.startswith(spec.PLACEHOLDER_PREFIX)):
                return False
    return seen


# ------------------------------------------------------------------------------------------------------------ bracketed placeholders
_BRACKET = re.compile(r"\[([^\[\]\n]{2,60})\]")
_PLACES = {"county": "your county", "town": "your town", "city": "your city", "area": "your area", "council": "your council", "region": "your region",
           "neighbourhood": "your neighbourhood", "neighborhood": "your neighbourhood", "street": "your street", "village": "your village"}
_DETERMINERS = ("the", "their", "your", "his", "her", "its", "our", "a", "an", "this", "that")
_FILLER = re.compile(r"(?i)\b(?:published|actual|real|exact|correct|official)\s+")


def _bracket_value(inner: str, hay: str, client: str) -> tuple:
    """``(text, from_brief)`` for a bracketed slot: the brief's value when it states one (a named county), else a neutral phrase."""
    w = inner.strip()
    lw = w.lower()
    if lw in ("client", "client name", "brand", "brand name", "company", "company name"):
        return client, True
    if len(w.split()) == 1 and w[:1].isupper():
        m = re.search(rf"\b{re.escape(w)}\s+([A-Z][a-z]{{2,}})\b", hay) or re.search(rf"\b([A-Z][a-z]{{2,}})\s+{re.escape(w)}\b", hay)
        if m and m.group(1).lower() not in _STOP and m.group(1) not in ("The", "Irish", "Our", "Your", "Every", "Each", "This"):
            return m.group(0), True
    if lw in _PLACES:
        return _PLACES[lw], False
    if re.search(r"\bname\b", lw):
        return "a neighbour", False
    lw = _FILLER.sub("", lw).strip()
    return (lw if lw.split()[0] in _DETERMINERS else "the " + lw), False


def fill_brackets(S: list, inp, client: str) -> list:
    """Replace a bracketed slot in the deck's own words ('[County]', "[council's published number]") with the brief's value or a neutral
    phrase ('your county'), each noted on the slide as still to supply. A person's labelled placeholder, the cover, '[Agency]' and a
    stage direction ('[Silence. A slow drip rises.]': a sentence or a list inside the brackets) are left as they are. Returns the
    ``[(slide title, slot, shown as)]`` it filled."""
    hay = "\n".join([str((f or {}).get("value") or "") for f in (inp.brief or {}).values()] + [str(inp.prompt_text or "")]
                    + [str(v) for v in (getattr(inp, "brief_source", None) or {}).values()])
    done = []

    def sub(text, sl):
        def one(m):
            inner = m.group(1)
            if re.search(r"[.!?,;:]", inner) or len(inner.split()) > 6 or inner.strip().lower() == "agency" or inner.isupper() and len(inner) > 3:
                return m.group(0)
            val, from_brief = _bracket_value(inner, hay, client)
            after = text[m.end():].lstrip().lower()
            if after.startswith(inner.strip().lower()):   # '[County] County Council': the slot names the head noun that follows it
                val = (val.split()[1] if from_brief and val.split()[0].lower() == inner.strip().lower() else val.split()[0]) if from_brief else "your" if val.startswith("your ") else val
            before = text[:m.start()].rstrip()
            if not before or before[-1] in ".!?\n\"\u201c" or before.endswith("..."):   # a sentence's first word (not after a colon)
                val = val[:1].upper() + val[1:]
            note = (f"'{m.group(0)}' is shown as '{val}' (the brief's own words)." if from_brief
                    else f"To supply: '{m.group(0)}' is shown as '{val}' until the client gives it.")
            if note not in sl.setdefault("_bracket_notes", []):
                sl["_bracket_notes"].append(note)
            done.append((sl["title"], m.group(0), val))
            return val
        return _BRACKET.sub(one, text) if isinstance(text, str) and "[" in text else text

    for sl in S:
        if sl["type"] in ("title", "appendix", "requirement_trace", "appendix_sources"):
            continue
        sl["title"] = sub(sl["title"], sl)
        for b in sl["blocks"]:
            if b.get("human") or str(b.get("text") or "").startswith(spec.PLACEHOLDER_PREFIX):
                continue
            for k in ("text", "from", "to", "answer", "title"):
                if isinstance(b.get(k), str):
                    b[k] = sub(b[k], sl)
            if b.get("lines"):
                b["lines"] = [sub(x, sl) for x in b["lines"]]
            if b.get("items"):
                its = []
                for i in b["items"]:
                    if isinstance(i, dict) and not i.get("human") and isinstance(i.get("text"), str):
                        i = {**i, "text": sub(i["text"], sl)}
                    elif isinstance(i, list):
                        i = [sub(x, sl) for x in i]
                    elif isinstance(i, str):
                        i = sub(i, sl)
                    its.append(i)
                b["items"] = its
            if b.get("rows"):
                b["rows"] = [[sub(c, sl) for c in r] for r in b["rows"]]
        notes = sl.pop("_bracket_notes", None)
        if notes:
            sl["notes"] = "\n\n".join([x for x in [sl.get("notes") or ""] if x.strip()] + notes)
    return done


# ------------------------------------------------------------------------------------------------------------ the contradiction check
_QUOTED = re.compile(r"(?<![A-Za-z])['‘\"“]([^'’\"”\n]{2,60}?)['’\"”](?![A-Za-z])")


def _texts(sl: dict) -> list:
    out = [str(sl.get("title") or "")]
    for b in sl["blocks"]:
        out += [str(b.get(k) or "") for k in ("text", "from", "to")]
        out += [str(c) for r in b.get("rows") or [] for c in r]
        out += [str(i.get("text", "")) if isinstance(i, dict) else " ".join(map(str, i)) if isinstance(i, list) else str(i) for i in b.get("items") or []]
    return out


def contradictions(S: list) -> list:
    """The proposition against the alternatives slide: a phrase the competition slide quotes in order to argue against it ("a 'free, no
    catch' campaign") must not be the proposition's own words. Fixed when it can be: the proposition's sentences made only of the quoted
    phrase's words leave its title for the notes ('No catch.'). Otherwise flagged on both slides. Returns ``[{phrase, fixed, removed}]``."""
    prop = next((x for x in S if x["type"] == "proposition"), None)
    comp = next((x for x in S if x["type"] == "competition" and x["status"] != "needs_human"), None)
    if not (prop and comp):
        return []
    pw = words(prop["title"])
    found = []
    for t in _texts(comp):
        for q in _QUOTED.findall(t):
            qw = words(q)
            if not qw or not qw <= pw or len(re.findall(r"\w+", q)) < 2 or q in [f["phrase"] for f in found]:
                continue
            found.append({"phrase": q, "fixed": False, "removed": []})
    if not found:
        return []
    allw = set().union(*(words(f["phrase"]) for f in found))
    sents = _sentences(prop["title"])
    drop = [x for x in sents if words(x) and words(x) <= allw]
    keep = [x for x in sents if x not in drop]
    if drop and keep:
        prop["title"] = " ".join(keep)
        prop["label"] = prop["title"][:80]
        for f in found:
            f.update(fixed=True, removed=drop)
        prop["notes"] = "\n\n".join([x for x in [prop.get("notes") or ""] if x.strip()] + [
            f"Contradiction check: '{' '.join(drop)}' left the proposition, because the alternatives slide argues against a "
            f"'{found[0]['phrase']}' campaign."])
    else:
        for sl in (prop, comp):
            sl["notes"] = "\n\n".join([x for x in [sl.get("notes") or ""] if x.strip()] + [
                f"Contradiction check (to fix by hand): the proposition says '{found[0]['phrase']}', which the alternatives slide argues against."])
    return found


# ------------------------------------------------------------------------------------------------------------ metric evidence (render time)
#: Markets that read in metric units: a brief that names one of these (Ireland, the EU, a euro budget) gets its imperial figures converted.
_METRIC_MARKET = re.compile(r"(?i)\b(?:ireland|irish|eire|europe|european|eu|uk|united kingdom|britain|british|scotland|wales|"
                            r"france|germany|spain|italy|netherlands|belgium|portugal|austria|denmark|sweden|finland|poland)\b|€|\beur\b")
_US_MARKET = re.compile(r"(?i)\b(?:united states|usa|u\.s\.|america|american)\b|\$|\busd\b")
#: (pattern, factor, metric unit, the market it marks). US gallons: a 'gallon' figure in English-language research is the US EPA's.
_UNITS = ((re.compile(r"(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:US\s+)?gallons?\b(?!\s*\()", re.I), 3.785411784, "litres", "US"),
          (re.compile(r"(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*miles?\b(?!\s*\()", re.I), 1.609344, "km", "US"),
          (re.compile(r"(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:lbs?|pounds? weight)\b(?!\s*\()", re.I), 0.45359237, "kg", "US"))


def metric_market(meta: dict | None, text: str = "") -> bool:
    """True when the deck is for a metric market: the deck's ``meta.market`` says so, else unless the brief's words place it in the US (or
    name the US and no metric market). Nearly every market reads in metric units, so a brief that names none is read as one."""
    m = (meta or {}).get("market")
    if m:
        return m == "metric"
    return bool(_METRIC_MARKET.search(text or "")) or not _US_MARKET.search(text or "")


def _round3(v: float) -> str:
    if v >= 1000:
        mag = 10 ** (len(str(int(v))) - 3)
        return f"{int(round(v / mag) * mag):,}"
    return f"{v:.1f}".rstrip("0").rstrip(".") if v < 100 else f"{int(round(v)):,}"


def metric_text(text: str) -> str:
    """``text`` with an imperial figure written in metric first, labelled with the market it comes from: '9,300 gallons' reads
    'about 35,200 litres (US figure: 9,300 gallons)'. Render time only, like numfmt: the stored words and their trace do not change.
    Converting a converted text changes nothing (a figure already followed by its bracket is left alone)."""
    if not text or not any(c.isdigit() for c in text):
        return text
    out = text
    for pat, k, unit, mkt in _UNITS:
        def one(m, k=k, unit=unit, mkt=mkt):
            if m.string[max(0, m.start() - 8):m.start()].endswith("figure: "):   # already converted: the original kept in its bracket
                return m.group(0)
            try:
                v = float(m.group(1).replace(",", "")) * k
            except ValueError:
                return m.group(0)
            hedged = re.search(r"(?i)\b(?:over|about|around|nearly|almost|roughly|some|up to|more than|less than|under|at least)\s*$", m.string[:m.start()])
            return f"{'' if hedged else 'about '}{_round3(v)} {unit} ({mkt} figure: {m.group(0)})"
        out = pat.sub(one, out)
    return out


# ------------------------------------------------------------------------------------------------------------ script annotations
#: A sentence written for the agency about the work, not for the room: a script's stage note ("Dramatises the 'X' half: ..."), a word
#: about where something came from ("the inputs", "the research summary"). It goes to the speaker notes, verbatim.
ANNOTATION = re.compile(r"(?i)^\W*dramatis(?:es|ing|e|ed)\b|^\W*(?:this|it) dramatises\b|\b(?:the|our|your) inputs?\b|"
                        r"\bthe research summary\b|\bnot in the brief or the inputs\b")
#: Blocks whose words are the client's or the work's own and never split (a verbatim, the copy lines, a chart).
_KEEP_KINDS = ("quote", "chart", "fromto", "stats", "steps")
#: Slides that list the deck's own workings by design (they are about the inputs).
_ANNOTATION_EXEMPT = ("requirement_trace", "appendix_sources", "questions", "conflicts", "appendix", "title")
ANNOTATION_NOTE = "Moved to the notes (a note for the agency, not for the room):"


def _strip_annotations(text: str) -> tuple:
    """``(kept text, [moved sentences])``: the sentences of ``text`` that are agency annotations, out."""
    sents = re.split(r"(?<=[.!?])\s+", str(text or "").strip())
    moved = [s for s in sents if s and ANNOTATION.search(s)]
    if not moved:
        return text, []
    return " ".join(s for s in sents if s and not ANNOTATION.search(s)), moved


def annotations_to_notes(S: list) -> int:
    """Script annotations and source talk leave every slide's words for its speaker notes, verbatim: a text block's or a list item's
    sentence that matches ``ANNOTATION``, and an execution's whole 'answer' line when it is one. A block or item left with no words is
    dropped (never a slide's last block). Titles, quotes and copy lines are never touched. Returns how many sentences moved."""
    n = 0
    for sl in S:
        if sl["type"] in _ANNOTATION_EXEMPT:
            continue
        moved, blocks = [], []
        for b in sl["blocks"]:
            b = dict(b)
            if b.get("kind") in _KEEP_KINDS:
                blocks.append(b)
                continue
            if b.get("kind") == "copy":
                ans = str(b.get("answer") or "").strip()
                if ans and ANNOTATION.search(ans):
                    moved.append(ans)
                    b["answer"] = ""
                blocks.append(b)
                continue
            if b.get("kind") == "table" and isinstance(b.get("rows"), list):   # a cell's annotation sentence leaves it (the header row stays)
                rows = [list(r) for r in b["rows"]]
                for r in rows[1:]:
                    for c, cell in enumerate(r):
                        if isinstance(cell, str):
                            kept, gone = _strip_annotations(cell)
                            if gone:
                                moved += gone
                                r[c] = kept
                b["rows"] = rows
                blocks.append(b)
                continue
            if isinstance(b.get("text"), str) and b["text"].strip():
                kept, gone = _strip_annotations(b["text"])
                if gone:
                    moved += gone
                    if not kept.strip():
                        continue
                    b["text"] = kept
            if isinstance(b.get("items"), list):
                items = []
                for it in b["items"]:
                    if b.get("kind") == "kv" and isinstance(it, (list, tuple)) and len(it) == 2:
                        kept, gone = _strip_annotations(it[1])
                        moved += gone
                        if str(kept).strip():
                            items.append([it[0], kept])
                        continue
                    t = it.get("text") if isinstance(it, dict) else it if isinstance(it, str) else None
                    if t is None or (isinstance(it, dict) and it.get("human")):
                        items.append(it)
                        continue
                    kept, gone = _strip_annotations(t)
                    moved += gone
                    if str(kept).strip():
                        items.append({**it, "text": kept} if isinstance(it, dict) else kept)
                if not items and b.get("kind") in ("bullets", "kv") and b["items"]:
                    continue
                b["items"] = items
            blocks.append(b)
        if moved:
            sl["blocks"] = blocks or sl["blocks"][:1]
            sl["notes"] = "\n\n".join([x for x in [sl.get("notes") or ""] if x.strip()] + [ANNOTATION_NOTE] + moved)
            n += len(moved)
    return n


# ------------------------------------------------------------------------------------------------------------ the ask
#: What the client can give for a 'To supply' slide (the agency's own gaps, the team, the case studies and the split, are never
#: asked of the client: they stay in the To supply part).
CLIENT_ASKS = {"competition": "Which alternatives are you weighing against this work?", "risks": "Which risks do you already see?",
               "why_now": "Why now: what makes this the moment?", "what_we_know": "What do you already know that we should build on?"}
DECISION_ASK = "When will you decide, and who decides?"
_DATE = re.compile(r"(?i)\b(?:decision|decide|decides|award|appoint(?:ment)?|shortlist|presentation|pitch)\b[^.\n]{0,60}?"
                   r"\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)"
                   r"(?:\s+\d{4})?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}"
                   r"(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})")


def decision_date(text: str) -> str | None:
    """The decision (or presentation) date when the inputs state one, verbatim; else None (the ask never shows a blank for it)."""
    m = _DATE.search(str(text or ""))
    return m.group(1) if m else None


def close_blocks(line: str | None, date: str | None, gaps: bool) -> list:
    """The ask, clean: the platform to agree as the statement (the close's left column), and the next steps as rows: settle what the
    brief leaves open (when it leaves anything open), and the decision by its date only when the inputs give one. No placeholder:
    what only the client can give is in the appendix list (CLIENT_ASKS_TITLE)."""
    stmt = f"Agree '{line.rstrip('.')}' as the campaign platform." if line else "Agree the campaign platform."
    rows = []
    if gaps:
        rows.append({"text": "Answer the questions the brief leaves open, so the work can be finished.", "basis": "proposal"})
    if date:
        rows.append({"text": f"A decision by {date}.", "basis": "proposal"})
    if not rows:   # nothing open and no date given: the one next step the ask can name without inventing one
        rows.append({"text": "Agree the next working session and its date.", "basis": "proposal"})
    return [{"kind": "statement", "text": stmt, "basis": "proposal"}, {"kind": "bullets", "items": rows}]


def client_asks(questions: list, supply: list, date: str | None) -> list:
    """The appendix list of what the client can give, as questions, said once: the brief's questions, then what a 'To supply' slide
    waits for from the client (CLIENT_ASKS), then the decision date when the inputs give none."""
    out = list(questions) + [CLIENT_ASKS[x["type"]] for x in supply if x.get("type") in CLIENT_ASKS]
    if not date:
        out.append(DECISION_ASK)
    seen, uniq = set(), []
    for q in out:
        k = re.sub(r"\W+", " ", str(q).lower()).strip()
        if k and k not in seen:
            seen.add(k)
            uniq.append(q)
    return uniq
