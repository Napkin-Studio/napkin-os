# Winning-pitch rubric (merged)

Date: 2026-10-16. Loadable form: rubric.json. Evidence: GUIDE.md and SOURCES.md.

The weights are our own default split. No published standard gives one (IPA/ISBA and TrinityP3 give none). Where the buyer's ITT states weights, use those and set `weights_source: brief`. Otherwise label the split `default_assumption`.

## Criteria

| id | Criterion | Weight | Check |
|---|---|---|---|
| compliance_gate | Requirement, criteria and format compliance (gate) | 12 | both |
| problem_objective | Client problem and measurable objective | 12 | both |
| insight | Insight: a human truth with tension | 14 | judge |
| idea_chain | One idea, plan justified against alternatives, unbroken chain | 14 | both |
| evidence_trace | Number and claim traceability | 14 | code |
| headline_fit_limits | Headlines proven by their slide; claims shown with limits | 8 | both |
| team_proof | Team, delivery and honest proof | 10 | both |
| commercials_ask | Investment, options and the ask | 6 | both |
| presentability | Order, skim test, craft and a memorable close | 10 | both |
| Total | | 100 | |

Shape of the split: diagnosis and logic (problem, insight, idea) 40, integrity (compliance, evidence, fit) 34, delivery and close (team, commercials, craft) 26. This follows the shape of Cannes Creative Strategy (60% on challenge and insight) and Effie (about 70% on context, insight and idea), with the weight we cannot take from a pitch standard moved into integrity, which Napkin can check in code.

## Anchors (1 / 3 / 5)

**compliance_gate (12)**
- 1: any requirement unmapped, rule broken, required content past a limit, or a banned category claim. The gate fails.
- 3: all mapped and no rule broken, but order ignores weights, some out-of-scope content, or no category note.
- 5: 100% of requirements and criteria mapped in the buyer's order, space proportional to weight, response map shown, limits met, nothing unrequested, category rules checked with the rule named.

**problem_objective (12)**
- 1: no objective or only "awareness"; opens on credentials or product; brief restated.
- 3: situation and goal stated, no baseline or target.
- 5: client-specific cited context, objective with baseline, target and date, a challenge the brief did not name, assumptions stated, nothing retrofitted.

**insight (14)**
- 1: restated fact or category convention.
- 3: real behavioural observation, method or uniqueness missing.
- 5: human truth with tension, specific to the client, method and source stated, raises a new challenge, paraphrasable in one sentence.

**idea_chain (14)**
- 1: no idea, or three or more, or a channel list.
- 3: one idea, link to insight implied, plan lacks reasons against alternatives.
- 5: one idea in one sentence, explicit insight-strategy-idea link, shown in a client-context mockup, channels justified against alternatives, phasing shown.

**evidence_trace (14)**
- 1: any invented number, any rejected or bad-pin citation, or over 25% of numbers without a ref.
- 3: none invented, 10-25% of numbers without a ref, or unverified findings unflagged.
- 5: zero invented, zero rejected, at least 95% of numbers with a resolving ref, unverified findings flagged.

**headline_fit_limits (8)**
- 1: under 40% of headlines supported, any "not supported" left in, or outcomes shown as certain with no risks.
- 3: 40-79% supported; generic risks slide; targets without baselines.
- 5: at least 80% supported with quoted evidence in both orderings; specific confounders; each target has a baseline and measurement.

**team_proof (10)**
- 1: no named delivery team, or an invented CV or case study, or unlabelled placeholders or agency-only text in the client render.
- 3: human-only slides labelled or filled; named team with roles but no results; generic process.
- 5: named day-to-day team with roles and results, process, governance, continuity; no placeholders in the final render.

**commercials_ask (6)**
- 1: no investment, or no ask, or a required social-value or cost criterion unanswered.
- 3: price or ask present, not tied to budget, or options without a recommendation or differing only by price.
- 5: sized to the stated budget, two or three scope-differentiated options with one recommended, outcome-framed value, specific ask and next step.

**presentability (10)**
- 1: word_budget error, most titles labels, presented count well over the slot, or no ask in the close.
- 3: order broadly right, most titles claims, a few warnings, differentiator not repeated at the close.
- 5: headlines alone carry the argument, no list over 4 items, fits the slot with appendix, differentiator in slides 1-3 repeated in the last 3 with the ask.

## How to score

1. Gate first. Run the code checks for compliance_gate. If it fails, say so before any quality score. Public buyers do the same (GAO B-418318; Wiltshire "Any fails will lead to rejection").
2. Run all code checks. They give evidence_trace, most of compliance_gate and the mechanical half of presentability.
3. Blind: strip the producing tool, run name and build mode (prompt-only, documents, full pipeline) from what judges see.
4. Two or more judges, ideally three or more from different model families (Verga et al. panel result; self-preference per Panickssery et al.). Never use only the generating model.
5. Anchors first: the judge reads the 1/3/5 descriptors, then for each judged criterion quotes the slide number and a short passage, then gives 1, 3 or 5 and a one-line rationale (Wang et al.; TrinityP3).
6. Both orderings for any A/B comparison; a flip counts as a tie.
7. Length-neutral: report words and slide count beside every score; regress judged scores on length and report the adjusted figure (Dubois et al.).
8. Each judge scores alone, then compare; disagreement of 2 or more points on a criterion goes to a person (DBA: individual scoring then consensus).
9. Report: the weighted total, the weakest criterion, every criterion scored 1 listed separately, `weights_source`. Do not hide a 1 inside an average (Brent excludes on a 0 or two low scores).
10. Anchor the scale with a gold set of human-scored decks and check rank correlation each run. None exists yet; building one is a task.

## Known judge biases to guard against

| Bias | Evidence | Guard |
|---|---|---|
| Position | GPT-4 consistent under swapped order 65.0% (Zheng et al., https://arxiv.org/html/2306.05685v4) | both orders, flips as ties |
| Verbosity | weaker judges fooled by padded lists 91.3% (same; figure read via summary, medium confidence) | length-control, word budgets, length-neutral companion check |
| Self-preference | models recognise and favour their own output (https://arxiv.org/abs/2404.13076) | cross-family panel |
| Unevidenced scores | judge writes evidence before rating reduces order effects (https://arxiv.org/abs/2305.17926) | quote first |
| Holistic scoring | binary checklists track humans better than coarse judgements (https://arxiv.org/abs/2603.07244) | many countable checks, code where possible |
| Unchecked numbers | reference-guided judging cut error from 70% to 15% (Zheng et al.) | check numbers in code against inputs |
| Human: presenter and theatre | WFA/EACA: easy to be impressed by presenters and theatre | score the text deck, not the performance |
| Human: order and recall | later presenters favoured in juries (https://pubmed.ncbi.nlm.nih.gov/15698823/, music and sport) | repeat the differentiator; note slot order when scoring real pitches |
| Fluency over proof | a polished deck with unsupported claims | evidence_trace and headline_fit are scored apart from craft |

Limits we state openly: no judge in these studies was validated against real pitch outcomes; the 18-slide and 2-minute defaults, per-type word budgets and investor slide order in the engine have no external source; weights are ours.
