# How Napkin pitches can win

Date: 2026-10-16. Based on the repo evidence listed in SOURCES.md (engine/deck/validate.py, spec.py, evaluate.py, docs/deck-maker/PLAN.md, edge-cases.md, ADR 0024-0028). I did not read stages.py, prompts or assemble.py beyond criteria_coverage, so the change list below names intent and files to check, not line edits.

## 1. What Napkin already does better

| Strength | Where | Rubric criterion |
|---|---|---|
| Any number in none of the inputs is an error; numbers a slide has no ref for are warned; refs resolve to pins, findings, document figures, brief fields, requirement ids or calc | validate.py numbers_trace, numbers_uncited | evidence_trace |
| A finding a person rejected, or a pin marked bad, can never appear | validate.py rejected_used | evidence_trace |
| Every client requirement needs a slide; stated rules are phrase-checked; mandated messages must sit on a presented slide | validate.py requirement_map, rule_broken, message_carried | compliance_gate |
| Scored criteria with weights map to home slide types, else an error names the criterion | spec.py CRITERIA_HOME, assemble.criteria_coverage | compliance_gate |
| Team, credentials, price and next step are never invented; labelled placeholders | spec.py HUMAN_ONLY_TYPES, validate.py placeholder | team_proof |
| Headline-vs-evidence fit judge, with stale-verdict detection | validate.py claim_fit | headline_fit_limits |
| Word budgets, action titles, 18-slide presented cap with appendix | spec.py, validate.py | presentability |
| An evaluator with no single score | evaluate.py | scoring method |

