"""Deck validators: plain code, no model (stage f, ADR 0016).

Each check returns findings ``{check, level, slide, message}``; level ``error`` fails the run's
gate, ``warn`` is shown beside the deck. The checks:

numbers_trace     a number on a slide that is in none of the inputs (the prompt's client and project
                  included): invented, an error. A number in the cited prompt sentence, answer or
                  document is traced
numbers_uncited   a number that is in the inputs but not licensed by a ref on its slide (fact,
                  document figure, client document, brief field, requirement, calc:): cite it
unverified_fig    a number resting only on a low-confidence research pin (no client document)
rejected_used     a finding a person rejected is cited (never allowed)
proposed_used     a finding not yet verified is cited (allowed; shown as derived by the agent)
unknown_ref       a ref that resolves to nothing in this run's inputs (a warning, not an error, for a brief: ref when
                  the run has no brief: there is nothing it could resolve against)
bare_claim        a claim with no refs and no creative/opinion/proposal basis
word_budget       on-screen words over the slide type's budget (error past 125%)
empty_slot        a block with no text, or a title missing
placeholder       a human-only slide whose text is not a labelled placeholder
requirement_map   a requirement no slide answers
banned_phrase     a category pack's banned phrase anywhere in a slide or its notes
watch_word        a pack's watch word (needs a person's read in context)
message_carried   a message the client mandates with no line of the work carrying it on a presented
                  slide (deck["messages"]: stage d names the line for each message requirement)
action_title      a presented slide whose title is a label, not a full-sentence takeaway
repeated_line     the same sentence on two presented slides (say it once)
copy_number       a number (10 or more) in creative copy that appears nowhere in the inputs: ad copy that
                  states a figure must take it from the brief or the research
pitch_length      a pitch whose presented story (before the Appendix divider) runs past spec.PITCH_MAX
pitch_cap         (spec.LOOK_V3) a pitch with no stated limit presenting more than spec.PITCH_CAP slides: ADVISORY, a warning
                  that never withholds a deck (its target is spec.PITCH_TARGET). With spec.RECIPES on, the deck type's own
                  cap and target (profiles.recipe: none for a tender), on spine types too
role_words        (spec.LOOK_V3) a presented slide's on-screen words outside its role's window (spec.ROLE_WINDOWS: statement
                  10-35, argument 35-70): ADVISORY, a warning; a shortfall is met by a brief field, never by a repeated line. With
                  spec.RECIPES on, the type's own roles and windows (profiles.recipe density), and none at density detailed
notes_unread      (spec.RECIPES, format full: 'Sent to be read') a slide whose points the plan moved to the speaker notes, which
                  nobody reads in a leave-behind: ADVISORY, a warning naming the slide and the count
rule_broken       a brief rule's quoted phrase ("Avoid 'the Netflix of X' framing") appears in the deck
source_required   a block or item marked "sourced" that cites nothing: information from outside the
                  three inputs (the user's prompt, the research CLAN, the brief) never reaches a slide
code_leak         (spec.PITCH_READY) an internal reference code on a shown text: a ref (prompt:43, brief:insight, req:R4), an id
                  (ic_feeling, gap_chart, f_ev1), a label (T1, C2, candidate B), a slide or stage id. Scrubbed by pitch_ready.scrub_deck first;
                  one left is an error for every audience
internal_leak     agency-only text on screen: pipeline ids, stand-in or gate labels, "to confirm",
                  the [Agency] placeholder (error for a client render; a warning in review, where
                  labelled placeholders and blocks marked internal are expected and skipped)
quote_source      a quote with no ref that is not marked creative (it would read as a verbatim)
criteria_map      a scored criterion's concept no slide answers (assemble.criteria_coverage)
image_unapproved  (client render) a picture not approved by the deck's approver for its own asset (an error: it is not drawn)
image_flagged     a picture the guard flagged (a warning in a review, where it is drawn marked)
image_rights      a reference-only picture in a slot (an error), or a territory run not checked against the brief (a warning)
style_pack_held  the Style Pack could not be read (a StyleError): the build went on (a warning, a major issue: the pictures were not restyled)
image_missing     an image slot that names an asset the deck does not hold (an error)
imagery           an image prompt names a pack's banned imagery (method or location, in pictures too)
copy_spec         execution copy over its channel's limit (spec.COPY_LIMITS: search characters,
                  poster words, audio words for the spot length)
budget_spread     more paid channels than the budget can carry (spec.SMALL_BUDGET_EUR rule of thumb)
thin_evidence     a deck built from a prompt (or a prompt and documents) alone whose presented slides mostly
                  cite nothing (more than spec.THIN_EVIDENCE_SHARE): a review draft, check and ask first
objective_quant   an agency deck (not an investor one) whose first three presented slides state no number, or no from/to,
                  versus or by-date pattern: the objective should be quantified early (a warning)
insight_shape     (a deck whose stage b wrote insight candidates) the insight slide is not the three-line truth with a
                  tension and its evidence: three sentences, the second with a tension word (but, yet, while, even though,
                  still, instead), the third starting "so" or "which means", no number in them, refs on the truth, and
                  at least one evidence line citing an input (a warning)
idea_single       the idea slide is not one idea: more than one presented idea slide when the client asked for one
                  route, an idea statement over its 60-word budget, or an idea that reads as a channel list (a warning)
chain_links       (a deck whose stage d wrote a ``chain``) a quoted phrase of the chain is not on the slide it links:
                  insight phrase on the insight slide, strategy phrase on the proposition slide, idea phrase on the idea
                  slide, proof phrase on the idea slide and on a measurement or execution slide (a warning)
weight_share      (a deck with scored criteria that state weights) a heavily weighted criterion (a quarter of the total weight or more)
                  whose share of the presented words is under half its weight share (a warning; the message and
                  ``weight_share_report`` give the minimum ratio)
claim_fit         a headline its evidence does not support, from the fit judge (deck["fit"]: a
                  judge's verdicts, recorded or live; "not" is an error, "partly" a warning, and a
                  verdict whose slide title changed is reported stale)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from . import profiles, spec
from .assemble import _brief_text, criteria_coverage, slide_refs
from .refs import Resolver, answer_text, numbers_in

PACKS = Path(__file__).parent / "packs"
#: What makes a number an objective: a from/to, a versus, or a date to reach it by (objective_quant).
_FROM_TO = re.compile(r"\bfrom\b[^.;\n]{0,50}?\d[^.;\n]{0,50}?\bto\b[^.;\n]{0,30}?\d|\d[^.;\n]{0,30}\b(?:vs\.?|versus)\b|\b(?:vs\.?|versus)\b[^.;\n]{0,30}\d"
                      r"|\bby\s+(?:the end of\s+|end of\s+)?(?:\d{1,2}\s+)?(?:Q[1-4]\b|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b|\d{4}\b)"
                      r"|\d[\d.,]*\s*%?\s+(?:to|→|->)\s+\d", re.I)


def packs_for(inp) -> list:
    """The category packs whose trigger words appear in the prompt, answers, brief, research or documents."""
    hay = " ".join(str((f or {}).get("value")) for f in inp.brief.values()).lower()
    hay += " ".join(str(f.get("value")) for f in inp.facts.values()).lower()
    hay += " ".join(d["text"][:20000] for d in inp.docs.values()).lower()
    hay += " " + str(inp.prompt_text or "").lower()
    hay += " " + " ".join(answer_text(inp, q) for q in (inp.answers or {})).lower()
    out = []
    for p in sorted(PACKS.glob("*.yaml")):
        pk = yaml.safe_load(p.read_text())
        if any(w in hay for w in pk.get("when_any", [])):
            out.append(pk)
    return out


def _texts(sl, with_notes=False, internal=True, human=True):
    """(text, basis) pairs of everything shown on a slide; ``internal``/``human``: include blocks
    marked internal, and labelled placeholders."""
    out = [(sl.get("title", ""), None)]
    moved = spec.moved_map(sl) if sl.get("layout") else {}   # points the layout plan moved to the notes are not on the slide
    for bi, bl in enumerate(sl.get("blocks", [])):
        if bi in moved and moved[bi] is None:
            continue
        if (bl.get("internal") and not internal) or (bl.get("human") and not human):
            continue
        basis = bl.get("basis")
        for k in ("text", "title", "from", "to", "answer"):
            if bl.get(k):
                out.append((bl[k], basis))
        for ln in bl.get("lines", []) or []:
            out.append((ln, basis))
        for ii, it in enumerate(bl.get("items", []) or []):
            if ii in (moved.get(bi) or ()):
                continue
            if isinstance(it, dict):
                if it.get("human") and not human:
                    continue
                out.append((it.get("text") or f"{it.get('value', '')} {it.get('label', '')}".strip(), it.get("basis") or ("proposal" if it.get("human") else basis)))
            elif isinstance(it, list):
                out += [(x, basis) for x in it]
        for row in bl.get("rows", []) or []:
            out += [(x, basis) for x in row]
        for s in (bl.get("chart") or {}).get("series", []):
            out.append((s.get("label", ""), basis))
    if with_notes:
        out.append((sl.get("notes", ""), None))
        if moved:   # the moved points are delivered in the notes: checks that read the notes read them
            from . import layouts
            out += [(t, None) for t, _ in layouts.moved_texts(sl)]
    return out


def presented(deck) -> list:
    """Slide ids of the presented story: everything before the Appendix divider (or the trace)."""
    cut = next((i for i, x in enumerate(deck["order"]) if deck["slides"][x]["type"] in ("appendix", "requirement_trace", "appendix_sources")), len(deck["order"]))
    return deck["order"][:cut]


def words(sl) -> int:
    """On-screen slide text, title excluded (the budget rule). Labelled placeholders are not counted
    (a person replaces them), nor is ad copy: the work shown in its frame, held to its channel's
    limits by copy_spec instead."""
    return sum(len(str(t).split()) for t, _ in _texts({**sl, "blocks": [b for b in sl.get("blocks", []) if b["kind"] != "copy"]}, human=False)[1:])


def profile_of(deck: dict) -> dict | None:
    """The deck type (profile) a deck was built as: from ``meta.profile``, else ``meta.built_from.type``; None for a deck
    that records none (built before types existed, or by assemble with no profile), which keeps every default."""
    meta = deck.get("meta") or {}
    pid = (meta.get("profile") or {}).get("id") or (meta.get("built_from") or {}).get("type")
    try:
        return profiles.load(pid) if pid else None
    except profiles.ProfileError:   # a type this engine does not know: keep every default
        return None


def _slide_norm(deck: dict, sid: str) -> str:
    """A slide's on-screen words, title included, in spec.norm_text form (agency notes left out)."""
    return spec.norm_text(" ".join(str(t) for t, _ in _texts(deck["slides"][sid], internal=False)))


