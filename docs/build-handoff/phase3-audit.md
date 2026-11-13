# Phase 3 audit (read-only), 13 Nov 2026

Read from `spike/fabletest` at `ba6da21b` (it already holds `chore/merge-develop`, so `origin/develop` at fetch time is inside it).
Nothing was built, run, installed or written in any repo. Outside repos were read through `gh api` (names, trees, READMEs) only. No `.env`, `client_briefs/`, Cannes, Effie or WARC content was opened.

Status words: **built** = meets the prompt's acceptance wording on the integration branch; **partly** = a real part exists (named); **absent** = nothing but, at most, a door or a record.
Score: 25 Phase 3 items, **0 built, 11 partly, 14 absent**.

---

## 1. The Phase 3 list, with the prompts' own words

### What decides scope

`docs/napkin-os-build-prompt-v3.1.md` section 9, the phases table:

> Phase 3: production and the business end | v2 section 10, Phase 3, using the v3 shopper, film and tier detail | **J001 has a scored still, film, radio spot, poster and format pack**

Section 1: v3.1 wins; "Where v2 and v3 differ and this prompt is silent, v2 decides product behaviour, and v3 decides repo facts, providers and tool repos."
Section 12 (what v3.1 replaces) touches Phase 3 in these rows only: v3 "Estimates and job costing" is covered by "the Scope, estimates and invoicing tool"; the Spark rows (Judge and the night watch run in the EU cloud; the Spark does research and tuning on telemetry only); the Cannes rows; v2 key-storage row (Secrets Manager). Nothing in section 12 removes a Phase 3 tool.
v3.1 section 4: "Paid calls stay off and the product cap stays at 0 euro until Laurence raises it at a gate. Then follow v3 Models and cost control: Sketch, Standard and Hero tiers; the cost ledger with list price and actual charge; an alert at 80 percent of a job budget; a run past a cap is refused unless a named person overrides it. Re-read provider rates live before quoting a run. Never claim a provider works unless you saw it work."
v3.1 section 6 restores "Scope, estimates and invoicing ... It is a Phase 3 tool, not a suggestion", "Craft review by a named senior creative before any piece reaches the client", "Traffic board".
v3.1 section 10 rows that bite Phase 3: Art Director Tool "Test it. Wrap it if it runs. Rebuild the Stills canvas in Phase 3 if not"; Recipe runner "The Production Tool harness, with each recipe as a template"; Credits "Billed at cost per job ... Each run shows its price first"; FLUX "On the Black Forest Labs key, through the router"; "New video model, dictated as Elorna: Not added until its name, provider and terms are confirmed"; EU AI Act "Build both label styles and machine-readable marks. No pilot goes live without the legal view".
v2 section 10 Phase 3 row: "Stills canvas, Film, Radio, Outdoor in situ, Formats (12 formats in v1, as both ad repos are empty), Animation and motion design. Scope, estimates and invoicing, Traffic board, Craft review". Gate in v2: "J001 has a scored still, film, radio spot, poster and format pack".
v2 "v1 is done" (the end goal): "One product photo becomes a campaign still, a 10-second film and a full digital format pack. The copywriter's radio script becomes a voiced MP3. The poster is shown in situ on a real site. ... All of it is scored by Judge and shown on the dashboard."
v2 section 6 table: every tool "hands work on with one button: Send to Judge, Send to Formats, Send to Presentations".

### The 25 items

Sections are v2 section 6 tool entries ("v2 s6") and v3 sections ("v3 Tools", "v3 Models", "v3 Shared engines"). "Acceptance" is the prompt's own "Good looks like" line.

