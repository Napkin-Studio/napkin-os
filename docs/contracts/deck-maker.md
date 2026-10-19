# Contract — Deck Maker run

Status: **draft** · Features: `features/deck-maker-ui.clan`, `features/deck-maker-intake.clan`,
`features/deck-maker-handoff.clan` · Owner: Sai
Readers: the Deck Maker app (`app/templates/deck-maker/`), the future server feature that runs the
engine, and `engine/deck/`. ADRs: 0016, 0023 (input rule), 0028 (open inputs, proposed; amends 0023),
0024, 0025, 0026, 0029 (deck types, proposed).

The app is a view over one `.clan` document. It never calls the engine; it reads `shared/data.yaml`
and writes attributed patches (`clan.patchData`). Whatever runs the engine writes the same fields.
Every shape below is the engine's own, except `run`, `evidence`, `exports`, `intake.answers` and
`research_request`, which hold what the screens need around it. Schema: `app/templates/deck-maker/schema.json`.
Sample: `app/templates/deck-maker/example/data.yaml` (checked against `engine/deck/deck.schema.json` by
`engine/deck/tests/test_deck_maker_fixture.py`).

## What a deck is built from

The Deck stands alone. A deck builds from any of: the prompt text, documents the person attached, a
brief, research. At least one must be present; the brief and the research are optional. The app refuses
Build only when there is no prompt text, no document and no upstream (`DeckLogic.canBuild`); the engine
exits with an error on the same condition.

`meta.built_from` on `deck.json` records it (`intake.tier`, optional in `deck.schema.json`, so older decks
stay valid):

```
{ tier: "prompt" | "prompt+documents" | "research" | "brief" | "brief+research",
  documents: [file names], brief: bool, research: bool }
```

The tier is the richest source present: `brief+research`, `brief`, `research`, `prompt+documents`, else
`prompt`. Fields an intake stage filled never make a brief. The app computes the same record for its
"Built from" line (`DeckLogic.builtFrom`) until the engine's own is on the deck.

## Fields

| Field | Written by | Source |
|---|---|---|
| `inputs.prompt` `{client, project, agency, text}` | the app | Start screen. `text` is the open prompt, any length. An empty agency shows as `[Agency]` |
| `inputs.documents[]` `{name, pages?}` | the host | a display list of the files the person attached. The app's Attach button is not wired (it says "needs the host") |
| `inputs.kind` `agency\|investor`, `inputs.format` `pitch\|full` | the app | `run_deck --kind`, `--format` |
| `inputs.library.enabled` | nobody yet | ADR 0027 (proposed). Off |
| `upstream.<source id>` | the host's spin-off | the frozen source document, whole. **Read-only**: the app never writes it |
| `intake` `{gaps, questions}` | the runner | the a0 stage's `gaps` and `questions`, as the runner writes them |
| `intake.answers.<qid>` `{text \| option_id, at, skipped?}` | the app | one patch per answer or skip |
| `research_request` `{status: "asked", at}` | the app | the Strengthen click. Records a request and **launches nothing** |
| `run.stages[]` `{id,name,sub,status}` | the runner | `engine/deck/stages.py` |
| `run.gate` | the runner | the open gate, or `null` |
| `run.approvals.<gate>` `{by, at}` | the app | on Approve |
| `deck` | the runner | `deck.json` (+ `appendix_count`), with `meta.built_from` |
| `validation` | the runner | `validation.json`: `errors`, `to_supply`, findings by slide |
| `evidence.<ref>` `{kind,text}` | the runner | what each cited ref says, resolved from the inputs |
| `report` | the runner | `report.json`: `seconds`, `tokens`, `cost_usd`. The app shows these, never an estimate |
| `exports.web\|pptx\|anim\|pdf` | the runner | file names, once written. Absent means "Not built yet" |
| `change_requests[]` | the app | an Ask-for-a-change click: `{slide, change, at, status}`. Words only; sources stay |

On Build the app writes only the person's own inputs (`inputs.prompt`, `kind`, `format`). The Brief and
Research cards are **derived** from `data.upstream` on every render (`DeckLogic.upstreamSummary`): a
brief is a document that holds brief fields, research one that holds findings or a campaign (a research
hoisted into a brief counts too). Their counts (fields filled, mandatories, findings, rejected) are never
stored, so they cannot go stale. The deck's own fields are never seeded from upstream.

## Refs

A figure or claim on a slide traces to a ref. Besides `f_...` (fact), finding, `doc:KEY#pN` and the
brief refs, two kinds exist (`engine/deck/refs.py`):

