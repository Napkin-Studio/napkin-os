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
proposition). A failing part goes in `revise`, as it already can. The "and" is flagged to Jude, who
decides whether it joins two thoughts, and code also sends it back (ADR 0034, amended 2026-11-10).

**Code sends back only what it can measure,** once, in the review's own rewrite: a part more than 15
percent over its word limit, or a job, proposition or objection of more than one sentence. A word or a
phrase is fine. A list over its item cap and a standalone "and" in the proposition go back too
(ADR 0034, amended 2026-11-10).

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

## Addendum 2026-11-10 (brief-jev-checks): the checks run on both judge paths

The checks above were built into the whole-brief review only. Staging runs `NAPKIN_BRIEF_JUDGE=jev`,
where `PlannedBriefJob.stage_judge` returned through jev's check loop before the review, so Laurence's
tests and code's send-backs never ran there. They now run whichever judge reads the brief:

- **One source for the rules.** `checks.py` holds the measures (`facts`, `revisions`, `tests`) and the
  wording of how Jude uses them (`TESTS_GUIDE`, `ANTI_PATTERNS`, `tests_guide`). The review prompt and
  the loop's Jude prompt are both built from it. `REVIEW_SYSTEM` is byte-identical to before.
- **Jev path.** The loop's Jude call (`explain_flags`) carries `tests` and `part_checks` for the tested
  parts the job wrote, whether or not jev flagged anything, and answers under an optional `tests` key
  (an answer without it is valid; an unanswered part is logged as `tests_unanswered`). A part he fails
  goes to Dara on his instruction; what code measures goes in the same rewrite, and for a part Jude
  already named code's instruction is left out, as on the review path. What code still measures after
  that rewrite goes back once more, from the rewritten text (`checks_sent_back_again`). jev reads
  before and after the first rewrite only.
- **Cost.** With jev answering: one Jude call and no Dara call when nothing fails, at most one Jude and
  two Dara calls otherwise, and no whole-brief review. When jev does not answer, or the loop raises
  (`check_loop_failed`), the brief gets the whole review path; the first draft is never lost to a judge
  stage error.
- **What code measures** (as `checks.revisions` does): words over the limit by more than 15 percent,
  items over the item cap, more than one sentence in the proposition, job or objection, and a standalone
  "and" (ADR 0034, amended 2026-11-10).
- **The record.** A part only a check sent back is recorded as sent back by a check, with code's reason,
  not as Jude's note, and the jev path writes no "Jude reviewed the brief again" verdict.
- **Not changed.** The engine-checked job (`EngineCheckedBriefJob`, only with `NAPKIN_BRIEF_ENGINE_URL`;
  staging does not set it) passes no `whole` and behaves as before. The review path's own recording of a
  code-only send-back as "Jude sent it back" is left alone.
