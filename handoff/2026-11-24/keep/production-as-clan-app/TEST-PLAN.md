# Production as a CLAN app: TEST PLAN (written before building, 2026-11-23)

Parent record: `features/production-as-clan-app.clan` (approved by Shrey, 2026-11-23). Children: `production-in-library` (stages 0 and 1), `production-app-page` (stage 2), `production-jobs-via-host` (stage 3), `production-relay-to-middleware` (parked).
Build lanes and file ownership: `BUILD-PLAN.md` in this folder. Every lane builds to these tests; a test with an ID here is the acceptance test for it. If a lane thinks a test is wrong it records a decision in its feature record and tells the lead; it does not quietly drop it.

Owner (2026-11-23): "plan the tests properly and then learn from our experience so far ... change it without spending too much time by using parallel agents."

## 0. How to read this plan

Check kinds, cheapest first. Each acceptance test names its kind and its exact fixture.

| Kind | What it is | Where it runs |
|---|---|---|
| unit | one function or one class, in memory | `cargo test`, `vitest`, `pytest` |
| contract | a request/response or file shape against the written contract and its vectors (`docs/contracts/examples/production-clan-app/*.json`) | same, but both sides read the same vector file |
| host | napkin-web / napkin-host started in-process (axum test client, real `TenantStore` on a temp dir, never a store that cannot refuse a write; lesson: `SnapshotDocumentStore` hid every refusal on 2026-10-19) | `cargo test -p napkin-web -p napkin-host` |
| e2e | Playwright in a real browser against a locally started napkin-web + local relay in mock mode (free) | `production-tool/web/e2e/clan-app/`, `app/e2e/` |
| live local | a person-like walk on our own local stack with real Runway and the real director (rule: never mock unless asked), under a named cap | section 6 |
| UAT | the same walk on UAT after the owner agrees | section 6 |

Fixtures (exact; all fictional or already-owned test data, none is client material, none is committed except the small ones marked "repo"):

| ID | What | Where |
|---|---|---|
| FX-EMPTY | an empty Production document (the app template instance) made by `crates/clan-sdk/examples/make_production.rs` | built in tests; repo |
| FX-BRIEF | the Hollow Oak brief with client and research carried (`data.upstream`, objectives filled) | `/home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/spinoff-upstream/brief.clan` copied to `crates/napkin-web/tests/fixtures/hollow-oak-brief.clan` (repo; the lane that needs it copies it; fictional brand) |
| FX-EXPORT | the Hollow Oak "Still" Production export with 23 pictures (the LESSONS #8 case) | `/home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/downloads/napkin-hollow-oak-still-production.zip` (outside the repo; the e2e and web tests read it by path from `PRODUCTION_FIXTURES`, default that folder) |
| FX-HO-REAL | Hollow Oak's real latest `.clan` from UAT S3 (196,537 B zipped, 1,156,473 B expanded, 70 asset hashes, 38 CloudFront URLs). Read-only copy taken by the lead with `aws s3 cp` (needs the owner's SSO login once) | `/home/batunii/Documents/napkin-local-keep/production-as-clan-app/fixtures/hollow-oak-latest.clan` (never committed) |
| FX-5MB | synthetic: FX-HO-REAL's shape grown to 5 MB expanded (a generator script, seeded) | made by `test-sandbox`-free helper `crates/napkin-web/tests/support/big_doc.rs`; repo (generator only) |
| FX-DECK-PROD | the deck's production demo | `engine/deck/tests/fixtures/production_demo` (exists) |
| FX-TERR | a Territories document | whatever `feat/territories` provides in `app/templates/territories`; until it lands, a minimal hand-made document with `app_id` of Territories (made in the test) |
| FX-TWO-TENANTS | two agencies on the roster (`a@alpha`, `b@beta`) | host test helper (exists in `crates/napkin-web/tests/people.rs`) |

Ports for live and e2e stacks: see `BUILD-PLAN.md` (each lane has a range; never 8091, 8788, 8797, 8191, 8888, 8897 or 18xxx/19xxx).

## 1. Stage 0: host groundwork (record `production-in-library`, lanes A and T)