def _of_type(deck: dict, type_: str) -> list:
    """Slide ids of a type, the presented ones first, then the backup."""
    ids = [x for x in deck["order"] if deck["slides"][x]["type"] == type_]
    story = set(presented(deck))
    return [x for x in ids if x in story] + [x for x in ids if x not in story]


def insight_findings(deck: dict) -> list:
    """The insight_shape findings (level, slide id, message) for a deck built from insight candidates; none for a deck
    built the old way (no ``meta.insight``): its insight slide is judged by the other checks only."""
    if not (deck.get("meta") or {}).get("insight"):
        return []
    out = []
    for sid in _of_type(deck, "insight")[:1]:
        sl = deck["slides"][sid]
        st = next((b for b in sl["blocks"] if b["kind"] == "statement"), None)
        if not st:
            return [("warn", sid, "the insight slide has no three-line truth (a statement block)")]
        sents = [x for x in re.split(r"(?<=[.!?])\s+", str(st.get("text", "")).strip()) if x]
        if len(sents) != 3:
            out.append(("warn", sid, f"the insight truth is {len(sents)} sentences; the form is three (people..., but..., so...)"))
        if len(sents) > 1 and not re.search(spec.TENSION_WORDS, sents[1], re.I):
            out.append(("warn", sid, "the second line of the insight has no tension (but, yet, while, even though, still, instead)"))
        if len(sents) > 2 and not re.match(spec.IMPLICATION_START, sents[2], re.I):
            out.append(("warn", sid, "the third line of the insight does not say what it means for us (starts with 'so' or 'which means')"))
        if numbers_in(" ".join(sents)):
            out.append(("warn", sid, "a number in the insight's three lines: numbers belong in the evidence, not the truth"))
        if not st.get("refs"):
            out.append(("warn", sid, "the insight truth cites no input: it reads as our own opinion"))
        if not any(b["kind"] in ("small", "bullets") and b.get("basis") != "meta" and (b.get("refs") or any(isinstance(i, dict) and i.get("refs") for i in b.get("items") or [])) for b in sl["blocks"]):
            out.append(("warn", sid, "the insight slide has no evidence line citing an input"))
    return out


