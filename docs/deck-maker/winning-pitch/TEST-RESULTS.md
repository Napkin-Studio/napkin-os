# Winning-pitch test: results of six live decks

Date: 2026-10-16. Status: indicative only. Two invented clients, three LLM judges per deck, no human judgement.

## 1. What was run

Two invented clients, each meant to be built at three information levels. Each level adds to the one before.

| Level | Inputs |
|---|---|
| A | prompt only |
| B | A plus documents |
| C | B plus a structured brief and research (`brief_object.json`, `research.clan`) |

| Scenario | Client | Project | Ground truth |
|---|---|---|---|
| agency | Fernley Drinks Ltd (FICTIONAL, Cork) | Fernley Sparkling Tea pitch: 330ml can, EUR 1.89 | 17 numbered asks. Awareness 11% to 25% by 30 Sep 2027, 150,000 first-time buyers via a QR offer, stores 612 to 900, EUR 450,000 budget, separate EUR 55,000 fee, campaign 5 Apr to 26 Sep 2027, pitch 1 Dec 2026 |
| investor | Dockhand Ltd (fictional, Dublin) | EUR 2.5M seed round for proof-of-delivery-to-invoice matching for independent food wholesalers (EUR 900k committed, close 15 Dec 2026) | 15 numbered asks. 38 customers, ARR 412k, 4.3x growth, NRR 118%, GM 78%, CAC payback 7 months, largest customer 14% of ARR, use of funds 55/30/15, max 14 slides |

- Planned: six live decks. Delivered: five. Investor level A failed twice and produced no deck (see section 6).
- The compliance gate was run first, before the decks. The gate cap was USD 2.50. I was given no gate results, so none are reported here.
- Cost cap for the six decks was USD 9 in total. Recorded spend is USD 0. That is not a real zero. The CLI transport records tokens, not dollars, so `report.json` shows `usd_total` 0 for every run. Actual spend is unknown, and I cannot say whether the cap held.
- Models: decks were written by Opus 5.5 and Sonnet 5.5. Judges were Sonnet. Three judges scored each deck blind, with labels D-xx hiding the arm. Judges used each client's `ground_truth/requirements.md` for all levels.
- Rubric: nine criteria, Napkin's default weights, giving a weighted total out of 100.
- All client material is invented. The research files are fictional, with source URLs on `example.invalid`. Each research set holds outside-market facts that are not in the documents, and one rejected finding plus one bad pin to test the rejected-fact guard.

Label to arm mapping (given to me only; the judges did not see it):

| Label | Arm |
|---|---|
| D-17 | agency A |
| D-04 | agency B |
| D-23 | agency C |
| D-29 | investor B |
| D-06 | investor C |

## 2. Results per client

Weighted total is out of 100. Validator counts come from each run's `validation.json`. Every run that produced a deck has `validation.pass = false`.

### Fernley (agency)

| Arm | Weighted total | Weakest criterion (mean) | Validator errors | Warnings | Slides | Cost | Time |
|---|---|---|---|---|---|---|---|
| A prompt only | 44.8 | compliance_gate 1.33 (team_proof also 1.33) | 2 | 14 | 29 | not recorded | 164 s |
| B plus documents | 57.2 | commercials_ask 1.33 | 29 | 32 | 34 | not recorded | 419 s |
| C plus brief and research | 56.5 | compliance_gate 2.00 (tied with team_proof and commercials_ask) | 26 | 41 | 35 | not recorded | 392 s |

### Dockhand (investor)

| Arm | Weighted total | Weakest criterion (mean) | Validator errors | Warnings | Slides | Cost | Time |
|---|---|---|---|---|---|---|---|
| A prompt only | no deck | n/a | n/a | n/a | n/a | not recorded | failed at stage i, twice |
| B plus documents | 70.1 | insight 2.67 | 6 | 12 | 18 | not recorded | 278 s |
| C plus brief and research | 74.0 | insight 3.00 | 6 | 18 | 19 | not recorded | 180 s |

