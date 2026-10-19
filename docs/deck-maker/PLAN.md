# Deck Maker: plan to production, and the thin slice

Claude, 2026-10-02, for Sai. Branch `integrate/jev-hardening`; nothing committed or pushed.
Everything below the thin slice is a proposal waiting for your go, one step at a time.

## 1. In one paragraph

Deck Maker turns the brief maker's brief, the research CLAN and the client's documents into the
deck an agency presents. The deck is data first (`deck.json`, one record per slide with its claims
and their source ids), then rendered to an editable PowerPoint and a PDF. Model stages do the
thinking (requirements, storyline, three territories, idea and executions, slide copy); plain code
does the rest (assembly, validation, rendering), so a deck can be rebuilt and re-checked for free.
A thin slice of that pipeline now runs end to end on Lumen Water and on the short brief.

## 2. What the thin slice is, and what it is not

**Built** (`engine/deck/`, untracked; ADR 0016 draft; edge-case register DK-001..015):

| Part | State |
|---|---|
| Deck schema (`deck.schema.json`, `spec.py`) | 24 slide types, word budgets, claims with refs, statuses; both decks validate against it |
| Inputs | brief object, research CLAN (94 facts, 8 findings with human decisions, 38 sources, 4 documents, 36 decisions), document figures; coverage reported |
| Assembler | agency structure (§3) from the stage outputs; requirement mapping; generated requirement trace and sources appendix; labelled placeholders for team, credentials, investment, decision date |
| Validators (code) | numbers trace, rejected findings, unverified low-confidence pins, word budgets, requirement map, category safety pack, legal lines, placeholders; 6 offline tests pass |
| Renderer | python-pptx, native charts from fact values, PowerPoint sections, speaker notes with fact ids, footnote keys, DRAFT watermark, "CHECK FAILED" flag; LibreOffice PDF; PNGs |
| Model stages | `stages.py` + prompts written, **not run** (no paid calls made) |

**Not a test of creative quality.** The stage outputs in this slice (requirements, figures read from
the tracker pages, storyline, territories, idea) were written by me in this session as stand-ins and
are labelled `STAND-IN` in the files and in the deck's notes. I had read the reference deck before
writing them, so they cannot be scored fairly against it. The real test is P1 below: live stages, then
`ref_check`.

**Results**

| Run | Slides | from source / drafted / needs a person | Validation | Wall time | Model cost |
|---|---|---|---|---|---|
| Lumen Water (brief + research + documents) | 31 | 8 / 18 / 5 | pass: 0 errors, 9 warnings | 4.9 s | $0 (recorded stages) |
| Short brief (brief only, no research) | 25 | 5 / 15 / 5 | 1 error shown on the slide (proposition 151 words vs 80: the brief's failed RTBs; the copy stage's repair pass fixes this) | 2.8 s | $0 |

Both .pptx files pass the pptx skill's `validate.py` (the checks PowerPoint enforces). Not yet opened
in PowerPoint or Keynote on your Mac: please do (acceptance a).

**What the slice found already** (from the register):

- DK-001/002: the tracker PDF's numbers are unreadable as text (scrambled order), and the research
  has none of them. The brief maker read trust as 76% (2023); the current figure is 73%. KPI
  baselines need a vision read of image-led pages: stage a2.
- DK-003/004: volunteers, call length and "560,000 views" are low-confidence research pins with no
  client document; one call-volume pin has conflicting sources. The validator flags them.
- DK-007/008: a brief-only run inherits the brief's failed RTBs; a brief that asks for two directions
  still gets one recommendation.

## 3. The deck structure (agency convention)

Opening · the brief in their words · how it is scored (tenders) · the real question · the gap chart ·
the barrier and the insight with evidence · audience and persona · the single thought, from → to,
RTBs, the objection · three territories · the recommendation · the idea and line · executions per
channel · channel roles · what the work must never do (safety, legal, tone) · measurement against
baselines · how we run it · timeline · investment options · team · credentials · the ask · open
questions · requirement trace · sources.

Against the reference deck, the strategy half still lacks (to add to stage b/d prompts and slide
types): language and adaptation (Irish language, reading age, WCAG AA, sound-off), sign-off and the
media advisory route, "what we will not claim", attribution design (regional phasing, read six weeks
after), the bereaved-by-suicide strand, an internal competitor map, and broadcast legal lines
(Coimisiún na Meán codes).