def idea_findings(deck: dict) -> list:
    """The idea_single findings (level, slide id, message): one presented idea slide unless the client asked for more routes
    (assemble.routes_asked), an idea statement within its word budget, and no more than spec.IDEA_MAX_CHANNEL_WORDS
    channel words (spec.FRAMES) in it. A deck with no idea slide has none."""
    from .assemble import routes_asked
    story = set(presented(deck))
    ideas = [x for x in _of_type(deck, "idea") if x in story]
    out = []
    if len(ideas) > max(1, routes_asked(list((deck.get("requirements") or {}).values()))):
        out.append(("warn", ideas[1], f"{len(ideas)} idea slides are presented and the brief asked for one route: recommend one idea"))
    for sid in ideas[:1]:
        stm = next((b for b in deck["slides"][sid]["blocks"] if b["kind"] == "statement"), None)
        text = str((stm or {}).get("text", ""))
        if len(text.split()) > spec.SLIDE_TYPES["idea"]["words"]:
            out.append(("warn", sid, f"the idea is {len(text.split())} words; one idea in {spec.SLIDE_TYPES['idea']['words']} or fewer"))
        low = text.lower()
        chans = [w for _, ws in spec.FRAMES for w in ws if re.search(rf"\b{re.escape(w)}", low)]
        if len(chans) > spec.IDEA_MAX_CHANNEL_WORDS:
            out.append(("warn", sid, f"the idea names {len(chans)} channels ({', '.join(chans[:4])}): an idea is one thought, not a channel list"))
    return out


#: A chain phrase must be at least this many words (the d prompt asks for three or more).
CHAIN_MIN_WORDS = 3


def _has_phrase(text: str, phrase: str) -> bool:
    """True when the normalised ``phrase`` occurs in the normalised ``text`` on word boundaries (never inside a longer word)."""
    return f" {phrase} " in f" {text} "


def chain_findings(deck: dict) -> list:
    """The chain_links findings (level, slide id, message) for a deck whose stage d wrote a ``chain``: each quoted phrase
    must be at least CHAIN_MIN_WORDS words and be found (spec.norm_text, on word boundaries) on the slide it links. Without a chain, none."""
    chain = (deck.get("meta") or {}).get("chain")
    if not isinstance(chain, dict):
        return []
    links = (("insight_phrase", ("insight",), "the insight slide"), ("strategy_phrase", ("proposition",), "the proposition slide"),
             ("idea_phrase", ("idea",), "the idea slide"), ("proof_phrase", ("idea",), "the idea slide"))
    out = []
    for key, types, where in links:
        phrase = spec.norm_text(chain.get(key) or "")
        if not phrase:
            continue
        sids = [x for t in types for x in _of_type(deck, t)]
        if len(phrase.split()) < CHAIN_MIN_WORDS:
            out.append(("warn", sids[0] if sids else None, f"chain {key} \"{str(chain[key])[:50]}\" is under {CHAIN_MIN_WORDS} words: quote a phrase long enough to be a real link"))
        elif not sids:
            out.append(("warn", None, f"chain {key}: there is no {types[0]} slide to hold \"{str(chain[key])[:50]}\""))
        elif not any(_has_phrase(_slide_norm(deck, x), phrase) for x in sids):
            out.append(("warn", sids[0], f"chain {key} \"{str(chain[key])[:50]}\" is not on {where}"))
        if key == "proof_phrase" and sids and len(phrase.split()) >= CHAIN_MIN_WORDS and any(_has_phrase(_slide_norm(deck, x), phrase) for x in sids):
            proof = [x for t in ("measurement", "execution") for x in _of_type(deck, t)]
            if not any(_has_phrase(_slide_norm(deck, x), phrase) for x in proof):
                out.append(("warn", proof[0] if proof else None, f"chain proof_phrase \"{str(chain[key])[:50]}\" is on no measurement or execution slide: the proof does not cite the idea"))
    return out


def relay_test(deck: dict) -> dict | None:
    """The relay-test line for report.json, RECORD ONLY (no model, never blocks): can the idea be restated from the insight
    alone? The skim material (titles of the presented story, the idea slide) is kept for a later judge; ``overlap`` is the
    share of the idea's content words (over three letters) found in the insight's own text, a lexical hint and not a judgement.
    None when the deck has no insight or no idea slide."""
    ins, idea = (_of_type(deck, t) for t in ("insight", "idea"))
    if not (ins and idea):
        return None
    words_of = lambda sid: {w for w in _slide_norm(deck, sid).split() if len(w) > 3}
    mine = words_of(idea[0]) - {w for w in spec.norm_text(deck["slides"][idea[0]]["title"]).split()} or words_of(idea[0])
    shared = mine & words_of(ins[0])
    return {"mode": "record_only", "overlap": round(len(shared) / len(mine), 2) if mine else 0.0, "shared_words": sorted(shared)[:12],
            "insight": deck["slides"][ins[0]]["title"], "idea_line": deck["slides"][idea[0]]["title"],
            "titles": [deck["slides"][x]["title"] for x in presented(deck)],
            "note": "lexical overlap only; a judge reading the titles and the idea slide is not run"}


def _supplied_ok(sl: dict) -> bool:
    """True when a human-only slide is filled by the person's own input: it records ``supplied`` and every claim
    on it cites an answer or a document (answer:<qid>, doc:<key>#...). A slide that says it is supplied but cites
    anything else is not: the placeholder rule still fails it."""
    claims = sl.get("claims") or []
    return bool(sl.get("supplied") and claims and all(r.startswith(("answer:", "doc:")) for c in claims for r in c.get("refs") or [])
                and all(c.get("refs") for c in claims))


