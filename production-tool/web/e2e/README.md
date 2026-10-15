# e2e: the Production Tool in a real browser

Playwright specs that drive the web app with **real pointer and keyboard events**
(`page.mouse`, `page.keyboard`), for the bugs unit tests can't reach: jsdom and
happy-dom have no 2D canvas, no layout and no pointer capture. Started by
`features/image-editor-masks-layers.clan` (P0); every later UI item adds specs
here instead of a harness of its own.

## Running

```sh
cd production-tool/web
npm run e2e                                  # starts vite on :5199 and runs every spec
E2E_CHROMIUM=/usr/bin/chromium npm run e2e   # a local Chromium instead of Playwright's download
npx playwright test image-editor/job -g Cancel   # one file, one test
```

- `scripts/check.sh --only production-tool` runs it, with a system Chromium when
  there is one. CI runs `npx playwright install --with-deps chromium && npm run e2e`.
- `E2E_PORT` moves the dev server (default 5199). `E2E_REUSE=1` uses a server
  already on that port; otherwise a busy port fails, so another checkout's
  server never answers for this one.
- The clan store must be built first (`npm run clan-store`, or check.sh does it).
- Failures keep a trace: `npx playwright show-trace test-results/<test>/trace.zip`.

## What it runs against

The vite dev server and the **in-browser MockRelay** (`src/relay/mock.ts`). No relay,
no Runway, nothing paid. Each test gets a fresh browser context, so a fresh
IndexedDB and a fresh project.

Two dev-only hooks (never in a build, `import.meta.env.DEV`):

- `window.__seed` (`src/dev/seed.ts`): `frame({ ratio, shots, frameOn, w, h })` makes a
  project with storyboard shots and a drawn frame through the app's own helpers
  (the frame lands through `jobs/handlers.ts applyFrame`). `storyboard()` opens the
  Storyboard stage. `canvas()` opens a project on the canvas, for specs that drop pictures there
  (`canvas-picture/edit.spec.ts`, features/edit-canvas-pictures.clan).
- `window.__canvas` (`stages/Character.tsx`): the canvas adapter, to read elements, the
  selection and positions (`sceneToViewport`) back.
- `?mockDelay=<ms>` holds every mock job that long, so a spec can act while one runs.
  `[ask]` in a job's words makes the mock stop at `needs_input` with a question.

`window.__pt` is the open project's services (`doc`, `ui`, `runner`), for reading state back.

## Fixtures (`fixtures.ts`)

| Fixture | Does |
|---|---|
| `openEditor(page, { ratio, mockDelay })` | seed, open the Storyboard, open frame 1 in the Image editor |
| `at`, `frameBox`, `line` | frame coordinates (0-1) to page pixels |
| `drag`, `stroke`, `lasso` | pointer paths through `page.mouse` |
| `overlay(page)` | the committed mask canvas: painted and rim pixels, the box (0-1) |
| `picPixel(page, x, y)` | the composed picture's pixel |
| `session(page, frameId)`, `jobState(page, jobId)` | the editor's session and a job's state |
| `longTasksSince(page, i)` | long tasks (a PerformanceObserver installed before load) |
| `editRows(page)` | the Edits list as text |

## Writing a spec

- Wait on DOM or data conditions (`expect.poll`, `locator.waitFor`), never fixed sleeps.
- Read pixels and state back; don't assert on class names alone when the bug is visible.
- Keep timing budgets generous enough for CI's machines, and say what they guard.
