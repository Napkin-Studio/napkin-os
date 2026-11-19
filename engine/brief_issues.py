#!/usr/bin/env python3
"""brief_issues.py: what is wrong with or missing from a client brief, flagged, never smoothed over.

A blind test on three weak real client briefs (19 Nov 2026) found every deck quietly working around the brief's problems: another
client's objectives presented as this client's, a campaign that runs past the year its money is for, a mascot that is both mandatory
and to be cut, no audience, no budget figure. This module turns those into one structured list, ``brief_issues``, that the brief tool
writes into brief_object.json and the deck shows as "What the brief doesn't tell us".

Each issue is ``{id, kind, topic, what, why_it_matters, question, quote, source}``:

* ``kind``: ``contradiction`` (two parts disagree: timing, budget, mandatories), ``foreign_content`` (a passage that looks pasted from
  another brand, product, market or brief) or ``missing`` (a basic the brief does not give: audience, budget figure, measurable
  objective, timing);
* ``quote``: the brief's own words for a contradiction or a foreign passage (verified against the text: an unverifiable one is dropped,
  so nothing is ever attributed to a brief that does not say it); empty for ``missing``;
* ``question``: a short question to put to the client, in plain words;
* ``source``: ``model`` (the shared prompt block ``PROMPT``, run inside a call the tool already makes: the brief tool's scorecard and the
  deck's intake) or ``rule`` (``rule_checks``, deterministic, no model).

Suspected foreign content is never adopted as the client's objective: ``quarantine`` lifts every captured value that repeats a foreign
passage out of the brief object and into the issue (``quarantined``), and ``matches`` is the one test the deck uses for the same.

Backfill an existing brief object (no model call unless ``--model``):

    python3 brief_issues.py --brief brief_object.json --text raw.txt [--out new.json] [--model]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

KINDS = ("foreign_content", "contradiction", "missing")
TOPICS = ("objective", "audience", "budget", "timing", "mandatories", "positioning", "brand", "other")
#: The basics a brief must give (kind ``missing``), most serious first.
BASICS = ("objective", "audience", "budget", "timing")
MAX_ISSUES = 8

#: The shared instruction, appended to the system prompt of a call that already reads the whole brief (the brief tool's scorecard,
#: the deck's intake), so both paths detect the same problems the same way with no extra call.
PROMPT = """
Also list the problems in the brief itself, as "brief_issues": [{"kind", "topic", "what", "why_it_matters", "question", "quote"}],
at most 8, the most serious first. Flag the mess; never smooth it over or resolve it yourself.
- kind "foreign_content": a passage that looks pasted from another brand, product, market or brief (objectives, names, anniversaries,
  products or markets that do not fit this client and this task). Never treat such a passage as the client's objective.
- kind "contradiction": two parts of the brief disagree (dates against the budget's dates, a mandatory against a "do not", the
  positioning against the brand's own name or line).
- kind "missing": a basic the brief does not give: who the audience is, a budget figure, a measurable objective (a number and a
  date), the timing.
topic: one of objective, audience, budget, timing, mandatories, positioning, brand, other. what: one sentence on what the brief says or
lacks. why_it_matters: one sentence on what goes wrong if nobody asks. question: one short, polite question to the client in plain
words, addressed to them ("you"). quote: for foreign_content and contradiction, the brief's own words, copied exactly (one short
passage); "" for missing. Use only the brief's words; return an empty list when the brief has none of these problems.
""".strip()

# ------------------------------------------------------------------------------------------------------------------- text helpers
_QUOTES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-", "\u00a0": " "})
_STOP = frozenset("a an and are as at be but by for from has have i in is it its of on or our so that the their them this to was we "
                  "were will with you your not no all any can do does should would could must also more most very into than then".split())


def norm(text) -> str:
    """Lower case, plain quotes and dashes, one space: the form two passages are compared in."""
    return re.sub(r"\s+", " ", str(text or "").translate(_QUOTES).lower()).strip()


def words(text) -> set:
    """Content words (no stop words, at least three letters)."""
    return {w for w in re.findall(r"[a-z0-9]+", norm(text)) if len(w) > 2 and w not in _STOP}


def sentences(text) -> list:
    """The text's sentences (and lines: a brief is often a form, one field a line)."""
    out = []
    for line in str(text or "").splitlines():
        out += [s.strip() for s in re.split(r"(?<=[.!?])\s+", line) if s.strip()]
    return out