def number_corpus(deck: dict, inp) -> set:
    """Every number the inputs state: the brief, the research facts and document figures, the documents, the prompt (with the
    client and project names) and the person's answers. numbers_trace and the figure guard (deck/figures.py) read the same set."""
    corpus = set()
    for f in inp.brief.values():
        corpus |= numbers_in(json.dumps(f.get("value"), ensure_ascii=False, default=str))
    for f in list(inp.facts.values()) + list(inp.doc_facts.values()):
        corpus |= numbers_in(json.dumps(f, ensure_ascii=False, default=str))
    for d in inp.docs.values():
        corpus |= numbers_in(d["text"])
    corpus |= numbers_in(f"{deck['meta'].get('client', '')} {deck['meta'].get('project', '')}")   # the prompt is an input
    corpus |= numbers_in(inp.prompt_text)
    for qid in inp.answers:
        corpus |= numbers_in(answer_text(inp, qid))
    return corpus


def slide_allowed(sl: dict, R) -> set:
    """The numbers a slide's own refs license (a ref that resolves to nothing licenses none)."""
    allowed = set()
    for r in slide_refs(sl):
        if R.kind(r) != "unknown":
            allowed |= R.numbers(r)
    return allowed


def untraced(n: float, allowed: set, corpus: set) -> bool:
    """True when ``n`` is a numbers_trace error: not licensed by the slide's refs and in none of the inputs (0 and 1 are never)."""
    if n in allowed or n in (0.0, 1.0) or round(n / 1000, 4) in allowed:   # $788K from a cited $0.788M
        return False
    return not (n in corpus or round(n / 100, 4) in corpus)