| # | Item | Where the prompt puts it | Acceptance wording | Status |
|---|---|---|---|---|
| T1 | Scope, estimates and invoicing | v2 s6 (Phase 3, "New, on AI timesheets"); v3.1 s6 | "Ask for a fourth round on a three-round job. A change order is drafted, and the work waits for approval." Also: hours from confirmed timesheets become invoice-ready lines, each linked to its source, agency rate card, CSV export | absent |
| T2 | Traffic board | v2 s6 (built from napkin-timesheet-traffic) | "A traffic manager staffs a new job from the board in under a minute." Rules: suggestions only, never scores people | absent |
| T3 | Craft review | v2 s6 | "Every piece on the client link shows the name of its craft reviewer." Each note names the exact fault and is an attributed verdict decision on the exact version | absent |
| T4 | Stills canvas: scamp to photograph to formats | v2 s6; v3 "Art director" | "Highly visual. The canvas fills the screen ... an art director goes from a doodle to a finished campaign photograph without typing a prompt. Type is never generated inside an image." Five steps: scamp, image, photograph, edit (GPT Image 2.5 / FLUX 3), formats. Also motion from a still | partly |
| T5 | Film: script to storyboard to film | v2 s6; v3 "Film" | "A creative team sees a storyboard the same day as the script, and a rough film the next." Steps: script from Script editor, storyboard with consistent characters, shots plus sound design, edit in words, variations | partly |
| T6 | Animation and motion design | v2 s6; v3 | "An animated end card or social ad comes from an approved layout in minutes, then goes to Formats." Kinetic type, logo stings, character animation, "slower in, snap at the end" | absent |
| T7 | Radio | v2 s6; v3 "Radio" | "A copywriter hears a draft spot within a minute of finishing the script." Timed 10, 20, 30, 40 s; keys server side; writing model through the router; voices through the router | absent |
| T8 | Outdoor in situ | v2 s6; v3 "Outdoor" | v2: "The client sees the poster on a real Dublin site, labelled as a mock-up." v3: "... on a Dublin street and believes it." 48 sheet, 6 sheet, bus shelter, station panel, digital screen; perspective, day and night; safe area and legibility at distance | absent |
| T9 | Formats (digital ads) | v2 s6; v3 "Digital ads" | v2: "J001's 12 formats export as one checked pack, and a human only looks at the ones flagged." Cap 12 in v1, design allows 60 (v3 says 60). Real platform frames, safe zones, variants for testing | partly |
| E1 | Model router | v3 Shared engines 2; v3 Models "Route by job, tier and budget" | Reads task, tier, brand rules, job budget left, each provider's free credit left; "falls back cleanly when a provider is down or out of credit, and it never fakes a success"; learns cost per kept asset per model | partly |
| E2 | Cost engine | v3 Shared engines 3 | "Prices every run before it starts, shows the credits on the button, refuses a run past the agency's monthly cap." Keeps estimated, committed and actual separate | partly |
| E3 | Three tiers Sketch, Standard, Hero | v3 Models "Three tiers for every creative job" | "A person picks the tier in plain words; the router picks the model." Rate table (Nano Banana 2.1 ~4 credits a still; Gen-4 Turbo 5/s; Gen-4.5 12/s; Kling 4.0 15.7/s; Veo 3.1 20/s; Seedance 2.5 30/s; Magnific 25 to 150). "Escalate only what is kept." "Re-read them live before quoting a run." | partly |
| E4 | Cost ledger | v3 Models "The cost ledger" | "Every model call writes one line: provider, model, tier, units, list price, actual charge, job, person and the decision-chain entry it belongs to." Dashboard shows spend by job, client, provider and tier, cost per kept asset, free credit left with end date | partly |
| E5 | Result cache ("Never pay twice") | v3 Models | "Cache by a hash of model, prompt, seed and inputs, and reuse a result instead of regenerating it." | absent |
| E6 | Job budgets, 80 percent alert, named override | v3 Models; v3.1 s4 | "An alert goes out at 80%. A run that would pass the job budget or the agency cap is refused unless a named person overrides it, and the override is logged." Agency monthly credit cap (v3 data model, Agency record) | partly |
| E7 | Recipe runner | v3.1 s10; v2 s12 | "The Production Tool harness, with each recipe as a template. Recommend in Discovery." Discovery recommended Napkin's own runner on the harness's queue, sheets and lineage, about 3 weeks | absent |
| E8 | The six v1 recipes behind the Add door | v2 s6 Stills; v3 | Clean Packshot, Product Campaign Image, Product Ad, Product UGC, Product Turntable, Format Flip | absent |
| E9 | Export with AI labels and machine-readable marks (both label styles) | v3 Shared engines 6; v3 EU AI Act; v3.1 s10 | "Exports carry an AI-generated label." "A persistent label on images and video, an opening disclaimer on video, an audible line on audio. Record on every asset whether it is fully AI-generated or AI-assisted." Napkin adds its own provenance on export | absent |
| E10 | Per-asset provenance | v3 Hard rules | "Every asset keeps its model, seed, prompt, inputs and credits." | partly |
| E11 | Judge scoring of still, film, radio, poster, format pack | v2 s7; v3.1 s6; gate wording | Score out of 30, "Judge advises, the creative director decides"; the gate needs a "scored" still, film, spot, poster and pack | partly |
| E12 | Audio engine: voices, music, effects, mix | v3 Radio and Film ("sound design"); v3 Models sound column | ElevenLabs studio voices, music bed, final mix; radio spots timed to length | absent |
| E13 | Capability sheets and clients for the other providers (ElevenLabs, Black Forest Labs, Luma, ByteDance direct, NVIDIA, World Labs) | v3 Models table and "Also in reach"; "Add each to the router with its own capability sheet" | Each provider added with its own sheet | absent |
| E14 | Media rules: no type inside generated images; no UGC or real-face recipe for an alcohol client without legal sign-off and a consent record | v3 Hard rules | Headlines, prices and mandatory copy set in layout with the locked font | absent |
| E15 | Client review of Phase 3 pieces (a client spec for the Phase 3 document types) | v2 s4 client review link; v2 s6 Craft review ("before any piece reaches the client review link") | Client sees image, film, audio pieces one at a time with the craft reviewer's name | partly |
| E16 | Asset library | v2 s12 "Suggested tools, not yet decided"; Discovery audit says "Yes, from Phase 3: every approved still and film must be findable" | Every approved asset findable by client, product, format and date, with rights and expiry. Not a decision in v3.1 | absent |

(E16 is the only suggested, not decided, item. Without it the count is 24: 0 built, 11 partly, 13 absent.)

Not Phase 3, so not counted: Shopper stands, Experiential, Presentations, Case study builder, Compliance night watch, Job memory (all Phase 4); Judge, Script editor, Idea room, Approval route, client review link (Phase 2, built).

---

## 2. What exists, per item

### The two Production lines (read this first)

The Production Tool exists in **two incompatible states**:

| | `spike/fabletest` (and `origin/develop`) | `origin/feat/make-and-edit` (top of the PR stack) |
|---|---|---|
| Base | develop snapshot of 13 Oct (`209c602e`) plus 3 later develop commits, plus fabletest harness work | same 13 Oct base, plus 457 commits (432 in `feat/production-tool-v2`) never merged into develop |
| `production-tool/` size | relay 123 files, web src 153 files | relay 206, web src 508, plus `production-tool/canvas-engine/` (our own canvas, 54 files), `docs/production-tool/` ui mocks and benches |
| Spend control | `server/napkin/spend.py` and its relay copy `production-tool/relay/director/spend.py` (euro, per environment day cap, per-run cap, pause switch, in memory per process; `providers/runway.py:281` calls `spend.check` before every submit) | `relay/ledger.py` (USD; global total plus per-agency month `spend#<tenant>#<YYYY-MM>`; atomic admission; `features/tenant-limits.clan`, verifying). **No `director/spend.py` on this line** |
| Providers | `providers/runway.py`, `mock.py` | same two, but `runway.json` sheet lists 16 models and 11 ops |
| Overlap | 54 files changed on both sides since the base, including `crates/napkin-web/src/{api,lib,main}.rs`, `production-tool/relay/{service.py,providers/runway.py,director/model.py}`, `clan-store/src/store.ts`, `infra/modules/services/*`, `scripts/check.sh`, `docs/contracts/os-layer.md`, `features/script-editor.clan` | |

Open PRs: **#124** `feat/connected-video-2` into `feat/production-tool-v2` (+5,466/-251, 66 files; shots that join, one take, landing frames, join marks); **#129** `feat/make-and-edit` into `feat/connected-video-2` (+28,612/-2,691, 208 files; Make and Edit rooms over one Bin, Change this drawer, V1 timeline, remake with one change). `feat/production-tool-v2` itself has no PR (merged sub-PRs such as #78, #95, #97, #102 went into it). Last commit dates: v2 16 Oct, connected-video-2 19 Oct, make-and-edit 21 Oct.
Both branches are the Production code to read for "what the tool does". They have none of Phase 1/2 (no client wall, no spend guard, no EU pin, no attributed-write rule). Build on neither without a merge plan.