Notes on the validator numbers:
- Fernley B's errors were 26 `unknown_ref` (for example a `brief:` reference that resolves to nothing in a run with no brief) and 3 `word_budget`. Fernley C's were 25 `unknown_ref` and 1 `claim_fit`. Most of the agency errors are therefore dangling references, not invented numbers.
- Fernley A had the fewest errors (2) and the lowest score. Fewer validator errors did not mean a better deck here.
- Fernley A's two errors were a `numbers_trace` hit (a "24" in a persona line, in none of the inputs) and one `claim_fit`.
- Dockhand B and C errors were `word_budget` (B: 83 words against 60 on s10) and `requirement_map` (B: m1, m2, m6, m7, m11 unanswered; C: 3 `requirement_map`, 3 `word_budget`).
- Both Dockhand decks exceed the brief's 14-slide maximum (18 and 19 slides). The validator's 18-slide presented cap did not catch the client's own cap.

## 3. Per-criterion means (3 judges, scale 1 to 5)

### Fernley (agency)

| Criterion | A | B | C |
|---|---|---|---|
| compliance_gate | 1.33 | 2.00 | 2.00 |
| problem_objective | 2.00 | 3.00 | 3.00 |
| insight | 1.67 | 3.00 | 3.00 |
| idea_chain | 2.67 | 3.67 | 3.00 |
| evidence_trace | 3.67 | 4.00 | 4.00 |
| headline_fit_limits | 2.33 | 2.33 | 3.00 |
| team_proof | 1.33 | 2.00 | 2.00 |
| commercials_ask | 1.67 | 1.33 | 2.00 |
| presentability | 3.00 | 3.00 | 2.67 |
| Weighted total /100 | 44.8 | 57.2 | 56.5 |

### Dockhand (investor)

| Criterion | B | C |
|---|---|---|
| compliance_gate | 4.00 | 4.00 |
| problem_objective | 3.00 | 3.33 |
| insight | 2.67 | 3.00 |
| idea_chain | 3.33 | 4.00 |
| evidence_trace | 4.00 | 4.00 |
| headline_fit_limits | 4.00 | 4.00 |
| team_proof | 3.00 | 3.00 |
| commercials_ask | 4.67 | 4.33 |
| presentability | 3.67 | 4.00 |
| Weighted total /100 | 70.1 | 74.0 |

## 4. Blind rankings

Judges ranked the decks without seeing the arm. The run data holds two full rankings per scenario. Every ranking agreed.

| Scenario | Rank 1 | Rank 2 | Rank 3 |
|---|---|---|---|
| Fernley | D-23 (agency C) | D-04 (agency B) | D-17 (agency A) |
| Dockhand | D-06 (investor C) | D-29 (investor B) | (no A deck) |

Why, in the rankers' words (condensed):
- D-23 (Fernley C) ranked first because it is the only one that put the hard asks on the page: EUR 450,000 budget, EUR 55,000 fee, the 11% to 25% awareness target and 150,000 QR buyers. It also used outside market evidence (38% Sunvale share, the 63% of 2 to 5pm drinking and the 9% healthy insight).
- D-04 (Fernley B) has a distinctive Irish-first idea ("Gan seanmoir") and a strong measurement table. It lost because its investment slide says "Budget given: not given" although the brief gives EUR 450k and EUR 55k, and it has no outside market evidence.
- D-17 (Fernley A) was called a generic weather-turning idea that ignores the real asks, and "reads as a different client's pitch".
- D-06 (Dockhand C) ranked above D-29 for a dedicated competition table, a risks slide with mitigations, a stated no-market-share caveat, cited evidence and a requirement map.
- D-29 (Dockhand B) was complete and clear, and one ranker credited it with stating the 14% Greenmarket concentration earlier. It put the ask last, had an unfilled "Evidence:" on the title slide, and left out the sources and requirement map.

## 5. What the judges said (one-line verdicts, by arm)

### Fernley A (D-17)
- The idea is competent, but the deck ignores the client's real asks and has no budget, team or proof a buyer can use.
- A clean single weather-turn idea and honest hedging, but it holds no numbers, budget, fee, team or the required Irish-language and Cork-lockup executions.
- One clear, ownable idea, but it answers almost none of the client's asks, so it loses to any deck that uses the brief's numbers.

