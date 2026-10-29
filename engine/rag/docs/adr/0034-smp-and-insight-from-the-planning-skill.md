# ADR 0034 — The insight and proposition checks come from the planning skill

Status: accepted (Sai, 2026-10-28: "use the Laurence skill doc as primary") · Supersedes one
sentence of ADR 0007 · Source: Laurence's `strategic-planning` skill and its
`insight-and-proposition` reference (`Napkin planning and design skills (for Sai and Shrey) 25 Oct 2026`,
lines 183-250) · Code: `server/napkin/brief/golden_brief.schema.json` (fields `insight`, `smp`),
`server/napkin/brief/rubric.py` (`and_flag`), `server/napkin/brief/judge.py`,
`server/napkin/brief/drafters.py` · Tests: `server/tests/test_hard_check.py` · Feature: `brief-hard-check`.

## Context

Laurence's test of Brief Maker (Ballymaloe Relish, 6.5/10) asked for a hard check that the
insight is a human tension and the proposition is one thought with no "and". The agency's
standard for both is now his planning skill, not the literature review behind ADR 0007. The two
agree on most things and disagree on one: ADR 0007 says "an and or comma is not a fail"; the skill
says a proposition is "one thought, not a thought with an 'and'".

## Decision

**The skill's tests are the judge's tests, in its words.**
- Insight (4 tests, beside the existing tension and why checks): true and the audience would nod
  (`rings_true`); about the audience, not the brand (`about_audience`); fresh, not a category
  cliche (`fresh`); gives the product a role (`has_implication`, reworded).
- Proposition (5 tests): single minded (`single_minded`, hard); true, backed by a reason to
  believe (`true_backed`, new); motivating (`reason_to_care`); ownable (`ownable`); generative
  (`room_for_many_ads`).

**The "and" is a flag, not a ban.** The skill states a test of the thought, and ADR 0007 found
that a word rule fails sourced propositions ("A range of thick flavours" passes, Levi's fails). So
code flags a standalone "and" or "&" (`and_flag`) and hands the judge the question: does it join
two thoughts (fail) or sit inside one thought (pass)? A fail is hard, goes back to Dara with the
judge's fix, and is capped by the existing rewrite limit. Two clauses joined by a colon,
semicolon or dash count as two thoughts to the judge, which closes the gap the word rule leaves.
Commas do not flag.

**Wording.** The insight and proposition definitions in the schema and the ranking prompt use the
skill's words ("a truth about the audience, usually a tension"; "one thought, not a thought with
an 'and'").

**Superseded.** The sentence in ADR 0007's check table, "an 'and' or comma is not a fail", for the
server's Brief Maker. The rest of 0007 stands.

## Scope

Only the server's schema copy changes (`server/napkin/brief/golden_brief.schema.json`, which the
Brief Maker reads). The engine's source of truth (`engine/golden-brief/golden_brief.schema.js`, its
generated `.json` and the engine tests that read it) is left as it is, so the engine suite is
unchanged. The two copies now differ on purpose; reconciling them is a separate decision.

## Consequences

- Three more judge tests on the insight and one more on the proposition ride in the judge's one
  existing call; no extra model call per field.
- The offline tests prove the wiring (flag, payload, fail goes back, wording). They do not measure
  the judge's accuracy; that needs a model key and a labelled set (Laurence's Samaritans and
  Ballymaloe lines, the Reason Enough colon proposition, the schema's good and bad examples).
- Stored verdicts keep their ids; a brief without a verdict for a new check shows it as not yet
  checked.
- The number 0034 avoids a clash with the award-library ADR 0033 on the spike branch.
