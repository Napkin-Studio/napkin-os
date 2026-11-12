# End-to-end smoke (Playwright)

The real shell, the real `napkin-web` and real documents, on 127.0.0.1. No model,
no network service, no secrets, and no client material: every client in the tests
is a placeholder (Client A, Client B...).

## Run it

```bash
cd app
npm ci                                  # once
npx playwright install chromium         # once, about 100 MB
npm run e2e                             # builds the shell and napkin-web, starts the stack, runs the specs
```

From the repo root, the same thing as a suite: `scripts/check.sh --only e2e`.
It is never part of `--all` or of what a change "reaches": it needs a browser,
and it joins CI only as a separate non-required job once it has been stable
for a week (feature `landing-circles`, owner decision).

`npm run e2e` starts `e2e/stack.mjs` itself (see `playwright.config.ts`):

1. `vite build` into `app/dist` (skip with `NAPKIN_E2E_SKIP_BUILD=1` when it is current);
2. packs Brief Maker, Research and Deck Maker with the SDK's examples into a temp seed directory;
3. `cargo build -p napkin-web`, then starts it on `127.0.0.1:18080` (`NAPKIN_E2E_PORT` to change)
   with anonymous sessions, an empty temp data directory and that seed installed into every new workspace.

Each test opens its own browser context, which is its own anonymous tenant, and seeds
what it needs through the tenant's own API (`POST /clients`, `POST /documents`, and a
document's `patch-data` for an open contest or a Deck run). Nothing is shared between tests.

## Run the stack by hand

```bash
cd app && node e2e/stack.mjs            # then open http://127.0.0.1:18080/
```

## Screenshots

`NAPKIN_E2E_SHOTS=/some/dir npm run e2e` also writes a PNG of each landing screen
(light, dark, phone, empty, twenty clients, a refused add) from `shots.spec.ts`.

## What it covers

`landing.spec.ts`: the landing from the server's counts, the agency circle to the clients
page, Add client (and its refusal), reload, open a client, back and forward, the trail,
starting a document for a client, hostile hashes, a second tenant, the Launcher fallback,
the keyboard, reduced motion. `shots.spec.ts`: needs you, running and failed computed from
the documents themselves, urgency order, accessible names.
`research.spec.ts`: the SDK's packed research example uploaded and opened from its link; the report body
(band, stats, the ask, numbered sections, the record as report sections), the evidence map widening the
inspector beside the report, a summary line traced and a crumb back, a finding's card, a gap put into Ask the
research (never sent), the record filtered, and the phone bottom sheet.

## The J001 pilot suite (feature `j001-pilot-suite`)

`j001-pilot.spec.ts` is the Phase 1 acceptance suite: tests 1 to 18 of `docs/napkin-os-build-prompt-v3.1.md`
section 9, each named by its number and run at 390 and 1440 px. A test whose feature is not built is written
in full and marked `test.fixme`; the `TESTS` table at the top of the file names the feature record that turns
it on, and that feature removes the fixme when it lands. Count what is left:

```bash
node e2e/phase1-fixme.mjs           # the slug for each fixme test and the count (Phase 1 is done at 0)
node e2e/phase1-fixme.mjs --gate    # the same; exits 1 while the count is above 0
```

Every pilot test runs in one plain `scripts/check.sh --only e2e` (or `npm run e2e`): the tests that sign people in
(1 to 7, 9, 10, 14, 17, 18) use the roster server on `NAPKIN_E2E_ROSTER_PORT`, so `NAPKIN_E2E_ROSTER=1` is not needed.
Tests 6 and 7 once used the primary server and needed that switch; they now open the roster server like the rest. Test 7
reads the Territories page open (a brief signed by the planner and the creative director and confirmed by the client, in the
agency `wk`) and every other page as the admin.

Tests 11, 12 and 13 run. Test 11 reads the chains of the seeded documents and sends an unattributed write, which the host
refuses with a 400. Test 12 runs the engine's own retrieval over stand-in rows (`seed/j001/retrievalTrace.py`, through
`uv`, with four rows tagged `cannes` and no corpus text) and reads the trace: no `cannes` hit, each hit's source named. Test 13
cuts the network while a part of the J001 brief is written, and Try again saves it. Test 15 stays `test.fixme`: the shell says
the reserved estimate is returned, but the web meter never returns it. Its other parts run in `runFailed.spec.ts`.

`seed/j001/` is the de-identified job ("Client A, an Irish whiskey"): `seedJ001(page)` writes its documents
through the tenant's own API, as `seedClients.ts` writes clients. No real brand, client or person appears in
it. To prove that, keep a list of the real names in a file **outside the repo** (one per line) and run
`NAPKIN_DENY_LIST=<that file> node e2e/seed/j001/denyList.mjs`; `seedJ001` makes the same check and throws on a
hit. With no list supplied the check passes and says so. `j001-seed.spec.ts` tests the seed and the check.

The stack unsets every provider key for the server and sets a fake canary key (test 8). The role tests sign
people in, and a server has one auth mode per process, so the stack also starts a second `napkin-web` in roster
mode on `NAPKIN_E2E_ROSTER_PORT` (default 18082) beside the anonymous one: the placeholder people and their roles
are in `seed/j001/people.mjs`, and a spec opens its context with `open(browser, size, 'white', { roster: true })`
(features/roles-and-homes.clan, decision "the e2e stack serves both auth modes"). `roles-homes.spec.ts` covers the
homes, the O and the switcher; `NAPKIN_E2E_SHOTS=<dir>` also writes a screenshot of each.