def quote_in(quote, text) -> bool:
    """True when ``quote`` is in ``text`` (compared normalised; a quote cut with '...' matches part by part)."""
    hay = norm(text)
    parts = [p.strip(" .,;:") for p in re.split(r"\.\.\.|\u2026", norm(quote)) if p.strip(" .,;:")]
    return bool(parts) and all(p in hay for p in parts)


def matches(value, quote, share: float = 0.6) -> bool:
    """True when a captured ``value`` repeats a suspected foreign ``quote``: one holds the other, or most of the value's content words
    are the quote's (a value of three or more content words)."""
    v, q = norm(value), norm(quote)
    if not v or not q:
        return False
    if (len(v) >= 12 and v in q) or (len(q) >= 12 and q in v):
        return True
    vw, qw = words(v), words(q)
    return len(vw) >= 3 and len(vw & qw) / len(vw) >= share


# ------------------------------------------------------------------------------------------------------------------- rule checks
_AUDIENCE = re.compile(r"(?i)\b(?:audiences?|target (?:group|market|consumers?|customers?)|aimed at|aged \d|\d{2}\s*(?:-|to)\s*\d{2}\b|"
                       r"customers?|consumers?|shoppers?|households?|parents|mothers|fathers|families|employers|users|buyers|viewers|"
                       r"students|owners|drivers|commuters|residents|patients|members|subscribers|people who|those who|anyone who)\b")
_BUDGET_WORD = re.compile(r"(?i)\b(?:budget|funds?|funding|spend)\b")
_MONEY = re.compile(r"(?i)(?:[€$£]\s?\d|\b\d[\d.,]*\s?(?:k|m|bn|million|thousand|eur|euros?|usd|gbp|ron|lei|dollars?|pounds?)\b|"
                    r"\b(?:eur|usd|gbp|ron)\s?\d)")
_OBJECTIVE = re.compile(r"(?i)\b(?:objectives?|aims?|goals?|targets?|kpis?|wants?|increase|reduce|grow|cut|drive|achieve|boost|raise|"
                        r"lift|double|win|more|fewer)\b")
_FIGURE = re.compile(r"\d|(?i:\b(?:half|a third|a quarter|double|twice)\b)")
_MONTHS = re.compile(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|"
                     r"Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b")
_TIMING = re.compile(r"(?i)\b(?:(?:19|20)\d{2}|q[1-4]|\d+\s*(?:weeks?|months?|days?|years?)|deadline|launch(?:es|ing)? (?:in|on|date)|"
                     r"by (?:the )?end of|spring|summer|autumn|fall|winter|christmas|easter|black friday|back to school)\b")
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_RUN_WORD = re.compile(r"(?i)\b(?:campaign|launch|run|runs|live|weeks?|flight|on air|activity|starts?)\b")
_MUST = re.compile(r"(?i)\b(?:must|should|needs? to|has to|have to|required to|mandatory)\b[^.]{0,40}?\b(?:include|feature|show|use|have|"
                   r"carry|contain|appear|be (?:shown|used|included))\b")
_AVOID = re.compile(r"(?i)\b(?:reduce|avoid|limit|minimi[sz]e|less|fewer|without|do not use|don't use|not use|no more|drop|remove|"
                    r"cut down)\b")
#: Words two sentences may share without being about the same thing.
_GENERIC = frozenset("brand campaign communication communications message messages product products store stores client agency work "
                     "visual visuals idea ideas people consumer consumers market create need needs make used using include".split())

_QUESTIONS = {
    "objective": ("The brief gives no measurable objective: no number to move and no date to move it by.",
                  "Without a number and a date there is no way to judge the work or to size it.",
                  "What number should move, from what starting point, and by when?"),
    "audience": ("The brief does not say who the work is for.",
                 "A message aimed at everyone is aimed at no one; the media and the idea both depend on it.",
                 "Who exactly do you want to reach, and who is this not for?"),
    "budget": ("The brief gives no budget figure.",
               "Without a figure, the scale of the idea, the channels and the production cannot be planned.",
               "What budget should the work fit, even as a range?"),
    "timing": ("The brief gives no timing: no launch date and no deadline.",
               "The plan, the production schedule and the media booking all hang on the dates.",
               "When should the work go live, and when will you decide?"),
}


def _issue(kind, topic, what, why, question, quote="", source="rule") -> dict:
    return {"kind": kind, "topic": topic, "what": what, "why_it_matters": why, "question": question, "quote": quote, "source": source}


