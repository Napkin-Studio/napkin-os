# Design: the Napkin Brain

Record `napkin-brain` (`features/napkin-brain.clan`, status exploring, `design.approved_by` unset, owner Laurence O Byrne, branch `feat/napkin-brain`), read on `spike/fabletest` at `7b614b99` in `/home/napkin/napkin/napkin-fabletest`. Design only. Nothing was built, no record was patched, no git repo was changed, no model or paid call was made, no `.env` and no Cannes, Effie or WARC material was opened.

The record already holds a full design of 12 Nov (approach A: a brain `.clan` per vault, a no-model ingest, then a curator). Four things decided on 13 and 14 Nov make parts of it wrong. This document keeps what still holds, changes what does not, and splits the build into records of at most 3 builder hours.

| Changed since the record was written | Where it is decided | What it changes here |
| --- | --- | --- |
| Confidential means Napkin's systems never take the part in; the brain is named as a reader | `features/align-confidential-prices.clan` done_when 7 ("a confidential part of Client A's brief is in no brain page"), `docs/contracts/os-layer.md` C4 | The ingest may not read a document's chain directly |
| Three security reviews found that every host-made copy of a value under a new address leaks; the fix is an allow list, not a subtraction | `BUILD-LOG.md` (commit `7b614b99`), `/home/napkin/napkin-share/design-allowlisted-agent-context.md`, `crates/napkin-host/src/outgoing.rs` on `feat/align-confidential-prices` | A brain line is exactly such a copy. Section 4 |
| No price, cost or credit on any screen; a run's cost is a `run_cost` decision | `features/align-confidential-prices.clan` done_when 8 and 11 | The record's done_when 15 ("each run shows its price first") is void |
| No chat panel and no new side panel; agents sit in the Booth and act in place; a door that opens a client's document is a tool, not a page | `features/align-booth.clan`, `features/ask-nap.clan`, `feat/align-landing-look:app/src/shell/landing/tools.ts`, `home/DoorPage.tsx` | The brain's screens are a template with no panel of its own; Ask the brain is one line, not a chat |

## 1. Problem

The agency has no memory in Napkin OS. v3 "The Napkin Brain" (`docs/napkin-os-build-prompt-v3.md` lines 98 to 179) asks for raw sources, a wiki of linked pages and a rules file; v3.1 section 7 places it in Phase 2. There is no `brain/` and no brain code. What exists is only the edges: the search index already names the app (`crates/napkin-host/src/searchindex.rs:57`, `BRAIN_APP = "ie.napkin.agency-brain"`, and `route_of` at 572 to 589), `roles.rs` has `Group::Brains` for `client-brains` and `pitches` (line 639), `doors.ts` has `client-brains` and `agency-brain` with `appId: null` (lines 42, 76), and `app/e2e/j001-p2-napkin-brain.spec.ts` holds tests 65 to 69 as `test.fixme`. What a job decided and why sits in each document's decision chain and is read by the job index only, which keeps stages and no reasons.

The record's own design would, as written, break the confidential rule in two ways: its ingest reads each chain raw (`before`, `rationale`, `extra` and all), and it stores the words it reads in a file that no route may edit, so a part marked confidential a day later stays in the brain for good.

## 2. done_when

Numbered as the record's, with the changes marked. Each line names its test.

