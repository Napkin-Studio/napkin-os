# ADR 0029 — Deck Maker: deck types as profiles, chosen by a question

Status: **proposed** (Claude, 2026-10-18, for Sai to confirm) · Builds on ADR 0016 (schema and stages), 0023
(input rule), 0028 (open inputs) · Feature: `features/deck-maker-intake.clan` · Code: `engine/deck/profiles.py`,
`engine/deck/profiles/*.yaml`, `engine/deck/intake.py` (`infer_type`, `type_question`, `chosen_type`),
`engine/deck/run_deck.py` (`--kind`), the type selector in `app/templates/deck-maker/index.html`.

## Context

Until now the Deck Maker built two shapes, an agency pitch and an investor seed deck, and chose between them
by a flag. The research in `docs/deck-maker/winning-pitch` (GUIDE.md, RUBRIC.md, rubric.json, NAPKIN-EDGE.md)
says that what wins is not one shape. The differences that matter:

- **A tender is scored, and a gate comes before the score.** A response that leaves a requirement unmapped or
  breaks a page or slide limit can be dismissed before quality is read (GUIDE.md section 2: the GAO decision
  B-418318, Brent and Wiltshire exclude on a fail). The build rule is one section per scored criterion, in the
  buyer's order, space proportional to weight, with a visible response map, and weights come from the buyer's ITT,
  never assumed (GUIDE.md 3.2). Scope fidelity matters too: work the buyer did not ask for earns nothing
  (WFA/EACA, GUIDE.md 2).
- **A client's own criteria outrank ours.** The same research shows buyers choose on thinking, then team, and
  that criteria relate to the subject of the contract. A fixed scoring split is therefore our guess.
- **A credentials or chemistry-meeting deck is a different artefact from a pitch** (GUIDE.md 3.1, 4.5): short,
  team and proof first, no territories, no idea, no price, questions for the client at the end.
- **An investor deck** follows its own story (problem, why now, product, market, traction, ask) and a different
  vocabulary, and is already built by stage `i` (ADR 0025).

Guessing the type from a short prompt would be wrong often and silently. The other tools in the OS ask before
they spend or assume (the question card of `docs/contracts/middleware-api.md` 8.3, the no-halt rule), so the
Deck should ask too.

## Decision

1. **A deck type is a profile: one data file, `engine/deck/profiles/<id>.yaml`.** Fields (checked by
   `profiles.validate_profile`; `profiles.load` fails loudly on any error):
   `id`, `label`, `one_line` (what the option shows), `kind` (the assembler, `spec.KINDS`), `arrange`
   (`legacy` keeps the assembler's own order, `spine` orders and filters by the profile), `spine` (slide types
   in order), `appendix`, `buyer_order` (slots re-sorted by the scored criterion each answers), `stages`
   (which model stages run), `length` (`max_slides`, `minutes`, optional `min_slides`, `respect_stated_limit`),
   `rubric_weights` (`basis`, `source`, `weights` over the nine criteria of `rubric.json` summing to 100,
   `adjustments` each with a reason), `strict` (validator checks that are errors rather than warnings),
   `prompt_guidance` (lines appended to a stage's prompt), `questions` (type-specific intake questions, each
   addressed to a brief field), `sources` (the research each choice comes from).
   Four profiles ship: `agency_pitch`, `investor_seed`, `tender_response`, `credentials`.
2. **A profile adds guidance, never content.** It may order and filter slides and add lines to a model prompt.
   It may not add a fact, a name or a legal line to a slide. The renderer and the profile never reword
   anything; model words are traced, cited and checked like any other (ADR 0023, 0028). `agency_pitch` and
   `investor_seed` use `arrange: legacy` and build exactly as before types existed.
3. **The type is chosen by a question, the first question of the check step.** `intake.infer_type` reads the
   prompt, then the documents, then the brief, in plain code with no model. It matches stated words
   (for example "invitation to tender", "scoring criteria" for a tender; "seed round", "investors" for an
   investor deck; "chemistry meeting" for credentials), weighted 1 to 3, and returns the type, a confidence
   and the exact words it matched. A type needs a score of 3; anything weaker is an agency pitch with low
   confidence and no evidence. `intake.type_question` then writes the question card
   `{id: q_deck_type, text, options: [{id, label, value, origin, source?}], allow_text, address: deck.type}`:
   the inferred type first with `origin: proposed` and its quoted evidence as `source`, the other three
   `asked`. The inference proposes; the person decides. The card is computed in code, so it exists with no
   model stage and always leads `a0.questions`, with up to four more, which may include the profile's own.
4. **Default and skipping.** An explicit `--kind` wins; then the person's answer (an option id, or typed words
   that name a type); a skip, or typed words that name none, builds the stated default, `agency_pitch`; with
   nobody asked it is also the default. The build never waits on the question. The deck records how the type
   was chosen at `meta.built_from.type` (`{id, label, source: flag|answer|skipped|default, note}`).
5. **Strictness per type.** `strict` sets which checks are errors and which stay warnings. A tender makes
   `requirement_map`, `rule_broken`, `criteria_map`, `pitch_length`, `message_carried` and `numbers_uncited`
   errors, because the research treats compliance as a gate. A credentials deck keeps only `pitch_length` an
   error and the mapping checks warnings, because there are usually no scored criteria to map. Agency and
   investor decks are unchanged.
6. **Weights are a default, not validated, and the buyer's replace them.** The nine-criterion split in each
   profile is our own judgement from `rubric.json`, adjusted with a stated reason per change; it is labelled
   `default, not validated` and no published study backs the numbers. When a tender's scoring (stage a) states
   a weight for every criterion, `profiles.weights` uses the buyer's weights (`source: brief`) and never ours.
   The result is written to `meta.weights`.
7. **One new type is one file.** Adding a type means adding `profiles/<id>.yaml` that passes
   `validate_profile`. `profiles.ids()` picks it up, the question card lists it, and `--kind` and the app
   selector are the only places that name the legacy four (`profiles.KIND_TO_PROFILE`,
   the app's `DECK_TYPES`); a new type that should be a `--kind` choice adds one line to the former.

## Consequences

- A tender response is held to the compliance gate and the buyer's order, so a thin response fails loudly
  rather than looking finished. A credentials deck is short and honest about its placeholders.
- The person always sees why a type was proposed, in the buyer's own words, and can overrule it.
- Existing agency and investor decks are byte-identical; the golden fixtures prove it.
- The research sits in the profile files as comments and `sources`, so a changed finding is a one-file edit.
- A type's guidance lines add prompt text and so a small, measurable cost per stage; they add no stage.

## Not decided

- Whether the default weights are right. They are a labelled guess until a study or the agency's own results
  support them; the rubric is a review aid, not a verdict.
- A fifth type (a tissue session, a one-page proposal, a pitch for a public body outside Ireland and the UK).
  The research names the tissue session as a separate format and does not describe it enough to build.
- Whether the type should also be inferred again from a later answer or a new document. Today it is settled
  once per run.
- Deck types for the spin-off path (`features/deck-maker-handoff.clan`): a brief carries no type, so the
  question is asked there too.
- Server wiring of the question into a running job (`features/deck-maker-server.clan`).
- Measuring on the seven-deck eval (`deck.evaluate`) whether per-type guidance improves scores. No model run
  has been made for types; none is claimed here.