def rule_checks(text: str) -> list:
    """Deterministic issues (no model): the four basics missing, and two contradictions a rule can see: money for one year with a
    campaign that runs into a later one, and a thing the brief both requires and asks to cut. Conservative by design: a rule raises an
    issue only when the text plainly lacks the basic or plainly states both sides."""
    text = str(text or "")
    if not text.strip():
        return []
    sents = sentences(text)
    out = []
    if not any(_OBJECTIVE.search(s) and _FIGURE.search(s) for s in sents):
        out.append(_issue("missing", "objective", *_QUESTIONS["objective"]))
    if not _AUDIENCE.search(text):
        out.append(_issue("missing", "audience", *_QUESTIONS["audience"]))
    if not _MONEY.search(text):
        what, why, q = _QUESTIONS["budget"]
        if _BUDGET_WORD.search(text):
            what = "The brief mentions a budget but gives no figure."
        out.append(_issue("missing", "budget", what, why, q))
    if not (_TIMING.search(text) or _MONTHS.search(text)):
        out.append(_issue("missing", "timing", *_QUESTIONS["timing"]))
    # money for one year, a campaign that runs into a later one
    money_years = [(int(y), s) for s in sents if _BUDGET_WORD.search(s) for y in _YEAR.findall(s)]
    run_years = [(int(y), s) for s in sents if _RUN_WORD.search(s) and not _BUDGET_WORD.search(s) for y in _YEAR.findall(s)]
    if money_years and run_years:
        yb, sb = max(money_years)
        yc, sc = max(run_years)
        if yc > yb:
            out.append(_issue("contradiction", "timing",
                              f"The budget is for {yb}, but the campaign timing runs into {yc}.",
                              "Money that must be spent in one year cannot pay for activity in the next; the dates or the budget must move.",
                              f"Can the budget be spent in {yc}, or must the campaign finish in {yb}?", quote=sc))
    # a thing both required and to be cut (the mascot that is mandatory and also to be reduced)
    musts = [s for s in sents if _MUST.search(s)]
    avoids = [s for s in sents if _AVOID.search(s) and not _MUST.search(s)]
    seen = set()
    for m in musts:
        for a in avoids:
            shared = [w for w in (words(m) & words(a)) - _GENERIC - seen if len(w) > 3 and not w.isdigit()]
            if shared:
                w = max(shared, key=lambda x: norm(m).rfind(x))   # the head noun: the last shared word of the requirement ('the mascot')
                seen.add(w)
                out.append(_issue("contradiction", "mandatories",
                                  f"The brief asks for the {w} in the work, and also asks to cut it back.",
                                  "The agency would have to guess which instruction wins, and the client may reject either answer.",
                                  f"Should the {w} be in the work, and how prominently?", quote=a))
                break
    return out


# ------------------------------------------------------------------------------------------------------------------- the model's list
def from_model(raw, text: str) -> list:
    """The model's ``brief_issues`` list, cleaned: unknown kinds and topics folded, every field a string, and an issue that quotes the
    brief (foreign content, a contradiction) kept only when its quote is in ``text`` (an unverifiable accusation is never shown)."""
    out = []
    for x in raw if isinstance(raw, list) else []:
        if not isinstance(x, dict):
            continue
        kind = str(x.get("kind") or "").strip().lower().replace(" ", "_")
        if kind not in KINDS:
            continue
        topic = str(x.get("topic") or "other").strip().lower()
        topic = topic if topic in TOPICS else "other"
        f = {k: str(x.get(k) or "").strip() for k in ("what", "why_it_matters", "question", "quote")}
        if not f["question"] or not f["what"]:
            continue
        if kind != "missing":
            if not f["quote"] or not quote_in(f["quote"], text):
                continue
        else:
            f["quote"] = ""
        out.append(_issue(kind, topic, f["what"], f["why_it_matters"], f["question"], f["quote"], source="model"))
    return out


