# Deck Maker engine (`engine/deck/`)

Turns whatever the person gave into a pitch deck, in any mix of: a prompt (one line to many pages), the
documents they attach, the research tool's CLAN and the brief tool's output (`brief_object.json`, or a Brief
Maker `.clan`). At least a prompt, a document, a brief or research is needed. The output is `deck.json` → web deck, `.pptx`,
PDF and a HyperFrames slideshow, with every number traced to its source.

Design: ADR 0016 (`engine/rag/docs/adr/0016-deck-schema-and-stages.md`), ADRs 0023-0026 (`engine/rag/docs/adr/`) and
`docs/deck-maker/PLAN.md`. Known failures: `docs/deck-maker/edge-cases.md`. Project state, metrics
and open decisions: the feature records `features/deck-maker-intake.clan` and `features/deck-maker-handoff.clan` (`clan read agent <file>`).

**Input rule (ADR 0023, amended by the proposed ADR 0028).** A deck takes only the person's prompt
(`--client`, `--project`, `--agency`, `--prompt-text`/`--prompt-file`, and the documents they attach,
`--doc`), the research tool's output and the brief tool's output. Nothing else may add facts, names or
legal lines to a slide, and a figure on a slide must trace to a prompt sentence, an answer, a document, the
brief or the research. Outside facts enter only through the Research Tool, which the app launches only on
the person's yes: the engine never searches the web and never launches research. A finding a person
rejected is never used.

## Run

From recorded stage outputs (free, deterministic):

```bash
cd engine
python3 -m deck.run_deck --brief outputs/deck_inputs/lumen_water/brief_object.json \
  --research research.clan \
  --stages outputs/deck_runs/lumen_water/stages \
  --client Lumen Water --project "National awareness campaign" --out outputs/deck_runs/lumen_water/vN
```

From a prompt alone, or a prompt and documents (no brief, no research):

```bash
python3 -m deck.run_deck --prompt-file prompt.txt --doc memo=notes.docx \
  --stages outputs/deck_runs/lumen_water/stages --client "Lumen Water" --project "Awareness" --out outputs/deck_runs/lumen_water/v1
```

An investor (seed) deck from a Brief Maker CLAN, the founders' deck and brand files:

```bash
python3 -m deck.run_deck --kind investor --brief outputs/deck_inputs/seed/brief.clan.zip \
  --doc deck=outputs/deck_inputs/seed/deck.pdf --brand outputs/deck_inputs/seed/brand/brand.json \
  --stages outputs/deck_runs/seed/stages --client "Lumen Labs" --project "Seed round" --out outputs/deck_runs/seed
```

| Option | What it does |
|---|---|
| `--live` | Runs missing model stages and saves them to `--stages`. **Paid** (about $0.65-1.25 a deck in the 2026-10-05 eval): ask first |
| `--format pitch\|full` | `pitch` (default): at most 18 presented slides, an Appendix divider, backup slides hidden. `full`: every slide in story order (ADR 0024) |
| `--audience review\|client` | `review` (default) shows agency notes and flags; `client` drops them and fails on any agency-only text left on screen |
| `--kind agency\|investor` | Agency response to a brief (default) or a seed investor deck (ADR 0025) |
| `--brief FILE` | The brief tool's output. Optional since ADR 0028 |
| `--prompt-text TEXT`, `--prompt-file FILE` | The person's prompt, any length. Its sentences are cited as `prompt:<n>` (1-based; split at line ends and after `.` `!` `?` followed by white space). Not both. With no prompt, no `--doc`, no `--brief` and no `--research` the run exits with an error |
| `--answers FILE` | JSON `{qid: {text or option_id, at, skipped?}}`: the person's answers to the intake questions, cited as `answer:<qid>` |
| `--research FILE.clan` | The research tool's CLAN. May be given alone |
| `--doc KEY=PATH` | A document the person attached: `.docx`, `.pdf` (page by page, `[pN]` markers kept), `.txt`, `.md`, `.eml` or an image (read by `brief_ingest.ingest`; nothing dropped). Cited as `doc:KEY#pN`. Repeatable |
| `--brand FILE` | Brand JSON: `name`, `colors` (THEME keys + `accent_ink`), `head`/`body` fonts, logo SVG/PNG paths |
| `--agency NAME` | Agency name for the cover; without it the cover shows an `[Agency]` placeholder |
| `--master FILE.potx` | Render the `.pptx` onto an agency master |
| `--animate auto\|click` | Native PowerPoint transitions and builds (not yet checked in real PowerPoint or Keynote) |
| `--hyperframes` | Also write a HyperFrames slideshow project to `hyperframes/` (`npx hyperframes present`) |
| `--builds` | HyperFrames: one click per block instead of one per slide |

Every run writes `deck.json`, `validation.json`, `report.json` (time, tokens, cost, coverage),
`deck.html` (the animated web deck: B builds, O overview, P presenter view, A appendix),
`deck.pptx`, `deck.pdf` and `png/slide-NN.png`.

## Intake: check, ask, strengthen