### Per item

**T1 Scope, estimates, invoicing: absent.** Door `scope-estimates` and `Money` role group (`crates/napkin-web/src/roles.rs:153,225,263,571-630`; producer, account-service, management, traffic; 403 for others; paths `/jobs/{n}/scope|estimates|invoices|change-orders|time-money`). `roles.rs:572`: "no route writes it yet". Job `budget_hours` only (`crates/napkin-host/src/jobs.rs:102`). No template, no rate card, no scope or change-order record, no invoice lines, no CSV. Underneath: timesheet sessions (`crates/napkin-web/src/timesheet.rs`, `features/timesheet-sessions.clan` status building; `timesheet-signals` exploring). `align-confidential-prices` (designed, not built) adds `set_budget` decisions and removes budget screens.

**T2 Traffic board: absent.** Door `traffic-board`, role `traffic` (read-only variants). No capacity, no board. Outside: `larryob78/napkin-timesheet-traffic` is a local Python prototype with a traffic engine (matching, allocation, 37.5 h capacity, scope_changes, approval_delays, explained_risks) on made-up data; `napkin-timesheet` is a README only.

**T3 Craft review: absent.** Door `craft-review` (`roles.rs:194,213`). The `verdict` decision kind exists (`crates/napkin-host/src/ops/decisions.rs`, `crates/napkin-web` `/verdict` route) but nothing names a craft reviewer or marks a piece.

**T4 Stills canvas: partly.**
- On fabletest: Production canvas, character and storyboard stages (`production-tool/web/src/stages/{Character,Storyboard,Video}.tsx`), ops `generate, view, frame, region_edit, clip, clip_edit` (`contracts/capabilities/runway.json`), region package (`relay/region/`, pastes the original back outside the box because Runway takes no mask).
- On make-and-edit: ops `frame_edit, upscale (magnific_precision_upscaler_v2), resize`; image editor with brush, lasso and layers (`features/image-editor*.clan`, building and verifying); `typeset.py` (type drawn as layers with Pillow, never sent to a model); `canvas-engine/`; `art-boards`, `canvas-nodes` (verifying).
- Missing against v2: scamp-to-image that keeps layout, the "photograph" finish step, GPT Image 2.5 and FLUX routes (no sheet; Runway sheet carries Gemini 3 Pro and 3.1 Flash, Ideogram 4.5, Seedream not present), locked type and logo from a brand kit in the still itself, the six recipes, being a `.clan` template in `app/templates` (none exists for it), Judge, hand-off buttons. `larryob78/napkin-art-director` not wrappable (see section 4).

**T5 Film: partly.**
- fabletest: `app/templates/advertising-studio/` (index.html 127 KB, schema, `pipeline.yaml`, `EXPORT-CONTRACT.md`): script revisions with beat ids, shots, blocking, takes, audio cues, approvals; Discovery audit: "a screen and a contract. No backend in this repo makes anything for it". No feature record. Production video stage on Runway (`veo3.1_fast`, `aleph2`), `production-tool/stitch/stitch.py` (ffmpeg end card).
- make-and-edit: `connected.py` (one take, landing frames), `cutdowns.py`, `timeline_layers.py`, `time_rules.py`; features `connected-video`, `make-and-edit` (building), `clip-quality`, `clip-moment-edit`, `runway-video-models` (WAN 3, Seedance 2.5, Kling O3/3.0, Omni Flash 1.1, Hailuo 3).
- Missing: sound design (see E12), TV script hand-off from Script editor to Film (Phase 2 test 56 sends "with its beat ids" but nothing receives it), Director3D, Production Amplifier, running inside the shell (`/production` route lives only on the v2 line via `features/os-sign-in.clan`, verifying; no `/production` in fabletest `crates/napkin-web`).

**T6 Animation: absent.** No code. v2 line has only an end card stitched from PNGs (`stitch/endcard/`) and `typeset.py`.

**T7 Radio: absent in napkin-os.** Door `radio` only. `features/radio-bridge.clan` on the v2 line is "designed" and says in done_when "Nothing anywhere calls Radio: a test fails if production-tool ... contains 'napkin-radio' or 'vercel.app'" (a manifest import/export and a `radio_cut` op, not a Radio tool). Phase 2 script editor has a "send to Radio" button with no destination. Outside: `napkin-radio` parser, quality gate, MP3 stitch are reusable logic; it writes on Gemini and Groq and voices on ElevenLabs, not through any router.

**T8 Outdoor: absent.** Door only (`formats-in-situ`). `idea-to-ooh-studio` is a film previz app; no outdoor code. v2 line `campaign-formats.clan` lists "Show in place mock-ups (licensed mock-up photos with fixed corners, labelled Mock-up)" as phase 7, not built.

**T9 Formats: partly (v2 line only).** `relay/formats.py` (crop and layout banner are free; extend via Ideogram 4.5 and regenerate via Gemini 3 Pro are paid), `typeset.py`, `cutdowns.py` (15/10/6 s cutdowns and 9:16, 4:5, 1:1 re-aspect via Aleph 2), web `campaign/crop.ts` and `layout.ts` tested against `contracts/examples/crop-cases.json`; `features/campaign-formats.clan` status building; paid tests CF-T1..T6 (about $9) not run on a non-owner stack. fabletest has only the Advertising Studio formats stage (screen, no backend). No platform frames of real Meta, TikTok, YouTube, LinkedIn; no 12-format J001 pack; no Judge check.

**E1 Model router: partly.** Text only: `server/napkin/model_routes.py` (purposes to model, effort, EU pin, aliases; `model_route_exceptions.json`, none listed). Media: Production capability sheets (`runway.json`, `mock.json`) and `features/model-choice.clan` (verifying; choose model per step; `fallbackOnly`). Two separate interfaces (middleware generation port, relay `Provider` Protocol at `providers/base.py:93`; the relay holds a copy of the routes file, `director/model_routes.py`, kept in step by a test). No router across providers, no tier or budget input, no free-credit-left input, no cost-per-kept learning. `server/napkin/capabilities.py` is a different thing (feature flags).

