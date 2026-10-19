# Deck maker: edge cases, bottlenecks and known failures

The register for making the deck maker never fail. Same columns and rules as
`docs/brief-maker/edge-cases.md`: every row has a repro and a status, and no client text goes in here
(name the input by its file stem or describe it).

- **Harness:** `deck` = `engine/deck/` (assemble, validate, render); `stages` = `engine/deck/stages.py`
  (model stages; run live since 2026-10-05); `inputs` = the brief object, research CLAN and client documents;
  `render` = python-pptx, LibreOffice, pdftoppm.
- **Kind:** `bug`, `drop` (input silently lost), `slow`, `cost`, `fragile`, `doc`, `env`, `gap` (the deck
  does not do its job).
- **Severity:** S1 wrong or lost content reaches the client; S2 degraded or silently unchecked; S3 slow,
  costly or misleading to a developer.
- **Status:** `open`, `fixed <commit>`, `xfail <test>`, `wontfix`.

Started 2026-10-02 on `integrate/jev-hardening`, from the thin slice (no model calls; stage outputs recorded
by hand in the design session and labelled STAND-IN).

## Requirements (hard gates for every run)

- **DREQ-01 (Sai): every slot filled.** A slide with nothing to say is not rendered; a human-only slide
  (team, credentials, investment, next step) carries a labelled placeholder: "Proposed (not given by the
  client): … To confirm: …". Validator `placeholder`.
- **DREQ-02 (Sai): every number traced** to a fact id, a client-document figure, a brief field, a
  requirement or a `calc:` of cited figures. Validator `numbers_trace`.
- **DREQ-03 (Sai): a rejected finding never appears.** Validator `rejected_used`.
- **DREQ-04 (Sai): every client requirement is answered by a slide** and listed on the requirement trace.
  Validator `requirement_map`.
- **DREQ-05 (Sai): one repair pass, then ship the best draft with the failed check shown** on the slide
  ("CHECK FAILED: …") and in `validation.json`.
- **DREQ-06 (Sai): never drop input.** Coverage of each input is in `report.json` (`coverage`).

## Found so far