The ladder for a thin input. The engine does the first rung; the app does the others.

1. **Check** (engine). `intake.gap_report(inputs)` computes in code, never by a model, which brief fields
   are empty or filled only by proposal, and which slide types have no evidence (`spec.SLIDE_EVIDENCE`:
   no figure for a measurement slide, no audience evidence for an audience slide). `intake.tier(inputs)`
   records what the deck was built from as `meta.built_from = {tier, documents, brief, research}`, tier
   one of `prompt`, `prompt+documents`, `research`, `brief`, `brief+research`.
2. **Ask** (app). Stage **a0 (intake)** writes `a0_intake.json`: `fields` (brief fields the brief does not
   supply, each with `value`, `kind` prompt/document/research/proposal and `refs`), `abstained` (fields
   nothing supports: omitted, never blanked or invented), `gaps` (the gap report) and at most 5 skippable
   `questions` (`id`, `text`, `options`, `allow_text`, `address` `brief.<field>`). The app shows the
   questions and writes the answers; a skipped question never blocks a build and becomes an open question.
3. **Strengthen** (app). Only on the person's explicit yes, the app launches the Research Tool and the
   result comes back as research. Nothing in `engine/deck` does this.

Stage a0 reads the prompt text and every document chunk (60,000 characters each, merged in code, nothing
clipped). Precedence: brief and research first, then documents (a disagreeing document wins over the
prompt and the conflict is noted on the field), then the prompt; a field the brief supplies is never
overwritten (a document that disagrees with it is listed under `conflicts`). `intake.apply_a0` puts the
fields into the brief where empty, drops a field with a figure in none of the inputs or citing a rejected
finding, and demotes a field that cites nothing to `proposal`. It runs only when there is a brief gap and
something else to read (`run_deck._needs_intake`), so a complete brief costs nothing extra. Slides built
from a thin input are `drafted`, never `from_source`, and `validate` warns `thin_evidence` when more than
`spec.THIN_EVIDENCE_SHARE` (0.5) of a prompt-only deck's presented slides cite nothing.

From a Deck document (the hand-off): `inputs.from_upstream(data, members, docs)` builds the same
`Inputs` from `data.upstream.<source id>` plus the merged `facts`, `findings`, `sources` and carried
`decisions`, through the one field mapping (`CLAN_FIELDS`) and one research reader (`parse_research`). A
finding rejected in the chain stays rejected.

## Stages

Recorded stage files in `--stages`: `a0_intake.json` (only when intake ran), `a_requirements.json`, `b_storyline.json`, `c_territories.json`,
`d_idea.json` (agency), `i_investor.json` (investor), then `fit.json` (does each headline's evidence
support it) and `e_copy.json` (tightened copy). Models and effort: `stages.py` docstring.

## Check and compare

```bash
PYTHONPATH=. python3 -m pytest -q deck/tests        # 70 offline tests; fails to import without PYTHONPATH
python3 -m deck.evaluate outputs/deck_runs/eval/* --html outputs/deck_runs/eval/report.html
```

`evaluate` scores runs on integrity, citations, headline fit, requirements, messages, criteria,
copy and placeholders, and writes a comparison page plus the rows as JSON.

## Components

| File | What it does |
|---|---|
| `spec.py` | Slide types, word budgets, formats (`PITCH_MAX`), copy limits, statuses, claim bases |
| `deck.schema.json` | The deck contract (JSON Schema) |
| `inputs.py` | Loads the brief (JSON or CLAN, or none), research CLAN, the prompt, documents; `from_upstream` for a Deck document; records coverage |
| `intake.py` | `tier`, `gap_report`, `validate_a0`, `apply_a0`: the check rung and the a0 contract |
| `refs.py` | Resolves any ref to its value, licensed numbers, source and a notes line |
| `assemble.py` | Builds `deck.json`: requirements to slides, pitch arrangement and appendix, trace and sources slides, the investor build, copy edits |
| `validate.py` | 28 code checks, listed in its docstring (no model) |
| `stages.py`, `prompts/` | The model stages a0, a, b, c (+ judge), d, i, fit, e |
| `packs/*.yaml` | Category safety rules (banned imagery and phrases, watch words), each with its source |
| `render_web.py` | Single-file animated web deck |
| `render_pptx.py` | python-pptx renderer: theme, brand or `.potx`, native charts, notes, optional animations |
| `render_hyperframes.py` | HyperFrames slideshow (appendix as a branch sequence) |
| `evaluate.py` | Scores runs and writes the comparison page |
| `run_deck.py` | CLI: the whole pipeline and the report |
| `tests/` | Offline tests: validators, intake, the hand-off loader, the CLI; invented fixtures and a golden brief-only deck |


## Slide layouts and theme (render_pptx.py, theme.py)

`theme.py` holds one `Theme` (palette with a dark ink, light surface, panel, an accessible `accent_ink` of at least 4.5:1 on the surface, type scale, spacing grid, 0.65 in margins), `contrast()` (WCAG) and `check_palette()` (returns problems). The default theme `napkin` is cream, navy and rust in Cambria and Calibri; `classic` is the earlier white and amber look, drawn with the old flow only: `render(deck, inp, out, theme="classic")`. A brand JSON and `--master` apply as before; a brand with no `accent_ink` gets one derived from its accent.