### Fernley B (D-04)
- Wins on a distinctive, well-chained Irish-language idea with good evidence discipline. Loses because there is no budget split, fee, team or risks slide.
- Would win on a sharp, native Irish-language idea and a strong diagnosis (slides 2 to 7). Loses on the scored basics, with a close that is all placeholders.
- Distinctive, well-traced idea and a sound measurement slide. Budget split, fee, risks and team are unfilled placeholders, so commercials, team and risk cannot be scored.

### Fernley C (D-23)
- Wins on a distinctive, well-traced "Fernley o'clock" idea and a solid measurement slide. Loses because the team, budget split, options, risks and criteria map are placeholders or absent from the presented spine.
- A single ownable idea with traced numbers. Budget split, priced options, named team and case studies are unfilled placeholders.
- Would lose to any rival that shows a real team, a priced budget split and named risks. Slides 16 and 17 are placeholders and risks are missing from the presented spine.

### Dockhand B (D-29)
- Wins on a complete, well-traced ask (traction, 14% concentration disclosed early, use of funds, board seat). Loses if the investor wants a sharper reason why Dockhand wins: the insight rests on one Cork anecdote and the team slide is thin.
- Complete and sourced, but thin insight, a two-person team slide with no customer proof, dense slides and internal founder-question text left in the appendix.
- Covers every investor ask honestly. Weak on team, no sharp insight beyond a single-customer 2.4%, and an internal questions slide left in the render.

### Dockhand C (D-06)
- Complete, traceable, with an honest 14% concentration slide and a precise ask. Loses ground because the objective arrives late, the insight is a statistic contrast, the concentration disclosure comes at slide 13, and the team slide is thin.
- Covers every investor ask with sourced numbers and honest risk disclosure. Reader may want a sharper human-truth insight and proof of the team beyond two founder biographies.
- Complete, well-sourced and honest. Thin team slide, no stated objective until slide 12, and an insight that is a good statistic rather than a method-backed human truth.

## 6. Findings

Caution: n = 2 clients, one run per arm, three LLM judges. A 0.7-point gap between two arms is inside the noise I would expect. None of this is proof.

1. **Documents are the big step for the agency brief.** Fernley moved from 44.8 (A) to 57.2 (B), +12.4. The biggest criterion gains were insight (+1.33), problem_objective (+1.0), idea_chain (+1.0), compliance_gate (+0.67) and team_proof (+0.67). The prompt-only deck had no way to know the budget, targets or Irish-language mandatories, and judges said so.
2. **Brief plus research added little on top of documents for Fernley.** C scored 56.5 against B's 57.2, a difference too small to call. C gained on headline_fit_limits (+0.67) and commercials_ask (+0.67), but lost on idea_chain (-0.67) and presentability (-0.33). Blind judges still ranked C first, citing the budget and fee stated on the page and the use of outside market evidence. So the totals say "no difference" while the rankings say "C a little better". Both can be true at n = 2.
3. **For Dockhand, brief plus research helped modestly: 70.1 to 74.0 (+3.9).** Gains were idea_chain (+0.67), problem_objective (+0.33), insight (+0.33) and presentability (+0.33). commercials_ask dipped (-0.33). Judges and rankers preferred C for the competition table, risks mitigations and cited evidence.
4. **Direction is consistent, size is not.** In both clients, more input produced a higher total except Fernley B to C (flat). The size of the gain depended on how much the prompt already carried: Dockhand's prompt B carried the key figures, Fernley's did not.
5. **Where the pipeline does NOT help.**
   - Insight stayed the weakest or near-weakest criterion for Dockhand even with research (2.67 to 3.00). Judges called it a statistic, not a human truth.
   - team_proof did not move from B to C in either client (Fernley 2.0, Dockhand 3.0). This is by design, since team, credentials and price are placeholders.
   - Fernley's commercials_ask stayed at 2.0 or below in every arm. Fernley B printed "Budget given: not given" even though the documents state it. That looks like an intake gap.
   - evidence_trace was already high in B (4.0 in both) and did not rise with research.
   - compliance_gate stayed at 2.0 for Fernley B and C. Placeholders left unfilled (budget split, priced options, risks, criteria map) were the stated reasons.
   - Validator errors did not track quality. The worst-scoring Fernley deck had the fewest errors. The agency B and C errors are mostly dangling `unknown_ref` references.
   - Both Dockhand decks break the client's 14-slide maximum (18, 19) and the validator reported `requirement_map` errors on them.