- `prompt:<n>`: the n-th sentence, 1-based, of `inputs.prompt.text`. The split is deterministic: break at
  every line end, then after each `.`, `!` or `?` followed by white space (`5.2` stays whole), trim, drop
  empty pieces (`prompt_sentences`).
- `answer:<qid>`: the person's answer to a question: their text, or the chosen option's label and value.
  A skipped or unanswered question resolves to nothing.

A ref the run holds no evidence for shows as "not found", never skipped.

## Intake: the a0 stage

Stage **a0** writes `a0_intake.json` to the `--stages` directory like the other recorded stages. It runs
only when there is a brief gap and something else to read (`run_deck._needs_intake`).

```
{ stage: "a0_intake", produced_by,
  fields:    { <brief field id>: { value, kind: prompt|document|research|proposal, refs: [...] } },
  abstained: [<brief field ids nothing supports>],
  gaps:      { brief_fields: [{field, why}], slide_types: [{type, why}] },
  questions: [{ id: "q_...", text, options: [{id, label, value}], allow_text, address: "brief.<field>" }] }
```

`intake.validate_a0` checks it. At most 5 questions, each skippable. The **gap report is computed in code**
(`intake.gap_report`, never by the model): a brief field is a gap when empty or filled only by proposal;
a slide type is a gap when it has no evidence (`spec.SLIDE_EVIDENCE`: no figure for a measurement slide,
no audience, competitor or budget evidence for the slides that need them). The model writes only `fields`
and `questions`; the runner stores `gaps` and `questions` at `data.intake`.

`intake.apply_a0` puts the fields into the brief:

- **Precedence.** Brief and research first, then documents (a disagreeing document wins over the prompt
  and the conflict is noted on the field), then the prompt. A field the brief supplies is never
  overwritten; a document that disagrees with it is listed under `conflicts`.
- The person's answers fill their addressed field first, cited `answer:<qid>`.
- A field is dropped when a figure in it is in none of the inputs, or when it cites a rejected finding.
  A field that claims a basis but cites nothing that resolves is demoted to `proposal`.
- An unanswered or skipped question joins the open questions. It never blocks a build.
- Slides built from a thin input are `drafted`, never `from_source`. `validate` warns `thin_evidence`
  when more than `spec.THIN_EVIDENCE_SHARE` (0.5) of a prompt-only deck's presented slides cite nothing.

## The ladder: check, ask, strengthen

1. **Check** (engine). `gap_report` and `tier`, in code. The app shows the result in the Check panel:
   brief fields nothing supports, slide types that would be thin.
2. **Ask** (app). Up to 5 questions with option buttons, a free-text box where `allow_text`, and Skip. An
   answer writes `intake.answers.<qid> = {text | option_id, at}`; a skip writes `{skipped: true, at}`.
   Build never waits for them.
3. **Strengthen** (app, on the person's yes). Offered when there are gaps. The click writes
   `research_request = {status: "asked", at}` and nothing else: **it launches nothing**, because launching
   the Research Tool needs the server feature. When it is built the result returns as research (an
   `upstream` document), never as text the Deck wrote.

The Deck never searches the web and never launches research on its own.

## Spin-off

The Deck template declares `app.spinoff { accepts: [ie.napkin.brief-maker, ie.napkin.campaign-research],
upstream: true }`, no map and no lift, and its version is `0.2.0` (`crates/clan-sdk/examples/make_deck_maker.rs`).
A deck spun off from a Brief Maker or Research Tool document carries that document whole, frozen, under
`data.upstream.<source document id>`. The app shows a notice when the host reports a source changed since
(`GET /upstream`); the deck keeps the version it has and does not take the newer one on its own. On the
engine side `inputs.from_upstream(data, members, docs)` builds the same `Inputs` from `data.upstream` plus
the merged `facts`, `findings`, `sources` and carried `decisions`. A finding rejected in the chain stays
rejected and is never used on a slide.

## Gates

A gate stops the run. `run.gate` names it and every stage after it is `next`, never `now`
(`DeckLogic.gateHolds`). Approving writes one patch: the gate's stage `done`, the next stage `now`,
`gate: null`, `approvals.<gate> = {by, at}`, with the decision `approve <gate>`. Only the open gate
can be approved. Edit beats and Ask Dex to try again are specified here and not built: the app only
toasts that they need the engine server.

## Rules the screens keep

- Inputs are the person's prompt, the documents they attach, the research and the brief (ADR 0023,
  amended by the proposed 0028). Nothing else adds a fact, a name or a legal line. A figure on a slide
  traces to a prompt, answer, document, brief or research ref. The library panel is off.
- A placeholder (`human: true`, or text of the form `[…]`) shows as "To supply". The app has no
  control that writes one.