`render_pptx.choose_layout(slide)` picks a native-shape layout from the slide type and block kinds (table in the module docstring): cover, emphasis_bar, chart, execution, territory, placeholder_card, quote_cards, comparison, big_number, kpi_row, timeline_strip, role_grid, native_table, cards. A layout that cannot hold the words at 10 pt or more, or meets a block kind it has no look for, raises `NoFit` and the slide is drawn by the earlier flow. `Renderer.layouts` records the layout each slide got. Words are fixed: layouts split, size and place text, never reword it. Claims are also written into the speaker notes. Tests: `tests/test_render_layouts.py`.

> Before any deck maker task read `features/deck-maker-intake.clan` (`clan read agent`); update it after any change to behaviour, interface, decisions, plan or handoffs.

## Stage h: rendered-slide QA

`qa_render.py` checks the finished `deck.pptx` (and a low-resolution render of its PDF) with plain code: no model, no new dependency. `run_deck` runs it after the PDF and PNG render and writes `qa.json` (`{"slides": {n: [{check, level: warn|error, message}]}, "pixels": {...}, "summary": {...}}`), a one-line summary in `report.json` under `qa`, and the stage's seconds under `stages.qa_render`. A finding never fails the run; `--no-qa` skips the stage. Run it alone with `python3 -m deck.qa_render deck.pptx --pdf deck.pdf --out DIR`.

| Check | Flags |
|---|---|
| `off_slide` | a shape reaching outside the slide |
| `margin` | a text frame under 0.5 in from an edge (footers, section labels and the DRAFT mark are exempt) |
| `text_overlap` | estimated text of two frames overlapping |
| `text_overflow` | estimated text clearly taller than its frame, or running off the slide bottom (a character-count estimate) |
| `min_font` | a run under its floor: title 28 pt, body 12 pt, caption 10 pt |
| `placeholder` | `[Agency]`, `lorem`, `TBD`, `XXX` on a presented slide (a slide the validator flags for `[Agency]` is skipped) |
| `contrast` | WCAG ratio of a run's colour on its fill or the slide background: 4.5:1, or 3:1 for large text |
| `mostly_empty`, `one_corner` | from the render: almost no non-background area; or 80% of it in one third both ways |

The pixel pass renders a separate 30 dpi PPM (about 0.1 s for 29 slides) and reads it with a small pure-Python P6 parser. The slide PNGs stay at 60 dpi: 150 dpi measured about four times slower (4.9 s against 1.2 s for 29 slides) for nothing the checks use. Hidden (appendix) slides are checked for geometry only. A pptx that cannot be opened gives one error under `"deck"`.


## Deck types (profiles)

A tender response, a credentials deck, an investor deck and an agency pitch need different things, so the engine asks which one this is instead of guessing, and tailors the structure, stages, strictness and guidance to the answer. One data file per type, `profiles/<id>.yaml`, loaded and checked by `profiles.py` (an unknown slide type, stage, check or brief field stops the load with `ProfileError`). Each file names the research it comes from (`docs/deck-maker/winning-pitch`: GUIDE.md, RUBRIC.md, rubric.json, NAPKIN-EDGE.md) in a comment.

| Type (`--kind`) | Use it when | Spine (presented) | Stages | Length | Strict (errors, not warnings) |
|---|---|---|---|---|---|
| `agency_pitch` (`agency`, the default) | an agency answers a client's brief | today's agency story | a0 a b c d fit e | 18 slides, 30 min | the defaults |
| `tender_response` (`tender`) | a buyer scores the answer against published criteria | title, response map, then each scored criterion in the buyer's order, plus the idea only if asked; routes not chosen behind the divider | a0 a b c d fit e | 18, or the buyer's stated slide limit | requirement_map, rule_broken, criteria_map, pitch_length, message_carried, numbers_uncited |
| `investor_seed` (`investor`) | a company raises a seed round | today's investor story | a0 i fit e | 18, 20 min | the defaults |
| `credentials` | a chemistry meeting, not a pitch | title, team, proof, what we heard, how we work, questions for you, next step; no territories, idea or price | a0 a b fit e (no c or d) | 10 to 14, 90 min meeting | pitch_length error; requirement_map, criteria_map, message_carried only warn |

`agency_pitch` and `investor_seed` have `arrange: legacy`: they build exactly as before types existed (the golden fixtures prove it) and carry no prompt guidance, so a recorded or live run of either does not change. `tender_response` and `credentials` have `arrange: spine`: `assemble._arrange_spine` orders the slides by the profile's `spine`, drops types it does not name, puts `appendix` types behind the divider, and (tender) moves the slides that answer a scored criterion into the buyer's order (`buyer_order`). Words stay fixed: a profile never writes, rewords or adds a slide's content.