6. **Robustness.** Investor level A failed twice at stage i: unusable JSON from sonnet-5-5 and opus-5-5 on the CLI transport, then `NoClaudeAvailable`. It failed quickly both times, so a retry may not help. Fernley C also needed one internal JSON retry. The A arm for Dockhand therefore has no data, and "does the pipeline help" is untested at the prompt-only level for investor decks.
7. **Cost and time are not comparable.** Cost was not recorded. Time rose with input for Fernley (164 s, 419 s, 392 s) but fell for Dockhand from B to C (278 s to 180 s). Do not read much into wall-clock times.

## 7. Top five changes to the Deck Maker

These use the gap numbers in `NAPKIN-EDGE.md` section 2. Each is a suggestion from five decks, not a tested fix.

1. **Fix intake so stated budget and fee reach the investment slide, and fill labelled placeholders from documents when they exist (gaps 3 and 5, commercials_ask).** Fernley B said "not given" for stated figures, and Fernley B and C both left budget split and options as placeholders. Commercials was 2.0 or less in all three arms. Add a `weight_share` style check so a heavily weighted criterion is not left as a placeholder.
2. **Make the deck respect the client's slide cap and requirement map (gaps 3 and 7, compliance_gate).** Dockhand B and C went to 18 and 19 slides against a stated maximum of 14, with requirement_map errors. Read the client's cap from the brief and refuse to present above it, with the appendix as overflow.
3. **Add an insight and idea-chain check and prompt (gap 1, insight and idea_chain, 28 points).** Insight was the weakest criterion for Dockhand and 3.0 at best for Fernley. Judges asked for a method-backed human truth rather than a statistic. Insight and chain are not measured by the current evaluator.
4. **Move the objective, baseline and target into the first three slides (gap 4, problem_objective).** Dockhand C was criticised for no stated objective until slide 12 and the concentration disclosure at slide 13. A cheap `objective_quant` regex check and a "risks not buried" order rule would target both.
5. **Fix the transport and reference failures, and report the cost (gaps 2 and 11).** Stage i failed outright on investor A, and `unknown_ref` errors dominate the agency validation (25 to 26) so they hide real problems. Make dangling `brief:` refs a warning when no brief exists, retry stage i with a repair prompt, record per-stage USD under the CLI transport, and keep the blind-panel harness with judge-family controls (gap 11) so a three-way run (ADR 0028) can be repeated on more clients.

Also worth noting: every deck with research is better placed for fit and evidence (gap 2). This test only weakly supports that, since evidence_trace was already 4.0 at level B for both clients.

## 8. Caveats

- All inputs are invented. The documents were written by the test author alongside the ground truth, so the documents match the ground truth by construction. Real briefs are messier.
- The research is fictional. It was written to contain outside-market facts, a rejected finding and a bad pin. The guard's behaviour on real research is untested here.
- Judges were Sonnet. The deck writers were Opus 5.5 and Sonnet 5.5, so a same-family bias toward Sonnet-written text is possible. No judge from another family was used.
- The rubric weights are Napkin's own default split. They are not validated against real pitch wins.
- No human or client judged any deck. Judge agreement was high on rankings, but that is agreement between LLMs, not evidence that buyers would choose the same way.
- One run per arm, two clients, three judges. Differences under about one point on a criterion, or about 2 to 3 points of total, should be treated as noise.
- Investor level A has no deck. Cost was not recorded, so the USD 9 cap cannot be confirmed as met.
- Judges saw the decks as built. Slides with placeholders were marked down for them, which is intended, but it means the totals partly measure how much a human still has to supply.