## The visual brief (feature `visual-brief`)

`visual-brief.spec.ts` runs on the roster stack at 390 and 1440 px: a brief signed by both people and confirmed by the
client, a territory typed on the Territories page, the visual brief that is spun off, and the creative director's approval
(one `approve` decision, then a 409 on a write, then a new version with the first left as it was). The frames are plain
gradient PNGs made in the test; nothing generates an image. The Territories retrieval check runs the engine's mix path over
stand-in rows (`seed/visual-brief/territoryTrace.py`) with `cannes`, `effie` and `warc` rows. `VISUAL_BRIEF_SHOTS=<dir>`
also writes a screenshot of each new screen. No pilot test carries the slug `visual-brief`, so `phase1-fixme.mjs` is unchanged.

## The Phase 2 suite (feature `j001-phase2-suite`)

`docs/design/phase2-acceptance.md` lists tests 19 to 73, one or more per Phase 2 record. Each is written in full before its
screen exists, in **one spec file per record**, `j001-p2-<slug>.spec.ts` (17 files: sixteen records and the suite's own, tests 71
to 73), at 390 and 1440 px. A test whose record has not built its screen is `test.fixme(t(N), ...)`; a plain `npm run e2e` skips it
and runs the rest. `j001-pilot.spec.ts` is Phase 1's and is not edited; its 18 tests still run in the same plain run.

```bash
node e2e/phase2-fixme.mjs                    # each fixme test with its record's slug, and the count
node e2e/phase2-fixme.mjs --gate             # the same; exits 1 while the count is above 0 (2 if the files disagree)
node e2e/phase2-fixme.mjs --slug idea-room   # one record's burn-down
npx playwright test e2e/j001-p2-idea-room.spec.ts   # one record's tests (a Phase 2 run alone: e2e/j001-p2-*.spec.ts)
```

- `phase2/tests.mjs` is the **read-only registry**: number, slug, spec file, short title and the fact as the acceptance document words
  it. It is never edited when a test is turned on: live or fixme is read from the spec file alone (`phase2/count.mjs`). A unit test
  (`app/tests/phase2Suite.test.ts`) compares it with the document, and the counter refuses a number declared twice, in the wrong file
  or not at all, a fixme with no slug, and a record with live tests and no page.
- **To turn a test on** (the owning record): in your own spec file, change `test.fixme(` to `test(` for the test, replace every line
  marked `ADJUST(<slug>)` with what you built (the selectors, routes and test ids in a fixme body are guesses from the design; the facts
  read from the chain and the API are the part to keep), make it pass at both widths, and add your pages to your own
  `j001-p2-<slug>.pages.ts` (`export const PAGES: Phase2Page[]`, see `phase2/pages.ts`). You edit only your spec, your pages file, your seed
  file under `seed/j001/p2/` and your answer files.
- **Tests 71 to 73 run from the first day** (`j001-p2-j001-phase2-suite.spec.ts`): attributed writes over every Phase 2 document the seed
  writes (`seedPhase2`, which skips a document whose app is not installed yet and says so); axe in the three modes, a 44 px primary button
  at 390 px and no em dash on every page in every `j001-p2-*.pages.ts`; the canary key and a retrieval trace with no Cannes, Effie or WARC
  hit, and a run log with no model event. A primary button is `.ch-btn-primary`, `.ns-primary` or `[data-primary]`: mark yours if it uses
  another class.
- **The stand-in middleware** (`standin.mjs`, started by `stack.mjs`) answers a task from `seed/j001/p2/answers/<task>.json` when that
  file exists (the reply's own keys: `task`, `handler`, `result`, `change`, `trace`; the stand-in adds `api` and `job`) and a variant
  from `<task>.<variant>.json`, picked by `POST /control {variant: {<task>: <name>}}`. `POST /control {fail: <task>}` makes the next
  request for that task return a 502 `provider_error` once. `GET /control/log` lists the tasks asked and the time, and nothing else. Any
  other task gets the old canned `start_campaign` reply, so every Phase 1 spec is unchanged. `pilot.ts` has `control(page, ...)` and
  `middlewareLog(page)`. A record that adds an answer file adds a middleware pytest that validates it against its handler's output schema.
- **The seed** (`seed/j001/p2/`): one file per record (placeholder content only, "Client A, an Irish whiskey"), `documents.mjs` listing
  the documents each record's app makes (each must hold every key its template schema declares; the unit test checks a document as soon as
  its `app/templates/<app>/schema.json` exists), `wall.mjs` with the canary sentence and `plantCanary` for the wall tests, and
  `reviewers.mjs`. `seed/j001/people.mjs` gains the five Phase 2 roles, a second copywriter, a person with a Phase 1 and a Phase 2 role, and
  a second agency (`@bq`, its own workspace). The deny-list check (`seed/j001/denyList.mjs`) reads the whole folder.
- The suite calls no model and no paid provider. It is not part of `check.sh --all`.
