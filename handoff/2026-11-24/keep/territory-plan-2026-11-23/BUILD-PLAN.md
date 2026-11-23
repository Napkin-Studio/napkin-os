# Territories: build plan (planning only, 2026-11-23)

Nothing here is approved or built. 24 feature records (1 umbrella + 23) are committed locally on branch `docs/territory-plan`
in `/home/batunii/Documents/Code/napkin-wt-territory-plan/features/territories*.clan`, all `exploring`, `approved_by` empty. Not pushed.
Read one with `scripts/feature show <slug>`.

Product intent = the owner's demo (origin/claude/ad-campaign-territory-explorer-auewh5: `design/territory-explorer/prototype.html`, README, 22 stills,
`three-steps.mp4`, `features/territory-explorer.clan`). Prior art to reuse = develop's `features/territory-tool.clan` + `engine/territory/`.
Where they differ the demo wins by default, and each difference is a question below.

The flow (demo): 1 Pick what to work on, 2 The crew explores (5 agents on different headings, compass, spread fix with Undo, steering optional), 3 Review and greenlight, then send to Deck Studio or the production tool.

## Build order

LESSONS column = items of LESSONS.md the record guards against in its rework_risks (23 = design before code and 24 = live test apply to all).

| # | Slug | Goal | Depends on | Size | Verified live by | LESSONS |
|---|------|------|-----------|------|------------------|---------|
| 1 | `territories-contract` | Document shape: schema.json + contract doc + fixtures; engine output validated against it | - | 1d | Live engine output saved and validated against the schema (cap USD 1.00) | 7, 12, 15, 16 |
| 2 | `territories-spinoff-in` | Brief/Research Continue in Territories; upstream carried and shown | contract | 1.5d | Spin a real Brief and Research on a local stack; read the screen counts (USD 0) | 1, 4, 6, 7, 15 |
| 3 | `territories-costs` | One spend module: cap named before paid calls, resume-not-repay, prices only in Decisions | contract | 1d | Live run on Bedrock, cap USD 1.00: ledger = calls; forced timeout resumes with no repeat charge | 13, 19, 24, 25 |
| 4 | `territories-engine-insights` | Ranked, cited insights from the carried brief and research (one call) | contract, spinoff-in, costs | 1.5d | Real Bedrock on invented Linea-style brief, cap USD 0.30 | 7, 11, 12, 13, 15, 25 |
| 5 | `territories-gates` | One pure gate state machine (pick, greenlight, sensitive review, derived asks) | contract, costs | 1d | Real approvals through the server, cap USD 1.00 | 11, 17, 18, 25 |
| 6 | `territories-engine-routes` | Crew of 5 headings in parallel, routes, distance bands, spread check, steering | insights, gates | 2d | Real run on two briefs, cap USD 1.50; spread results read | 11, 12, 13, 14, 15, 16, 25 |
| 7 | `territories-engine-develop` | Worlds (palette, lines, touchpoints), checks, blind rank | routes | 2d | Real run, cap USD 1.50; compare with demo world | 11, 12, 13, 15, 16, 21, 24 |
| 8 | `territories-engine-server` | HTTP engine server, segments, resume, Bedrock via brief_llm | develop, gates, costs | 2d | Local server on Bedrock, cap USD 2.00; kill and resume | 2, 3, 5, 11, 12, 13 |
| 9 | `territories-handlers` | Middleware tasks, job runner, file delivery route, mock-backend stub | engine-server | 1.5d | Local stack end to end, cap USD 2.00; real download | 1, 5, 11, 12, 17, 18 |
| 10 | `territories-telemetry` | Run log: timing, spend vs outcomes, no client text | handlers, costs | 1d | Record spend equals ledger, cap USD 1.00 | 13, 19, 24, 25 |
| 11 | `territories-app-shell-pick` | App shell in house style, Booth, Pick step (owner's mock) | handlers, spinoff-in, insights | 2d | Local live stack, cap USD 0.50; screenshots of every step; paired with stills 03-07 | 7, 9, 15, 17, 18, 19, 22 |
| 12 | `territories-cloud` | Seed, sidecar container, Terraform switch, Bedrock, deploy, verify in AWS | shell-pick; deck-cloud merged | 2d | UAT run, cap USD 3.00 Claude; task definition checked in AWS | 1, 2, 3, 4, 5, 24, 25 |
| 13 | `territories-app-explore` | Crew view, compass, cards by agent, steering, auto spread fix with Undo | shell-pick, routes | 2d | Live Explore + one steer, cap USD 1.50; paired with stills 09-13 | 14, 17, 18, 19, 20, 22 |
| 14 | `territories-app-greenlight` | Gallery, greenlight tray, derived/mandatory asks, Send dialog | explore, develop | 1.5-2d | Live run, 2 routes greenlit and sent, cap USD 2.00; stills 14-15, 19-21 | 9, 10, 15, 17, 18, 19, 22 |
| 15 | `territories-app-world` | World view: dials, journey touchpoints, line lab, animatic, wall | greenlight | 2d | Dials with no network call; 'more like' cap USD 0.50; stills 16-18 | 15, 16, 17, 18, 19, 21, 22 |
| 16 | `territories-pictures-rights` | Picture member: hash, rights chips, Final, re-home, policy | contract, greenlight | 1d | Carry 23 real pictures from a Production export; USD 0 | 8, 9, 10, 14, 20, 21 |
| 17 | `territories-exports` | PDF via napkin-web Chromium (board, one-pagers), JSON, real download path | world, handlers | 1.5d | Export a finished doc; open the PDF; USD 0 | 3, 5, 9, 10, 15, 16, 19 |
| 18 | `territories-spinoff-out-deck` | Greenlit routes into Deck Maker as the recommendation | greenlight, pictures-rights | 1.5d | Real Deck build from Territories, cap USD 2.00 | 6, 7, 9, 11, 14, 15 |
| 19 | `territories-lookups` | Own look-ups via the research port; checked quotes pin as x_ | handlers, explore | 1.5d | Real Tavily + Bedrock, 4 look-ups, cap USD 0.30 | 7, 10, 17, 19, 24, 25 |
| 20 | `territories-pictures-frames` | Runway frames for greenlit routes with existing guards, separate provider cap | pictures-rights, costs | 2d | Real Runway on invented material only, cap USD 1.60 provider + USD 0.30 Claude | 1, 8, 10, 13, 14, 20, 21, 24, 25 |
| 21 | `territories-spinoff-out-production` | Routes into the production tool via the production-spinoff bridge | production-spinoff merged | 1.5d (blocked) | Copy of a local relay (never the owner's live one); USD 0 | 6, 7, 8, 10, 11, 24 |
| 22 | `territories-landscape` | Optional: scan, landscape map, whitespace tabs | owner decision; licences | 5-7d, split on approval | One real category, 8 brands, cap USD 3.00; strategist compares with their wall | 7, 10, 12, 19, 24, 25 |
| 23 | `territories-uat` | UAT script, paired screenshots, full live run on UAT | all | 1d + per feature | Full UAT round, cap USD 10 total | 1, 5, 11, 17, 18, 19, 22, 23, 24, 25 |

Umbrella record: `territories` (order, shared questions; no build).
Total about 36-40 working days without landscape; each record merges alone by its own squashed PR into develop.
Each record's test_plan has the same four lines: live-mode through every gate with models stubbed, schema contract test, live end to end with a $ cap, own UAT check.

Build rules that apply everywhere: owner approves each record before code; `scripts/feature status <slug> designed` then `building`; no price outside Decisions/History; Claude spend and picture-provider spend counted apart; agents never apply Terraform or deploy production.

## Mocks (clickable-mock rule: "build matches the mock")

The owner's prototype and stills ARE the approved mock where they exist. The owner still needs to say "this is the mock" per record, and the 5 not covered need a small mock first.

| Feature | Mock | Status |
|---|---|---|
| app-shell-pick | prototype.html + stills 03-07 | Covered. Check: 1024/1280/1440 widths, teal accent, name, Booth lift |
| app-explore | stills 09-13 (running, compass, auto, agent, whitespace) | Covered. Whitespace tab only when landscape ships |
| app-greenlight | stills 14-15, 19-21 | Covered. The derived-evidence ask card and the mandatory-fail ask are NOT shown: small mock needed |
| app-world | stills 16-18 | Covered. Present mode and Wall at laptop width: check |
| spinoff-out-deck / -production | still 21 (Send dialog) | Covered for the dialog; blocked or not-built wording needs a line in the mock |
| lookups | still 07 'Look it up' box, still 10 look-up note | Partly: the OK-before-lookup card (without a price) is new, mock needed |
| gates | none | Mock needed: ask cards (derived, mandatory, sensitive review, error 'engine off') |
| pictures-rights | none | Mock needed: rights chip and Final marker on a card |
| pictures-frames | none | Mock needed: make-frames ask, flagged frames review |
| exports | none | Mock needed: board PDF and one-pager (static HTML is enough) |
| landscape | still 13 | Covered if go-ahead |
| contract, costs, engine-*, handlers, telemetry, cloud, uat | no UI | none |

The demo shows euro amounts in the Booth (stills 11 and 20: 'about EUR 0.52'). If the owner keeps LESSONS #19 the prototype's text must change first.

## Disagreements demo vs develop (owner's questions)

Demo wins by default; each item still needs the owner's answer. (Also in the records' open_questions.)

1. **Shape of the pipeline.** Demo: insights picked, then 5 parallel headings, routes developed into worlds. develop: assumed brief, tensions, 30 seeds, kill gate, Safe/Stretch/Brave sort, propositions. Plan: reuse develop's kill, idea-group and judge inside each heading. Keep the kill gate?
2. **Tier words.** develop: Safe/Stretch/Brave (judged). Demo: Core/Stretch/Far out (measured distance). Keep both as two fields, one, or neither?
3. **Score.** develop: blind /35 score. Demo: 'judge #n' rank. Store both, show rank only?
4. **No-brief start.** develop supports category + market only (intake gate). Demo done_when says brief/research carried upstream, design text says a brief is not required. Is there a no-brief path in v1?
5. **Pictures.** develop: Runway frames, 4 shots per territory, style pack, about USD 1.5 per 20 frames. Demo: palette-drawn sketches; mood images deferred to phase 2. v1 = sketches only, or frames for greenlit routes only (plan: sketches default, frames as a separate record)?
6. **Cost.** develop: cost card, card id, hard stop USD 2.00 (max 2.50). Demo: no cap in v1, spend logged, shown as EUR in the Booth. LESSONS #19/#25: no price outside Decisions, cap named before paid calls. Cap or no cap, and may the Booth show money? Currency?
7. **Gates.** develop: sensitive-run review checklist, named reviewer, void if the run changes. Demo: ask only for derived evidence at greenlight or near a mandatory. Keep the sensitive review for sensitive packs (plan: yes)?
8. **Proof and awards.** develop: proof cases with verified badge, Cannes out by the 10 Nov rule, IPA only. Demo: 'Explore other categories' from the award/effectiveness case library. Is the Cannes film sheet allowed (asked of Laurence 16 Nov, open)? Is awardlib allowed in shared services?
9. **Where the writer lives.** develop: `engine/territory/` separate from the Deck, Deck reads files (`engine/deck/from_territory.py`). Demo: move `territories()` into shared `engine/territories`, Deck imports it. Plan keeps develop's layout and has the Deck read the document. OK?
10. **Hand-off to Deck and Production.** develop: file path (`--territory-run`). Demo: spin-off to Deck Studio or Production. Production needs `production-spinoff` (unmerged). Accept the not-built wording until it lands?
11. **Stale records.** `territory-tool.clan` says client-to-Runway is 'allowed for testing' but `engine/visuals/policy.py` defaults to refuse (Sai 18 Nov, later). `territory-explorer.clan` done_when still lists five steps (Scan, Landscape, Whitespace, Territories, Outputs) plus Ideate, Line lab, Tissue session and Watch, though the last commits reduced it to three steps. Confirm: three steps, refuse default, Ideate/Tissue/Watch out of v1?
12. **Scan and landscape.** Demo record: full category scan stored in layers-service, whitespace scoring. develop: nothing. Plan: separate optional record, second release. Agree? Which ad libraries may we use (licences)?
13. **Name and owner.** 'Territory Explorer' (demo, owner Shrey) vs territory tool (develop, owner Sai) vs 'Territories' (this plan, ie.napkin.territories). Which name, who answers?
14. **Fonts.** Five faces in the demo are not in `licences/fonts.toml`. Approve them, or limit to Newsreader and Geist Extra Bold?
15. **Booth.** Lift `production-tool/web/src/ui/booth` into the shell first, or import it for now?
16. **Engine container.** Same engine image as the deck started as its own container (plan), or its own image and ECR repo?
17. **Branch hygiene.** The brief said `feat/territory-explorer`; that branch does not exist, the demo is on `claude/ad-campaign-territory-explorer-auewh5`. `feat/territory-slice` (23 commits, 17 Nov) is older than develop's copy and holds the early commits with client names in history (develop record, squash note): never merge it, never reuse its history.

Top questions to answer first: 6 (cap/prices), 5 (pictures v1), 1-3 (what the engine is), 12 (landscape in or out), 16/cloud dependency (deck-cloud must land first).

## Risks we can't design away yet

- **Does the crew beat one good prompt?** develop's blind comparison by Laurence was never recorded (its done_when is open). The demo's five-heading design is unproven; the baseline arm in `engine/territory/compare.py` should stay in the first live runs.
- **Spread and distance quality.** Thresholds and the distance measure (embeddings or model rating) can only be tuned on real briefs; the demo's compass data is fabricated (Linea).
- **Cost at five parallel Opus-class calls plus worlds.** Estimates (tens of cents to about USD 1) are from the demo and the old pipeline (USD 0.5-0.9), not measured on this design.
- **Dependencies not on develop:** `deck-cloud` (cloud pattern, Chromium PDF test, file delivery), `production-spinoff` (Production bridge). Cloud and Production hand-off wait for them.
- **Licences and rights:** ad libraries, the Cannes rule, fonts, picture rights (client material to Runway). Owner and Laurence decisions, not engineering.
- **Runway:** output not reproducible (no seed), guard (local Ollama) has no cloud twin yet (Haiku via Bedrock proposed), false-positive flags cost review time.
- **Bedrock access:** Opus 5.5, Sonnet 5.5, Haiku 4.5 in eu-west-1 must be confirmed for the task role before the first cloud run.
- **Real use vs demo:** the demo has hand-made data; first real runs may give thin evidence (develop's early runs showed 'none ready, assumption-dependent'). A rework of insight ranking is likely after UAT.
- **Mock drift:** the prototype is 3000 lines of a mock, not an app; the build can only match it if the owner agrees which parts are binding.

## LESSONS coverage by exception

All 25 items appear in at least one record. Where a lesson does not apply (e.g. #20 format-aware generation to non-picture features) the record says so. #23 is the process itself (umbrella). #1, #4: territories-cloud plus a seed test in territories-spinoff-in.