def run(deck: dict, inp, audience: str = "review", profile: dict | None = None) -> list:
    """Run every check over the deck for an audience (spec.AUDIENCES). Returns the findings. ``profile`` (default:
    the deck's own, profile_of) sets which checks are errors rather than warnings (its ``strict`` map; the default
    levels are the ones documented above) and the presented length."""
    profile = profile or profile_of(deck)
    R = Resolver(inp, list(deck.get("requirements", {}).values()))
    F = []
    def add(check, level, sid, msg):
        F.append({"check": check, "level": level, "slide": sid, "message": msg})
    packs = packs_for(inp)
    num = {sid: i for i, sid in enumerate(deck["order"], 1)}
    story = presented(deck)
    backup = set(deck["order"]) - set(story) if deck["meta"].get("format", "pitch") == "pitch" else set()   # read, not presented
    corpus = number_corpus(deck, inp)   # every number the inputs state, for figures in creative copy
    for sid in deck["order"]:
        sl = deck["slides"][sid]
        refs = slide_refs(sl)
        allowed = set()
        for r in refs:
            k = R.kind(r)
            if k == "unknown":
                add("unknown_ref", "warn" if r.startswith("brief:") and not inp.has_brief() else "error", sid, f"{r} resolves to nothing in this run")
                continue
            allowed |= R.numbers(r)
            if k == "finding":
                st = inp.findings[r].get("status")
                if st == "rejected":
                    add("rejected_used", "error", sid, f"{r} was rejected by a person: {inp.findings[r].get('rejection', {}).get('reason')}")
                elif st != "verified":
                    add("proposed_used", "warn", sid, f"{r} is {st}, not verified: shown as derived by the agent")
            if k == "fact" and r in inp.rejected_pins:
                add("rejected_used", "error", sid, f"pin {r} was marked bad by a person")
        # numbers
        for text, basis in _texts(sl):
            if basis in ("creative", "proposal", "meta"):
                continue
            for n in numbers_in(text):
                if n in allowed or n in (0.0, 1.0) or round(n / 1000, 4) in allowed:   # $788K from a cited $0.788M
                    continue
                if not untraced(n, allowed, corpus):
                    add("numbers_uncited", "warn", sid, f"'{n:g}' in \"{str(text)[:70]}\" is in the inputs but cited by no ref on this slide")
                else:
                    add("numbers_trace", "error", sid, f"'{n:g}' in \"{str(text)[:70]}\" is in none of the inputs")
        # unverified research figures: a number licensed only by low-confidence pins
        doc_nums = set()
        for r in refs:
            if R.kind(r) in ("docfig", "doc", "brief", "req", "calc", "prompt", "answer"):
                doc_nums |= R.numbers(r)
        for r in refs:
            if R.kind(r) == "fact" and str(inp.facts[r].get("confidence")) == "low":
                vals = R.numbers(r) - doc_nums
                shown = {n for t, _ in _texts(sl) for n in numbers_in(t)}
                if vals & shown:
                    add("unverified_fig", "warn", sid, f"{r} ({inp.facts[r].get('key')}) is low-confidence research with no client document behind it: confirm with the client")
        # sourced means sourced: anything marked so must cite one of the inputs
        for bl in sl.get("blocks", []):
            marked = [bl] if bl.get("basis") == "sourced" else []
            marked += [it for it in bl.get("items", []) or [] if isinstance(it, dict) and (it.get("basis") or bl.get("basis")) == "sourced"]
            for m in marked:
                if not m.get("refs"):
                    add("source_required", "error", sid, f"marked sourced but cites no input: \"{str(m.get('text', ''))[:60]}\"")
        # claims
        for cl in sl.get("claims", []):
            if not cl.get("refs") and cl.get("basis") not in ("creative", "opinion", "proposal"):
                add("bare_claim", "error", sid, f"claim with no source and no basis: \"{cl.get('text', '')[:70]}\"")
        # budget
        budget = sl.get("budget") or spec.SLIDE_TYPES[sl["type"]]["words"]   # a written answer's budget comes from its criterion's weight
        w = words(sl)
        if w > budget and sid not in backup:
            add("word_budget", "error" if w > budget * 1.25 else "warn", sid, f"{w} words on screen, budget {budget} for {sl['type']}")
        # empty slots
        if not sl.get("title"):
            add("empty_slot", "error", sid, "no title")
        for bl in sl.get("blocks", []):
            if bl["kind"] in ("text", "small", "statement", "quote", "callout", "card") and not str(bl.get("text", "")).strip():
                add("empty_slot", "warn", sid, f"empty {bl['kind']} block (dropped at render)")
        # placeholders
        clean_ask = spec.FINISH and sl["type"] == "next_step" and sl.get("status") != "needs_human"   # finish fixes: the clean ask holds no blank
        if sl["type"] in spec.HUMAN_ONLY_TYPES and not clean_ask:
            hum = [it for bl in sl["blocks"] for it in (bl.get("items") or []) if isinstance(it, dict) and it.get("human")]
            hum += [bl for bl in sl["blocks"] if bl.get("human")]
            for h in hum:
                if not (h["text"].startswith(spec.PLACEHOLDER_PREFIX) and "To confirm:" in h["text"]):
                    add("placeholder", "error", sid, "human-only content is not a labelled placeholder")
            if not hum and not _supplied_ok(sl):
                add("placeholder", "error", sid, "human-only slide carries no labelled placeholder")
        # agency-only text reaching the room
        client = audience == "client"
        seen = set()
        for text, _ in _texts(sl, internal=False, human=client):
            for pat, what in spec.INTERNAL_PATTERNS:
                m = re.search(pat, str(text))
                if m and (what, m.group(0)) not in seen:
                    seen.add((what, m.group(0)))
                    add("internal_leak", "error" if client else "warn", sid, f"{what} on screen: '{m.group(0)}' in \"{str(text)[:60]}\"")
        # quotes: a verbatim needs a ref; an unsourced line must be marked creative (shown as illustrative)
        for bl in sl.get("blocks", []):
            if bl["kind"] == "quote" and str(bl.get("text", "")).strip() and not bl.get("refs") and bl.get("basis") != "creative":
                add("quote_source", "error", sid, f"quote with no source reads as a verbatim: \"{str(bl['text'])[:60]}\"")
        # figures in creative copy must come from the inputs
        for bl in sl.get("blocks", []):
            if bl.get("basis") == "creative" or bl["kind"] in ("copy", "sketch"):
                for t in [bl.get("text", ""), bl.get("answer", "")] + list(bl.get("lines", []) or []):
                    t = re.sub(r"\b\d{1,2}:\d{2}\b|\b\d+(?:st|nd|rd|th)\b", " ", str(t))   # times and ordinals set a scene
                    for n in numbers_in(t):
                        if n >= 10 and n not in corpus and round(n / 100, 4) not in corpus:
                            add("copy_number", "warn", sid, f"'{n:g}' in copy \"{str(t)[:60]}\" is in none of the inputs")
        # image prompts: method and location are banned in pictures as in words
        prompt = " ".join([str((sl.get("visual") or {}).get("prompt") or "")] + [
            str(v["image"].get(k) or "") for v in (sl.get("slots") or {}).values() if isinstance(v, dict) and v.get("kind") == "image"
            for k in ("prompt", "subject")]).lower().strip()   # an image slot's prompt and subject are read as well as slide.visual
        _images(sl, sid, deck, audience, add)
        for p in packs:
            for bi in p.get("banned_imagery", []):
                if re.search(rf"\b{re.escape(bi['text'])}\b", prompt):
                    add("imagery", "error", sid, f"image prompt shows '{bi['text']}' ({p['id']}, source {bi['source']})")
        # channel copy limits
        if sl["type"] == "execution":
            _copy_spec(sl, lambda lvl, msg: add("copy_spec", lvl, sid, msg))
        # safety
        alltext = " ".join(str(t) for t, _ in _texts(sl, with_notes=True)).lower()
        for p in packs:
            for bp in p.get("banned_phrases", []):
                if bp["text"] in alltext and sl["type"] != "guardrails":  # the guardrails slide lists them
                    add("banned_phrase", "error", sid, f"'{bp['text']}' ({p['id']}, source {bp['source']})")
            for ww in p.get("watch_words", []):
                if ww["text"] in alltext and sl["type"] != "guardrails":
                    add("watch_word", "warn", sid, f"'{ww['text']}': {ww['why']} ({p['id']})")
    sp = (deck["meta"].get("preferences") or {}).get("style_pack") or {}
    mh = deck["meta"].get("style_hold") or {}   # the one hold: set by a failed pack load or by the frames plan; preferences.style_pack.hold mirrors it
    if sp.get("hold") or mh:
        add("style_pack_held", "warn", None, f"the Style Pack could not be read ({str(sp.get('hold_reason') or mh.get('reason', ''))[:120]}): the build went on and the pictures keep the style they were made in")
    # requirements (a rule is kept across the deck, not answered by a slide: its quoted phrase must not appear)
    mapped = {r for sl in deck["slides"].values() for r in sl.get("requirements", [])}
    deck_text = " ".join(str(t) for x in deck["order"] if deck["slides"][x]["type"] != "requirement_trace"   # the trace quotes the rules
                         for t, _ in _texts(deck["slides"][x], internal=False)).lower()
    for rid, r in deck.get("requirements", {}).items():
        if r["kind"] == "rule":
            for phrase in re.findall(r"['\u2018\u201c\"]([^'\u2019\u201d\"]{4,60})['\u2019\u201d\"]", r["text"]):
                core = re.sub(r"\s+(x|y|z)$", "", phrase.strip().lower())   # 'the Netflix of X' -> 'the netflix of'
                if core and core in deck_text:
                    add("rule_broken", "error", None, f"{rid}: the deck says '{core}' ({r['text'][:60]})")
            continue
        if rid not in mapped:
            add("requirement_map", "error", None, f"{rid} ({r['text'][:60]}) is answered by no slide")
    # pitch length: the presented story is everything before the Appendix divider
    length = deck["meta"].get("length") or {}   # a spine profile records its limit, or the buyer's stated one
    if deck["meta"].get("format", "pitch") == "pitch" and len(story) > length.get("max_slides", spec.PITCH_MAX):
        what = f"a {profile['label'].lower() if profile else 'deck'} presents at most {length['max_slides']} ({length['source']})" if length else f"an agency pitch presents at most {spec.PITCH_MAX}"
        add("pitch_length", "warn", None, f"{len(story)} presented slides; {what} (move the rest behind the Appendix divider)")
    if profiles.recipes_on():   # deck-types: the type's own target and cap (a spine type records its profile length: only a stated one silences the cap)
        rl = profiles.recipe(profile, deck["meta"].get("format", "pitch"))["length"]
        stated = bool(length) and length.get("source") != "profile"
        if deck["meta"].get("format", "pitch") == "pitch" and not stated and rl["cap"] is not None and len(story) > rl["cap"]:   # ADVISORY only
            aim = f"aims at {rl['target']} and " if rl["target"] is not None else ""
            add("pitch_cap", "warn", None, f"{len(story)} presented slides; a {profile['label'].lower() if profile else 'pitch'} {aim}is usually at most {rl['cap']} "
                f"(advisory: asked-for routes and executions may rightly run longer; nothing is withheld for length)")
    elif spec.LOOK_V3 and deck["meta"].get("format", "pitch") == "pitch" and not length and len(story) > spec.PITCH_CAP:   # deck-look: ADVISORY only
        add("pitch_cap", "warn", None, f"{len(story)} presented slides; a pitch aims at {spec.PITCH_TARGET} and is usually at most {spec.PITCH_CAP} "
            f"(advisory: asked-for routes and executions may rightly run longer; nothing is withheld for length)")
    fmt_ = deck["meta"].get("format", "pitch")
    rd = profiles.recipe(profile, fmt_)["density"] if profiles.recipes_on() else None   # deck-types slice 4: the type's roles and windows
    lvl = ((deck["meta"].get("preferences") or {}).get("density") or {}).get("level") if rd else None
    lvl = lvl or (rd or {}).get("level")
    if spec.LOOK_V3 and not (rd and lvl == "detailed"):   # deck-look step 6 (Q13): the word windows by role, ADVISORY; never met by repeating a sentence or by words a layout asks for
        roles_, wins_ = (rd["roles"], rd["windows"]) if rd else (spec.ROLE_OF_TYPE, spec.ROLE_WINDOWS)   # with a recipe at detailed (a tender, the read format): no windows
        for x in story:
            role = roles_.get(deck["slides"][x]["type"])
            if not role:
                continue
            lo, hi = wins_[role]
            n = words(deck["slides"][x]) + len(str(deck["slides"][x].get("title") or "").split())   # the window counts the title: a statement is often its title
            if not lo <= n <= hi:
                add("role_words", "warn", x, f"{n} words on screen; {'an' if role[0] in 'aeiou' else 'a'} {role} slide carries {lo}-{hi} (advisory: "
                    + ("add a brief field that says more, never a repeated line)" if n < lo else "the plan moves the rest to the notes)"))
    if rd and fmt_ == "full":   # deck-types slice 8: nobody presents a leave-behind, so a point the plan moved to the notes is unread (ADVISORY)
        for x in deck["order"]:
            n = len((((deck["slides"][x].get("layout") or {}).get("fit") or {}).get("moved")) or [])
            if n >= spec.NOTES_UNREAD_MIN:
                add("notes_unread", "warn", x, f"{n} point{'s' if n != 1 else ''} moved to the speaker notes: a deck sent to be read is not presented, so "
                    f"{'they go' if n != 1 else 'it goes'} unread (choose a roomier layout or a denser level; the A4 export prints notes under each slide once slide size lands)")
    if deck["meta"].get("format", "pitch") == "pitch" and length.get("min_slides") and len(story) < length["min_slides"]:
        add("pitch_length", "warn", None, f"{len(story)} presented slides; a {profile['label'].lower() if profile else 'deck'} presents at least {length['min_slides']}: "
            f"give the stages more to work from (a brief, documents or answers)")
    # the objective, quantified, in the first three presented slides
    if deck["meta"].get("kind", "agency") == "agency" and story:
        head = [str(t) for x in story[:3] for t, _ in _texts(deck["slides"][x], internal=False, human=False)]
        if not (numbers_in(" ".join(head)) - {0.0, 1.0} and any(_FROM_TO.search(t) for t in head)):
            add("objective_quant", "warn", None, "the first three presented slides do not give the objective as a number and a from/to, versus or by-date "
                "(say what moves, from what, to what, by when)")
    # a thin input leaves most slides with nothing to cite: say so
    tier = (deck["meta"].get("built_from") or inp.built_from or {}).get("tier")
    if tier in spec.THIN_TIERS and story:
        bare = [x for x in story if not slide_refs(deck["slides"][x])]
        if len(bare) / len(story) > spec.THIN_EVIDENCE_SHARE:
            add("thin_evidence", "warn", None, f"{len(bare)} of {len(story)} presented slides cite nothing and the deck is built from "
                f"{'a prompt' if tier == 'prompt' else 'a prompt and documents'} alone: a review draft; answer the questions or add a brief or research")
    # mandated messages: each needs a line of the work, on a presented slide, that carries it
    on_screen = {x: spec.norm_text(" ".join(str(t) for t, _ in _texts(deck["slides"][x], internal=False))) for x in story}
    lines = {m["req"]: m.get("line", "") for m in deck.get("messages") or []}
    for rid, r in deck.get("requirements", {}).items():
        if r["kind"] != "message":
            continue
        ln = lines.get(rid, "").strip()
        parts = spec.message_parts(ln)
        flat = " ".join(on_screen.values())
        if not ln:
            add("message_carried", "error", None, f"{rid} ({r['text'][:60]}): no line of the work carries it")
        elif not any(x and x in flat for x in parts):
            add("message_carried", "error", None, f"{rid}: its line \"{ln[:50]}\" is on no presented slide")
    # titles are takeaways; a sentence is said once
    seen, said_by = {}, {}
    v3 = bool(spec.LOOK_V3)   # deck-look (fix 2, Q13): a sentence is said once, the titles and the campaign line included, from four words
    labels = profiles.label_titles(profile, fmt_)   # deck-types slice 4: a type whose titles are labels (title form label) is not held to claims
    for x in story:
        sl = deck["slides"][x]
        if not labels and sl["type"] not in spec.LABEL_TITLE_TYPES and len(sl["title"].split()) < 5:
            add("action_title", "warn", x, f"title \"{sl['title']}\" is a label: write the takeaway as a full sentence")
        for t, basis in (_texts(sl, internal=False, human=False) if v3 else _texts(sl, internal=False, human=False)[1:]):
            if basis == "creative" and not v3:   # copy repeats its sign-off by design (the helpline on every piece)
                continue
            for sent in re.split(r"(?<=[.!?])\s+", str(t)):
                key = re.sub(r"\W+", " ", sent.lower()).strip()
                if len(key.split()) >= (4 if v3 else 6):
                    if key in seen and seen[key] != x and not (basis == "creative" and said_by.get(key) == "creative"):   # one piece's sign-off on another
                        add("repeated_line", "warn", x, f"said on slide {deck['order'].index(seen[key]) + 1} too: \"{sent[:60]}\"")
                    seen.setdefault(key, x)
                    said_by.setdefault(key, basis)
    # budget spread
    budget = re.search(r"€\s?([\d,]{4,})", _brief_text(inp, "budget_scope", ""))
    cr = next((x for x in deck["order"] if deck["slides"][x]["type"] == "channel_roles"), None)
    if budget and cr:
        eur = float(budget.group(1).replace(",", ""))
        rows = next((b.get("rows") for b in deck["slides"][cr]["blocks"] if b["kind"] == "table"), None) or [[]]
        paid = [r[0] for r in rows[1:] if not re.search(spec.UNPAID_CHANNEL, " ".join(map(str, r)))]
        if eur < spec.SMALL_BUDGET_EUR and len(paid) > spec.MAX_PAID_CHANNELS:
            add("budget_spread", "warn", cr, f"{len(paid)} paid channels on €{eur:,.0f} gross (VAT, fees and production included): "
                f"under €{eur / len(paid):,.0f} each before fees; rule of thumb: at most {spec.MAX_PAID_CHANNELS} under €{spec.SMALL_BUDGET_EUR:,}")
    # headline fit, from the judge's verdicts
    by_title = {deck["slides"][x]["title"]: x for x in deck["order"]}
    for v in (deck.get("fit") or {}).get("verdicts", []):
        x = by_title.get(v["title"])
        if not x:
            add("claim_fit", "warn", None, f"stale verdict (no slide titled \"{v['title'][:60]}\"): run the fit judge again")
        elif v["verdict"] in ("not", "partly"):
            add("claim_fit", "error" if v["verdict"] == "not" else "warn", x, f"headline {'not' if v['verdict'] == 'not' else 'partly'} supported: {v['reason']}")
        elif v["verdict"] == "narrowed" and v.get("was") == "not":   # a 'not' headline reworded and never re-judged: the gate error stays
            add("claim_fit", "error", x, f"headline was not supported and was reworded without being judged again (was \"{str(v.get('narrowed_from', ''))[:60]}\"): run the fit judge again to clear it. {v.get('reason', '')}".strip())
        elif v["verdict"] == "narrowed":   # reworded after the judge read it (stage e or the red team): not judged again
            add("claim_fit", "warn", x, f"headline was {v.get('was')} supported and has been narrowed (was \"{str(v.get('narrowed_from', ''))[:60]}\"): run the fit judge again to confirm. {v.get('reason', '')}".strip())
    # the insight, the one idea and the chain that ties them (DECK-CRAFT-PLAN 3.4, 3.5)
    for check, found in (("insight_shape", insight_findings), ("idea_single", idea_findings), ("chain_links", chain_findings)):
        for lvl, sid, msg in found(deck):
            add(check, lvl, sid, msg)
    # weight-aware allocation: the buyer's weights against the words the deck spends on each criterion
    rep_ = weight_share_report(deck)
    for r in rep_["rows"]:
        if r["heavy"] and r["ratio"] < spec.WEIGHT_SHARE_FLOOR:
            add("weight_share", "warn", None, f"'{r['criterion']}' carries {r['weight_share'] * 100:.0f}% of the weight but {r['words_share'] * 100:.0f}% of the presented words "
                f"(under half its share; the lowest ratio is {rep_['min_ratio']:.2f} on '{rep_['min_criterion']}'): give it more of the answer")
    # scored criteria
    for c in criteria_coverage(deck):
        for concept in c["missing"]:
            add("criteria_map", "error", None, f"scored criterion '{c['criterion']}' ({c['weight']}): no slide answers '{concept}'")
    if spec.SHOW_WORK:   # show the work: stage b's own proposition, and the idea and two executions in the first ten (deck/show_work.py)
        from .show_work import findings as _show_work_findings   # noqa: PLC0415
        for chk, lvl, sid, msg in _show_work_findings(deck, story):
            add(chk, lvl, sid, msg)
    if spec.PITCH_READY:   # pitch-ready: an internal reference code on a shown text (prompt:43, brief:insight, ic_feeling, T1) is an error
        from .pitch_ready import code_findings   # noqa: PLC0415
        F += code_findings(deck)
    for f in F:   # the deck type's strictness: a check it names is that level wherever it fires
        f["level"] = ((profile or {}).get("strict") or {}).get(f["check"], f["level"])
        f["slide_no"] = num.get(f["slide"])
    return F