| ID | In plain words | Kind | Exact fixture and how it is checked |
|---|---|---|---|
| S0-1 | A write that names the version it started from is refused with a conflict if the document has moved on, for every app and every writer, not only Production. | host | FX-EMPTY: `TenantStore::apply(Change::update(doc, bytes, Base::At(v1)))` twice from `v1`; the second returns `HostError::conflict` (409); the file on disk is the first writer's bytes. Also `Base::Absent` over an existing file is a conflict. Vector `save-conflict.json`. |
| S0-2 | Saving a whole Production document works and the new version is the sha256 of the bytes sent. | contract + host | `PUT .../save` with `If-Match: "<v>"` on FX-EMPTY: 200 `{version, saved_at, snapshot}`, `version == sha256(bytes)`, `ETag` header equal; next `GET .../data` shows the new data; `GET .../download` carries `ETag: "<version>"` and returns the same bytes. Vector `save-ok.json`. |
| S0-3 | Two saves from the same starting version: the second loses and is told which version won; nothing is overwritten. | contract + host | Same as S0-1 over HTTP: second answer 409 `{"error":{"code":"conflict",...},"latest":"<winner>"}`; `GET download` equals the winner. Vector `save-conflict.json`. |
| S0-4 | The save route refuses what it must. | host | table test over: no `If-Match` 428; document of another app 422; template (not an instance) 422; archive whose `manifest.id` is not this document's 422; unreadable bytes 400; body over 32 MiB 413; no session 401; a document of another tenant 404 (FX-TWO-TENANTS, `tenant.rs` isolation); a missing document 404. |
| S0-5 | History: the host keeps recoverable earlier copies. A snapshot is taken at most once per 10 minutes for interval and manual saves, and always for accept, handoff and export; the newest 50 are kept; the newest one is never pruned; snapshots belong to the tenant and never appear in the library. | unit + host | Seeded property test: 500 random save sequences (reasons and timestamps from a fake clock) against the ring: `len <= 50`, newest present, order by time, 10-minute rule holds, every always-reason present; a second tenant's directory untouched; `GET /library` lists no snapshot. |
| S0-6 | An open session sees a whole-document save: no stale cache. | host | Open a session on the document (`doc_session`), save through the route from another session, then `GET data` through the first and read the new version; the SSE stream carries `clan-data-changed` with the new version (listen on `/t/{tenant}/events`). |
| S0-7 | Save and list stay fast on real sizes. | host (benchmark, recorded) | FX-HO-REAL and FX-5MB: 5 saves a minute for 3 minutes plus a library list each time; p95 of save and of list under 150 ms; the numbers go in the feature log. Fails the stage if worse than the relay's p50 145 to 184 ms. FX-HO-REAL missing means the benchmark is run on FX-5MB only and the lead is told. |
| S0-8 | A save that was answered 200 survives the host being killed. (Lost save on restart.) | host + live local | Unit: `apply` writes a temp file in the same directory, fsyncs it, renames over the target, fsyncs the directory; a leftover `*.tmp` at start is ignored and never listed. Live local: start napkin-web, save, `kill -9` immediately after the 200, start again, `GET download` has the saved version (script `scripts/e2e-production-clan crash`, lane T). |
| S0-9 | The session says where pictures live. | contract | `GET /api/session` has `media_base` (string) when `NAPKIN_PRODUCTION_MEDIA_BASE` is set, `null` when not; never any secret. Vector `session.json`. |
| S0-10 | The backup is planned and valid Terraform. | terraform | `terraform fmt`, `validate` and the mocked-provider test in `infra/modules/services/tests` (new case: backup plan daily at 03:00 UTC, 35 days, selects the web EFS by ARN; absent when `backup_enabled=false`); the lane attaches the `terraform plan` TEXT for uat and staging to the feature record; the owner applies. An agent never applies. |
| S0-11 | Making the base check real does not start 409 errors in the other apps. | host + suites | A test lists every `PartStore::apply` caller in `crates/` and the `Base` each passes; every caller that updates passes the version it just read (or `Base::At` of the opened document's version) and the matching host test saves twice in a row from one session without a 409 (brief, research, deck, territories fixtures). `scripts/check.sh --only rust,wasm,conformance,engine,middleware` green before the stage 0 PR merges. |

Existing tests that must stay green at stage 0: `crates/napkin-host/tests/no_direct_writes.rs` (nothing writes except through `apply`), `crates/napkin-web/tests/api.rs`, `people.rs`, `production.rs`, `spinoff.rs`, wasm32 builds of napkin-host (the base check lives in the napkin-web store, not in napkin-host, so napkin-host stays wasm32-clean), conformance, app suites.

## 2. Stage 1: documents live in the library (lanes B, C, A2, T)

### 2.1 What a person sees

| ID | In plain words | Kind | Exact fixture and how it is checked |
|---|---|---|---|
| S1-1 | A Production project is in the library, under its client; with no client it is under "no client", like a brief. | host | FX-EMPTY created through `POST /documents {app_id:"ie.napkin.production", client_id}`; `GET /t/{tenant}/library` lists it with the client; without `client_id` it lists with no client. Same assertion through `crates/napkin-host/src/listing.rs`. |
| S1-2 | Brief to Production through the plain spin-off lands in the library under the brief's client. (UAT S3.) | host | FX-BRIEF (has a client): `POST /d/{brief}/spinoff {app_id: production}`; the new document lists under that client; there is no `/spinoff/production` route (404). |
| S1-3 | The spin-off targets are right. | host | `spinoff_targets` for sources brief, research, territory (FX-TERR) lists `ie.napkin.production`; for source Production lists Deck Maker; Production never lists itself. The 422 guard "Production projects live in the relay" in `api.rs` is gone. |
| S1-4 | A target that is not installed says so. (UAT S1: "could not find the saved project".) | host + web unit | Seed without Deck Maker: spin-off answers `app not installed: <app id>`; `production-tool/web/src/projects/spinoff.test.ts` asserts the person sees "Deck Maker is not installed here", never "could not find the saved project". |
| S1-5 | A spin-off carries the whole upstream, not a summary. (Owner rule 2026-11-23; the "field is null" objectives bug.) | host + contract | FX-BRIEF with objectives, audiences, decisions: after brief to Production, `data.upstream.<brief doc>` deep-equals the brief's data (every key, nothing summarised) and the decisions came across; pictures are links by sha256, not bytes (`spinoff-asset-links`); after Production to Deck, the deck document's upstream still holds the full brief (objectives non-null) and the research. Asserted by key-set equality plus a field-by-field deep compare, not by presence of one field. |
| S1-6 | New project opens on the blank canvas and asks nothing; from a brief only the Brief node is placed. (Memory blank-canvas-entry.) | e2e | Playwright: `POST /documents` then open: canvas has zero nodes, no modal, no start card, no input; spin-off from FX-BRIEF: exactly one node (Brief) and no Script laid out; paired screenshots at 1024, 1280, 1440 against the previous build (UI must not change in stage 1: no new screen without a mock the owner approved). |
| S1-7 | Fresh start: the named projects are brought in by hand with their client. | unit + live local | `scripts/import-production-projects` (lane C): dry run on FX-EXPORT prints the plan and writes nothing; real run creates one library document with the named client through `POST /documents/upload`; verify step: the same sha256 of `data.yaml` content and the same set of asset hashes as the source. The owner names the 3 or 4 projects (Hollow Oak, An Post, Let Them Sleep suggested). |
| S1-8 | The tool has no Delete for a project in stage 1. | web unit | The library has no delete route (there is none in `api.rs`); the project menu offers Rename, Duplicate, Export, Open file; a test pins that. If the owner wants Delete it is its own small feature (open question in the record). |

### 2.2 Saving and not losing work (the autosave lessons)

| ID | In plain words | Kind | Exact fixture and how it is checked |
|---|---|---|---|
| S1-9 | The tool saves through the host with the version it started from, and keeps the old timing. | web unit (real store, `modelStore()` from `web/src/test/model.ts`) | `ServerCopy` against the contract stub (vectors): first save at the first change (`CREATED_SAVE_MS` 1.5 s), 10 s after a job landing (`LANDING_SAVE_MS`), every 60 s while changing (`MIRROR_EVERY_MS`), on accept, manual, handoff and export; each save sends `If-Match` of the last version; the answer's version becomes the next `If-Match`. Existing `session.ts` timing tests keep passing. |
| S1-10 | Two tabs saving one project never overwrite each other; the loser is told; the loser's edits stay in that browser. | web unit + e2e | Stub: second tab's save answers 409 `latest`; `serverCopy.test.ts` conflict flow kept: banner "saved from somewhere else", no automatic overwrite, local working copy kept; e2e with two real browser contexts on one library document: A edits and saves, B edits and saves, B sees the banner, `GET download` equals A's bytes, B's edits still in B's IndexedDB. |
| S1-11 | Saves are serialised, so one tab never conflicts with itself. (UAT round 2 F1: false 409 banner; 45 saves, 0 after the fix.) | web unit | 10 edits in 200 ms plus a manual save plus a landing save racing: one request in flight at a time, the next `If-Match` taken from the previous answer, zero 409 against a stub that answers like the real route. |
| S1-12 | An edit followed at once by a reload is not lost. (UAT round 6: "an edit + reload within about 0.4 s is lost silently".) | e2e | Playwright: edit, reload within 300 ms; the edit is in the page after reload (the browser working copy is flushed first, then pushed on open; the open compares the host version with the working copy's base). Fails today; this stage fixes it or records it as known with the owner told. |
| S1-13 | Assigning a client to an open project never silently drops it, and the tool's whole-file save never loses the manifest's client or title. | host + web unit | Host test: set the client through `/clients` while the tool holds the old version: its next save is 409 (stale base), the reload shows the client; web test: a save of a document opened with `manifest.client` writes the same `manifest.client`; a rename in the tool changes the manifest title the library lists. |
| S1-14 | A save answered 200 survives a host restart. | live local | S0-8 repeated through the real browser page: edit, wait for the save, `kill -9` napkin-web, restart, open from the library: the edit is there. Script `scripts/e2e-production-clan crash` (lane T). |
| S1-15 | Snapshots exist and a restore is documented and byte-exact. | host + doc | After a live editing session the ring has entries; restore of the newest snapshot is byte-identical to what was saved (unit); the admin steps are in `docs/contracts/os-layer.md` (lead writes after merge). |

### 2.3 Pictures and exports

| ID | In plain words | Kind | Exact fixture and how it is checked |
|---|---|---|---|
| S1-16 | Pictures are stored by sha256 only: the tool writes no web address into the document, and never trusts one it reads. | web unit + contract | FX-EXPORT and FX-HO-REAL: open, edit, save: the saved archive's `data.yaml` holds zero `https://` strings in `assets[].locations` (the lane first lists every reader of `locations`: `jobs/assets.ts`, `jobs/runner.ts`, `lib/blobs.ts`, `rooms/Viewer.tsx`, `campaign/make.ts`, `export.ts`, `projects/serverAssets.ts`, `clan-store/src/bundle.ts`, `engine/deck/prod_picker.py` and records the rule); old documents with CloudFront URLs open, and a fetch spy shows the tool asks only `${media_base}/...` or the relay's by-hash route, never the stored address. `production-tool/contracts/check.py` passes with examples that have no locations. |
| S1-17 | Importing an export re-homes every picture by its hash. (LESSONS #8: 3 of 23.) | web unit (real store) + e2e + live local | FX-EXPORT opened in a second workspace (fresh tenant, empty IndexedDB, empty media cache): 23 of 23 pictures resolve by hash; if one hash cannot be had the person is told how many are missing and which (never silent); an https location in the file that is not this media base is ignored. e2e uses the real zip through the file chooser. |
| S1-18 | The whole picture set survives the move: opening Hollow Oak's real document shows all 70 hashes. | live local (and UAT copy) | FX-HO-REAL imported by the upload route on the local stack; count of resolved pictures equals 70 in the Assets room. |

### 2.4 Hand-offs to the Deck and Territories

| ID | In plain words | Kind | Exact fixture and how it is checked |
|---|---|---|---|
| S1-19 | The Deck reads a Production project that lives in the library. | contract (server) + engine | `server/tests/test_attach_production.py` and `engine/deck/tests/test_production_spinoff.py`, `test_from_production.py`, `test_prod_picker.py`, `test_prod_groups.py` unchanged except the source address (`doc:<id>@<version>` replaces `production:<project>@<etag>`); a new case feeds a library Production document made from FX-DECK-PROD and the assets pass; the deck still gets every final (not 1 of 12; the `fix/deck-uat` result must stay true). Blocked until `fix/deck-uat` is in develop and merged into the lane (see BUILD-PLAN). |
| S1-20 | Territories to Production works through the plain spin-off. | host | FX-TERR: `spinoff_document` to Production gives a library document with the upstream carried whole (record 21 of the Territories plan needs nothing else). |
| S1-21 | The old special routes and callers are gone. | host + grep guard | `crates/napkin-web/src/spinoff.rs` deleted; `/t/{tenant}/spinoff/production` and `/t/{tenant}/production/{project}/spinoff` answer 404; a guard test (`crates/napkin-web/tests/no_bridge.rs`) fails if the strings `brief_to_production`, `production_to_app`, `fn bridge`, `production:<` / `"production:"` appear under `crates/`, `app/src`, `production-tool/web/src`, `server/`, `engine/deck`. |

### 2.5 The relay and who may call what

| ID | In plain words | Kind | Exact fixture and how it is checked |
|---|---|---|---|
| S1-22 | Nothing reads the deleted relay `/clan` and `/projects` routes. | relay + web unit + grep guard | Relay: `GET/POST/PUT /clan*` and `/projects*` answer 410 `{"error":{"code":"gone","message":"Reload the page: projects now live in the library."}}` (`test_projects.py` becomes `test_gone.py`); napkin-web's proxy refuses those paths (404) so a stale page cannot reach them; a vitest guard reads `production-tool/web/src`, `app/src` and `engine/deck` and fails on `'/clan'`, `'/clan/'`, `/projects` as relay paths (allow-list for the word in prose). `production-tool/contracts/relay-api.schema.json` has no such paths. After one release the 410 code is deleted (tracked in the record's `next_step`). |
| S1-23 | Auth goes only through the session. | host | Production document calls (list, open, new, save, spin-off) work with the session cookie and carry no `X-Napkin-Identity`; a request with a forged `X-Napkin-Identity` header is stripped (the existing 5 tests in `crates/napkin-web/tests/production.rs` stay); no session answers 401 on every new route; an agency-B session asking for agency A's document gets 404 on read, save and spin-off (FX-TWO-TENANTS). Job and media calls still use the identity bridge in stages 1 and 2. |
| S1-24 | Jobs still work exactly as before. | existing suites + e2e | Relay suite unchanged and green; local stack in mock mode: generate a picture and a clip, the job lands, the document saves with the output. (Closed-tab landing is stage 3.) |

Existing tests that must stay green at stage 1 (names in section 5): web vitest and e2e, relay suite, host tests, conformance, the Deck's production reader, the Territories spin-in.

## 3. Stage 2: app page (record `production-app-page`, lane D)

| ID | In plain words | Kind | Exact fixture and how it is checked |
|---|---|---|---|
| S2-1 | Clicking a Production project in the library or on Home opens the tool as a page on napkin-web's own origin. | e2e | `app/e2e` + `production-tool/web/e2e/clan-app`: sign in, click the project card, URL is `/production/d/<doc>` on the same origin, tool loads on the document, no second sign-in. |
| S2-2 | No signed identity is made for document, list or save calls. | host | napkin-web test with a stand-in relay that records every request: a full open, edit, save, list session produces zero relay requests carrying `X-Napkin-Identity` (document calls never reach the relay); only job and media calls do. |
| S2-3 | One CSP, written once for the real route set. | e2e | Report-only run: Playwright collects `securitypolicyviolation` and console errors across open, edit, generate (mock), export, Excalidraw/own-engine canvas: zero. Then enforcing run: same walk, zero. The CSP lists exactly the origins the walk used (media base, relay, fonts). |
| S2-4 | The page keeps every browser feature it had standalone (Worker, wasm, IndexedDB, fonts). | e2e | The existing Playwright specs `production-tool/web/e2e/canvas-picture` and `image-editor` run against napkin-web serving the page, not vite; plus a boot check that the clan wasm loads, the store Worker starts and IndexedDB works. |
| S2-5 | Old bookmarks still work for one release. | host | `GET /production/` and `/production/?doc=<id>` redirect to `/production/d/<id>` or the library; removed in the next release (note in `next_step`). |
| S2-6 | The session ending mid-edit is handled. | web unit + e2e | The host answers 401 to a save: the page keeps the working copy, shows the sign-in prompt, and after signing in the next save goes through with the right `If-Match`. |
| S2-7 | The page looks as it did. | e2e screenshots | Paired screenshots (before and after) at 1024, 1280, 1440 of: project list, blank canvas, a document with Hollow Oak open, Assets room; the lead looks at each pair (memory build-matches-mock) before the PR. No new chrome without an approved mock. |

## 4. Stage 3: jobs through the host (record `production-jobs-via-host`, lanes E1 and E2)

| ID | In plain words | Kind | Exact fixture and how it is checked |
|---|---|---|---|
| S3-1 | The browser talks to napkin-web only. | e2e | Playwright network log through a full mock-mode walk: no request to the relay origin; the only other origin is the public media base (GET). |
| S3-2 | napkin-web calls the relay with a service credential and a user claim; the relay refuses anything else. | relay unit + host | Relay tests: no credential 401, wrong credential 401, valid credential with a user claim for another agency 403, valid credential and claim 200; napkin-web test: every outbound relay call carries both; the per-user HMAC code path is deleted from napkin-web (grep guard) once the assets pass moves. |
| S3-3 | A job that finishes after the tab is closed lands in the document exactly once. | host + live local | Local stack, relay in mock mode with a provider that completes after 20 s: start a job, close the browser, wait, let the library watcher settle, reopen: exactly one new asset and exactly one decision entry for the job; calling settle twice answers `already applied`; two settlers racing (watcher plus reopen) still give one. Then the same with a relay restart in the middle (the relay's durable jobs resume it). Never restart the real relay with paid jobs in flight (memory relay-restart-inflight): this test uses the mock provider. |
| S3-4 | The ledger and caps stay in the relay and stay right. | relay suite | `production-tool/relay/tests` (all 80 files) green; `test_ledger.py`, `test_reservation.py`, `test_durable.py` unchanged; a new test that a job created through the service credential is counted against the same agency cap and global stop; Claude spend and provider spend are recorded apart (`cost.agentUsd`). |
| S3-5 | One live run with real Runway under a named cap. | live local, then UAT | Section 6. |
| S3-6 | The assets pass for the Deck is unchanged. | host + engine | `crates/napkin-web/tests/production.rs` assets-pass tests and `engine/deck/tests/test_production_spinoff.py` unchanged. |

## 5. Existing tests that must keep passing (named; the lane that could break each runs it before merging)

- Production web: `cd production-tool/web && npm run lint && npm test && npm run build`; `npm run e2e` (Playwright specs `canvas-picture`, `image-editor`); clan-store `npm run build` and its tests. Existing project tests to rewrite, not delete: `projects/server.test.ts`, `serverCopy.test.ts`, `projects.test.ts`, `spinoff.test.ts`, `tabs.test.ts`; `relay/http.test.ts` and `access.test.ts` stay.
- Relay: `cd production-tool/relay && uv run --python 3.12 pytest -q` (80 files); `test_projects.py` is replaced by `test_gone.py`; `test_identity.py`, `test_assets.py`, `test_local.py`, `test_contract3.py`, `test_durable.py`, `test_ledger.py` stay.
- Rust host: `cargo test -p napkin-host -p napkin-web -p clan-sdk -p clan-cli`; `crates/napkin-host/tests/{clients,routes,middleware,view_from_library,no_direct_writes}.rs`; `crates/napkin-web/tests/{api,people,production,spinoff}.rs` (spinoff.rs is rewritten for the plain route); clippy `-D warnings` and fmt; wasm32 builds (`scripts/check.sh --only wasm`).
- Conformance: `scripts/check.sh --only conformance` (`test-sandbox/pipeline/conformance.mjs`).
- The Deck's production reader: `engine/deck/tests/{test_from_production,test_prod_picker,test_prod_groups,test_production_spinoff,test_spinoff_deck_v3}.py` and `server/tests/test_attach_production.py`, `test_deck.py`; `scripts/check.sh --only engine,middleware`.
- Territories spin-in: the host spin-off tests for Territories sources in `crates/napkin-host` (`library.rs` tests) and whatever `feat/territories` adds under `app/templates/territories`; run again after each merge of develop into the integration branch.
- Shell: `scripts/check.sh --only frontend` (`app/tests/barInventory.test.tsx` and the rest); `app/e2e` landing and links specs when the shell open path changes.
- Terraform: `scripts/check.sh --only terraform`.
- Images: `scripts/check.sh --only image` once, before each PR (the Dockerfile packs the production web build and the template).

Pre-push suites are slow under load: lanes push early (a branch the day it first compiles) and never run a full check by hand before pushing; the hook runs what the change reaches (memory build-speed-rules).

## 6. Regression risks from the lessons, each guarded

| Risk (where it came from) | Guard (test ID) |
|---|---|
| Autosave conflict and version check: false 409 banner when saves raced (UAT round 2 F1); two tabs overwrite (relay had If-Match, host did not) | S0-1, S0-3, S1-10, S1-11 |
| A lost save on restart: relay lost in-flight work on restart; host dies between write and flush; an edit within 0.4 s of reload lost (UAT round 6) | S0-8, S1-12, S1-14 |
| Pictures by sha only: absolute CloudFront URLs in documents (38 in Hollow Oak); locations trusted for any host | S1-16, S1-18, S0-9 |
| The import re-homing bug: only 3 of 23 pictures re-homed because https locations were assumed to be on this relay (LESSONS #8) | S1-17 |
| A spin-off carries the whole upstream (owner rule; "field is null" on the deck; summaries are for a tool's own steps only) | S1-5, S1-20, S1-19 |
| The client list: a spin-off to Production was never attached to its client (UAT S3); a whole-file save dropping the manifest client | S1-1, S1-2, S1-13 |
| The Deck reading a Production project from the library; Deck "could not find the saved project" (S1); the deck used 1 of 12 finals | S1-19, S1-4 |
| A job finishing after the tab closed lands exactly once (and a restart mid-job does not lose a paid job) | S3-3, S3-4 |
| Auth only through the session: forged identity header, other agency's document | S1-23, S2-2, S2-6, S3-2 |
| Nothing reading the deleted relay `/clan` routes (stale pages, engines, scripts) | S1-22, S1-21 |
| Built is not deployed (LESSONS #1, #4): infra and relay changes not live after merge | each record's rollout names the apply and the AWS check; the lead's report says "deployed, not yet live" until verified; S0-10 |
| Engine/host shape drift (LESSONS #12): the web writes a shape the contract refuses | contract vectors in `docs/contracts/examples/production-clan-app/` are read by Rust and by TypeScript tests; `production-tool/contracts/check.py` over examples; every ask the web writes through the real store (UAT round 5 rule) |
| Tests that pass on a store that cannot refuse (2026-10-19) | all web store tests use `modelStore()` and the stub that answers 409 like the real route; the host tests use the real `TenantStore` |
| A UI change slipping in without a mock | S1-6, S2-7: paired screenshots looked at by the lead; no new chrome without an approved mock |
| Two-lane merge conflicts and squash/history conflicts (Territories) | BUILD-PLAN merge order: stage PRs cut from the integration branch before later lanes merge, develop merged back right after each squash |

## 7. Final live end-to-end: one local, one UAT, with caps

Rules: our own ports (BUILD-PLAN); never the owner's 8091/8788 stack; never restart a relay with paid jobs in flight; test on a copy, never on the owner's live project (memory verify-ui-before-handoff); the paid walk is run only after the owner names the cap; the lead records every paid action in a `paid.log` and counts provider spend and Claude spend apart (LESSONS #24, #25); no `$` outside Decisions/History in the UI (`$` found anywhere else is a bug); laptop 1024 to 1440 only.

Walk (both runs; the lead drives it, one agent, with the Chrome extension, shots of every step; a run is not done until the lead has looked at the shots):
1. Sign in as the roster user. Home: the client circle shows (no Production "Nothing yet" for a client with a project).
2. FX-BRIEF is in the library with a client. Continue in Production: lands in the library under that client; open from Home; blank canvas with only the Brief node (S1-2, S1-6).
3. Paid: one key visual with one reference, then one 6 s clip (or one image only for local). Edit; save; second tab saves: conflict banner, nothing overwritten (S1-10).
4. Local only: kill -9 napkin-web, restart, reopen: the edit is there (S1-14). Reload within a second of an edit (S1-12).
5. Export the project, import it into a second workspace: 23 of 23 pictures with FX-EXPORT (S1-17); with the new project, all its pictures.
6. Continue in Deck from the project: the deck is built (Claude cost counted), contains every final, the full brief (objectives present), PDF and PPTX download (S1-19, plus the `fix/deck-uat` fix).
7. Stage 2 and 3 additions: open from the library as the page (S2-1), no identity on document calls (S2-2), start a clip, close the tab, reopen after it finishes: one output, one decision entry (S3-3).
8. Report: per test ID pass/fail, spend per provider, shots, anything that behaved differently from the mock.

Caps (proposed; the owner confirms before the paid steps):
- Local live (own stack, real Runway and the real director on `scripts/model-local`): provider cap USD 6, Claude cap USD 1.50 computed from the price table; stop at the cap.
- UAT (after the stage is deployed to UAT by the owner or the lead under the UAT loop authority): provider cap USD 8, Claude cap USD 1.50; the deck build counts toward Claude. UAT relay and stitch are shared with staging; no relay deploy by an agent.
- Stage 3's live closed-tab run uses one cheap clip inside those caps (the mock-provider test S3-3 does the race cases for free).

Every other test in this plan is free (mock provider, no model calls, or a stubbed model).