def merge(model: list, rules: list) -> list:
    """One list: the model's issues, then each rule issue the model did not raise (same kind and topic), foreign content first, then
    contradictions, then the missing basics in BASICS order; ids bi_01.. in that order; at most MAX_ISSUES."""
    have = {(i["kind"], i["topic"]) for i in model}
    allq = [i for i in model] + [i for i in rules if (i["kind"], i["topic"]) not in have]
    seen, uniq = set(), []
    for i in allq:
        key = norm(i["question"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(i)
    rank = lambda i: (KINDS.index(i["kind"]), BASICS.index(i["topic"]) if i["kind"] == "missing" and i["topic"] in BASICS else len(BASICS))
    uniq.sort(key=rank)   # stable: the model's order holds within a rank
    return [{"id": f"bi_{n:02d}", **i} for n, i in enumerate(uniq[:MAX_ISSUES], 1)]


def detect(text: str, model_issues=None) -> list:
    """``brief_issues`` for a brief's ``text``: the model's list (``model_issues``, the raw ``brief_issues`` a call returned; None when
    no model ran) verified against the text, merged with the rule checks."""
    return merge(from_model(model_issues, text), rule_checks(text))


# ------------------------------------------------------------------------------------------------------------------- quarantine
#: The parts of a brief object a foreign passage is lifted out of (never the ledger, which records the client's text as received).
QUARANTINE_ROOTS = (("loop2_golden", "fields"), ("loop1_capture", "fields"), ("loop2_brief",))


def _lift(node, quote, path, found):
    """Walk ``node``; a string that repeats ``quote`` is removed (a list item) or set to None (a dict value), recorded in ``found``."""
    if isinstance(node, dict):
        for k in list(node):
            v = node[k]
            if k in ("source_quote", "evidence", "source_refs", "review", "provenance", "open_questions"):
                continue
            if isinstance(v, str) and matches(v, quote):
                found.append({"path": f"{path}.{k}", "value": v})
                node[k] = None
                if k == "value":
                    node["quarantined"] = True
            else:
                _lift(v, quote, f"{path}.{k}", found)
    elif isinstance(node, list):
        keep = []
        for n, v in enumerate(node):
            if isinstance(v, str) and matches(v, quote):
                found.append({"path": f"{path}[{n}]", "value": v})
            else:
                _lift(v, quote, f"{path}[{n}]", found)
                keep.append(v)
        node[:] = keep


def quarantine(obj: dict, issues: list) -> int:
    """Lift every captured value that repeats a foreign passage out of the brief object ``obj`` (in place) and into its issue's
    ``quarantined`` list ``[{path, value}]``. Returns how many values were lifted."""
    n = 0
    for i in issues:
        if i.get("kind") != "foreign_content" or not i.get("quote"):
            continue
        found: list = []
        for root in QUARANTINE_ROOTS:
            node = obj
            for k in root:
                node = node.get(k) if isinstance(node, dict) else None
            if node is not None:
                _lift(node, i["quote"], ".".join(root), found)
        if found:
            i["quarantined"] = found
            n += len(found)
    return n


def foreign_quotes(issues) -> list:
    """The quotes of the foreign-content issues: what no objective, field or slide may carry as the client's own."""
    return [i["quote"] for i in issues or [] if isinstance(i, dict) and i.get("kind") == "foreign_content" and i.get("quote")]


# ------------------------------------------------------------------------------------------------------------------- backfill CLI
def _model_call(text: str):
    """One model call on the brief (the scorecard's mechanical route) returning the raw ``brief_issues`` list, or None."""
    import brief_llm as L
    system = "You check a client brief for problems an agency must raise with the client.\n" + PROMPT + \
             '\nReturn ONLY raw JSON: {"brief_issues": [...]}.'
    obj = L._json_call(f"<brief>\n{text}\n</brief>", system=system, max_tokens=4000, route="mechanical")
    return (obj or {}).get("brief_issues") if isinstance(obj, dict) else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Add brief_issues to an existing brief_object.json.")
    ap.add_argument("--brief", required=True, type=Path)
    ap.add_argument("--text", required=True, type=Path, help="the brief's raw text")
    ap.add_argument("--out", type=Path, help="where to write (default: in place)")
    ap.add_argument("--model", action="store_true", help="also ask the model (one call on the mechanical route)")
    a = ap.parse_args(argv)
    obj = json.loads(a.brief.read_text())
    text = a.text.read_text()
    issues = detect(text, _model_call(text) if a.model else None)
    n = quarantine(obj, issues)
    obj["brief_issues"] = issues
    (a.out or a.brief).write_text(json.dumps(obj, indent=2, ensure_ascii=False))
    print(f"{len(issues)} brief issues ({', '.join(sorted({i['kind'] for i in issues})) or 'none'}); {n} value(s) quarantined", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