def weight_share_rows(deck: dict) -> list:
    """Per scored criterion that states a weight: ``{criterion, weight, weight_share, words, words_share, ratio, heavy}``. The weight
    share is its weight over the total stated. The words are the presented words of the slides that answer it (assemble.criteria_coverage;
    a slide answering several criteria splits its words between them); the words share is over the presented words of slides that answer
    any criterion; ``ratio`` is words share over weight share; ``heavy`` is a weight share of spec.HEAVY_WEIGHT_SHARE or more. Empty when no
    criterion states a weight or no presented slide answers one."""
    cov = criteria_coverage(deck)
    nums = {}
    for c in cov:
        m = re.search(r"(\d+(?:\.\d+)?)", str(c["weight"] or ""))
        if m and float(m.group(1)) > 0:
            nums[c["criterion"]] = float(m.group(1))
    total_w = sum(nums.values())
    story = set(presented(deck))
    answering = {}
    for c in cov:
        for sid in c["slides"]:
            if sid in story:
                answering.setdefault(sid, []).append(c["criterion"])
    pool = sum(words(deck["slides"][sid]) for sid in answering)
    if not total_w or not pool:
        return []
    rows = []
    for c in cov:
        if c["criterion"] not in nums:
            continue
        got = sum(words(deck["slides"][sid]) / len(answering[sid]) for sid in c["slides"] if sid in answering)
        ws, sh = nums[c["criterion"]] / total_w, got / pool
        rows.append({"criterion": c["criterion"], "weight": c["weight"], "weight_share": round(ws, 4), "words": round(got, 1), "words_share": round(sh, 4),
                     "ratio": round(sh / ws, 4), "heavy": ws >= spec.HEAVY_WEIGHT_SHARE})
    return rows