| ID | Harness | Kind | Sev | What happens | Repro | Status |
|---|---|---|---|---|---|---|
| DK-001 | inputs | drop | S1 | The client tracker PDF is image-led: its text layer has the dashboard numbers but in scrambled order (5/4/6, 88/88/85 … unlabelled), so no extractor can tell which number is which. The brief maker read trust as 76% (it is 73% now; 76% was 2023). | `unzip -p Lumen-Water---Ireland.clan 'human/assets/.extracted/2_*'` | open: stage a2 (vision read of pages whose text is sparse or scrambled) designed; stand-in figures in `doc_facts.json` |
| DK-002 | inputs | gap | S1 | The research CLAN has no tracker figures at all (spontaneous awareness, prompted, trust, support): KPI baselines can only come from the client document. A deck from research alone has no baselines. | facts.yaml keys | open: a2 makes them `doc:` figures |
| DK-003 | inputs | fragile | S2 | Several research pins the brief leans on are `confidence: low` with no client document behind them (volunteer count, call length 28 min, 560,000 views); the reference brief flags them as unverified. | `validate` → `unverified_fig` on the proposition slide | open: warned and footnoted; the copy says "to confirm" |
| DK-004 | inputs | bug | S2 | One research pin for 350,000 calls a year is sourced to a page titled "50 calls per hour", and the client's own published figures differ (345k / 350k / 470k / 570k per the reference brief). Same number, conflicting sources. | sources appendix row for f_XZ6WJ2EX4KK6 | open: needs a contest in the research tool; the deck does not use it |
| DK-005 | inputs | bug | S3 | `generation_open_questions` repeat questions already in `loop2_brief.open_questions`: the questions slide listed two twice. | v1 slide 28 | fixed (dedupe in assemble) |
| DK-006 | deck | gap | S2 | Brief fields the engine left empty (desired response, competitor context on Lumen Water) have no slide; the storyline stage must fill them as labelled proposals. | brief `loop2_golden.fields.desired_response.value = null` | open |
| DK-007 | deck | gap | S2 | The engine brief's reasons to believe failed `supports_smp`; on a brief-only run (the short brief) the proposition slide falls back to them and is 151 words against a budget of 80. | `short-brief/v2` slide 6, CHECK FAILED | open: stage e (slide copy) repair pass |
| DK-008 | deck | gap | S2 | A brief that asks for **two** creative directions (the short brief) still gets one recommendation; the deck should present the top two as the client asked. | the short brief mandatories | open: stage c reads the requirement count |
| DK-009 | validate | fragile | S2 | Number checking licenses any number in a whole client document cited as `doc:<key>#section` (the RFT has hundreds of numbers). Too permissive for a cited section. | `refs.Resolver.numbers` | open: resolve `#section` to its span |
| DK-010 | validate | fragile | S3 | Structural numbers (slide numbers on the trace, "1 of 2" in a title) failed the number check. | v2 validation | fixed (basis `meta`, "continued") |
| DK-011 | render | fragile | S3 | Height estimates are conservative: tables carry blank space under short rows; long tables were cut off at the slide foot. | v1 slide 29 | fixed (trace split into 14-row slides); estimate still rough → stage h |
| DK-012 | validate | doc | S2 | The safety pack's banned phrases and the legal-lines pack were written from secondary summaries; each rule carries `verify: true` until checked against the primary text (Lumen Water media guidelines; Charities Regulator; ASAI). | `engine/deck/packs/*.yaml` | open |
| DK-013 | stages | cost | S3 | Stage a sends every document chunk to Sonnet; the RFT is 129k chars, mostly standard terms. | stages.requirements | open: Haiku scan to skip boilerplate sections, with the skipped spans listed in coverage (never silently) |
| DK-014 | render | env | S3 | `device_bash` cannot delete files in the connected folder; the PNG step tried to clear old slides and failed. | run_deck v1 | fixed (PNGs overwrite under `png/`) |
| DK-015 | inputs | gap | S2 | The brief's insight joins a sourced figure (56% say Lumen Water is their only support) to a hypothesis (self-comparison) in one sentence; the engine's own gate noted it "tries to say two things". The deck shows the human truth as the headline and the figure as evidence, but still prints the brief's sentence. | slide 7; `loop2_golden.fields.insight.gate_notes` | open: storyline stage restates the insight |
| DK-016 | env | env | S2 | In this session's sandbox `git status` created `.git/index.lock` and could not remove it, which would block every later git command. | `git status` from `device_bash` | fixed (lock removed; use `git --no-optional-locks status` from the sandbox) |
| DK-017 | stages | bug | S2 | Parallel live stages deadlocked in `brief_llm._stats_snapshot` (a non-reentrant lock taken twice). | eval batch, 6 decks in parallel | fixed (RLock in `brief_llm.py`, uncommitted on integrate/jev-hardening) |
| DK-018 | stages | bug | S2 | A stage reply wrapped in a ```json fence was rejected by the whole-object parse, losing the storyline. | bmw `b_raw.txt` | fixed (`brief_llm._loads_lenient` strips the fence first, uncommitted) |
| DK-019 | stages | env | S3 | `brief_llm` reads its CLI timeout at import, so long stages timed out whatever the env said. | stage d on a long brief | fixed (`stages._call` sets `CLI_TIMEOUT_S` >= 600 on the module) |
| DK-020 | deck | fragile | S2 | Live stage output shapes differ from the hand-recorded ones: null baselines, nested `answers_objection`, `doc:brief#` refs, several refs packed in one string, empty chart series. | the 6 live eval decks | fixed (`assemble._normalize`); new shapes go there |
| DK-021 | deck | bug | S1 | Text written for one client (a Lumen Water-only callout, territory ids like `t_reason`) reached other clients' decks. | eval round 1 | fixed (callout internal and Lumen Water-only; ids replaced by territory names) |
| DK-022 | validate | fragile | S3 | False positives: placeholder words counted toward budgets; a creative sign-off flagged as a repeated line; message matching failed on annotations and punctuation; times and ordinals in ad copy; $788K from a cited $0.788M; `rule_broken` firing on the trace slide that quotes the rule. | eval rounds 1-2, a seed-deck run | fixed (`spec.message_parts`/`norm_text`, n/1000 rule, trace and internal blocks excluded) |
| DK-023 | deck | bug | S2 | Identical slides were counted as one because `in` compared dicts by value. | `_arrange_pitch` | fixed (identity) |
| DK-024 | deck | gap | S3 | A brief that asks for two routes presents both territories, so the pitch reaches 19 slides (max 18); `pitch_length` only warns. | short-brief eval deck | open: Sai to decide whether two asked routes may exceed 18 |
| DK-025 | stages | gap | S1 | Model-written ad copy can add lines from outside the inputs (betting "18+" legal lines not in the brief or research), against the input rule (ADR 0023). | betfair eval deck | open |
| DK-026 | inputs | gap | S2 | Brief Maker read only the one-line prompt, not the attached founders' Keynote, so the brief contradicted the founders' deck in 8 places. The deck records the conflicts on an internal slide and lets the documents win. | a seed run: the brief archive vs the founders' deck PDF | open (fix belongs in the brief tool) |
| DK-027 | stages | bug | S3 | A live run that crashed lost its token usage, so its cost was unknown. | short-brief first run | fixed (usage persisted in each stage file) |
| DK-028 | render | gap | S2 | Nothing checks the rendered slides: `.pptx` animations have never been opened in PowerPoint or Keynote, web print-to-PDF is untested, and stage h is not built. | all runs | open (PLAN P2) |
| DK-029 | deck | gap | S2 | Without research, few headlines are supported by their evidence (fit judge 0-33% vs 57% with research). | eval round 2 | open |