- A line with no source is labelled opinion, proposal or creative, never hidden and never flagged
  as an error (the engine's `bare_claim` rule).
- A finding a person rejected is never used on a slide.

## Deck types and the type question

A **deck type** is a profile, one file `engine/deck/profiles/<id>.yaml` (ADR 0029, proposed). Four ship:
`agency_pitch` (the default), `investor_seed`, `tender_response`, `credentials`. A profile holds `id`, `label`,
`one_line`, `kind`, `arrange` (`legacy` | `spine`), `spine`, `appendix`, `buyer_order`, `stages`, `length`,
`rubric_weights`, `strict`, `prompt_guidance`, `questions`, `sources`; `profiles.load` rejects an invalid one.
A profile orders slides, picks stages, sets strictness and adds prompt guidance. It never adds a fact, a name
or a legal line to a slide (ADR 0023, 0028). `agency_pitch` and `investor_seed` build as they always did.

**The type question.** The first question in `a0_intake.questions` is always the type card, computed in code
(`intake.type_question`, so it exists with no model stage):

```
{ id: "q_deck_type", text: "What kind of deck is this?", allow_text: true, address: "deck.type",
  skippable: true, default: "agency_pitch",
  options: [{ id: <profile id>, label: "<label>: <one_line>", value: <profile id>,
              origin: "proposed" | "asked", source?: "<quoted words>" }] }
```

The type `intake.infer_type` points at is first with `origin: proposed` and `source` holding the exact words it
matched in the prompt, documents or brief; the rest are `asked`. No match is an agency pitch with no source. A
type's own questions (`profile.questions`, addressed `brief.<field>`) fill the other four places only about a
brief field still empty.

**Answer and skip.** The app writes `intake.answers.q_deck_type = {option_id | text, at}` or `{skipped: true, at}`
(the selector on the Check step: four options, the proposed one marked with its quote, and Skip). Build never
waits. `intake.chosen_type` settles the type: an explicit `run_deck.py --kind agency|investor|tender|credentials`
first, then the answer (an option id, or typed words that name a type), then the stated default `agency_pitch`
(skipped, an answer naming no type, or nobody asked). The deck records the result at
`meta.built_from.type = {id, label, source: flag|answer|skipped|default, note}`, and `meta.profile` for a spine
type or an answered or skipped question. The app reads the same rule in `deckTypeOf` and maps a type to the
legacy `inputs.kind` (`investor_seed` is `investor`, the others `agency`).

**Strictness and weights.** `strict` lists the validator checks that are errors for a type (a tender: the
requirement map, rules broken, the criteria map, pitch length, messages carried, uncited numbers; a
credentials deck: pitch length only); every other check stays a warning. `meta.weights` carries the nine
criterion weights with `source`: `brief` (the buyer's own weights, when the tender's scoring states a weight
for every criterion) or `default_assumption` (the profile's split, labelled "default, not validated").

**Adding a type** is adding one profile file that passes `validate_profile`; the question lists it.

Not built: running the question from a live job (the server feature), a fifth type, measuring the guidance
on the eval.

## The objective slide and the sketch tier (ADR 0030, proposed)

- `objective` (50 words, section Objective) is slide 2 of an agency pitch and a credentials deck, follows the response map in
  a tender and carries the round and milestones in an investor deck. It is built only from objective requirements,
  `brief.objectives` and the person's answer addressed to `brief.objectives`; with none of those there is no slide. It amends
  ADR 0024: `brief_restated` stays in the appendix. Check `objective_quant` (warning) wants a number and a from/to in the
  first three slides.
- A buyer's, prompt's or document's stated slide, page or minute limit tightens the length of every profile; the least needed
  slides move behind the Appendix divider in `spec.TRIM_ORDER`.
- **Sketch tier.** A deck from a prompt alone, or a prompt plus documents under `spec.SKETCH_DOC_CHARS`, presents at most
  `spec.SKETCH_MAX_SLIDES` (10), carries `spec.SKETCH_LABEL` on the cover and records `meta.sketch`.

## Insight candidates, the Gate 1 payload, headline narrowing and the red team (ADR 0031, proposed)

- Stage b writes `insight_candidates[{id, observation, refs, tension, implication, not_in_brief, from, swap_test,
  confidence}]` and `insight{chosen_candidate_id, why, title, evidence}`. A blind judge (`insight_judge.json`) tests each
  candidate; pass or fail is computed in code. No recorded candidates builds the old insight slide.
- **Gate 1 payload** (`deck.meta`): `insight` (`chosen`, `writer_choice`, `chosen_by`, `why`, `judged`, `judge_pass`,
  `needs_human`), `insight_candidates` (each with `chosen` and `judge{pass, failed, reason, paraphrase}`), `chain`
  (`insight_phrase`, `strategy_phrase`, `idea_phrase`, `proof_phrase`, `because`), and `red_team` and `narrowing` below.
  The app does not read them yet.
- **Headline narrowing** (stage e): `e_copy.json` may return `narrowed[{slide, headline, reason}]` for slides whose fit verdict
  is `not` or `partly`; applied only if no number is added and the headline is at most 3 words longer. Outcomes are in
  `deck.meta.narrowing`; the fit verdict becomes `narrowed`.
- **Red team** (`red_team.json`, `deck.meta.red_team`): at most 6 objections, each of a kind in `spec.RED_TEAM_KINDS`
  (`ask_unanswered`, `objective_unclear`, `claim_unsupported`, `risk_unaddressed`, `price_unclear`), tied to a slide and one
  change (`wording`, `order`, `placeholder`, `ask`). Code applies at most one wording or order change per objection; the
  rest is left for the person. Each is a decision in `report.json`.
- A new model stage with no recorded output and no `--live` is `skipped: no recorded output`. Checks `insight_shape`,
  `idea_single`, `chain_links` are warnings; the relay test is record-only.

## New slide types and per-type shape

`spec.SLIDE_TYPES` now also holds `objective`, `criterion_answer` (one written answer per scored tender criterion, word
budget from the criterion's weight), `measurement_plan`, `risks`, `competition`, `what_we_know` (investor). Tender gains the
`weight_share` warning and a "Share of our words" column on the response map. Agency decks gain risks (cards, at most four),
a competition slide and a measurement plan; with nothing recorded they are labelled placeholders. The investor profile
requires `why_now`, an objective at slide 2 and the scariest number disclosed before slide 8 (prompt guidance only, not
checked in code). An investor `why_now` or `what_we_know` slide with no ref anywhere on it (only a placeholder) is a gap:
it is `needs_human`, labelled "Gap to fill", and sits behind the Appendix divider (kept, outside the presented count and
limit); `run_deck` adds a supply card for it (`q_supply_why_now`, `q_supply_what_we_know`, `intake.GAP_CARDS`) to
`supply_questions`, and its text joins the questions slide. An answer to the card cites `answer:<qid>` and presents the
slide again. The app's `schema.json` does not yet describe these types.

## Supply cards, human-only fills, the confirm list and verify decisions

- `intake.supply_questions` writes skippable cards `q_supply_team`, `q_supply_credentials`, `q_supply_budget`,
  `q_supply_options`, `q_supply_decision_date` (`kind: supply`, `fills: <slide type>`), inside the five-question cap; they
  are in `report.json` `supply_questions`. The answer is `intake.answers.<qid>`.
- Team, credentials, investment and next-step slides are filled from the person's answer (`answer:<qid>`) or an attached
  document section (`doc:KEY#...`), marked `supplied: {basis, by, refs}`. Never invented; with nothing supplied they stay
  placeholders (ADR 0023, 0028).
- `meta.confirm` lists every proposal, every figure resting only on the person's own statement or a low-confidence pin, and
  every slide still needing a person, each with a stable `ref`. A verify decision is `intake.verified.<ref> = {by, at}`
  (the `verified` key of `--answers`). `meta.confirm_summary` counts `verified`, `supplied` and `sourced`.
- One untraced name or legal line no longer costs a field: it is kept and flagged (`kept_with_flag`, card
  `q_token_<field>`: Keep it / Remove it). An untraced figure is still dropped.

## Cost estimate

Each live stage records `usd`: the transport's figure, else tokens at `spec.PRICE_PER_MTOK`, marked `usd_estimated`.
`report.json` `usd_total` includes recorded stages priced the same way and `usd_basis` says it is an estimate. A reply that
is not JSON gets one repair call. Bench cost ranges are assumptions, plus or minus 30% (ADR 0032, proposed).

## Not built

- Running the engine from the app: the Build button saves the inputs and opens the recorded run. The
  runner (middleware tasks `build_deck`, `approve_gate`, `ask_change` in the template's
  `app/pipeline.yaml`) needs the server feature.
- Launching the Research Tool on a Strengthen yes (only the request is recorded).
- Attaching documents from the app (the display list is written by the host).
- The territory and idea gates' screens, and Edit beats and retry.
- File delivery for `exports`.
- Live (paid) model stages from the app: `--live` is a command-line option, run on request only.
- Live measures for the twelve craft fixes (ADR 0030 to 0032 are proposed), the app reading the Gate 1 payload, and the
  `schema.json` entries for the new slide types.