def weight_share_report(deck: dict) -> dict:
    """The weight_share rows with the minimum: ``{rows, min_ratio, min_criterion}`` (the minimum is over every criterion that states a
    weight, heavy or not; None for both when there are no rows). Recorded in the run report."""
    rows = weight_share_rows(deck)
    low = min(rows, key=lambda r: r["ratio"]) if rows else None
    return {"rows": rows, "min_ratio": low["ratio"] if low else None, "min_criterion": low["criterion"] if low else None}


def _copy_spec(sl, add):
    """Hold an execution's copy to its channel frame's limits (spec.COPY_LIMITS)."""
    cp = next((b for b in sl["blocks"] if b["kind"] == "copy"), None)
    fr, L = spec.frame_for(sl["title"]), spec.COPY_LIMITS
    if not cp or not fr:
        return
    lines = [str(x) for x in cp.get("lines", [])]
    if fr == "search":
        for ln in lines:
            if ln.lower().startswith("query:"):
                continue
            head, _, rest = ln.partition(":")
            label = head.strip().lower() if rest else ""
            ad = rest.strip() if label in ("ad", "headline", "description") else ln
            if label == "headline" and len(ad) > L["search_headline_chars"]:
                add("warn", f"search headline is {len(ad)} characters: responsive search ads show up to {L['search_headline_chars']} (Google Ads): \"{ad[:40]}\"")
            elif len(ad) > L["search_chars"]:
                add("warn", f"search ad text is {len(ad)} characters: responsive search ads show headlines of up to 30 and "
                            f"descriptions of up to {L['search_chars']} (Google Ads), so split it")
    elif fr == "poster":
        for ln in lines:
            if len(ln.split()) > L["poster_words"]:
                add("warn", f"poster line has {len(ln.split())} words (rule of thumb: {L['poster_words']}, read whole at distance): \"{ln[:50]}\"")
    elif fr == "audio":
        secs = next((int(w) for w in str(cp.get("answer", "")).split() if w.isdigit()), None)
        n = sum(len(ln.split()) for ln in lines)
        if secs and n > secs * L["audio_words_per_sec"]:
            add("warn", f"{n} spoken words for a {secs}-second spot (rule of thumb: {int(secs * L['audio_words_per_sec'])})")


