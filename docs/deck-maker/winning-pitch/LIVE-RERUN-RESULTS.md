# Deck Maker live re-run: results (old engine vs the twelve fixes)

Date: 2026-10-18. All inputs are invented. Nothing here comes from sample_research/, client_briefs/ or real outputs.

## Headline

- Two of the five comparisons are valid and clearly favour the new engine or are neutral. Two are void because of harness faults. One is a tie.
- On the four decks that could be scored, the mean weighted total moved from 59.3 to 61.3 (+2.0). That is inside the noise band of about 3 points.
- The biggest gain is agency C (+5.8, new won head-to-head 2-0). Agency A is flat (+1.9, split 1-1). Investor B (+0.6) and investor C (-0.4) are flat.
- Agency B could not be scored: the judge was handed a corrupted copy of the new deck (516 bytes of grep output). Its -38.1 is an artefact, not a regression.
- Investor B head-to-head is void: both judges were given the same path (`undefined.md`).
- Every new deck still fails validation (pass=false). Judge verdict on the insight stage was "fail, needs a person" on all three decks where it ran.

## 1. What was run

- Five live decks, run end to end through the real engine with live model calls: agency A, agency B, agency C, investor B, investor C. The inputs are the same invented ones as the first test (`engine/outputs/winning_pitch_test`; summary in `TEST-RESULTS.md`).
- Arms: old engine (the first test's outputs) against the engine with the twelve fixes. One run per deck per arm.
- The gate deck ran first, then the rest. No runs failed: all five exited 0 and wrote deck.json, deck.pptx, deck.pdf and deck.html (agency A confirmed; agency C notes exit 0 with three internal "unclean JSON, retrying once" retries that recovered).
- Judging: Sonnet judges, blind, old and new decks scored together in one pool under random labels (K-xx), nine criteria, weighted total out of 100. Head-to-head used both orders (X/Y swapped), so each pair has two verdicts.
- Labels: agency A new K-52 / old K-07; agency B new K-31 / old K-64; agency C new K-18 / old K-45; investor B new K-73 / old K-26; investor C new K-09 / old K-58.
- Cost: the CLI transport records no dollars. Every figure below is an ESTIMATE from tokens times list price, not a bill.
  - Estimated total 6.59 USD against caps of 3 USD for the gate deck and 12 USD overall. Within the overall cap.
  - Agency C alone cost 2.94 USD, above the expected 0.9 to 1.8 and above the plan's 1.75 budget (stage d alone was 1.72).
  - Total wall time 2,198 s (about 36.6 minutes).
- Check the owner's weekly usage: the run used live Opus and Sonnet calls and the estimate says nothing about quota consumed.

## 2. Results per deck

### Weighted total (/100)

| Deck | Old | New | Change | Head-to-head (new : old : tie) | Status |
|---|---|---|---|---|---|
| Agency A | 48.9 | 50.8 | +1.9 | 1 : 1 : 0 | valid |
| Agency B | 58.1 | 20.0 | -38.1 | 0 : 2 : 0 | VOID, new file corrupted |
| Agency C | 57.5 | 63.3 | +5.8 | 2 : 0 : 0 | valid |
| Investor B | 62.1 | 62.7 | +0.6 | 0 : 0 : 2 | total valid, head-to-head VOID |
| Investor C | 68.7 | 68.3 | -0.4 | 2 : 0 : 0 | valid |
| Mean of the four valid | 59.3 | 61.3 | +2.0 | | |

### Targeted criteria, old to new (mean of three judges, scale 1 to 5)

| Criterion | Agency A | Agency C | Investor B | Investor C | Mean change (4 valid) |
|---|---|---|---|---|---|
| problem_objective | 2.00 to 2.00 (0) | 3.00 to 4.00 (+1.00) | 3.00 to 2.67 (-0.33) | 3.33 to 4.00 (+0.67) | +0.33 |
| insight | 2.00 to 2.00 (0) | 3.00 to 4.00 (+1.00) | 2.00 to 2.00 (0) | 3.00 to 3.00 (0) | +0.25 |
| idea_chain | 3.00 to 3.00 (0) | 3.33 to 3.33 (0) | 3.00 to 3.00 (0) | 3.33 to 3.00 (-0.33) | -0.08 |
| headline_fit_limits | 3.00 to 3.00 (0) | 3.00 to 3.67 (+0.67) | 4.00 to 4.00 (0) | 4.00 to 4.00 (0) | +0.17 |
| team_proof | 1.67 to 2.00 (+0.33) | 2.00 to 2.00 (0) | 2.67 to 3.00 (+0.33) | 2.67 to 3.00 (+0.33) | +0.25 |
| commercials_ask | 2.00 to 1.67 (-0.33) | 2.00 to 2.67 (+0.67) | 4.00 to 4.00 (0) | 4.00 to 4.33 (+0.33) | +0.17 |
| compliance_gate | 1.67 to 1.67 (0) | 2.00 to 2.00 (0) | 3.00 to 3.00 (0) | 3.00 to 2.67 (-0.33) | -0.08 |

Other criteria (old to new): evidence_trace A 3.67 to 4.00, C 4.00 to 3.33, investor B 4.00 to 4.00, investor C 4.00 to 4.00. Presentability A 2.67 to 3.00, C 2.67 to 3.00, investor B 3.00 to 3.33, investor C 4.00 to 3.33.

Agency B (not comparable): old arm 2.00 compliance, 2.67 problem_objective, 3.00 insight, 4.00 idea_chain, 4.00 evidence_trace, 2.33 headline_fit_limits, 2.00 team_proof, 2.00 commercials_ask, 3.00 presentability. The new arm scored 1.00 on everything because the judge file was not a deck. These are not scores of the real new deck.

### Run facts for the new arm

| Deck | Slides (file) | Presented | Validator errors | Warnings | Est. USD | Time (s) |
|---|---|---|---|---|---|---|
| Agency A | 31 | 10 (sketch limit 10) | 1 | 19 | 0.83 | 307.9 |
| Agency B | 38 | 31 | 2 | 79 | 1.48 | 512.7 |
| Agency C | 39 | 20 (limit 20; 7 appendix) | 35 | 47 | 2.94 | 929.3 |
| Investor B | 19 | 14 | 13 | 14 | 0.74 | 255.8 |
| Investor C | 19 | 14 | 4 | 21 | 0.60 | 192.3 |

Notes:
- Old-arm error and warning counts are not in the data, so no validator change can be computed.
- All five new decks have validation pass=false.
- Agency C's 35 errors are 32 `unknown_ref`, 2 `message_carried` and 1 `claim_fit`. The `unknown_ref` count is dominated by one cause: the third document key was inferred as `data`, so references to it did not resolve (run note). Its qa.json shows 0 errors, 19 warnings.
- Agency A's one error is `claim_fit` on s13. Agency B's two errors are `numbers_trace` on s27 and `claim_fit` on s08.
- Investor B errors: `numbers_trace` 7, `requirement_map` 5, `word_budget` 1. Investor C errors: `requirement_map` 3 (ask, EU data, max 14 slides each answered by no slide) and `word_budget` 1 (ask slide, 88 words against 70). Investor C qa.json: 1 error, a title overflow on slide 2.

### Which new checks and stages fired

| Deck | New checks that fired (all warn level) | Not fired |
|---|---|---|
| Agency A | objective_quant 1, insight_shape 2, chain_links 1 | idea_single, thin_evidence, weight_share |
| Agency B | insight_shape 1, chain_links 2, weight_share 1 (idea and creative 30% of weight, 0% of presented words) | objective_quant, idea_single, thin_evidence |
| Agency C | insight_shape 2, chain_links 3, weight_share 1 (same 30% / 0%) | objective_quant, idea_single, thin_evidence |
| Investor B | none | all six |
| Investor C | none | all six |

| Stage | A | B | C | Inv B | Inv C |
|---|---|---|---|---|---|
| Insight judge ran | yes, fail, needs human | yes, fail, needs human | yes, fail, needs human | no verdict recorded | no verdict recorded |
| Insight retry (Opus) | yes | yes | yes (0.31 USD) | not recorded | not recorded |
| Headline narrowing (applied : rejected) | 1 : 2 | 1 : 7 | 2 : 3 | 1 : 4 | 1 : 5 |
| Red team objections : revisions applied | 6 : 0 | 6 : 0 | 6 : 0 | 6 : 0 | 5 : 0 |
| Supply questions asked : supplied | 5 : 0 | 3 : 0 | 3 : 0 | 0 | 0 |
| Confirm items open (needs person) | 14 (5) | 16 (4) | 16 (4) | 5 (1) | 2 (1) |
| Objective slide | not confirmed (objective_quant warned) | not recorded | per judge, on slide 2 | yes | yes (s02) |
| Sketch tier | yes, prompt tier | not recorded | not recorded | not recorded | not recorded |

## 3. Did each fix show its measure?

Measures come from the plan. "Not measurable" means the data supplied does not contain the needed number.

| Measure | Verdict | Evidence |
|---|---|---|
| Fernley B investment slide shows EUR 450,000 and EUR 55,000 | Not measurable from this data | The real new agency B deck was never judged (corrupted file). The data holds no text of its investment slide. The old arm's judges said budget and fee were blank. |
| claim_fit warnings on Fernley C fall from 7 to at most 3 | Not measurable from this data | The data gives agency C's claim_fit as 1 error but no claim_fit warning count. Total warnings are 47. |
| problem_objective up at least 1 point | Met on one deck only | Agency C +1.00. Others: investor C +0.67, agency A 0, investor B -0.33. Mean +0.33. |
| commercials_ask up at least 1 point | Not met | Best was agency C +0.67. Agency A -0.33, investor B 0, investor C +0.33. Mean +0.17. |
| Insight up to 4.0 on Fernley C | Met | Agency C insight 3.00 to 4.00 (assuming "Fernley C" is agency C). |
| Insight up to 3.5 on Dockhand C | Not met | If Dockhand C is investor C (the data does not name the clients): 3.00 to 3.00. |
| No deck over its stated limit | Partly measurable | Presented counts meet the stated limits where the limit is known: agency A 10 of 10, agency C 20 of 20, both investor decks 14 of 14. Whole files are longer (31, 38, 39, 19, 19 slides) because of appendices, and one judge still read agency C as "39 slides against a 20-slide limit". Agency B's limit is not in the data (31 presented). |

Other fix evidence, from the data:
- Objective slide: present in both investor decks, and the judges rewarded it in the investor C head-to-head (both orders). Agency A still lacks a numeric objective in its first three slides (objective_quant fired), and its judges say the same.
- Insight step: the stage ran, but its own judge failed the chosen insight on all three decks where it ran, so a person is still needed. The retry did not clear the bar. Insight scores rose only on agency C.
- Red team: ran on all five and applied 0 revisions every time. All findings were left for the person.
- Headline narrowing: ran, but most proposals were rejected (rejected 2, 7, 3, 4, 5). Rejection reasons were added numbers or a longer headline.
- Supply cards: agency decks asked 5, 3 and 3 questions, and supplied 0 answers on A. The investor decks asked 0 (investor B asked 5 of 5 intake questions, cap full). The data shows no effect on team_proof beyond +0.33 on three decks.
- Cost estimate: present in report.json ("estimate, not billed").
- Per-type slides: not measurable from this data.

## 4. What the judges said

Agency A (split 1-1):
- Pro-new: a real tension-based insight (tea as a home drink, not a summer one) runs through to the idea "Tea's day out"; a risks slide; a measurement slide with baselines and labelled placeholders. Its presented spine carries objective, insight, one idea, three channel executions, a one-job-per-channel table, timeline, team placeholders and an ask.
- Pro-old: the old deck is stronger on risks and honest hypothesis flagging, but only 10 slides in its spine and it pushes executions, channel plan and timeline to the appendix. One note: the old deck "overclaims that the plan cannot fail on the weather".
- Both arms: would lose because they contain none of the client's numbers (11% to 25% awareness, 150k trials, 612 to 900 stores, EUR 450k budget), no Irish-language work and no claims rule. New decks are mostly placeholders and "to agree" items.

Agency B: no usable judgement of the new deck. One judge declined to score K-31 and said the file needed regenerating. Judges of the old deck liked "Gan seanmoir" and its Irish-language executions and chain, but wanted the EUR 450,000 budget, the EUR 55,000 fee, risks and a named team filled in. One head-to-head note said the old deck's objective was buried at slide 14.

Agency C (new won 2-0):
- New: quantified objective on slide 2 (11% to 25% awareness, 150,000 first-time buyers), a real insight with tension, the idea "One to keep. One to pass on", a presented risks slide, a KPI table with baselines, lag and confounders, fee and budget stated.
- Old: the more distinctive "Fernley o'clock" idea and stronger in-spine creative, but no presented risks slide, no objective slide up front, blank budget split.
- Complaints about the new deck: empty team and proof slide, no channel budget split, no priced options, 0% of words answering five of the six client scoring criteria, Irish-language work and criteria map in the appendix, 39 slides against a 20-slide limit.

Investor B: no head-to-head signal (same path given for both decks; judges said it needed rerunning). Per-deck notes for the new deck: wins on traced traction, honest concentration disclosure and a precise ask; loses on no real insight or opening objective (the problem is one Cork wholesaler's 2.4%), a thin team slide, and an appendix requirement map that wrongly shows NOT MAPPED. The old deck drew nearly the same comments.

Investor C (new won 2-0):
- New: objective on slide 2 (EUR 2.5M takes it to EUR 2M ARR and 120 distributors by June 2028, with a SOC 2 date and ERP integrations), 14% Greenmarket concentration disclosed on slide 6 instead of slide 13, EU and GDPR stated on the solution slide.
- Against new: a hollow "Why now" slide ("founders must confirm"), the same response-map gaps (ask, GDPR and the 14-slide limit shown as NOT MAPPED), thin team beyond two founders.
- Old: no objective slide, risk and concentration disclosure later, but a better-looking deck (presentability 4.00 against 3.33).

## 5. Honest conclusions

Method limits first. These matter more than any single result:
- One run per deck per arm, five decks, and one of them (agency B) lost to a harness fault, so four usable comparisons.
- Sonnet judges only, three per deck, no human.
- Writers were Opus and Sonnet.
- Code and prompts changed together, so no single fix can be credited or blamed.
- Differences under about 3 total points, or 0.5 per criterion, are within noise.

What the data supports:
- Helped, probably: agency C, +5.8 and a 2-0 head-to-head, with problem_objective +1.00, insight +1.00, commercials_ask +0.67 and headline_fit_limits +0.67. This is the one result clearly above the noise band, and the objective slide and tension-based insight are what the judges credit.
- Helped, modestly: investor C won 2-0 head-to-head (credited to the objective slide and earlier concentration disclosure) even though the total moved -0.4. problem_objective rose 0.67, which is above the 0.5 line.
- No detectable effect: agency A (+1.9) and investor B (+0.6). Both totals are inside noise, and most criteria were unchanged. The objective_quant check still fires on agency A: its numeric objective is missing.
- Did not help: the insight judge and retry did not fix the insight. It failed on all three decks where it ran. Red team applied nothing. Headline narrowing rejected most of its own proposals. Supply cards produced no answers on agency A and at most one supplied item elsewhere. Team_proof moved only +0.33 on three decks, which is noise.
- Did not meet plan measures: commercials_ask rose at least 1 point on no deck, and insight reached 3.5 on no investor deck (assuming that is the Dockhand case).

What got worse, specifically:
- Agency C evidence_trace -0.67 (4.00 to 3.33).
- Investor C presentability -0.67 (4.00 to 3.33), compliance_gate -0.33, idea_chain -0.33, plus a title overflow on slide 2.
- Agency A commercials_ask -0.33.
- Investor B problem_objective -0.33.
- All of these are at or under the noise line individually. Taken together they suggest a mild cost in polish and traceability, but one run each cannot separate that from chance.
- Validator load is high: agency C has 35 errors (32 of them `unknown_ref`), agency B 79 warnings, and every new deck fails validation. There is no old-arm count, so we cannot say this is worse than before.
- Cost: agency C at 2.94 USD is about 1.7 times the plan's 1.75 budget.

What is noise or unknown:
- Agency B's -38.1 is not a regression. Do not quote it.
- Investor B's 0-0-2 head-to-head says nothing.
- Per-criterion moves of 0.33 are one judge changing one score.
- The weight_share and chain_links warnings fired on agency B and C only. Judges' remarks about "0% of words" on the client's criteria match the weight_share warning, so that check at least agrees with the judges.

Judge remarks that persist across both arms, so the fixes have not reached them: empty team and proof slides, no budget split, requirement maps marking met items as NOT MAPPED (both investor decks), and placeholders on the presented slides.

## 6. Next steps

1. Re-judge agency B with the real new deck. The agency B new file at `engine/outputs/live2/judge/K-31.md` was overwritten with grep output, so find how that happened first (a judge or harness step wrote it). Then rerun both orders for the pair.
2. Re-run the investor B head-to-head with the real paths filled in.
3. Add repeats (at least three runs per deck per arm) before judging any single fix, or run the fixes one at a time on the two decks that moved most (agency C, investor C).
4. Look at agency C's 32 `unknown_ref` errors and the inferred `data` document key. Fix the reference resolution so validation reflects real problems.
5. Investigate the requirement map on both investor decks: it marks the ask, GDPR and the slide limit as NOT MAPPED while the slides do answer them. This is a visible defect in both arms.
6. Insight: the judge fails every pick and a person is needed, so decide whether the retry is worth its cost (0.31 USD on agency C) or the person should supply the insight up front.
7. Headline narrowing: look at why 21 of 29 proposals were rejected. Likely fix: forbid added numbers and require shorter text in the prompt.
8. Review cost on agency C (stage d alone 1.72 USD) before another full run, and check the owner's weekly usage first.
9. Record old-arm validator counts from the same checker so the next round can compare errors and warnings.

## CORRECTION (2026-10-18, added after a re-judge)

Two comparisons above were invalid and are replaced here.

- **Agency B** was scored from a corrupted packet (516 bytes of grep output): its -38.1 was an artefact.
- **Investor B** was scored from a file named `undefined.md` for BOTH decks (an agent returned a malformed deck name that broke the label lookup), so its "valid" total (+0.6) and the "void" head-to-head were both wrong.

Both were re-judged from packets built in code (K-31 agency B new, K-73 investor B new, K-26 investor B old; K-64 was already valid), three judges each, same rubric prompt, head-to-head in both orders. No new live decks were built.

| Deck | Old | New | Change | Head-to-head new : old |
|---|---|---|---|---|
| Agency A | 48.9 | 50.8 | +1.9 | 1 : 1 |
| Agency B | 58.1 | 58.7 | +0.6 | 1 : 1 |
| Agency C | 57.5 | 63.3 | +5.8 | 2 : 0 |
| Investor B | 64.5 | 64.0 | -0.5 | 0 : 2 |
| Investor C | 68.7 | 68.3 | -0.4 | 2 : 0 |
| Mean of five | 59.5 | 61.0 | +1.5 | 6 : 4 |

The mean change is inside the noise band of about 3 points. Only agency C is a clear improvement.

Mean change per criterion across the five decks: problem_objective +0.67, headline_fit_limits +0.27, team_proof +0.20, insight +0.13, commercials_ask +0.07, compliance_gate -0.07, presentability -0.07, idea_chain -0.13, evidence_trace -0.27 (agency B -1.0, agency C -0.67).

What the corrected data adds:
- Agency B: the new deck states the EUR 450,000 budget and the EUR 55,000 fee and the objective on slide 2 (judges noticed; the plan's Fernley B measure is met), but commercials_ask is still 2.0 (budget split and options remain placeholders), and one judge order preferred the old deck for its distinctive idea and better-grounded insight (the new insight is the one the engine's own insight judge failed).
- Investor B: the new deck LOST both head-to-heads. It presents an empty "why now" placeholder slide, discloses the 14% customer concentration later, and does not ask for UK introductions. This is a regression from roadmap item 11 (requiring why_now when the inputs hold none).
- The agency C 32 unknown_ref errors come mostly from a document key the harness inferred as `data`: a harness fault, not an engine defect.