1. **A brain is a `.clan` from a new template**, one per client and one for the agency, in the agency's own workspace. Test: `crates/clan-sdk/tests/agency_brain.rs`; `crates/napkin-host/tests/brain_store.rs`. Unchanged.
2. **The page format is fixed and checked**: type (decision, idea, outcome, lesson, client, person, tool, job), title, summary of 20 words or fewer, owner role, lines. Every line has an id, at least one cite and a state. A line with no cite is refused with 400. Test: `crates/napkin-host/tests/brain_page.rs`. Unchanged.
3. **Changed. A derived line holds no words from a source.** It stores `{id, rule, cites, slots, state, superseded_by, at}`, where `slots` are ids, enums, dates and numbers only. Its sentence is rendered at read from the cited decision, through `outgoing::SafeDoc`. Test: `brain_page.rs a_derived_line_holds_no_free_text` (the schema refuses a string slot longer than an id); `brain_walls.rs a_part_marked_confidential_after_the_ingest_leaves_every_page` (ingest, then add a classify mark, then read: the canary is in no page, no `.md`, no search hit, and the brain file's bytes never held it).
4. **Markdown is a rendering**: `pages/<slug>.md`, `index.md`, `log.md`. Superseded lines are struck through with the date and a link. Test: `crates/napkin-host/tests/brain_render.rs` against `tests/fixtures/brain/*.md`. Unchanged, except `log.md` leaves out `run_cost` entries.
5. **The write-through is one write**: a page change is one attributed `patch-data` on the brain document. Test: pilot 65; `brain_writes.rs`. Unchanged.
6. **The ingest is code with no model and reads sources only through the allow list.** New: the only reader of a source document in `brain/` is `outgoing::brain_view(&SafeDoc)`. Test: `crates/napkin-host/tests/brain_ingest.rs` over the seeded J001 chains; a source test that `brain/*.rs` holds no `read_entry(`, no `decision_chain(` and no `serde_yaml::from_` on a source; `confidential.rs` `READERS` gains the row and its canary test.
7. **Idempotent and resumable.** Test: `brain_ingest.rs` (two runs, equal bytes; stop between two documents and run again); pilot 68.
8. **History is never rewritten.** A later decision supersedes the old line; no route edits or deletes a line. Test: `brain_writes.rs` (an edit and a delete of a line through `patch-data` return 409); pilot 68.
9. **The verified mark is computed, never stored**: a line is verified only while its cited decision sits on a version with a live `client_review` whose `answer` is `accepted` (`ops/client_review.rs:58 ANSWERS`). Test: `brain_verified.rs`; pilot 66.
10. **Per-client separation.** Test: `brain_walls.rs` two-client canaries; pilot 67.
11. **Per-agency separation.** Test: `crates/napkin-web/tests/brain.rs` (a second agency gets 404); pilot 67.
12. **Roles through `roles.rs`.** Test: the table test in `roles.rs`; pilot 67 (403).
13. **Keyword search in code** over rendered titles, summaries and current lines; verified first; a page not verified for six months ranks lower. Test: `brain_search.rs` with a fixed clock; pilot 69 (keyword half).
14. **Changed. The screens are the template's own page**, `app/templates/agency-brain/index.html`: the list of pages as cards, a page with its lines and sources shown in place under each line, the index and the log. No side panel, no chat, no price. Nine states; 44 px buttons at 390 px. Test: `app/tests/agencyBrain.test.ts`; pilot 65 to 69 and 72.
15. **Changed. The curator and Ask the brain sit behind the model seam, off by default, and show no price.** The curator only proposes; an owner approves. Ask the brain answers in two lines with links, and says it does not know without any call when the search finds nothing. Each paid run passes `spend.allow` and is written as one `run_cost` decision; the request is an `Outgoing` built by `Outgoing::task`. Test: `server/tests/test_brain_curate.py`, `test_brain_ask.py` with a stub model; `crates/napkin-host/tests/outgoing.rs` for the two task rows; pilot 69 on the fixture answer. Cannot be proven without a provider: that curated pages and answers are worth reading.
16. **New. Nothing confidential is in any brain page, search hit, export or model request.** Test: pilot 67 gains the line align-confidential-prices wrote for it; `brain_walls.rs` seeds a canary in a `confidential_fields` part, under a `classify` mark with `corpus: false`, and in a `client-confidential` material.

## 3. Prior art (paths and names)

| Path | What it is | Reuse |
| --- | --- | --- |
| `features/napkin-brain.clan` `design` | The 12 Nov design | Kept: one `.clan` per vault, line and page schema, rule ids, supersession, computed verified mark, append-only guard, routes. Changed: sections 4 and 6 |
| `feat/align-confidential-prices:crates/napkin-host/src/outgoing.rs` (`SafeDoc::of` 521, `Closed` 355, `DECISION_ALLOW` 256, `DECISION_CLOSED` 282, `context_of` 969, `TASK_SLOTS` 1056, `AGENT_SPECS` 78, `Outgoing::task` 1399) | The allow-listed reader and the sealed request | The brain's only way into a source document; the curator's and Ask's only way out |
| `feat/align-confidential-prices:crates/napkin-host/src/confidential.rs` (`READERS` 453, `NOT_READERS` 500, `Marks`) | The list of readers with a behavioural test each | One new `READERS` row for the brain |
| `crates/napkin-host/src/searchindex.rs` (`SearchCache` 712, `words` 115, `parse` 227, `score` 308, `route_of` 572) | An in-memory index per tenant rebuilt by document stamp | The same cache shape for the rendered brain (`BrainCache`); `words` and `parse` reused by brain search |
| `crates/napkin-host/src/jobindex.rs` (`JobIndex::build` 340, `IndexCache` 1364) | A deterministic walk of every document in a workspace | The ingest's walk |
| `crates/napkin-host/src/store.rs` (`DocStore` 137, `Library::new_document` 125, `PartStore::stamp` 100) | Documents per workspace | A brain is an ordinary document |
| `crates/napkin-host/src/ops/edit.rs` (`patch_data` 279), `ops/gate.rs` (`refuse_write_when_approved_for` 432, the per-app rule on `BRIEF_MAKER` 47) | Attributed writes and a host rule for one app id | The append-only rule sits beside it |
| `crates/napkin-host/src/ops/client_review.rs` (`KIND` 47, `UNLOCK` 49, `CLIENT_ANSWER` 51, `ANSWERS` 58; the answer is `extra.answer`) | The client's answer on a locked version | The verified mark |
| `crates/napkin-host/src/ops/ideas.rs:72` (`PICK = "pick_route"`, kind verdict), `ops/judge.rs:55` (`OVERRULE = "overrule_score"`), `ops/gate.rs:56` (`SIGN`) | The decisions the rules read | The rule table's left column |
| `crates/napkin-web/src/roles.rs` (`Group::Brains` 575, `group_of` 639, `allowed` 652) | Route groups | One new arm |
| `crates/napkin-web/src/state.rs:50,54` (`jobs`, `search` on the workspace), `events.rs` (`EventBus::publish` 52) | Caches per tenant; the change event | `brain: BrainCache`; the debounced trigger |
| `app/templates/visual-brief/`, `crates/clan-sdk/examples/make_visual_brief.rs`, `crates/clan-sdk/tests/visual_brief.rs`, `app/e2e/stack.mjs:71` | The small-template pattern and how the e2e stack installs one | `app/templates/agency-brain/`, `make_agency_brain.rs`, one line in `stack.mjs` |
| `server/napkin/client_ai.py` (`written_yes_recorded`, always False), `spend.py`, `model.py guard_spend`, `model_routes.py`, `registry.py` | The client AI switch seam, the guard, the EU pin, the handler registry | Both handlers; the switch file now exists, the record's open question to Sai is answered by it |
| `features/ask-nap.clan` (resolve then compose; the source-kind table `{kind, resolve, open}`; fixture composer by default) | Ask Nap's seam | Ask the brain is the same two steps with one source kind, `brain` |
| `features/job-memory.clan`, `features/case-study-builder.clan` | Two records that cite the brain's rule table | They read `brain/rules.rs RULES`; no second table |

## 4. Approaches

Hours are builder agent hours (a Sonnet builder, as in the allow-listed context design), not days.

**A1. The record's design, with the ingest moved onto `SafeDoc`.** Lines store their text. Build: about 56 hours. Run: none without the curator; one model call per changed source with it. It loses: the text is a host-made copy under a new address in a file nothing may edit. A part marked confidential after the ingest stays in the brain, and the only cures are a sweep that rewrites history or a tombstone that leaves the words in the zip. It is the leak shape the three reviews found, built in on purpose.

**A2 (recommended). Skeleton lines, words at read.** As A1, but a derived line stores ids, the rule and typed slots only. A new reader in `outgoing.rs`, `brain_view(&SafeDoc)`, gives the allow-listed decisions; the ingest writes skeletons from them; every reader of a page (the routes, markdown, search, the curator's request) renders the sentence at that moment through the same `SafeDoc`, so today's marks decide what is shown. The rendered brain is cached per tenant by document stamp (`BrainCache`, the `SearchCache` pattern). Build: about 61 hours in 23 records (section 10). Run: no model; a cold render reads each cited document once, a warm one reads nothing; storage is the brain files, a few hundred bytes per line. It wins because the confidential rule becomes structural (the file cannot hold what it never stored), a rule's wording can change without a new ingest, and the verified mark already worked this way.

**B. No brain document; pages computed from the chains on every read** (job-memory's choice, at brain size). Build: about 38 hours. Run: as A2's render. It loses: v3 and pilot 65 require one decision per page edit in `brain.clan`, supersession would be recomputed and not recorded, and curated lines and proposals need a store anyway, which brings the document back.

**C. Pages in the `layers-service` tables; D. the curator first; loose markdown in `brain/`.** Already argued in the record (25, 12 and 15 days) and the reasons stand: a second store with two writes, no Postgres in the e2e stack, and nothing provable offline. D also sends client text to a model before the walls are tested.

## 5. Recommendation

Build A2: a brain `.clan` per vault holding skeleton lines, read and written only through `outgoing::SafeDoc`, with the deterministic part (records 1 to 16) finished and its e2e tests live before any handler exists. The curator and Ask the brain (records 17 to 23) follow, off by default, proposing only.

## 6. Reach and contracts

**Host, new module `crates/napkin-host/src/brain/`** (pure, wasm-clean; `lib.rs` gains `pub mod brain;`):

- `page.rs`: `Vault {kind: Agency | Client, client}`, `Page`, `Line`, `Cite {doc, decision} | {fact}`, `LineKind {Derived, Curated}`, `line_id(doc, decision, rule) -> String` (sha256, 16 hex), `validate(&Page)`.
- `rules.rs`: `pub const RULES: &[Rule]`, `Rule {id, kind, action, page_type, template, slots}`. First table: `approve`, `sign`, `client_review` (`client_answer`), verdict `pick_route`, Judge's score verdict, verdict `overrule_score`, `unlock`. Read by job-memory and case-study-builder.
- `ingest.rs`: `pub fn ingest(store: &dyn DocStore, now) -> HostResult<IngestReport>`; one batched patch per brain; `sources{<doc>: {head}}` for resume.
- `render.rs`: `rendered(store, brain) -> Vec<RenderedPage>`, `page_md`, `index_md`, `log_md`; `BrainCache`.
- `verified.rs`, `search.rs` (`search(&[RenderedPage], &Query, now)`).

**Host, edited:** `outgoing.rs` gains `pub fn brain_view(&SafeDoc) -> Vec<BrainDecision>` and `const BRAIN_FIELDS: &[(kind, &[(field, Slot)])]` (enum and number slots only: `client_review.answer`, a Judge verdict's total), an `AGENT_SPECS` row for `ie.napkin.agency-brain`, and `TASK_SLOTS` rows `curate_source` and `ask_brain`. `confidential.rs READERS` gains one row. `ops/edit.rs patch_data` calls `brain::refuse_unless_append(doc, &input)` beside the gate call at line 281. `searchindex.rs route_of` changes the brain's routes to the ones below (today it writes `/client-brains/{document id}` and `/proprietary/{id}`).

**The brain document, `app/templates/agency-brain/schema.json`:** `vault{kind, client}`, `pages{<slug>: {type, title, summary, owner_role, links[], lines[]}}`, `sources{}`, `proposals[]`. A derived line: `{id, kind: derived, rule, cites[], slots{}, state, superseded_by, at}`. A curated line adds `text` and `approved_by`. App id `ie.napkin.agency-brain`. `agent/context.md` is v3's standing instruction with the Fable line and the `brain/raw/` line removed.

**Web, `crates/napkin-web/src/brain.rs` (new), one nest in `api.rs`, `state.rs` one field:**

- `GET /api/t/{tenant}/client-brains/{client}/pages`, `/pages/{slug}`, `/pages/{slug}.md`, `/index.md`, `/log.md`, `/search?q=`
- the same under `/api/t/{tenant}/agency-brain/`
- `POST /api/t/{tenant}/brain/ingest`
- later: `POST .../client-brains/{client}/ask`, `POST .../proposals/{id}/approve`, `/reject`
- `roles.rs`: `Group::AgencyBrain` (planning, account-service, agency-brain; management on GET only), `group_of` arm `Some("agency-brain")`.
- Flags: `NAPKIN_BRAIN=on` (web task), `NAPKIN_BRAIN_AI=fixture|model` (middleware task), both off by default.

**Shell:** `app/src/shell/landing/tools.ts` one row `{id: 'brain', name: 'Brain', full: 'Client brain', appId: 'ie.napkin.agency-brain', noun: ['brain', 'brains']}`; `route.ts` `ToolId`; `components/states/doors.ts` the two `appId`s; `home/doorWords.ts BUILT_PAGES` and one branch in `home/DoorPage.tsx` for `agency-brain`. No file under `app/src/shell/brain/`.

**Middleware:** `server/napkin/handlers/curate_source.py`, `ask_brain.py`, one line each in `registry.py`, two purposes in `model_routes.py`; `mock-middleware/server.py` and `app/e2e/standin.mjs` fixture answers.

**Docs:** `docs/contracts/os-layer.md` new section "The brain" and one line in C4; `docs/contracts/middleware-api.md` two tasks; `docs/adr/0004-client-wall.md` one table row.

## 7. Rework risks

| Risk | Avoided by |
| --- | --- |
| `outgoing.rs` changes shape again (nine fourth-review probes fail at `c4340d7d`: `rv02`, `rv02b`, `rv02c`, `rv05`, `rv08`, `rv09b`, `rv10`, `rv11`, `rvj1`) | Records 1 to 5 do not touch it. `rules.rs` takes plain `BrainDecision` rows. Only record 6 binds to `SafeDoc`, and it starts after that branch merges green |
| The rule table is thin or wrong | Words are rendered, so a template change needs no ingest; a new rule version supersedes by the normal path; a rebuild into a fresh brain is a test |
| job-memory, case-study-builder, one-bar-search and ask-nap each build their own reader | One `RULES` table, one `brain::search`, one route; ask-nap gets a source kind, not a second resolver |
| Curated prose and derived lines fight over a page | Two line kinds, two writers; the ingest never touches a curated line |
| The brain file grows | Skeleton lines are small; one file per client; the 5 MB warning and split by year stay as the record wrote them |
| Documents move to Aurora and S3 (foundation decision S1) | The brain is an ordinary document behind `DocStore` |
| The screens are rebuilt when align-booth lands | The page view has no side panel to move; sources sit under their line. The Booth is used only by record 22 |
| The verified rule changes | Computed at read |

## 8. Breakage and guards

| What could break | Guard |
| --- | --- |
| A confidential part reaches a page, the search, an export or a model | `brain_view` is the only reader; the source test in done_when 6; the three canaries of done_when 16; `READERS` row; pilot 67 |
| A part marked later stays | done_when 3; nothing is stored to stay |
| A cost figure reaches the agency's brain ("ids, stages, dates and numbers") | `run_cost` and `set_budget` are not on `DECISION_ALLOW`; `brain_walls.rs no_cost_kind_in_any_page` |
| Client text crosses clients or agencies | Two-client canary; two-agency 404; the ingest takes the client from the manifest only |
| The ingest slows every save | It runs after the reply, debounced per tenant; `brain_trigger.rs a_document_write_makes_no_brain_write_in_the_same_operation`; pilot 5's 10 seconds in the same run |
| A brain shows as a job document | `jobindex.rs` and `library.rs scan_recent` skip `BRAIN_APP`; tests on both lists; pilot 1 to 5 |
| A line is edited through plain `patch-data` | `refuse_unless_append`, 409 |
| A role is shut out or let in | `roles.rs each_role_against_each_route_group` for all nine roles |
| A paid call in a test | Fixture composer by default; `guard_spend` in front of the model one; pytest with paid calls off asserts the client is never called; the e2e stack has no key |
| The search index sends people to a route that does not exist | `route_of` fixed in record 10; `crates/napkin-web/tests/search.rs` opens the brain hit |

## 9. Test plan

- Rust, `crates/napkin-host/tests/`: `brain_store.rs`, `brain_page.rs`, `brain_writes.rs`, `brain_render.rs`, `brain_ingest.rs`, `brain_verified.rs`, `brain_walls.rs`, `brain_search.rs`, `brain_proposals.rs`; additions to `outgoing.rs` and `confidential.rs`.
- Rust, `crates/clan-sdk/tests/agency_brain.rs`; `crates/napkin-web/tests/brain.rs`, `brain_trigger.rs`, and the `roles.rs` table.
- vitest: `app/tests/agencyBrain.test.ts` (the page model lifted from the template, nine states), `templates.test.ts`, `rolesHomes.test.tsx`, `shellRules.test.ts` (no price string; no `app/src/shell/brain/`).
- pytest: `server/tests/test_brain_curate.py`, `test_brain_ask.py`; `mock-middleware` unittest.
- e2e, `app/e2e/j001-p2-napkin-brain.spec.ts` at 390 and 1440 px, turned on from fixme: **65** (the ingest writes pages that cite the chain), **66** (only client-accepted work is verified), **67** (the walls, plus the confidential line), **68** (supersession and idempotence), **69** (keyword search first; the two-line answer with record 22). **72** in `j001-p2-j001-phase2-suite.spec.ts` gains the brain's pages. Pilot **1 to 5** run unchanged.
- `scripts/check.sh --only rust,wasm,frontend,middleware,mock-backend,copy`, then `--only e2e`.
- By hand on UAT: Laurence reads the J001 brain; with a cap he sets, ten questions to Ask the brain.

## 10. The split: 23 records, about 61 builder hours

Each is one record on its own `feat/<slug>` branch, at most 3 hours. "After" names what must be merged into `spike/fabletest` first.

**Part one, the 12-day part with no model (16 records, 42 hours).**

| # | Slug | Hours | Builds | After |
| --- | --- | --- | --- | --- |
| 1 | `brain-template` | 3 | `app/templates/agency-brain/` (schema, context, a static `index.html`), `make_agency_brain.rs`, `tests/agency_brain.rs`, one line in `app/e2e/stack.mjs` | nothing |
| 2 | `brain-page-model` | 3 | `brain/page.rs`, `lib.rs` line, `brain_page.rs`, `brain_store.rs` | 1 |
| 3 | `brain-append-only` | 2 | `refuse_unless_append` in `ops/edit.rs`, `brain_writes.rs` | 2 |
| 4 | `brain-rules` | 3 | `brain/rules.rs` over `BrainDecision` rows, fixture chain for J001 | 2 |
| 5 | `brain-render` | 3 | `brain/render.rs` on fixture rows, golden `.md` files | 4 |
| 6 | `brain-safe-reader` | 3 | `outgoing::brain_view`, `BRAIN_FIELDS`, the `READERS` row and its canary | 4; `feat/align-confidential-prices` merged with the nine probes green |
| 7 | `brain-ingest` | 3 | `brain/ingest.rs`: walk, one write per brain, idempotence, resume; `jobindex.rs` and `library.rs` skip the app | 3, 6 |
| 8 | `brain-supersede-verified` | 3 | supersession rules, `verified.rs`, `brain_verified.rs` | 7 |
| 9 | `brain-walls` | 2 | the agency vault's job pages, `brain_walls.rs` (clients, confidential, late mark, no cost) | 8 |
| 10 | `brain-search` | 2 | `brain/search.rs`, `BrainCache`, `route_of` fix | 8 |
| 11 | `brain-routes` | 3 | `napkin-web/src/brain.rs`, the nest, `Group::AgencyBrain`, `NAPKIN_BRAIN`, `tests/brain.rs` | 9, 10; `feat/align-landing-look` merged |
| 12 | `brain-trigger` | 2 | the debounced run on `EventBus`, `brain_trigger.rs` | 11 |
| 13 | `brain-screen-list` | 3 | the template's list, filters, index and log, nine states, `agencyBrain.test.ts` | 11 |
| 14 | `brain-screen-page` | 3 | the page: lines, sources in place, superseded, verified date; screenshots in `docs/design/napkin-brain/` | 13 |
| 15 | `brain-doors` | 2 | `tools.ts`, `route.ts`, `doors.ts`, `doorWords.ts`, `DoorPage.tsx`, `rolesHomes.test.tsx` | 13; `feat/align-landing-look` merged |
| 16 | `brain-e2e` | 2 | tests 65 to 68 and the keyword half of 69 live; `phase2-fixme.mjs`; os-layer, ADR and C4 text | 12, 14, 15 |

Records 1 to 5 can start today. 4 and 5, 9 and 10, 12 and 13 can run side by side.

**Part two, the 8-day part behind the model seam (7 records, 19 hours).**

| # | Slug | Hours | Builds | After |
| --- | --- | --- | --- | --- |
| 17 | `brain-task-slots` | 2 | `AGENT_SPECS` row, `TASK_SLOTS` rows, `tests/outgoing.rs` | 16 |
| 18 | `brain-proposals` | 3 | `proposals[]`, approve as one write to a curated line, reject, owner role check, `brain_proposals.rs` | 16 |
| 19 | `brain-curate-handler` | 3 | `curate_source.py`, fixture composer, guard, pin, switch, `run_cost`, mock answers, pytest | 17, 18 |
| 20 | `brain-ask-handler` | 3 | the ask route (no hit, no call), `ask_brain.py`, citation check, pytest | 17 |
| 21 | `brain-proposals-screen` | 3 | proposals in place under the page with the agent-proposal words of align-booth | 18, 14 |
| 22 | `brain-ask-screen` | 3 | one line and one answer; ask-nap's source kind `brain`; test 69 whole | 20; `align-booth` and `ask-nap` built |
| 23 | `brain-flags-infra` | 2 | `NAPKIN_BRAIN` and `NAPKIN_BRAIN_AI` in `infra/envs/staging` and `uat` as text, the terraform test, `middleware-api.md` | 16; `production-line-merge` merged |

## 11. Shared files and what they collide with

| File | This design | In flight |
| --- | --- | --- |
| `crates/napkin-host/src/outgoing.rs`, `confidential.rs`, `tests/outgoing.rs`, `tests/confidential.rs` | records 6, 17 | `feat/align-confidential-prices` creates them (1,301 and 590 lines); not on `spike/fabletest` yet. Hard dependency |
| `crates/napkin-host/src/searchindex.rs`, `lib.rs` | 2, 10 | `feat/align-confidential-prices` (9 and 2 lines) |
| `crates/napkin-web/src/api.rs`, `tests/api.rs` | 11, 20 (one nest line each) | `feat/align-confidential-prices` (+116); `production-line-merge` joins `api.rs` and `lib.rs` with `production.rs` and names `tests/api.rs` |
| `crates/napkin-web/src/roles.rs` | 11 | `feat/align-landing-look` rewrites it (569 lines changed; `group_of` moves from 639 to 585) |
| `app/src/shell/home/DoorPage.tsx`, `doorTargets.ts`, `home/model.ts`, `landing/tools.ts`, `route.ts` | 15 | `feat/align-landing-look`: `DoorPage.tsx` rewritten, `doorTargets.ts` deleted and replaced by `doorWords.ts`. Build 15 only on the merged shape |
| `app/src/components/states/doors.ts` | 15 | `feat/align-confidential-prices` (2 lines) |
| `app/tests/shellRules.test.ts`, `rolesHomes.test.tsx` | 13, 15 | both branches |
| `app/e2e/pilot.ts`, `standin.mjs`, `seed/j001/` | 16, 19 | both branches; `j001-pilot.spec.ts` is edited by both and by nothing here |
| `app/e2e/phase2-fixme.mjs`, `scripts/check.sh`, `.github/workflows/ci.yml` | 16 | `production-line-merge` names all three |
| `docs/contracts/os-layer.md`, `middleware-api.md`, `docs/adr/0004-client-wall.md` | 16, 23 | `feat/align-confidential-prices` (36, 22 and 2 lines) |
| `mock-middleware/server.py`, `server/napkin/app.py` | 19 | `feat/align-confidential-prices` |
| `infra/` | 23 | `production-line-merge` merges the line's infra as text |
| `app/templates/shared/booth-sections.html`, the template `index.html` files | 22 | `align-booth` and `ask-nap` (designed, no branch found) |

No collision: `crates/napkin-host/src/brain/`, `app/templates/agency-brain/`, `crates/napkin-web/src/brain.rs`, the new test files, `ops/edit.rs` (neither branch's diff touches it).

## 12. Rollout

Part one needs no secret and no infra to run locally, in e2e or on UAT with the flag set by hand. `NAPKIN_BRAIN` reaches staging only when a person applies Terraform in `infra/envs/staging` before the deploy (record 23 writes the text; an agent plans and reads, never applies). Brains are made on the first ingest. Part two stays on the fixture composer until a person sets `NAPKIN_BRAIN_AI=model`, confirms `python -m napkin.model_routes --check` under `NAPKIN_MODEL_PIN=eu`, and Laurence raises the cap; and nothing of a client reaches a model while `client_ai.written_yes_recorded` answers no. Say "the brain lists what was decided", not "Ask the brain is live", until then. Roll back by setting the flag off and applying; the brain files stay unread, and deleting them loses nothing but curated lines.

## 13. Non-goals

The record's list stands: no layers-service writes, no brain over this repo's own records, no graph view, map, department lens, quality score, review queue or dashboard tile, no embeddings or reranking, no raw drops, no training, no Pitches, Awards, Case studies or Proprietary data tools. Added: no price or estimate on any screen; no chat thread; no panel beside the page; no purge route for a curated line; no change to what `model: true` on a classify mark means.

## 14. Questions for the owner, each with a recommended pick

1. **Laurence and Shrey: storage.** A brain `.clan` per vault, and not loose markdown or layers tables? Recommended: yes (the record's default).
2. **Sai and Shrey: do derived lines store their words (A1) or only ids, with the words rendered at read (A2)?** Recommended: A2. It is the only shape in which a part marked confidential later leaves the brain without rewriting history.
3. **Sai: a decision on a confidential part.** No line at all, with a count on the page ("Napkin did not read 2 parts") (a), or a line of ids and dates with no words (b)? Recommended: a.
4. **Sai: the reason a person typed on an open decision.** Shown as `SafeDoc` gives it (a), or left out whenever the source document holds any mark, as `agent/context.md` is (b)? Recommended: a; nothing is stored, so the residual is the one the agent context already carries.
5. **Sai: a curated line a person approved, whose sources are later marked confidential.** Withheld at read and kept in the file (a), or a purge that breaks "never rewrite history" (b)? Recommended: a.
6. **Laurence: the verified mark.** Client-accepted only (a), or also approved decisions as v3 says (b)? Recommended: a.
7. **Laurence: what the agency's brain may say about a client's job.** Ids, stages, dates and Judge totals, never a cost and never client text? Recommended: yes.
8. **Laurence: which decisions make a page.** Approve, sign, the client's answer, the pick, a Judge score, an overrule, an unlock; edits and votes left out? Recommended: yes.
9. **Laurence: owners by page type** (planning owns insights, creative owns ideas, account service owns client history), named people later? Recommended: yes.
10. **Laurence: the screens.** A template opened as a tool for a client and as the `agency-brain` page for the agency, with sources under each line and no panel? Recommended: yes.
11. **Laurence: Ask the brain before align-booth and ask-nap are built.** Wait for them and ship it as the Booth's Nap section (a), or one ask line at the top of the brain's own page now (b)? Recommended: a; keyword search covers the gap.
12. **Shrey: the routes.** `/client-brains/{client}` and a new `/agency-brain` group with management read only, replacing the search index's `/client-brains/{document}` and `/proprietary/{id}`? Recommended: yes.
13. **Shrey: may `outgoing.rs` grow `brain_view` and `BRAIN_FIELDS`** (enum and number fields beyond `DECISION_ALLOW`, for the brain only)? Recommended: yes; the alternative is adding `answer` to the agents' `client_review` row.
14. **Shrey: a host rule for one app id** (append-only lines), as `ops/gate.rs` has for the Brief Maker? Recommended: yes.
15. **Sai: where a curator or Ask run's `run_cost` is written,** since a brain has no job. The brain document's own chain, left out of `log.md` (a), or no record (b)? Recommended: a.
16. **Sai: order.** Start records 1 to 5 now, and hold 6 onward until `feat/align-confidential-prices` is merged green? Recommended: yes.
17. **A person must:** apply `NAPKIN_BRAIN` in `infra/envs/staging`; later raise the cap and apply `NAPKIN_BRAIN_AI`; build the client AI switch behind `client_ai.py` before any client brain meets a model.

## 15. Not verified

- `outgoing.rs` was read on `feat/align-confidential-prices` at `c4340d7d` by its public names only. It is not merged, the allow-listed design is not approved, and nine probes fail there. Line numbers will move.
- The `extra` keys of Judge's score verdict (the total out of 30) were not read; `BRAIN_FIELDS` names it by assumption. `client_review`'s `extra.answer` was confirmed.
- That `patch_data` accepts a batched patch of several hundred lines within the request limits (the record's own open point).
- How large a real brain grows; the 5 MB mark is the record's guess.
- The 28 conflicted paths of `production-line-merge`: only the paths its record names were read; no trial merge was run.
- `align-booth` and `ask-nap` have no branch in this clone; their shared files are taken from their records.
- Whether `library.rs scan_recent` and the landing's lists already skip an unknown app id.
- No test, build or check was run for this design. Hours are estimates from the sizes of comparable records, not measurements.
- `an_open_racing_a_write_does_not_lose_the_write` (`crates/napkin-host/tests/client_link.rs`) is logged as failing 10 times in 20 on plain `spike/fabletest`; record 12's trigger test runs beside it and may be blamed for it.