def _images(sl: dict, sid: str, deck: dict, audience: str, add) -> None:
    """The picture checks for one slide's image slots (contract section 4.3). ``image_unapproved``: on a client render any picture
    not approved by the deck's approver for its own asset (an error: it is not drawn); ``image_flagged``: a picture the guard flagged
    (a warning in a review, which draws it marked); ``image_rights``: a ``reference_only`` asset in a slot, and a territory run whose
    brief was never checked against this deck's; ``image_missing``: a slot that names an asset the deck does not hold."""
    assets = deck.get("assets") or {}
    for name, v in (sl.get("slots") or {}).items():
        if not (isinstance(v, dict) and v.get("kind") == "image" and isinstance(v.get("image"), dict)):
            continue
        im = v["image"]
        if im.get("status") == "empty" and (im.get("from") or {}).get("kind") == "production":   # deck-prod-assets: never held back silently
            add("image_rights", "warn", sid, f"{name}: {(im.get('reason') or spec.RIGHTS_TO_SUPPLY)[:200]}")
            continue
        if im.get("status") in ("empty", "planned", "failed", "rejected"):
            continue
        aid = im.get("asset")
        if aid not in assets:
            add("image_missing", "error", sid, f"{name} names the picture {aid} and the deck holds no such asset")
            continue
        if assets[aid].get("rights") == "reference_only":
            add("image_rights", "error", sid, f"{name} holds a reference-only picture: it may never fill a slot")
        g = assets[aid].get("guard") or {}
        if im.get("status") == "approved" and (g.get("flagged") or (not g.get("checked") and (im.get("from") or {}).get("kind") == "territory_frame")):
            add("image_flagged", "warn", sid, f"{name} was approved by a person although " + ("the guard flagged it" if g.get("flagged") else "no guard looked at it") +
                ": look at it again before a client sees it")
        elif im.get("status") == "flagged" or g.get("flagged"):
            add("image_flagged", "warn", sid, f"{name} was flagged by the guard ({(im.get('reason') or 'needs a person')[:80]}) and waits for a person")
        a = im.get("approval")
        approved = im.get("status") == "approved" and isinstance(a, dict) and a.get("decision") == "approve" and a.get("asset") == aid and a.get("by")
        if audience == "client" and not approved:
            add("image_unapproved", "error", sid, f"{name} is not approved by the deck's approver, so a client render does not draw it")
    tr = (deck.get("meta", {}).get("built_from") or {}).get("territory_run") or {}
    if tr.get("same_brief") == "unverified" and sl.get("type") == "territory" and sid == next((x for x in deck["order"] if deck["slides"][x]["type"] == "territory"), None):
        add("image_rights", "warn", sid, "the territory run was not checked against this deck's brief (give --brief to from_territory)")


def summary(F: list) -> dict:
    """Counts by check and level, and whether the gate passes (no errors)."""
    out = {"errors": sum(f["level"] == "error" for f in F), "warnings": sum(f["level"] == "warn" for f in F), "by_check": {}}
    for f in F:
        out["by_check"].setdefault(f["check"], {"error": 0, "warn": 0})[f["level"]] += 1
    out["pass"] = out["errors"] == 0
    return out
