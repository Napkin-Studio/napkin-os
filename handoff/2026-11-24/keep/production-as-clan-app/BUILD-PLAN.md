# Production as a CLAN app: BUILD PLAN (2026-11-23)

Parent: `features/production-as-clan-app.clan` (approved, pinned decision with the owner's words and the answers taken). Tests: `TEST-PLAN.md` (same folder). Both are agreed before any lane starts; lanes build to the test IDs.
Integration branch: `feat/production-as-clan-app`, worktree `/home/batunii/Documents/Code/napkin-wt-pt-clan`, based on develop. The lead (this session's owner-facing agent) merges lanes into it. Stage PRs go to `develop`.

## 0. Rules for every lane (from the lessons)

- One worktree per lane: `/home/batunii/Documents/Code/napkin-wt-pc-<lane>`, branch `feat/pc-<lane>` cut from the integration branch. Remove the worktree when merged (keep the branch; memory keep-merged-branches).
- At most 4 lane agents at once. No sub-agents inside a lane. Small fixes done directly.
- `npm ci` in your own worktree. NEVER symlink `node_modules` (broke the Territories builds). Rust `target/` may use a shared `CARGO_TARGET_DIR=/home/batunii/.cache/napkin-target-pc-<lane>` per lane, never shared between lanes.
- Own ports only (section 3). Never 8091, 8788, 8797, 8191, 8888, 8897, never 18xxx or 19xxx. Stop every process you started.
- Mock provider only, no paid calls, no deploy, no `terraform apply` (plan text only), no UAT. The paid walk is the lead's, after the owner names the cap (TEST-PLAN section 7).
- Push your lane branch the day it first compiles, and after every commit that passes its own suite. The pre-push hook runs the suites your change reaches; it is slow under load, so push early and often rather than once. No hand-run full check before pushing (memory build-speed-rules). Never `--no-verify`, never a `NAPKIN_*` bypass.
- Commits: `<area>: <imperative>` 72 characters or fewer; areas per CLAUDE.md; no Co-Authored-By, no Generated-with. `FEATURE_AGENT=claude scripts/feature log <record> "<what changed>"` after each meaningful commit. The lane commits the record changes with its code.
- Contracts are in section 2 and are frozen. A lane that must change one records a decision (`clan patch-decision`), updates section 2's source file `docs/contracts/production-clan-app.md`, and tells the lead first; it never drifts.
- No lane edits a file another lane owns. If you need a change in someone else's file, say so in your hand-off; the lead routes it. Shared touch points are listed in section 4 with an owner until a named merge, then they pass on.
- UI rule: stage 1 and 2 change no screen. Anything visible and new needs a clickable mock approved by the owner first (memory verify-ui-before-handoff, build-matches-mock). Laptop widths first.
- Tests against the real store: `modelStore()` (`production-tool/web/src/test/model.ts`) in web tests, the real `TenantStore` in host tests.
- Held files: `fix/deck-uat` (another agent) is in flight and merges into develop BEFORE our PRs. Until it lands and develop is merged into the integration branch, NO lane edits `crates/napkin-host/src/ops/read.rs` (`production_upstream`), `engine/deck/from_production.py`, `engine/deck/prod_picker.py`, `server/napkin/handlers/attach_production.py`, `server/napkin/handlers/build_deck.py`, `app/templates/deck-maker/index.html`, `docs/contracts/deck-maker.md`, `docs/contracts/deck-visuals.md`. Lane C owns them after that (C-late, section 1).

## 1. Lanes, stages 0 and 1 (record `production-in-library`)

Start now, in parallel: T, A, B, C (four agents). A2 and later stages wait as shown in section 5.

### Lane T: contracts, vectors, stub, live harness, relay retire, docs (agent days: about 4 over three drops)

Record/stage: `production-in-library`, stages 0 and 1 (tests and the retire step). Branch `feat/pc-tests`.
Drops (each merges separately):
- T1 (first half day, merges FIRST): contract text and vectors. Owns: `docs/contracts/production-clan-app.md` (section 2 of this plan, made normative), `docs/contracts/examples/production-clan-app/{save-ok,save-conflict,save-refusals,session,library-item,spinoff-ok,spinoff-not-installed}.json` (request and response pairs, exact bytes of headers), `production-tool/web/src/test/hostStub.ts` (a stub `fetch` that implements the section 2 routes in memory and answers from the vectors, including 409 with the winner's version).
- T2 (merges before B and C merge): the live harness. Owns: `scripts/e2e-production-clan` (start/stop a local stack on lane ports in mock mode via `scripts/run-production-local` with env overrides, subcommands `up`, `down`, `crash` (S0-8, S1-14), `walk` (the TEST-PLAN section 7 walk in mock mode)), `production-tool/web/e2e/clan-app/**` (Playwright specs for S1-6, S1-10, S1-12, S1-17, S2-1, S2-4, S2-6, S3-1; specs for later stages are written now and marked `test.fixme` with the stage), `production-tool/web/playwright.clan-app.config.ts`.
- T3 (merges after B and C): retire the relay's document routes and write the docs. Owns: `production-tool/relay/{projects.py,service.py (project_route and mirror_clan only),handler.py,local.py}`, `production-tool/relay/tests/{test_projects.py -> test_gone.py,test_local.py (project parts)}`, `production-tool/contracts/{relay-api.schema.json,check.py,README.md}`, `production-tool/relay/README.md`, `docs/contracts/{os-layer.md,production-tool-identity.md}` (the section 5.8/5.9 spin-off text, the save route, the Base enforcement and the stepping-stone decision), `docs/production-tool/` notes if any. The relay keeps serving `/clan` as 410 `gone` for one release; deletion of the code is a follow-up in the record's `next_step`.
Interface provided: the vectors and stub (to A, B, C, D), the harness commands (to everyone's live checks).
Consumes: the section 2 contract (it writes it down); the relay local server (`production-tool/relay/local.py`).
Tests (TEST-PLAN): vectors back S0-2, S0-3, S0-4, S0-9, S1-9, S1-11; harness runs S0-8, S1-6, S1-10, S1-12, S1-14, S1-17, S1-22 (relay 410 and grep guard).
Ports: 20420 to 20429.

### Lane A: host groundwork, stage 0 (about 3 agent days)

Record/stage: `production-in-library`, stage 0. Branch `feat/pc-host`.
Owns (exact):
- `crates/napkin-web/src/store.rs` (TenantStore.apply: per-document lock, `Base::At` check, `Base::Absent` create-new, temp file + fsync + rename + dir fsync; leftover `*.tmp` ignored in listing).
- NEW `crates/napkin-web/src/snapshots.rs` (the ring).
- NEW `crates/napkin-web/src/save.rs` (route `PUT /t/{tenant}/d/{doc}/save`, `router()`; reads the session, uses the same `doc_session` path so open sessions are invalidated and `clan-data-changed` published).
- NEW `crates/napkin-web/src/media.rs` (reads `NAPKIN_PRODUCTION_MEDIA_BASE`).
- `crates/napkin-web/src/api.rs` (register `save::router()`; `SessionInfo.media_base`; ETag header on `download`; map `HostError::conflict` to the 409 body with `latest`) and `crates/napkin-web/src/lib.rs`, `main.rs` (module lines, env): A owns them until A's merge, then C (section 4).
- `crates/napkin-host/src/store.rs`, `error.rs`, `document.rs` (docs and, only if needed, a `conflict_with_latest` constructor; napkin-host stays wasm32-clean, no `std::fs`).
- NEW tests: `crates/napkin-web/tests/save.rs`, `crates/napkin-web/tests/snapshots.rs`, `crates/napkin-web/tests/support/big_doc.rs` (FX-5MB generator), `crates/napkin-web/tests/bench_save.rs` (S0-7, `#[ignore]` unless `PRODUCTION_BENCH=1`).
- Terraform: NEW `infra/modules/services/backup.tf` (AWS Backup plan + vault + selection for the web EFS: daily 03:00 UTC, 35 days; variable `backup_enabled` default false; the env var `NAPKIN_PRODUCTION_MEDIA_BASE` as an optional module variable), `infra/modules/services/variables.tf`, `infra/modules/services/main.tf` (env var line only), `infra/envs/{uat,staging}/main.tf` (turn on, pass media base), `infra/modules/services/tests/` (new mocked-provider case). The lane attaches `terraform plan` text for uat and staging to the record; it does not apply. The owner applies BEFORE the deploy (CLAUDE.md, infra section).
Interface provided: section 2.1 to 2.4 (the save route, the base check, download ETag, snapshots, `media_base`).
Consumes: the vectors (T1), `Change`/`Base`/`Version` in `napkin-host`.
Tests: S0-1 to S0-11. Checks: `scripts/check.sh --only rust,wasm,conformance,terraform`.
Ports: 20410 to 20419 (only for the crash/restart check; host tests use in-process servers).
Merge: first into the integration branch (after T1), then PR-0 (see section 5).

### Lane B: Production web transport and the document (about 6 agent days)

Record/stage: `production-in-library`, stage 1. Branch `feat/pc-web`.
Owns (exact), all under `production-tool/`:
- `web/src/projects/{server.ts,serverCopy.ts,serverAssets.ts,session.ts,shell.ts,projectIndex.ts,migrate.ts,homeList.ts,openFile.ts,storage.ts,summary.ts,uiStore.ts}` and their tests `projects.test.ts`, `server.test.ts`, `serverCopy.test.ts`, `tabs.test.ts` (NOT `spinoff.ts` and `spinoff.test.ts`: lane C).
- `web/src/relay/access.ts` and `access.test.ts` (401 meaning changes: session ended), `web/src/App.tsx`, `Root.tsx`, `main.tsx` (open by `?doc=`), `web/src/contracts/types.ts`, `web/src/export.ts`, `web/src/lib/blobs.ts`, `web/src/jobs/assets.ts` (+ its tests) and any other reader of `locations` that the first-hour inventory finds (listed in the decision).
- `clan-store/src/{mirror.ts,persist.ts,bundle.ts,types.ts,migrate.ts}` (mirror becomes the save queue), `clan-store/app/index.html` and `clan-store/src/app-template.gen.ts` only if the summary view needs the client; contract: `contracts/document.schema.json` (stop writing `assets[].locations`; `locations` stays optional and is ignored on read; `client_id` stays; no other change), `contracts/examples/*` that carry locations.
- `scripts/run-production-local` (sets `NAPKIN_PRODUCTION_MEDIA_BASE` for the local relay; ports via env).
Interface provided: the Production page reads `?doc=<docId>` (section 2.5), lists through the library, opens by download, saves by `PUT save`. Its internal `ServerCopy` API keeps the names the other web code uses (`save(reason)`, `onConflict`).
Consumes: section 2 routes (against `hostStub.ts` first, the real napkin-web from lane A's merge), `/api/session.media_base`.
Tests: S1-9 to S1-12, S1-13 (web half), S1-16, S1-17, S1-8, S1-24 (mock walk). Checks: `scripts/check.sh --only production-tool,frontend`.
First hour (before editing): inventory every reader of `assets[].locations` and `projects/*` callers of `/clan` and `/projects` (grep), and record the rule in a decision (https locations never written and never trusted; `idb://` stays browser-local and is removed from the saved bytes; `s3://` decided by what the jobs need). Anything outside B's files that needs a change goes to the lead.
Ports: 20430 to 20439.

### Lane C: spin-offs, client, shell open path, deletion of the bridge (about 4 agent days)

Record/stage: `production-in-library`, stage 1. Branch `feat/pc-spin`.
Owns (exact):
- Rust: `crates/napkin-web/src/spinoff.rs` (DELETED), `crates/napkin-web/src/production.rs` (remove what only the bridge used; keep the proxy, identity signing, assets pass), `crates/napkin-web/tests/{spinoff.rs (rewritten for the plain route), production.rs, no_bridge.rs (new)}`, `crates/napkin-web/tests/fixtures/hollow-oak-brief.clan`, `crates/napkin-host/src/{library.rs,clients.rs,listing.rs}` (Production as a spin-off target from brief, research, territory; as a source for Deck; `source_uri` becomes `doc:<id>@<version>`; client carried), `crates/napkin-host/tests/{clients,routes,view_from_library}.rs`, `crates/clan-sdk/examples/make_production.rs` (the app's `spinoff` declaration for the new sources).
- `api.rs`/`lib.rs`/`main.rs`: after lane A has merged (section 4): delete `.merge(crate::spinoff::router())`, delete the 422 guard in `spinoff_document`, remove the relay wiring only the bridge used.
- Shell: `app/src/App.tsx` (library item of Production opens `/production/?doc=<id>`; the `spinoffToProduction` branch goes), `app/src/host/{http.ts,types.ts}` (drop `spinoffToProduction`), `app/src/shell/landing/tools*`, `app/tests/barInventory.test.tsx`, `app/e2e/links.spec.ts` if it names the old path.
- Web (the one exception in B's folder): `production-tool/web/src/projects/spinoff.ts` and `spinoff.test.ts` (calls `POST /t/{tenant}/d/{doc}/spinoff`; maps `app not installed` to "Deck Maker is not installed here").
- `scripts/import-production-projects` (S1-7), `docs`: none (T3 writes docs).
Interface provided: spin-off routes unchanged in shape (section 2.6); library listing with client (section 2.7).
Consumes: lane A's merged `api.rs`; the stub for the save route is not needed.
Tests: S1-1 to S1-5, S1-7, S1-13 (host half), S1-20, S1-21, S1-23, S1-3, S1-4. Checks: `scripts/check.sh --only rust,wasm,frontend,production-tool`.
C-late (starts only after `fix/deck-uat` is merged into develop and develop is merged into the integration branch; same agent, same branch): the Deck's production reader reads the library document: S1-19. Files then also owned by C: `crates/napkin-host/src/ops/read.rs` (`production_upstream`), `engine/deck/from_production.py`, `engine/deck/prod_picker.py` (hosts no longer taken from `locations`; the by-hash relay path is the way), `server/napkin/handlers/attach_production.py`, `server/napkin/handlers/build_deck.py`, `engine/deck/tests/{test_from_production,test_prod_picker,test_prod_groups,test_production_spinoff}.py`, `server/tests/test_attach_production.py`. Rule: do not change `fix/deck-uat`'s behaviour (every final reaches the deck); re-run its tests and add the library-source case.
Ports: 20440 to 20449.

## 2. Contracts (frozen; T1 writes them into `docs/contracts/production-clan-app.md` and the vectors)

Notation: `{t}` tenant id (from `GET /api/session` `tenant`), `{doc}` the library document id (the same string used by `/t/{t}/d/{doc}`). `V` is a version string `sha256:<64 hex>`, the sha256 of the archive bytes. All routes are under `/api` and need the session cookie (no session: 401). Another tenant's document: 404.

2.1 Save: `PUT /api/t/{t}/d/{doc}/save`
- Request headers: `Content-Type: application/vnd.clan+zip`, `If-Match: "V"` (required), `X-Clan-Reason: interval|accept|manual|handoff|export|landing` (default `interval`). Body: the `.clan` bytes, at most 32 MiB.
- 200: `{"version":"V2","saved_at":"<RFC 3339>","snapshot":true|false}` with `ETag: "V2"`. `V2` equals the sha256 of the bytes sent.
- 409: `{"error":{"code":"conflict","message":"This project was saved from somewhere else since you opened it."},"latest":"V3"}`; the store is untouched.
- 428 no `If-Match`. 422 the document is not an instance of `ie.napkin.production`, or the archive's `manifest.id` is not this document's. 400 unreadable archive. 413 too large. 404 missing or another tenant's. 401 no session.
- The manifest's `client` and `title` in the saved bytes are taken as sent (the tool preserves them; S1-13).

2.2 Read: `GET /api/t/{t}/d/{doc}/download` (exists) additionally returns `ETag: "V"` and `X-Saved-At`. The tool's `open` uses it. Version of the document is also in `GET .../data`.

2.3 Base check (every writer): `PartStore::apply(Change{doc,bytes,base})`: `Base::At(V)` and the stored version is not `V` gives `HostError::conflict`, HTTP 409 with the body of 2.1 and `latest`; `Base::Absent` over an existing document gives 409. The check and the write are one critical section per document. A write is temp file in the same directory, fsync, rename, fsync of the directory. Only `crates/napkin-web/src/store.rs` implements it; `napkin-host` stays wasm32-clean.

2.4 Snapshots (host-internal, not a route): `<store root>/<tenant>/snapshots/<doc-slug>/<unix-ms>-<reason>-<hex12>.clan`. A snapshot of the saved bytes is taken when `reason` is `accept`, `handoff` or `export`, and for `interval`/`manual`/`landing` when the newest snapshot is 10 minutes or more old. Keep the newest 50; never delete the newest; never listed in the library; a tenant's ring is inside the tenant's directory. Restore is a documented copy (T3).

2.5 Page and open path: stage 1: `/production/?doc=<doc>` (the page reads the tenant from `/api/session`). No `doc`: the page shows its project list from `GET /api/t/{t}/library` filtered to `app_id == "ie.napkin.production"`. New project: `POST /api/t/{t}/documents {"app_id":"ie.napkin.production","title":"<name>","client_id":"<id>"?}` answering the existing OpenView (`path` is the doc id), then the page navigates to `?doc=<path>`. No Delete in stage 1 (S1-8). Stage 2 changes the path to `/production/d/<doc>` (alias kept one release).

2.6 Spin-off: `POST /api/t/{t}/d/{doc}/spinoff {"app_id":"<target app id>","title":"<opt>","map":"<opt>"}` answering OpenView (existing). Targets from `GET .../spinoff-targets`. Production is a target for brief, research, territory sources and a source for Deck. Not installed: 422 `{"error":"app not installed: <app id>"}`. The new document's `source_uri` is `doc:<source doc id>@<source version>`; `data.upstream.<source doc id>` holds the source's whole data and decisions; pictures are links by sha256 (`spinoff-asset-links`). The client of the source is the client of the new document. The routes `POST /t/{t}/spinoff/production` and `POST /t/{t}/production/{project}/spinoff` are removed (404).

2.7 Library item: `GET /api/t/{t}/library` lists Production documents like any other: `{path, title, app_id:"ie.napkin.production", client:{id,name}|null, ...}` (the existing `LibraryItem`; no new field).

2.8 Session: `GET /api/session` gains `"media_base": "<https base>"|null`. The tool resolves a picture of sha `h` as `${media_base}/<prefix>/<hex>` where the prefix comes from the asset's origin (`in` for uploads, `out` for generated, `ads` for renders), exactly the keys `production-tool/relay/blobs.py` writes. Lane B verifies the key layout against `blobs.py` in its first hour and records it; if outputs are not keyed by hash alone, B uses the relay's by-hash route (`POST /uploads` `where`) for those and records a decision; either way no address is stored in the document.

2.9 Document (contract 3): `assets[].locations` is not written and never trusted when read; `client_id` is unchanged; no other change.

2.10 Relay (T3): `GET|POST|PUT /clan*` and `/projects*` answer 410 `{"error":{"code":"gone","message":"Reload the page: projects now live in the library."}}`; napkin-web's `/production/api` proxy answers 404 for those prefixes. Jobs, uploads, assets, library, config and me are unchanged.

## 3. Ports (never 8091, 8788, 8797, 8191, 8888, 8897, 18xxx, 19xxx)

| Lane / use | Range |
|---|---|
| A | 20410 to 20419 |
| T | 20420 to 20429 |
| B | 20430 to 20439 |
| C | 20440 to 20449 |
| D (stage 2) | 20450 to 20459 |
| E1, E2 (stage 3) | 20460 to 20469 |
| Lead's final local live run | 20470 to 20479 (web 20470, relay 20471, model backend 20472) |

State dirs: `PRODUCTION_STATE=/tmp/claude-1000/pc-<lane>-state` or the lane's scratchpad, never the owner's `~/.local/state/napkin-production`.

## 4. Shared touch points (one owner at a time)

| File | Owner until | Then |
|---|---|---|
| `crates/napkin-web/src/{api.rs,lib.rs,main.rs}` | lane A until A is merged into the integration branch | lane C |
| `crates/napkin-web/src/production.rs` | lane C until stage 1 merges | stage 2 lane D, then stage 3 lane E1 |
| `production-tool/web/src/{App.tsx,Root.tsx,main.tsx}` | lane B until stage 1 merges | lane D |
| `app/src/App.tsx` | lane C until stage 1 merges | lane D |
| `docs/contracts/os-layer.md` and `production-tool-identity.md` | lane T (T3) | stage owners add their section through T |
| `production-tool/web/src/relay/http.ts` | untouched in stages 1-2 | lane E1 |
| `Dockerfile`, `.github/workflows/*` | nobody (no change planned); if a lane needs one it asks the lead | |

## 5. Order: what starts now, what waits, when it merges

Start now, at the same time: T1, A, B, C. They need only the contract above. T1 finishes in half a day and merges first; A, B, C pick up the vectors and stub from the integration branch with `git merge feat/production-as-clan-app` (never rebase a pushed branch).

Order of merge into `feat/production-as-clan-app` (the lead merges real branch histories with merge commits, never squash; after each merge the lead runs the suites the merge reaches):
1. T1 (contracts, vectors, stub).
2. A (host groundwork) with T2 (harness) if ready. Then PR-0 (stage 0) from the integration branch to develop: `release`-style title `host: check versions on write and keep snapshots`. While it is in review/CI, B and C keep building and pushing their branches but do not merge into the integration branch. The owner applies the Terraform plan (backup) before the deploy; the lead says "deployed, not yet live" until verified in AWS.
3. After PR-0 is squash-merged: the lead merges `origin/develop` back into the integration branch at once (clean: nothing else has touched those files yet), then merges `fix/deck-uat`'s result (it is already in develop). This is the Territories lesson: merge develop back before any further lane merges, so a squash never conflicts with later history.
4. B then C (both start from an integration branch that now equals develop plus T/A). C merges after B because the shell opens `/production/?doc=` which B's page serves. C-late (deck reader) merges last of the two.
5. T3 (relay 410, docs, schema).
6. PR-1 (stage 1) from the integration branch to develop: title `release`-free, `shell: keep Production projects in the library`. Then merge develop back again.
7. Live local walk by the lead (TEST-PLAN section 7), then UAT after the owner deploys PR-1 to UAT (relay first, then web; the relay change is only 410 stubs, so relay-first is safe), then the UAT walk.

After PR-1 is merged:
- Stage 2 (record `production-app-page`, lane D, about 5 agent days, branch `feat/pc-page`, ports 20450 to 20459): starts after PR-1 is in develop and merged back. Owns `crates/napkin-web/src/production.rs` (route `/production/d/{doc}`, alias for `/production/` and `?doc=`, CSP layer), `crates/napkin-web/tests/production.rs`, `production-tool/web/{vite.config.ts,index.html,src/App.tsx,src/Root.tsx,src/main.tsx}`, `app/src/App.tsx` (open path), `production-tool/web/e2e/clan-app/**` (un-fixme the stage 2 specs), `features/production-csp.clan` folded in. Interface: the path `/production/d/{doc}`, one CSP header. Tests S2-1 to S2-7. One agent; a second only if the CSP report-only run needs one.
- Stage 3 (record `production-jobs-via-host`, about 9 agent days, starts after D merges): two lanes in parallel on a written credential contract (in the record's design): E1 napkin-web and the web client (`crates/napkin-web/src/{production.rs,relay_client.rs (new),dogfood.rs fold}`, `crates/napkin-host` landing inbox, `production-tool/web/src/{relay/http.ts,jobs/*,projects/session.ts landing reconcile}`; ports 20460 to 20464) and E2 the relay and infra (`production-tool/relay/{identity.py,handler.py,service.py auth parts,runtime.py}`, `infra/envs/hackathon/{secrets.tf,lambda.tf}`; ports 20465 to 20469). Merge E2 first (it accepts both credentials for no time: no backward compat, so the two deploy the same day; relay deploy by hand), then E1. Tests S3-1 to S3-6. Stage 3 may also start its E2 half earlier, in parallel with D, because E2's files (`production-tool/relay/*`, `infra/envs/hackathon/*`) overlap with nothing in D; the lead decides when the agent budget allows.
- `production-relay-to-middleware`: parked, no lane.

Agent budget, in order of days: T 4, A 3, B 6, C 4 (stage 1 and 0 total about 17 agent days in parallel, about 6 to 7 calendar days at 4 lanes), D 5, E 9 in two lanes. The owner-visible change completes at the end of stage 2.

## 6. What the lead checks at each merge

- The lane's tests from TEST-PLAN ran (names in its record's `last_check` and `build_log`), not only "green": for UI lanes, paired screenshots looked at.
- No file outside the lane's list changed (`git diff --name-only <integration>...<lane>` against section 1).
- `scripts/feature checked <record> pass "<suites>"` recorded.
- Handoff text names what the next lane needs (new names, env vars, ports).
- Fresh start list: the owner has named the 3 or 4 projects to bring in; the lead runs `scripts/import-production-projects` on UAT after PR-1, never on the owner's live project.