**What a profile holds.** `id`, `label`, `one_line` (when to use it), `kind` (`agency` or `investor`: which assembler), `arrange` (`legacy` or `spine`), `spine`, `appendix`, `buyer_order`, `stages`, `length` (`max_slides`, `minutes`, optional `min_slides`, `respect_stated_limit`), `rubric_weights` (rubric.json's split, labelled "default, not validated", with a justified `adjustments` list per type; a tender's own stated weights replace it and say `source: brief`), `strict` (check name to `error` or `warn`: applied by `validate.run`), `prompt_guidance` (lines per stage, appended to that stage's prompt in a `<type_guidance>` block before the input rule: `stages._sysmsg`), `questions` (type-specific intake questions for brief fields still empty), `sources`.

**The question.** `intake.infer_type(prompt_text, documents, brief)` reads the words (an invitation to tender, ITT/RFT, scoring criteria, lots; seed, raising, investors; chemistry meeting, credentials, who we are) and returns `{type, confidence, evidence}` with the exact words quoted; a bare line is an agency pitch, low confidence, no evidence. `intake.type_question()` turns that into the question card (middleware-api 8.3: `q_deck_type`, "What kind of deck is this?", the four types as options with the inferred one first, origin `proposed`, `source` the quoted words; the others `asked`; `allow_text`; `address: deck.type`; always skippable, `default: agency_pitch`). It is computed in code, so it exists with no model stage, it is the first of a0's questions (the type question plus up to four others, still at most five), and `run_deck` reports it as `type_question`. A spine type's own `questions` fill free slots for fields still empty. The answer is `{"option_id": "tender_response"}` (or typed words that name a type) in the answers file; a skip or an unrecognised answer uses `agency_pitch` and records that.

**The flags.** `--kind agency|investor|tender|credentials` picks the type and wins over an answer. Without it the answer to `q_deck_type` decides, then the stated default. The deck records `meta.built_from.type` (the profile id) and `meta.built_from.profile` ({id, label, source: flag|answer|skipped|default, note}); `meta.profile` is added when the person was asked (answered or skipped) or the type is a spine one, together with `meta.length` and `meta.weights` for a spine type. A plain default agency or investor deck keeps its meta as it was. `report.json` gains `type` and `type_question`. A stage a type does not run needs no recorded file, and `--live` never calls it.

**Add a type.**
1. Copy the closest `profiles/*.yaml` to `profiles/<new_id>.yaml`; the file name is the id.
2. Set `kind` (which assembler), `arrange: spine` and a `spine` of slide types from `spec.SLIDE_TYPES` only; list `appendix` types, a `buyer_order` if the buyer's criteria decide the order, and the `stages` it runs (a spine type works from the agency assembler's stage outputs).
3. Set `length`, a `rubric_weights.weights` that sums to 100 with an `adjustments` entry and a `why` for every weight that moves, `strict` (names from `spec.CHECKS`), `prompt_guidance` (instructions only: no facts, names or legal lines) and `questions` (`brief.<field>` addresses).
4. Name the source in a comment. Add it to `spec.DECK_TYPES` (its place in the question) and to `profiles.KIND_TO_PROFILE` if it should have a `--kind`; if the inference should find it, add its words to `intake.SIGNALS`.
5. Add a fixture folder `tests/fixtures/types/<new_id>/` of invented stage outputs and a row in `tests/test_profiles.py`. Run `PYTHONPATH=. python3 -m pytest -q deck/tests` from `engine/`.

Tests: `tests/test_profiles.py` (inference, the card, the profile files and their failures, the spine arrangement, strictness, prompts, the CLI).

## The evaluation bench (`deck/bench`)

Offline scoring of finished decks, so "the pipeline makes it better" is measured rather than felt (DECK-CRAFT-PLAN 4.3, roadmap item 7). It makes no model call unless `--live --claude-judge` are both given; judges are Claude-only by default (ADR 0006).

```bash
python3 -m deck.bench score RUN_DIR [RUN_DIR ...] --judgments j1.json [--judgments j2.json] --profile tender_response --seed 7 --out bench.json
python3 -m deck.bench gold --human human.json --bench bench.json
python3 -m deck.bench design --clients a,b,c --arms prompt,prompt+documents,brief+research --seeds 1,2 --out matrix.json
```