Why this matters: the rivals we checked brand the look and generate from a prompt. Gamma's help centre describes themes as colours, fonts, slide styles and accent images [https://help.gamma.app/en/articles/11029150-can-i-create-a-custom-theme-for-my-gamma-workspace]. Canva's page was not readable, so a claim about it is low confidence [https://www.canva.com/create/ai-presentations/]. We found no claim-level source tracing in either, but that is absence of evidence, not proof. Say "we show where each number came from", not "they cannot".

The weakness the research exposes: tenders are lost on compliance and one invented item (GAO B-418318; Brent exclusion rules), and the Deck Maker is built around exactly those gates. That is the lead pitch to buyers of the tool and the headline to score first.

## 2. Gaps against the rubric, ranked by impact over effort

| # | Gap | Criterion | Impact | Effort | Evidence |
|---|---|---|---|---|---|
| 1 | Nothing scores insight strength, one idea or the chain. evaluate.py measures none of it | insight, idea_chain (28 points) | High | Medium: judge panel plus code presence checks | evaluate.py docstring |
| 2 | Evidence depth is the bottleneck: fit 0-33% without research vs 57% with | headline_fit_limits, evidence_trace | High | Low to measure (ADR 0028 three-way run), medium to fix | DK-029 |
| 3 | Criterion weights are reported, not used to allocate slides and words | compliance_gate | High for tenders | Low to medium | assemble.criteria_coverage |
| 4 | No objective check for a quantified baseline and target in the first 3 slides | problem_objective | High | Low (regex plus numbers) | new check |
| 5 | Strategy sections missing: competitor/alternatives view, attribution and measurement plan, what we will not claim, risks and rival explanations in agency kind | headline_fit_limits, compliance_gate | High | Medium (slide types, budgets, checks) | PLAN.md section 3 |
| 6 | Proof slides (team, credentials, price) are blank by design, and buyers weight team heavily (Brent 23% vs concept 15%) | team_proof | High | Human handoff; tool can add a readiness report and prompts for what to supply | Brent; HUMAN_ONLY_TYPES |
| 7 | Brief asking for two creative directions gets one; presenting both exceeds 18 | compliance_gate | Medium | Medium | DK-008, DK-024 |
| 8 | Words are not checked in code, so outside facts and legal lines can reach prose | evidence_trace | Medium | Medium to high | DK-025 |
| 9 | Nothing checks rendered slides; no stage h; pptx lacks execution mockups | presentability | Medium | High | DK-028 |
| 10 | Investor order is an assumption (no cited source in spec.py); one real run, kind experimental | agency vs investor fit | Medium | Low to align with Sequoia | ADR 0025 |
| 11 | No scoring-run controls (judge families, both orders, length adjustment, gold set) | all judged criteria | High for credibility | Medium | evaluate.py |
| 12 | Social-value section and category compliance for sensitive briefs | compliance_gate, commercials_ask | Medium | Low to medium | Sourcing Playbook; ASA |

## 3. Concrete changes to engine/deck

### Stages and prompts

1. Objective gate before drafting. Refuse to proceed (or mark `needs_human`) when the brief gives no baseline and target; the stage asks the person or states an assumption slide. Source: Effie objectives guidance. Files to check: stages.py, the brief stage prompt.
2. Insight stage writes an insight in the form "what the data means, who, what tension, how found", cites a finding or pin, and says what the brief did not. Keep the insight slide at its 70-word budget. Sources: Effie insight definition.
3. Idea stage: exactly one recommended idea of 60 words or fewer with an explicit `traces_to` ref to the insight slide. A second direction only when the brief asks, held in the appendix or counted against the cap.
4. Plan stage: for each channel, a required `why_not` alternatives field (Effie channel choice).
5. Build the deck last from the finished argument, with the opening summary written last and every summary claim referencing a later slide (IPA).
6. Weight-aware allocation: when the brief gives weights, set per-criterion word and slide targets proportional to weight; when it gives none, state "default weights assumed".
7. Three-way run harness per ADR 0028: same client built prompt-only, prompt plus documents, full pipeline; record `built_from`; score with the rubric.

### Validators (validate.py, evaluate.py)

- `objective_quant`: first 3 presented slides contain a number and a from/to, vs or by-date pattern. Warn if the first presented slide type is credentials or product.
- `weight_share`: compare each scored criterion's weight share with its share of presented words; warn under half; report the minimum.
- `idea_single`: count recommended idea slides; check the idea refs the insight slide.
- `risks_present`: presence of a risks/assumptions element and a measurement slide with a KPI and baseline.
- `differentiator_repeat`: n-gram of the idea line appears in the first 3 and last 3 presented slides.
- `notes_overlap`: body text duplicating speaker notes above a threshold (Mayer and Moreno redundancy, extrapolated).
- `toc_present`: error for a table-of-contents slide (DocSend page).
- `options_count`: warn at more than 3 priced options with no recommended flag.
- `social_value`: required slide when the brief carries the criterion (UK central government 10% minimum).
- `category_rules`: banned-phrase list per sensitive category plus a `compliance` note requirement.
- `scoring_run_meta`: refuse to label a run trusted unless judge families, both-order runs, flip rate and a length-adjusted score are recorded.
- Keep the rubric weights in rubric.json, not in code, and have evaluate.py load it.

### Slide types

- `competition` (investor and agency): named alternatives with a plan to win (Sequoia). Budget 80.
- `why_now` for agency kind as "why this, now" in the objective slide, not a new slide.
- `measurement_plan` with KPI, baseline, target, lag and confounders. Budget 110 (existing measurement type extended).
- `risks` kept in the presented spine, but not last: the last slides are ask plus strongest proof (peak-end heuristic, extrapolated).
- `what_we_will_not_claim` in guardrails (PLAN.md gap).
- `response_map` already generated; extend it to show criterion weight and page share.
- A `credentials_deck` mode for chemistry meetings: short credentials, real team, questions for the client, sized for about 90 minutes of mostly conversation (WFA/EACA; IPA/ISBA). A different artefact from a full pitch.
- Budget-early placement as a tested option, not a default, because sources conflict (The Drum).

### Defaults to keep, relabelled

- 18 presented slides and two minutes a slide: keep, but label "Napkin default, not sourced". Cannes caps a strategy deck at 10 pages; DocSend's successful investor decks averaged 20. Make the cap a time-fit budget set per brief.
- Per-type word budgets: keep. DocSend says about 50 words per slide; assertion-evidence study 21 words. Our budgets for agency decks (40-120) are looser than both. Test a tighter presented budget against the leave-behind.

## 4. How to win with the output

1. Lead the tool's pitch with the gates: requirements traced, no invented number, rejected facts never reused.
2. Spend human time where the tool is blank: team, proof, price. Ship a readiness report listing what to supply for each placeholder.
3. Feed the tool research. DK-029 shows fit rises with evidence; the cheapest quality gain is a Research Tool run before the deck.
4. Score every run blind with the panel and report the weakest criterion, not just the total.
5. Measure the claim "better with the pipeline" on three or more clients before saying it externally (ADR 0028 says so itself).
6. Be honest about what we cannot show: none of these rubric weights is validated against real wins, and the judges were not validated against pitch outcomes.
