# ADR 0035 — Laurence's tests run on every first draft, and an assumption says it is one

Status: accepted (Sai, 2026-10-29: "get the rest done") · Extends ADR 0034 · Source: Laurence's
`strategic-planning` skill and his Expert Sign-off answers of 3 Oct 2026 · Code:
`server/napkin/brief/checks.py`, `planned.py` (`_review`, `_clean`, `REVIEW_SYSTEM`),
`golden_brief.schema.json` · Tests: `server/tests/test_first_draft_checks.py` · Feature:
`brief-first-draft-checks`.

## Context

Nine live runs on 29 Oct (the real tool, Sonnet 5.5 on Bedrock) showed that ADR 0034's tests never
reached a first draft. They live in `judge_field`, called only by the field-by-field flow and
"Write again"; the default flow writes the whole brief in one call and Jude reviews it against
BetterBriefs only. First drafts carried a proposition with an "and" joining two thoughts, objections
with two or three doubts, a restated brand tagline, parts at twice their word limit (an audience of 152
words against 80), and "To confirm" on some assumptions and not on others (the insight marked, the
proposition built on it not: Laurence's own review item).

## Decision

**Jude judges the five parts against the skill's tests, with code beside him.** The whole-brief review
carries, for the insight, proposition, job, barrier and objection, the schema's judged tests, and
`part_checks`: what code measured (words against the limit, sentences, a standalone "and" in the
proposition). A failing part goes in `revise`, as it already can. The "and" stays a flag, not a ban (ADR
0034): Jude decides whether it joins two thoughts.

**Code sends back only what it can measure,** once, in the review's own rewrite: a part more than 15
percent over its word limit, or a job, proposition or objection of more than one sentence. A word or a
phrase is fine.

**An assumption says it is one.** Dara's own proposals are prefixed "To confirm:" in code, on her raw
output before provenance reads the sentences (so a claim and its sentence stay the same text), and the
proposition and objection take the mark when the insight they rest on is an assumption. Lists, the
client's words and research are untouched.

**Laurence's 3 Oct definitions** are in the schema prompts: background, audience, insight (a surprising,
evidence-based discovery), reasons to believe (validated facts, nothing invented), desired response; the
proposition may be a word, a phrase or one sentence; the objection is ONE doubt and the job names ONE
change. Competitor context takes the messaging-gap wording of the competitive-brief skill, and budget and
scope the media-planner's: say whether VAT is included and whether media sits inside it, never invent a
figure.

**Objectives:** his wording prioritises one primary objective and does not require three levels. Adopted
in the prompt only; the app keeps three fields (the grid and the nothing-empty rule rely on them). The
structure is a decision for Laurence and Sai.

## Consequences

- One rewrite more in some briefs; no extra model call otherwise.
- Existing assertions that compared a rewritten assumption without the mark were updated (two, in
  `test_planned_brief.py`); no test was removed.
- A proposition that restates the brand's own line is told to Jude as a fail, but Jude cannot know the
  line without research.