- **Rubric and weights.** `deck/rubric.json` is the nine criteria with weights and 1/3/5 anchors, plus the tender override rule. Weights are the buyer's when the deck's `scoring` gives one for every criterion named as a rubric id (`weights_source: brief`), else the deck type's split labelled `default, not validated`. A buyer's own criterion names are recorded in the meta and the nine-criterion total keeps our split.
- **Blind packets.** A judge sees only the presented slides' text under a label `D1..Dn` from a seeded permutation; `meta` (built_from, stage sources), refs, notes, run names and any `--hide` string are stripped. The label-to-run map and the seed live in `bench.json`, never in a packet.
- **Both orders.** Every judge ranks the decks forward and reversed; a pair whose preferred deck changes is a flip and counts as a tie. The flip rate is recorded per judge and overall.
- **Judges.** `RecordedJudge` replays a saved file (tests, re-scoring). `ClaudeJudge` uses the engine's transport (`brief_llm._json_call`, pinned model) and refuses without `--live --claude-judge`. `NonClaudeJudge` (and a recorded non-Claude file) refuses unless `DECK_BENCH_ALLOW_NON_CLAUDE=1`. Each judgment records its judge and family; a score without quoted evidence is rejected.
- **Report.** Per-criterion means, the weakest criterion, every criterion at 1 (listed separately), judge agreement (exact, within 1, disagreements of 2 or more for a person), deck words and slides, and a length-adjusted score (least squares of score on words; needs 3 or more decks of different length).
- **`scoring_run_meta`.** A run may be labelled `trusted` (`--label trusted`, `label_run`) only with 2 or more judge families or a waiver note (`--waiver`), both orders, a recorded flip rate and a recorded length-adjusted score; otherwise it is refused and `untrusted_because` says why.
- **Gold set.** `human.json` is `{"decks": {run_name: {criterion: score}}}` (12 decks: 4 agency, 4 tender, 4 investor). `gold` reports Spearman rho per criterion and marks any criterion under 0.6 `untrusted` (judged by people only); under 12 decks it says it is a smoke check.
- **Experiment designer.** `design` writes the clients x arms x seeds matrix (12 x 3 x 2 = 72 builds, 432 judge calls) and a cost range from `experiment.PRICES` (assumed, plus or minus 30%). It runs nothing. `stats.noise_line` gives the pooled SD across seeds for the same client and arm.

`evaluate.rubric_criteria()` loads the criteria from `rubric.json`. Tests: `tests/test_bench.py`.

## Core fixes: intake flags, the objective slide, stated limits, sketches, cost (roadmap items 1, 3, 12)

Offline and model-free; tests in `tests/test_core.py` and `tests/test_intake.py`.