## 4. Stages, models, gates

| Stage | Job | Model, effort | Output |
|---|---|---|---|
| a | Requirements, scoring, page limits, rules; every document in 60k-char chunks, merged | Sonnet 5.5, medium | `a_requirements.json` |
| a2 | Figures from pages with sparse or scrambled text (vision) | Sonnet 5.5, medium | `doc_facts.json` |
| b | Storyline: reframe, evidence per slide, audience, insight, proposition, objection | Opus 5.5, high | `b_storyline.json` → **Gate 1: you approve** |
| c | Three territories; blind ranking by another model | Opus 5.5 high; judge Sonnet 5.5 low (Fable 5.1 for A/B comparisons) | `c_territories.json` → **Gate 2: a person picks** |
| d | Line, idea, 3-6 executions in the named channels, measurement, timeline | Opus 5.5, high | `d_idea.json` |
| e | Slide copy, one call per slide in parallel, word budgets, one repair pass | Sonnet 5.5, medium | into `deck.json` |
| f | Validators | code | `validation.json` |
| g | Render .pptx / PDF / PNG | code | files |
| h | Visual QA: fresh-eyes check of PNGs for overflow, overlap, contrast; fix in the generator | Sonnet 5.5, low (vision) | `qa.json` → **Gate 3: you review** |
| ref | Reference check against the reference (copy of `harness_2026_10_02/ref_check.py`) | Sonnet 5.5 | `ref_check.json` |

a and a2 run in parallel; slide copy runs in parallel batches.

## 5. Cost and time per run (estimate, to check against `/usage`)

Assumed prices, per million tokens: Opus 5.5 $5 in / $25 out, Sonnet 5.5 $3 / $15, cache writes 1.25×,
reads 0.1×. These reproduce the brief engine's recorded $3.41 for the same input within about 30%, so
treat them as ±30%.

| Stage | Lumen Water (228k chars, 94 facts) | Short brief, no research |
|---|---|---|
| a requirements | ~$0.30, 60-90 s | ~$0.03, 15 s |
| a2 figures (8 pages) | ~$0.10, 30 s (parallel with a) | n/a |
| b storyline | ~$0.70, 2-3 min | ~$0.30, 1.5 min |
| c territories + judge | ~$0.45, 1.5-2 min | ~$0.35, 1 min |
| d idea + executions | ~$0.45, 2 min | ~$0.35, 1.5 min |
| e slide copy (~30 calls) + repair | ~$0.70, 1.5 min | ~$0.50, 1 min |
| f, g render | $0, ~10 s | $0, ~5 s |
| h visual QA (2 passes) | ~$0.40, 1-2 min | ~$0.35, 1 min |
| **Total** | **~$3.1, ~11-13 min** of machine time, plus the gates | **~$1.9, ~6-7 min** (meets the 10-minute target) |
| ref check (Lumen Water only) | ~$0.15 | n/a |

jev is optional here (yes/no checks such as "does this sentence state a figure not in its refs"): at
$0.04 per million input tokens it adds under $0.05 a run.

## 6. Plan to production (each step: explain → trial → your go → commit)

| Step | What | Why | Estimate | Paid runs |
|---|---|---|---|---|
| P0 | Thin slice (this) | Prove the contract, validators and renderer before spending | done | none |
| P1 | Run stages a, a2, b live on Lumen Water; Gate 1 with you; then c, d; ref check | The real quality test; the slice's creative is a stand-in | 1 day | 2 runs ≈ $7 |
| P2 | Stage e (slide copy + one repair pass) and stage h (visual QA loop) | Word budgets and layout defects are fixed by the pipeline, not by hand | 1-2 days | ≈ $4 |
| P3 | Add the missing reference sections (§3) and fix DK-006/008/009/015 | Strategy at the reference's level | 1 day | ≈ $4 |
| P4 | Napkin app template `app/templates/deck-maker/` (schema, `pipeline.yaml` with `draft_deck@1` and `regenerate_slide@1`, context, requirements, a viewer using `clan-fields`), `app.spinoff: {accepts: [brief-maker], upstream: true}`, the middleware handler, slides as client-review parts; a spin-off test beside `crates/clan-sdk/tests/spinoff.rs` | The deck becomes a CLAN in the chain research → brief → deck | 3-4 days | none |
| P5 | Brand master: render onto the agency .potx; fonts; a designer pass | Designers edit their own layouts | 1-2 days once the master exists | none |
| P6 | Production on AWS: a container with LibreOffice and the fonts; Claude through an API key or Bedrock (the CLI login is for this Mac, not a server); S3 for outputs; a job queue for the long stages; cost and token logging per run; a 5-brief eval set with a noise line | Runs without your Mac, measured | 3-5 days | eval ≈ $15 |
| P7 (optional) | Media for executions: temp VO, animatics, mood images, each logged with model and licence | Richer tissue sessions and work slides | 2-3 days | per use |

