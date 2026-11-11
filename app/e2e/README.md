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