- **One untraced token never costs a field.** `intake.apply_a0` keeps a field whose name or legal line no input says (it still drops a field whose *figure* is in none of the inputs: an invented number must not reach a slide). The token is listed in `kept_with_flag` (in the report and on the brief field's record) and a question card `q_token_<field>` names it ('Keep it' / 'Remove it'), after the type question and inside the five-question cap; 'Remove it' takes the sentence, item or entry holding the token out. A legal line is now a form (`Fernley Drinks Limited`, `Ltd`, `plc`, `GDPR`, `the Companies Act`, `the Central Bank`), not the ordinary words 'limited', 'act', 'authority' or 'commission'.
- **The notes say what the brief says.** A `brief:<field>` ref in the speaker notes shows the field's first 140 characters and the refs it rests on; stage prompts carry each finding's `so_what` beside its statement.
- **Objective slide** (`objective`, 50 words, section Objective): slide 2 of an agency pitch and a credentials deck, after the response map in a tender. Built only from the requirements of kind objective, `brief.objectives` and the person's answer to the question addressed to `brief.objectives`; whole items until the budget; no slide when the inputs hold no objective. `brief_restated` stays in the appendix (also for tender and credentials). `objective_quant` (warn, agency decks) wants a number and a from/to, versus or by-date in the first three presented slides. The slide has no layout of its own yet: it falls back to the flow.
- **Stated limits, every profile** (`length.respect_stated_limit`): `assemble.stated_limit` reads the buyer's rules and criteria, the brief's mandatories, the prompt, the answers and the documents ('no more than 14 slides', '20 slides', 'slide limit', a page limit beside a limit word, '10 minutes' to present = 5 slides at `spec.MINUTES_PER_SLIDE`). The tightest wins, and an explicit count may be looser than the profile's; minutes only ever tighten. In the pitch format the presented story is cut to the limit by moving the least needed slides behind the Appendix divider in `spec.TRIM_ORDER` (process, guardrails, timeline, innovation, extra charts and executions, channel roles, ..., then credentials, audience, measurement). Nothing is reworded; the response map, the team, the money, the insight, the idea, the real question and routes the client asked for are never moved, and a story still over its limit is reported by `pitch_length`. A deck with no stated limit and no sketch is built exactly as before (no `meta.length` for the legacy types).
- **Sketch tier.** A deck built from a prompt alone, or a prompt and documents holding under `spec.SKETCH_DOC_CHARS` characters, presents at most `spec.SKETCH_MAX_SLIDES` (10), carries the fixed label `spec.SKETCH_LABEL` as a small block on the cover and records `meta.sketch`. `meta.length.source` says why.
- **Cost.** Each live stage records `usd`: a real figure when the transport gives one, else an estimate from tokens at `spec.PRICE_PER_MTOK` (Opus 5.5 5/25, Sonnet 5.5 3/15 dollars per million in/out; cache reads at 0.1x and writes at 1.25x the input price), marked `usd_estimated`. `run_deck` prices recorded stages that hold tokens but no dollars the same way, so `report.json` `usd_total` is not 0 and `usd_basis` says it is an estimate.
- **Repair call.** A reply that is not usable JSON gets one extra call (`stages.REPAIR_SYSTEM`) shown the bad text and asked for valid JSON only; its tokens are in the stage's usage and `repaired: true` is recorded. A failed repair raises as before. Reading the reply through `parse` turns provider JSON mode off for stage calls (it only matters to the non-Anthropic links, which stage calls do not use).
- **Dangling `brief:` refs** are warnings, not errors, when the run has no brief.
- **Smoke fixes.** A sentence is not shown twice on a slide (a text, statement, quote, callout or small block equal to the title or an earlier block is dropped; its refs stay as a claim). The credentials 'questions for the client' slide is in the presented spine in both formats (guarded by a test). The stage h line in `report.json` now counts the slides checked, not only the flagged ones.

## Thinking: the insight, the one idea and the chain (roadmap items 2 and 8)

Offline and model-free in tests (stubbed `_call`, invented Lumen Water fixtures in `tests/fixtures/thinking/`); tests in `tests/test_thinking.py`. Plan: `docs/deck-maker/winning-pitch/DECK-CRAFT-PLAN.md` 3.1-3.5.

- **Stage b writes three insight candidates** (`insight_candidates[{id, observation, refs, tension, implication, not_in_brief, from, swap_test, confidence}]`: one from behaviour, one from feeling, one from the category) and `insight{chosen_candidate_id, why, title, evidence[{text, refs}]}`. A recorded stage b with no candidates (`assemble.valid_candidates` finds none) builds the old quote-and-bullets slide, byte for byte.
- **The insight judge** (`stages.insight_judge`, `prompts/insight_judge.md`, Sonnet, low effort, never the writer's model). It reads the diagnosis and the candidates blind (ids renamed `j1..`, no choice, no swap-test text) and answers four yes/no tests with a quoted reason (`generic` must be no; `human_tension`, `specific`, `follows` must be yes) plus a paraphrase and an order. `assemble.judge_verdicts` computes pass or fail in code (a paraphrase with a number fails the candidate; a recorded `pass` is ignored). Output file: `insight_judge.json` in the stage directory. With no recorded file and no `--live` the step is skipped quietly (`report.json` stages: `insight_judge: skipped: no recorded output`) and the writer's choice stands. Live: the judge runs once; if every candidate fails and stage b was live this run, stage b re-runs once with the judge's reasons (`<insight_judge_reasons>`), is judged again and the retry is logged in `b_storyline.json` as `insight_retry`. If every candidate still fails, the slide is `needs_human` and its notes carry the judge's reasons. A non-Claude judge hook is not wired here (ADR 0006).
- **The chosen insight** is the judge's first-ranked passing candidate (it may overrule the writer), else the writer's choice. **The slide** is a `statement` block of three lines (people..., but..., so...) with the candidate's refs, a fixed label (`spec.INSIGHT_LABEL`, or `INSIGHT_LABEL_UNSOURCED` when it cites nothing) and the evidence as supporting `small` lines with refs. No quote block, so no 'Illustrative line, not a verbatim.' label.
- **For Gate 1** the engine writes `deck.meta.insight` (`chosen`, `writer_choice`, `chosen_by`, `why`, `judged`, `judge_pass`, `needs_human`) and `deck.meta.insight_candidates` (each candidate with `chosen` and the judge's `judge{pass, failed, reason, paraphrase}`). These are the gate payload for the storyline gate; the app does not read them yet.
- **Stage d writes a `chain`** (`insight_phrase`, `strategy_phrase`, `idea_phrase`, `proof_phrase`, `because{insight_to_idea, idea_to_proof}`) of quoted phrases; it is kept in `deck.meta.chain` and its prompt now asks for one idea of 60 words or fewer.
- **New checks (all warnings, in `validate.py`, named in `spec.CHECKS` so a profile may make them strict).** `insight_shape`: for a deck built from candidates, the truth is three sentences, the second with a tension word, the third starting 'so' or 'which means', no number in them, refs on the truth, and one evidence line citing an input. `idea_single`: one presented idea slide unless `routes_asked` is above 1, the statement within 60 words, no more than one channel word from `spec.FRAMES`. `chain_links`: for a deck with a chain, the insight phrase is on the insight slide, the strategy phrase on the proposition slide, the idea phrase on the idea slide, and the proof phrase on the idea slide and on a measurement or execution slide.
- **Relay test** (`validate.relay_test`, `report.json` `relay_test`): RECORD ONLY, no model, never blocks. It keeps the presented titles, the insight and idea lines and a lexical overlap of the idea's content words with the insight's text. A judge reading only the titles and the idea slide is not run.
- **`evaluate.py`** rows add `thinking`: insight (shape pass or warn, who chose, the judge's verdict), idea (single or warn) and chain (links given and found), all code-derived, and the comparison page shows them.

## Thinking 2: headline narrowing and the red team (roadmap items 4 and 6)

Offline in tests (`tests/test_redteam.py`: stubbed `_call`, invented Lumen Water fixtures, no live run). Both are skipped quietly when there is no recorded output and the run is not `--live`, so every existing stage directory rebuilds as before.

- **Headline narrowing (stage e).** `stages.copy` also sends a `<narrow>` block for every presented slide of a judged type (`stages.JUDGED`) whose fit verdict is `not` or `partly`: headline, the judge's reason, what the slide shows, its evidence lines. The model returns `narrowed: [{slide, headline, reason}]` in `e_copy.json`. `assemble.apply_narrowing` applies a rewrite only if it adds no number the original headline lacks (the `numbers_trace` guard), is not more than 3 words longer, and differs; otherwise the original stays. Each outcome, applied or rejected with why, is in `deck.meta.narrowing`. The slide's fit verdict is re-keyed to the new title as `narrowed` (it was not judged again): `claim_fit` then warns "narrowed, run the fit judge again" instead of erroring. If `fit.json` already holds a verdict under the new title (a re-run judge), that verdict wins. A recorded `e_copy.json` with no `narrowed` changes nothing. An existing `e_copy.json` is not re-run to add narrowing.
- **The red team (`stages.red_team`, `prompts/red_team.md`, Sonnet, medium effort).** One call after stage e on the finished deck: at most `spec.RED_TEAM_MAX` (6) objections as a skeptical buyer or investor, each of a kind in `spec.RED_TEAM_KINDS`, tied to a slide and one change (`wording`, `order`, `placeholder`, `ask`). `run_deck._red_team` reads `red_team.json` (or, with `--live`, makes the call and records it), `assemble.apply_red_team` stores the objections in `deck.meta.red_team` (for Gate 1 and Gate 3 to show) and applies at most one change per objection, by code, only for a `wording` change to a headline (judged slide type, not a placeholder, human-written or quote slide, no number added, not longer) or an `order` move of a presented slide (never the cover or the objective). Everything else is "left for the person". Each objection becomes a decision in `report.json` `decisions`; the `red_team` stage row carries a cost note.
- **Not done:** no non-Claude judge hook; the red team reads the finished deck once (a separate storyline-only pass before Gate 1 is not wired, the same objections are shown at both gates); no live run.

## Per-type polish: tender answers, agency risks and competition, investor shape (roadmap items 9, 10, 11)

Offline in tests (`tests/test_polish.py`: stubbed `_call`, recorded JSON in `tests/fixtures/polish/`, every client invented, no live run). A new model stage is skipped quietly when its recorded output is absent and the run is not `--live`, so every existing stage directory rebuilds as before.

- **Item 9, tender: one written answer per scored criterion.** For a deck type whose spine holds `criterion_answer` (the tender response), `run_deck._criterion_answers` reads `d_<criterion>.json` for each scored criterion of stage a (the file stem is the criterion in lower-case words joined by `_`, at most 40 characters). With none recorded and no `--live` that criterion is `skipped: no recorded output`; live, `stages.criterion_answer` makes one call per criterion (`prompts/tender_answer.md`, model `d_criterion`, Opus, medium) and records the file. The word budget (`assemble.criterion_budgets`) is the weight's share of `spec.ANSWER_WORDS_TOTAL` (600, a Napkin default), at least `ANSWER_WORDS_MIN` (40), capped by the buyer's own page limit (`WORDS_PER_PAGE` 450 a page) or word limit; the heaviest criterion gets the most. The budget is read from the scoring list stage a recorded (the same weights `meta.weights` holds), because the stage runs before the deck is built. The answers become `criterion_answer` slides (`assemble._criterion_slides`) placed after the objective in the buyer's order; each records `criterion` and `budget`, and `validate`'s word budget uses the slide's own. Whole points only: a point that does not fit stays in the notes, never cut. An answer with no points (nothing in the inputs, for example no team document) is a labelled placeholder whose text is the model's `needs` line. The person's documents may fill team, credentials and fee points when cited (ADR 0023, 0028). In a pitch, the slides whose types answer an answered criterion (`_criteria_rank`) go behind the Appendix divider, so the answer is the criterion's presented slide (`spec.ANSWER_KEEPS` never move). `report.json` has a `d_criteria` stage row (per-criterion source and budget, calls and cost summed).
- **`weight_share` (validate.py, a warning, in `spec.CHECKS`).** For each scored criterion that states a weight, its share of the weight against its share of the presented words of the slides that answer criteria (`weight_share_rows`; a slide answering several criteria splits its words). A criterion with a quarter of the weight or more (`spec.HEAVY_WEIGHT_SHARE`) whose words share is under half its weight share (`WEIGHT_SHARE_FLOOR`) is warned, and the message names the lowest ratio. `weight_share_report` (rows, `min_ratio`, `min_criterion`) is written to `report.json` as `weight_share`. The response map (scoring slide) gains a 'Share of our words' column beside the weight.
- **Item 10, agency: `risks`, `competition`, `measurement_plan`.** Stage d (`prompts/d_idea.md`) may write `risks[{risk, mitigation, refs, basis}]`, `competition{title, alternatives[{name, why_chosen, how_we_win, refs}], plan}` and `measurement_plan[{kpi, baseline, target, lag, confounders, refs, basis}]`. The assembler builds: a risks slide (cards, at most four, whole risks within 90 words) after the timeline and before the investment, presented and never last; a competition slide after the proposition (only alternatives that cite an input; a row without a ref is dropped, the plan line follows if it fits 80 words); a measurement plan table right after the measurement slide (110 words; a baseline the inputs do not give reads 'None in the brief: set before launch'). Risks and competition with nothing recorded are labelled placeholders (`needs_human`) that ask the person; the code writes no risk or rival. No plan recorded, no measurement plan slide. `risks` and `competition` already existed for investor decks (budgets 90 and 80); `measurement_plan` (110) is new. They go last in `spec.TRIM_ORDER` (competition, measurement_plan, measurement, risks) when a stated limit forces a trim; that also applies to an investor deck held to a limit. This intentionally changes the agency_pitch output: the Lumen Water golden deck gained the competition and risks placeholder slides (16 presented, was 14) and the goldens were regenerated; the validation findings are the same set.
- **Item 11, investor.** `prompts/i_investor.md` and `profiles/investor_seed.yaml` (`prompt_guidance` for stage i and the fit judge): `why_now` required (cited, or say the inputs state none and ask), slide 2 is an `objective` (the round and the milestones the money buys), `what_we_know` (new type, 70 words) right after traction, the scariest number disclosed before the eighth slide. The spine lists the types in that order; stage i's story still decides the build order, so the recorded investor golden (no such sections) is byte-identical. No code checks the scariest number: it is prompt guidance only.
- **Layouts (`render_pptx.py`).** `objective_panel`: a dark panel with the target as a big figure and the baseline and date pulled from the objective's own sentence (`_objective_facts`; fixed captions THE TARGET, BASELINE, BY WHEN), the slide's blocks as cards on the right; an objective with no figure is `cards`. `risk_cards`: a card per (risk, mitigation). `comparison_grid`: a dark cell per alternative beside why it is picked and how we win. The measurement plan is the existing `native_table`. Each falls back to the earlier flow on `NoFit`. The pulled figure repeats a token of the sentence (the sentence is still shown whole, so no word is lost).
- **Not done:** no live run; the `criterion_answer` slides are added beside the per-concept slides (which move behind the divider in a pitch) rather than replacing their builders; a tender with no stage a scoring runs no criterion step; the app's `schema.json` and the `docs/contracts` copy are not updated for the new slide types.

## Supply cards, human-only fills and the confirm list

The engine never invents what only the person knows (a team, past cases, a fee split, options, a decision date), but it
does read what the person supplies. `spec.HUMAN_ONLY_TYPES` means never invented, not never filled (ADR 0023, 0028).

- **Supply cards.** `intake.supply_questions(inp, kind, profile)` returns question cards (the 8.3 shape, `kind: 'supply'`,
  `fills: <slide type>`, free text, skippable) computed in code from the gap report and the deck type's spine: `q_supply_team`,
  `q_supply_credentials`, `q_supply_budget` (only when the brief gives no budget), `q_supply_options`, `q_supply_decision_date`.
  A section the person's own documents already state is not asked again; an investor deck has none. `intake.add_supply_questions`
  puts them after the type question and the stage's own, inside the five-question cap (it keeps room for the first two, and never
  drops the objectives question). `run_deck` writes them to `report.json` as `supply_questions` and into the a0 questions.
- **Answers.** The app writes the person's answer at `intake.answers.<qid>`. `--answers FILE` takes the flat `{qid: answer}` it
  always did, or `{"answers": {...}, "verified": {...}}`.
- **Fills.** `assemble._fill_human_only` fills a team, credentials, investment or next-step slide from the person's answer (cited
  `answer:<qid>`, one item per line, whole and in order), else from their attached document (`intake.doc_supply`: a Team, Case
  studies, Fees section whose lines read as the agency's own, or a sentence stating a decision date; cited `doc:KEY#pN`, or
  `doc:KEY#<heading>` when the document has no page markers). A line that asks for something ("Provide CVs of key personnel") is
  never read as the agency's own. A filled slide is `from_source` and carries `supplied: {basis: 'supplied by <person>' or 'document', by, refs}`;
  the DRAFT count and the "to supply" count fall. A slide nothing supplies stays a labelled placeholder, `needs_human`.
  With no answers and no document section the build is unchanged (the goldens prove it). In a pitch, the team and credentials
  slides are one merged slide: it is `from_source` only when both are supplied.
- **Confirm list.** `intake.confirm_list(deck, inp)` lists every proposal, every figure whose only source is the person's own
  statement (`prompt:`, `answer:`) or a low-confidence pin, and every slide still needing a person, each with a stable `ref`.
  `run_deck` stamps it as `deck.json` `meta.confirm` and `meta.confirm_summary`, and `report.json` `confirm`. A verify decision is
  `intake.verified.<ref> = {by, at}` (read from the `verified` key of `--answers`); `intake.confirm_summary(deck)` counts
  `verified`, `supplied` and `sourced` (verified plus supplied: nothing else counts). The renderers' "DRAFT · N slides need a
  person" wording is unchanged; they can call `confirm_summary` for the verified count.
