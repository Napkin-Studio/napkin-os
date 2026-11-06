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