**Status, 2026-10-06** (details in the feature records under `features/`, failures in `edge-cases.md`):

| Step | Status |
|---|---|
| P0 | Done |
| P1 | Mostly done: stages a-d and the fit judge ran live on 6 mock briefs (2026-10-05, about $0.65-1.25 a deck). Lumen Water stages are still hand-recorded stand-ins, a2 is not built, and Gate 1 (storyline sign-off) is not built |
| P2 | Half done: stage e (copy tightening, one call) is built and run; stage h (visual QA) is not |
| P3 | Partly done: pitch format (ADR 0024), scoring, innovation and measurement slides added; DK-006/008/009/015 still open |
| P4-P6 | Not started |
| P7 | Not started; question 3 (non-Claude media) still open |
| Added | Investor deck kind and client documents (ADR 0025); web and HyperFrames renderers (ADR 0026); the input rule (ADR 0023); `deck.evaluate` and a 7-deck eval |

## 7. Tools you have, and where each fits

| Tool | Use in Deck Maker | Recommendation |
|---|---|---|
| Claude Code login (CLI) | All model stages today, via `brief_llm` | Use now; switch to API or Bedrock for P6 |
| AWS | Hosting (P6); Bedrock serves Claude, so the Claude-only rule holds | Yes, P6 |
| jev | Cheap yes/no checks beside the code validators | Yes, P2, optional |
| ElevenLabs | Temp voice-over for audio-script executions, embedded in the slide | P7; stock voices only, never a real person's clone; label "temp VO, not final" |
| Runway | Animatics or mood motion for the chosen territory's video execution | P7; after Gate 2 only; label "illustrative"; log licence |
| Image generation (Bedrock image models, Firefly) | Key-visual sketches | P7, and needs your call: the Claude-only rule covers text; images would need their own rule. Prefer a licensed, indemnified source for client-facing work |
| Google Drive (connected) | Upload the .pptx; Drive converts to Google Slides when a team works there | Optional delivery route |
| Slack (connected) | Post the review link and the report at each gate | Optional |
| Figma (official MCP, not connected) | Designers' route if they insist; needs a Full seat; no custom fonts or images via the MCP yet | Later |
| Canva | Brand templates need Pro, autofill needs Enterprise | Later |
| Gamma | Fast, but it picks the layout and drops traceability | No |

## 8. Questions that change the design

1. Is there an agency brand master (.potx), with fonts and colours? Without one the built-in theme is used.
2. Pitch decks first, or a credentials deck too?
3. Images and audio: may non-Claude generators be used for illustrative media (P7), with licence logging, or does the Claude-only rule extend to them?
4. May I run P1 live on Lumen Water (about $7 for two runs, ~25 minutes)? Please check `/usage` first.
5. Where should the code live long term: `engine/deck/` (shares `brief_llm` and the outputs folder) or its own package?
6. When a brief asks for two creative directions, present both as recommended (my default), or one plus an alternative?

## 9. To approve in bulk

| # | Item | Proposed |
|---|---|---|
| 1 | Keep the deck schema and stage design (ADR 0016) | yes |
| 2 | python-pptx as the renderer, .potx master when supplied | yes |
| 3 | Commit the thin slice locally (code, schema, packs, tests, ADR, register, plan; no client material, outputs stay git-ignored) | after your review |
| 4 | Run P1 live | after your `/usage` check |