**E2 Cost engine: partly.** `spend.allow(amount, env, run)` is the one question before a paid request, callers: `server/napkin/model.py:159`, `judge/core.py:307`, `jev.py:58`, `websearch.py:372`, relay `director/model.py:160`, `providers/runway.py:281`. Its own docstring: "the cap is per task until the cost engine (Phase 3) keeps one ledger. That engine can implement allow() with this signature." Missing: prices before a run reach a screen, one durable ledger, agency month cap (exists only as `relay/ledger.py` on the v2 line), tier. Per-tenant `crates/napkin-web/src/meter.rs` is a quota counter in process memory.

**E3 Tiers: partly (v2 line, video only).** `features/clip-quality.clan` (building): Draft, Standard, Final per clip model with a quality map in `runway.json`. No Sketch/Standard/Hero concept for stills, sound, 3D; no "pick in plain words".

**E4 Ledger: partly.** Contract fields estimate, reserved, confirmed in USD (`production-tool/contracts/common.schema.json`); relay reserves at submit, confirms on completion. v2 `ledger.py` keeps counters, not lines. No list price beside the charge, no tier column, no per-line decision link. Designed (approved, not built) in `features/align-confidential-prices.clan`: a `run_cost` decision `{document, version, task, route, estimate_eur, charged_eur, guard, at}`, read by the Decisions drawer "and, later, the cost engine". Its own risk line: "The run_cost decision is shaped for Judge and the cost engine of Phase 3 needs another shape."

**E5 Cache: absent.** Lineage only (`parent_ids`, `input_hashes` in `contracts/document.schema.json:145`). Anthropic prompt caching exists for text.

**E6 Budgets: partly.** v2 line: agency monthly cap (`tenant-limits`: `capUsdMonthly`, admission refused with `limit_reached`, "Caps are off by default"). fabletest: day and run caps by environment (`NAPKIN_SPEND_CAP_EUR`, `NAPKIN_SPEND_RUN_CAP_EUR`, `NAPKIN_PAID_CALLS`; `infra/envs/uat/main.tf:304` sets 10 and on). Absent: money budget per job, 80% alert, named-person override with a log. Job budget is hours.

**E7 Recipe runner: absent.** Discovery: "Is the Production Tool harness the recipe runner? No ... no saved named recipe, no step graph and no runner that executes steps in order. The browser drives one step per click."

**E8 Six recipes: absent.** Names appear only in `docs/production-tool/model-research-2026-10-13.md` and `runway-catalogue-2026-10-15.md` and one CSS file; no code.

**E9 AI labels and marks: absent for media.** No label in any export path (`crates/napkin-host/src/export.rs`, `app/templates/*`, production `export.ts`). The decision chain records which agent wrote each change (`edited_by`, agent, action), the base for "who made it". One AI-related hit on v2 is a Runway schema fixture.

**E10 Provenance: partly.** Document schema keeps op, state, parent_ids, input_hashes; model and seed on the job; clan-store `attribution.ts` writes one attributed entry per finished job into a real `.clan`. No credits per asset; Discovery on Art Director Tool: "No per-asset provenance record".

**E11 Judge: partly.** Built: `crates/napkin-host/src/ops/judge.rs`, `judge_rubric.json` (v1 draft, 50 tests), `server/napkin/judge/*`, `handlers/judge_work.py`, routes `/judge`, `/judge/overrule`, `features/judge.clan`. **Rubric kinds are `script`, `idea_route`, `visual_brief` only.** No kind for still, film, spot, poster or format pack; trust state is `none` (BUILD-LOG: "no calibrated score exists"); no vision or audio input; "No model returns a number" (answers are yes/no per test). `Jude` as a Production house agent exists in the v2 UI line (check on a node), a different thing.

**E12 Audio: absent.** v2 line has eight records, all `designed` and none coded: `audio-contracts, audio-director, audio-elevenlabs, audio-mix, audio-music, audio-native, audio-ui, lipsync`. Neither line has `providers/elevenlabs.py`.

**E13 Other provider sheets: absent.** Sheets: `runway.json`, `mock.json` only (both lines). The hackathon-era fal and HeyGen adapters were removed (`features/drop-hackathon-extras.clan`, git tag `hackathon-2026-10`).

**E14 Media rules: absent as rules.** "No type in images" is honoured by design on the v2 line (`typeset.py`, campaign-formats done_when "no text is sent to an image or video model") but not enforced as a gate. Alcohol UGC/real-face gate: none (`features/licence-gate.clan` is about dependency and model-weight licences, a different thing).

**E15 Client review of pieces: partly.** Mechanism built and hardened (`crates/napkin-host/src/ops/client_pieces.rs`, `client_review.rs`, `crates/napkin-web/src/client_link.rs`, routes `/client-link/*`, `/client-review/*`): a piece is an image, film or audio, hashed by the host, allow list only. It serves only three document types: Brief Maker, Visual brief, Script editor (`client_pieces.rs:25,138,152`). A "document type with no spec gets no link": Advertising Studio and Production documents get none.

**E16 Asset library: absent.** Host `library.rs` is the document library, not an asset library. The relay's `library.py` is the Production team library (hackathon-era).

### Also on the integration branch and used by every Phase 3 run

- Jobs: `crates/napkin-host/src/jobs.rs` (registry: number, client, owner, title, dates, budget hours; stage read from decisions in `jobindex.rs`). Runs tracker `runs.rs`. Decisions `ops/decisions.rs`, versions `ops/versions.rs`, approval route `ops/review.rs` and web `agency.rs`/`needs.rs`, client link, Judge as above.
- Middleware jobs: `server/napkin/jobs.py` (in-memory, brief and research only), `registry.py` (handlers), `pipeline/`.
- Infra: `infra/envs/{hackathon,staging,uat}`, modules `services` (carries `NAPKIN_SPEND_CAP_EUR`, `NAPKIN_PAID_CALLS`), `storage`, `tenant-databases`, `rag-host`. The Production relay is deployed only from the hackathon env (`infra/envs/hackathon/lambda.tf`, secrets `RUNWAY_API_KEY`, `ANTHROPIC_API_KEY`, `TOKEN_SECRET`; `.github/workflows/deploy-production-tool.yml`). No Production relay, no media bucket and no media provider secret in staging or uat. Nothing is applied to AWS (BUILD-LOG).
- Doors for all Phase 3 tools exist as Empty states (`app/src/components/states/doors.ts`, `roles.rs`): `scope-estimates, traffic-board, craft-review, stills, video-motion, radio, formats-in-situ`.
- No Phase 3 feature record, no Phase 3 acceptance list (`docs/design/phase2-acceptance.md` is tests 19 to 73) and no Phase 3 design exists (BUILD-LOG 12 Nov: "design Phases 3 and 4 (not started)").
- Production records on fabletest (status): `production-tool` building, `-clan` building, `-harness` building, `-seam` building, `-ui` building, `-look` building, `-infra` building, `-dogfood` verifying, `model-choice` verifying, `default-models` verifying, `provider-reference` verifying, `canvas-arrow-cards` building, `canvas-solid-refs` building, `production-tool-own-keys` abandoned. Most "wait on Shrey's review".

---

## 3. Branches

| Branch | Position | Adds beyond fabletest |
|---|---|---|
| `origin/feat/production-tool-v2` (no PR; integration branch) | 432 ahead of develop, forked 13 Oct, last 16 Oct (#111 video versions) | 54 new feature records (list in section 2 and below), canvas engine, image editor, audio designs, campaign-formats, tenant-limits (ledger), os-sign-in, relay-durable-jobs, licence-gate, Runway sheet sync, 16-model sheet |
| `origin/feat/connected-video-2` (PR #124, base v2) | +18 commits over v2 | One take, landing frames, join marks, clip-quality, take cuts, document schema +137 lines |
| `origin/feat/make-and-edit` (PR #129, base connected-video-2) | +7 over #124 line (457 total) | Make and Edit rooms, `docs/production-tool/make-and-edit.md`, `features/make-and-edit.clan`, migrate.ts, integrity.ts, patch.ts, timeline compile |

Records only on this line (statuses read from `features/*.clan` on make-and-edit): verifying: art-boards, canvas-nodes, image-editor-masks-layers, licence-gate, tenant-limits, clip-moment-edit, relay-durable-jobs, frame-aspect, os-sign-in. building: campaign-formats, image-editor, production-ui, runway-video-models, connected-video, make-and-edit, clip-quality, resize-selection. designed: all eight audio-*, canvas-engine, lipsync, model-swap, radio-bridge, production-tool-overhaul. exploring: tenant-ops.

**Which Production code is current:** for the tool itself (UI, relay features, formats, ledger), `feat/make-and-edit` is the newest and a superset of the other two. For the platform rules (spend guard, EU pin, attributed writes, client wall) fabletest is current and v2 has none. No one has tried the merge: 54 overlapping paths (listed above). Shrey's Deck/Production UI prompt says the same ("check origin/feat/production-tool-v2 and say which code is current") and also says "Production's canvas engine, relay, contracts and collaboration stay as they are".
Also on this machine: the `napkin-studio-os` checkout (branch `spike/award-data-fit`) has an untracked `production-tool/canvas-engine/` folder, the same engine.

---

## 4. Outside repos

All 18 repos in `docs/sources/repos.md` answer to `gh repo view` from this login (access list now all "yes"; 11 were granted 11 Nov, after Discovery). The 7 Discovery clones are in `~/Projects/Work/work/napkin/discovery-scratch/` (`napkin-art-director, Resize, napkin-radio, Napkin-audio, idea-to-ooh-studio, awards-board-maker, Socials-ads-maker-`). The other 11 have no local clone; I read their trees and READMEs only (no tests run, nothing cloned). Not found: `larryob78/NAP` (v2 and v3 name for this repo), `larryob78/napkin-advertising-studio`, `larryob78/napkin-cannes-dataset` (names only; never opened).

| Repo (size, last push, language) | Readable | What it is | Wrap as is? |
|---|---|---|---|
| `larryob78/napkin-art-director` (30.9 MB, 24 Oct, JS) | yes, cloned in Discovery | Vanilla JS canvas editor, lasso masks, Runway generate, edit, upscale, 13-preset ad formatter, drawing board; one Node server port 8766; no package.json. START HERE.md says "not a production-ready app", AMBER. 80 tests, 77 pass, 3 skipped. Providers BFL, Runway, OpenAI, NVIDIA. Georgia and dark greens (not Hanken Grotesk and Napkin blue, so the prompt is wrong) | No. Globals in three large files, own single-tenant server, hard-coded paths, no provenance. Rebuild |
| `larryob78/Resize` (1.2 MB, 24 Oct, JS; default branch `codex/resize-local-completion`) | yes, cloned | Node 20, no npm deps, ffmpeg/ffprobe, optional Tesseract and Whisper, macOS-only Swift binary; one master becomes 16:9, 9:16, 4:5, 1:1 at 6 to 60 s. 86 of 86 tests pass. "Generic production sizes, not verified platform delivery specifications." One optional ElevenLabs STT call, key 401 on 12 Sep | No. Four ratios of the 12 formats, refuses foreign origins, own accounts and JSON store. Reusable idea: safe margins, OCR crop-risk flags |
| `larryob78/napkin-studio-editing` (213 KB, 11 Oct, JS) | yes, README and tree read this session | README is titled "Resize 0.3.0": "local, single-operator video versioning MVP", ffmpeg, brands, campaigns, approval bound to a revision, SRT/VTT. Looks like an earlier copy of Resize, not a separate editing tool. Not tested | Not for Film; same limits as Resize. Confirm with its owner whether it differs |
| `larryob78/napkin-radio` (373 KB, 24 Oct, TS) | yes, cloned | Next.js 15 suite (Brief, Deck, Radio, Poster). Parser FVO/MVO/VO/SFX/MUSIC, no-model quality gate, house style, MP3 stitch with no ffmpeg. Gemini and Groq write; ElevenLabs voices. Offered lengths 15/30/45/60/90, not 10/20/30/40. Basic auth. No server state. 3 newer branches unread | Plain logic only: `lib/radio/{parse,quality,types,audio}.ts`, `lib/ai/house-style.ts`. Every provider call is a Next route handler |
| `larryob78/napkin-audio` (337 KB, 26 Jun, TS, public) | yes, cloned | Separate Vite app: legal-line parsing, runtime and legal speed, Irish station specs, cue sheet, provider stand-ins (ElevenLabs, Riva). 34 of 34 tests. "Not a duplicate" of radio | Take station specs, legal-speed estimate, cue sheet |
| `larryob78/idea-to-ooh-studio` (97 KB, 26 Mar, TS, public) | yes, cloned | A film director's 3D previz app (React, Three.js). Nothing outdoor. `VITE_` keys in the browser (breaks keys rule). `npm run build` fails on two type errors | No. Outdoor is a new build |
| `larryob78/Socials-ads-maker-` (0 KB) | yes | Empty | n/a |
| `larryob78/Admagined-` (0 KB) | yes | Empty ("Git Repository is empty", HTTP 409) | n/a |
| `larryob78/napkin-timesheet-traffic` (734 KB, 24 Oct, Python, branch `master`) | yes, README and tree read | Local prototype on made-up data; ElevenLabs Scribe or faster-whisper speech; deterministic traffic engine; monochrome look, accent from logo. Stdlib unittest. Not run | Traffic logic ideas for T2 (matching, capacity 37.5 h, scope_changes, approval_delays); not the app |
| `larryob78/napkin-timesheet` (70 KB, 12 Nov) | yes | README only: "No application or provider integration is implemented here" | n/a |
| `larryob78/shopper-display-builder` (23 MB, 7 Nov, Python; branch `concept-vahid`) | yes, README and tree read | Blender plus FastAPI studio plus three.js viewer, 20 formats, 24 retail specs, `runway/` and `meshy/` folders. Phase 4 (v3 states 277 tests on 3 Nov; not verified here) | Phase 4 |
| `vahid-vakson/napkin-experimental` (415 KB, 10 Nov, Python, `master`) | yes | Experiential studio: brief, location photo, brand pack to editable 3D scene, renders, walkthrough, Runway-finished versions; Blender; optional `clan` CLI handoff | Phase 4 |
| `larryob78/napkin-os-experimental` (39 KB, 6 Nov, JS) | yes | Vite concept editor for one Coca-Cola Christmas study; photoreal still wired to OpenAI image edits | Phase 4 |
| `larryob78/awards-board-maker` (1.3 MB, public) | yes, cloned | Board maker; retrieval is built on a private Cannes image corpus (forbidden) | Phase 4, and not before the Cannes parts are cut |
| `larryob78/pitcher`, `napkin-deck-director-`, `HTML-slides-tool`, `the-canon` | yes (3 KB for the-canon; names and sizes only) | Phase 4 deck and idea sources | Phase 4 |

Referenced but not repos (`docs/sources/repos.md`): Director3D, Production Amplifier, GREENLIGHT, Shopper Studio, Production Recipes plan, Napkin Idea Machine, awards knowledge base. No source on disk for any.
Discovery's conclusion stands: "No outside repo is ready to wrap." What can be lifted as plain logic: napkin-radio parser, gate, house style, MP3 stitch; napkin-audio station specs and cue sheet; Resize's crop-risk checks.

---

## 5. Paid providers

Where each is in the code today, and what fake exists. Every media call in the repo goes through the relay's `Provider` Protocol (`providers/base.py`); text goes through `server/napkin/model.py` `ModelPort`.

| Provider / model route | Phase 3 use (prompt) | Client code exists? | Fake or mock | Spend guard today |
|---|---|---|---|---|
| Runway Developer API: Gemini 3 Pro and 3.1 Flash images, Veo 3.1 and Fast, Aleph 2 | stills, clips, clip edit (v3 table: Runway "Free for a period ... about 63 models ... 1 credit = $0.01") | yes, `providers/runway.py` over httpx; fabletest sheet 6 ops; v2 sheet adds WAN 3, Seedance 2.5, Seedance 2 Fast, Kling O3 and 3.0, Hailuo 3, Omni Flash 1.1, Ideogram 4.5, Magnific upscaler v2 | `providers/mock.py` (stamps the input "MOCK", kind "mock", never final), test fixtures of Runway schemas, `runway_testpack.py` and `pathway_costs.py` scripts | fabletest: `spend.check(estimateUsd or 1.0)` at `runway.py:281` before build and send, error `spend_stop`. v2 line: `ledger.py` admission in `service.py` instead |
| ElevenLabs (voices, music, SFX, dubbing; also inside Runway) | Radio, Film sound | no (`audio-elevenlabs` designed). Outside: napkin-radio, napkin-timesheet-traffic call it | none in repo; napkin-audio has stand-ins (outside) | none |
| Black Forest Labs FLUX | Stills edit; v3.1: "On the Black Forest Labs key, through the router" | no sheet, no client | none | none |
| GPT Image 2.5 / Nano Banana 2.1 / Seedream 5.0 Pro (tier table) | Stills Standard and Sketch | not by those names (Runway Gemini image ids only; a fixture `v1__text_to_image.json` mentions GPT image ids) | mock | via Runway path |
| Magnific upscale | Hero stills | v2 line only (`upscale` op, via Runway) | mock | v2 ledger |
| Luma, ByteDance (BytePlus Seedance direct), "Elorna" | "Also in reach" | no | none | none; Elorna "Not added until its name, provider and terms are confirmed" |
| World Labs Chisel, Marble, Atlas | 3D worlds, experiential, film previz (Phase 4 mostly) | no | none | none |
| NVIDIA (Inception key, NIM) | embeddings, rerank, vision, text | text and retrieval only, `engine/rag`; no media | rag offline tests | not behind `spend` |
| Anthropic Claude (Bedrock `eu.` profile, direct for local) | director, Dex/Skye prompts, Judge explanations, cutdown plans | yes: `server/napkin/model.py`, relay `director/model.py` copy; `director/cli_wire.py` runs headless Claude for dev | mock-middleware (canned, frozen clock, "the only true fixture mode"), mock-backend (headless Claude, not repeatable), `mock-agent` | `spend.allow` at `model.py:159` |
| TypeSafe jev (Judge scores briefs) | Judge | `server/napkin/jev.py` | fixtures `judge/fixtures/default.json` | `spend.check(REQUEST_EUR)` at `jev.py:58` |

How the guard is called: `spend.allow(amount, env, run)` returns a Verdict; `spend.check()` raises `SpendRefused`. Env vars `NAPKIN_PAID_CALLS` (on locally, off when deployed), `NAPKIN_SPEND_CAP_EUR` (0 when deployed unless set; refuses all), `NAPKIN_SPEND_RUN_CAP_EUR`, `NAPKIN_ENV`. In-memory per process. The relay's copy is held in step by `production-tool/relay/tests/test_spend.py`. The estimate passed is a ceiling "never zero". Runway sheet prices are USD standing in for euro ("only errs high").

### Acceptance lines that cannot be proven without a real paid call

1. Gate: "J001 has a scored still, film, radio spot, poster and format pack": a real still, real film, real voiced spot need provider calls; "scored" needs a Judge rubric for those kinds that does not exist and a calibrated backend (not built).
2. T4 "doodle to a finished campaign photograph without typing a prompt": quality of the photograph step is a model result.
3. T5 "storyboard the same day, rough film the next": needs live Runway video; the audit says Runway clip and region edits "never run live".
4. T7 "draft spot within a minute": needs ElevenLabs (and a writing model); timing is wall clock on the provider.
5. T9 "12 formats as one checked pack": crop and layout formats are provable offline (free, with `crop-cases.json`); extend and regenerate need Ideogram and Gemini; campaign-formats' own paid tests (CF-T1..T6, about $9) decide which method per format.
6. T8 "believes it": realism is judged by eye; day and night variants probably need an image model.
7. E3 rate table: "Re-read them live before quoting a run"; rates from the Napkin Runway account of 3 Nov; Runway "free for a period" end date unknown.
8. E9 "check that every model vendor marks its outputs": needs real outputs to inspect.
9. Provable offline with the mock: cost refusal at cap 0, 80% alert, override log, cache hit, fallback when a provider is down (needs fault injection on the mock), "never fakes a success", ledger line shape.

---

## 6. Rules that constrain the design

- **Client wall** (`docs/adr/0004-client-wall.md`, signature line blank): (1) one database and search store per agency; (2) brand walled by row-level security inside an agency; (3) client text processed in the EU only; (4) only scores with the content stripped may leave a vault; (5) Judge and the night watch run inside the client's vault. Host refuses `patch-data` with no agent or no action (400). `docs/adr/0004-providers.md` ends: "Not in this table: the Production Tool's media providers (Runway and others). ... outside this record." So no one has recorded where Runway, ElevenLabs, BFL process data, or whether a DPA exists.
- **EU model pin**: `NAPKIN_MODEL_PIN=eu` (`server/napkin/model_routes.py`): aliases resolve to `eu.` Bedrock profiles; a route on a wire the pin cannot vouch for stops startup. It covers text only. Media providers have no pin and no EU statement. v3.1 s8: "Only models whose terms allow commercial use make client work"; each client has an AI switch "off until the client's written yes is recorded" (`server/napkin/client_ai.py` returns False).
- **Every write names an agent and an action**: host enforces; Production's quiet writes name participant and action, folded by a 1.5 s wait (BUILD-LOG, "to be confirmed by Sai and Laurence"). The v2 line has none of this.
- **Keys** server side in Secrets Manager (hackathon env today); never in `.clan`, browser, log.
- **Cannes, Effie, WARC**: not used by any Phase 3 tool; Outdoor, Stills and Formats need no award data.
- **No type in generated images; EU AI Act labels (both styles); alcohol UGC and real-face gate** (v3 hard rules).
- **Owner's 13 Nov rule** (`/tmp/napkin-build-brief.md`, "Design addendum"): "Develop is the model for the whole system ... how it looks AND how it behaves"; read `tokens.css`, `nui.css`, `shell.css`, `Toolbar.tsx`, `barMenus.ts`, `palette.ts`, `AppRuntime.tsx` (postMessages `clan:jobs`, `clan:edit-mode`, `clan:booth`, `clan:feedback-pick`), and the two finished tools `brief-maker`, `campaign-research`. "The Booth is the one right-hand panel where agents sit. It pushes the document aside and never overlaps it. Evidence, review, agents, asks and actions ... go there, not in a new side panel, band or drawer." "No chat panel in any tool. Agents act in place." "Needs you is the one settle-before-lock list." "**No prices or costs in the interface. Costs are recorded per job and shown only in the decision tree.**" "Confidential means Napkin's own systems never take the part in." "'Napkin Studio' appears once. Every part, control and node is named for point-at-it feedback through `window.ClanFeedbackTarget`." Motion: slide and push, never bounce. "Where an approved record's design on this branch differs from the above, stop and report the difference."

### Where does a cost engine show cost?

What the prompts say: v3 Shared engines 3 "shows the credits on the button"; v3.1 s10 "Each run shows its price first"; v3 Models "The dashboard shows both [list price and actual charge], and forecasts the monthly bill"; "The agency dashboard shows spend by job, client, provider and tier, cost per kept asset, and free credit left with its end date"; v3.1 s4 "an alert at 80 percent". Phase 2 test 30: "A run shows its price before it starts."
What the rule says: nowhere except the decision tree. The same rule was set for Production on 13 Oct (`features/tenant-limits.clan`: "no price, cost, cap, warning, quota or spend figure in the UI") and in Shrey's prompt ("What Dex will send" tray "no prices").
How the repo already resolves it: `features/align-confidential-prices.clan` (status designed, approved, not built; branch `feat/align-confidential-prices` at fabletest tip) removes six price surfaces (`judgeModel.ts priceLine`, `dashboardModel.ts` hours tile, `JobPage`/`jobModel` budget, agency-setup credit cap, `states/words.ts` credits, a string check), keeps the refusal line without a figure ("Paid runs are off here. Nothing was sent."), records a `run_cost` decision per paid run and a `set_budget` decision, and calls the decision tree "the only place a cost may show". It says budget hours stay in the API for the Money group (403 for others) but not on screens. So: the cost engine's output is data (`run_cost`, ledger), refusals are plain lines with no number, alerts at 80% have no screen number defined, and the dashboard cost tiles and the "price on the button" have no approved home. T1 (Scope, estimates, invoicing) is money by definition (quotes, rates, invoice lines, hours against budget); the rule does not say whether it is exempt.

### What Shrey's UI prompt covers (`/Users/saieeshwar/Downloads/fable-master-prompt-deck-production.md`)

Its Production screens (each with the Booth on the right): 1 canvas with nodes, links and bar; 2 a node selected with the Booth on it; 3 the send tray before a generation; 4 Wren rendering a node; 5 an ask from Dex in the Booth; 6 script editor (screenplay and AV); 7 storyboard; 8 image editor with Rhea; 9 video editor with Edie; 10 Assets drawer; 11 Format sheets and Make all sizes; 12 phone view and review. Deck screens (8) are Phase 4.
Owner decisions it records (13 to 14 Oct, 13 Nov): typed nodes (Script, Storyboard, Image, Video, Document, Brand board, Format set); linking Script plus Storyboard makes a Video node; double-click opens a full editor, "no chat panel"; crew Dex directs, Skye scripts, Wren renders, Rhea retouches, Edie edits, Ellis reads, Jude checks, drawn with the real agent figure; inputs come from links (grey lines, inputs strip, "Show all links"); a "What Dex will send" tray without prices; asks like Research's; Assets drawer (This project, Team library, Upload, From Napkin); format sheets and "Make all sizes" (Social, Out of home, Print, Digital display, video cut-downs); the loader; desktop, iPad with Pencil, phone view and review; live multi-user; the tool moves inside napkin-web at `/production`; shell tokens win over Production's old tokens (flag conflicts); Booth rules (never overlaps, `]` toggles, tab 38 px wide, per tool per person via `clan:booth`); no prices anywhere; Needs you; point-at-it names; "Production's canvas engine, relay, contracts and collaboration stay as they are. This is the UI and its wiring."

**UI that prompt covers:** the inside of Stills (image editor, canvas, nodes), Film (script editor, storyboard, video editor, send tray, agents at work), Formats (format sheets, Make all sizes) and the phone review, as parts of the Production Tool at `/production`, mocks first then build, owner approval between.
**Not covered by that prompt (engine, server, data, or other UI):** T1 Scope/estimates/invoicing (UI and data), T2 Traffic board, T3 Craft review (a note UI, though Booth "review" slot is the stated place), T6 Animation, T7 Radio, T8 Outdoor in situ, any tier picker, the decision-tree cost view, E1 to E16 engines (router, cost engine, tiers, ledger, cache, budgets, runner, recipes, labels and marks, provenance, Judge kinds, audio, other providers, media rules, client specs for Production documents, asset library), the `/production` host route and sign-in (on the v2 line only), hand-off buttons Send to Judge/Formats, and all Phase 3 tests and acceptance lists.

---

## 7. Open questions only a person can answer

1. Which Production base do Phase 3 builders start from? (a) Merge the `feat/make-and-edit` stack (457 commits, 54 overlapping files, two spend guards) into the integration branch first, as its own record. (b) Keep fabletest's older Production and port only chosen v2 features (formats, ledger, quality, image editor) one record at a time.
2. Where do the cost engine, ledger, tiers and recipe runner live? (a) In the middleware and napkin-host (one guard, one ledger, euro, inside the client wall), with the relay as a client. (b) In the relay (Lambda, hackathon env, USD), extended as `ledger.py` already is.
3. Where does cost show, given "no prices in the interface"? (a) Only in the decision tree (`run_cost`), and the dashboard, "price on the button", the 80% alert number and cost-per-kept-asset tiles are dropped. (b) A named exception for Management or the Money group (dashboard spend tiles, Scope and estimates), with the rule amended in writing.
4. Is Scope, estimates and invoicing exempt from the no-prices rule? (a) Yes, it is the money tool, visible to the Money group only. (b) No: it shows hours and states only, and money lives in exports (CSV).
5. Do the media providers get the EU pin and a client AI switch? (a) Yes: record each provider's processing region and DPA in `0004-providers.md` first; refuse a provider that cannot state EU processing for client work. (b) No for Phase 3 pilot J001 because it uses no client text in media prompts (needs a ruling that prompts and reference images are not client text).
6. Who turns on paid calls and at what cap for J001 media? (a) Laurence at the Phase 3 gate, cap named in euro. (b) Sai sets a UAT cap now (as done for UAT at 10 euro a day) and Laurence confirms at the gate.
7. Is Runway's free period still on, and does the agency pay credits at cost per job on top of the 7,000 euro fee? (a) Confirm both in writing before the router uses list price. (b) Treat all spend as list price and decide billing later.
8. What does "a scored still, film, radio spot, poster and format pack" mean for Judge, which has rubrics for script, idea route and visual brief only? (a) Laurence writes media rubrics (30 yes/no tests each, with vision or audio input) first. (b) Score only the briefs and scripts that produced the media in Phase 3 and score media in Phase 4.
9. Radio: build a new Radio tool in the shell reusing napkin-radio's logic, or wrap napkin-radio? (a) New template, reuse parser, gate, house style, MP3 stitch, take station specs from napkin-audio. (b) Keep the Next app, embed it, and send scripts to it (its licence is unconfirmed; Phase 2 log asks for it in writing).
10. Outdoor in situ needs site photographs and perspective mapping: (a) Laurence supplies a licensed set of real Dublin site photos, mock-up labelled. (b) Use a generic mock-up wall for J001 and promise sites later.
11. Formats: 12 or 60 in v1? (a) 12 as v2 says (both ad repos empty). (b) 60 as v3 says. Also: are platform frames for Meta, TikTok, YouTube, LinkedIn licensed, or drawn by us?
12. Recipe runner: build before or after the Stills canvas? (a) Runner first (about 3 weeks), then each of the six recipes as a template. (b) Stills and Film first with the harness as is; add the runner when a second tool needs it.
13. Add a media provider that has no sheet (ElevenLabs is required for Radio; FLUX, Luma, ByteDance are "in reach"): (a) ElevenLabs only for Phase 3. (b) ElevenLabs plus BFL, as v3.1 s10 says FLUX goes "through the router".
14. Is "Elorna" (a new video model) still wanted? (a) No, drop it. (b) Hold until Laurence names it.
15. Asset library: include in Phase 3 (a) yes, a view over approved decisions, or (b) no, Phase 4.
16. Craft review: who counts as a "named senior art director or writer", and is the role a new role in `roles.rs`? (a) A new role `senior-creative`. (b) Any creative-director or named person on the job.
17. Should Phase 3 tools run as `.clan` templates in the shell (`app/templates/*`, as v2 says) or inside the Production Tool at `/production` as Shrey's prompt assumes? (a) Templates in the shell, Production only for canvas work. (b) All media tools inside `/production`.
