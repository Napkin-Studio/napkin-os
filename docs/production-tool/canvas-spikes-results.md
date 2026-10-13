# Canvas spikes: results

Feature: `features/canvas-spikes.clan`. Approved by Shrey on 2026-10-13, with the
recommended answers: devices, raters and thresholds as the design proposes until
he names them, Hocuspocus as the local sync server, and fork-now as the default if
FORK wins.

**Status: built. The headless runs are done. The device runs are pending.** The
decision rule needs gates measured on the primary iPad, the floor iPad and the
Windows laptop, and no gate is decided yet. Every number below comes from
headless Chromium on a desktop. **None of them is a device measurement.** They
show that the spikes, meters and scenarios work end to end, and they give a
desktop floor. Nothing more.

## 1. What was built

| Branch | Head | Contents |
|---|---|---|
| `spike/canvas-excalidraw` | `7d57f2b` | Harness `b3b7f8c`, `5190b01`, `d5df837`, `aa67652`, `414ee28`; Spike E `a2e5fa6` (numbers below) and `7d57f2b` (by-hand recording); guard `0319e79`; scratch record log `7f3273f` |
| `spike/canvas-own-engine` | `856ab20` | Harness cherry-picked: `4884c23`, `43b4e33`, `6a09b85`, `16c315a`, `6e46757`; guard `b5582e9`; Spike O `8dbb01f` and `856ab20`; scratch record log `082256d` |

Both branches were cut from `feat/canvas-spikes` at `cca8a08`, which is the
"building" commit on top of canvas-core `b608022`. Neither branch is merged
anywhere and neither is pushed. Spike O took the harness by cherry-pick only.

### The harness (`production-tool/spikes/harness`, identical on both branches)

- `scene.ts` is a seeded scene generator: 10 boards, 300 previews (640x360 WebP),
  5,000 perfect-freehand strokes averaging 60 points, and 500 typed nodes. Their
  kinds come from canvas-core's `NODE_REGISTRY`. Each scene has a fingerprint, and
  seed 1 gives `f8082c81`.
- `frames.ts` is the rAF frame recorder, with G3's pass rule built in.
- `drift.ts` is the overlay-drift meter, with G4's rule.
- `inputPaint.ts` is the input-to-paint meter, plus a pointer-capability probe.
- `driver.ts` is the synthetic driver. It pans at 2,000 px/s and pinches from 0.25x
  to 2x through WheelEvent dispatch, and draws pen strokes through PointerEvent
  dispatch.
- `fuzz.ts` is the two-client fuzz bot with scene digests and a ping-pong latency
  probe. The probe uses half the round trip, so the device clocks never have to agree.
- `undo/specs.ts` holds the 22 G5 scenarios, written once against `UndoDriver` in
  `undo/types.ts`. `undo/coordinator.ts` has the PatchSink stub, shaped like
  `{path, value, base_version, origin}`, and a stub coordinator. Both run over the
  real `SnapshotDocumentStore`, `doc/undo.ts` and `CanvasDocSync`.
  `undo/yRefDriver.ts` is an engine-free reference driver.
- `yscene.ts` is the Y scene shape both spikes bind to (see §4).
- `control.ts` is the control page: bare canvas2d plus perfect-freehand.
- `bench.ts` refuses to record from a dev build, and logs the user agent, commit,
  seed and fingerprint with every number.
- `scripts/` holds the rest:
  - `sync-server.mjs`: Hocuspocus 4.7.1, in memory, on 0.0.0.0:1234. It took well
    under the half day the approval allowed.
  - `gen-previews.mjs`: the 300 WebP files.
  - `licences.mjs`: the licence check, which also reads the bundled fonts.
  - `fuzz-headless.mjs`: G9 at the Y level.
  - `measure.mjs`: the headless runner.
- `npm run verify` runs eslint (the harness may not import an engine or a spike),
  vitest, `tsc -b` and the licence check. It passes on both branches: 51 tests on
  E's branch, 54 on O's.

### Spike E (`production-tool/spikes/excalidraw`)

Excalidraw is pinned to exactly 0.18.1. `production-tool/web/package-lock.json`
also resolves `@excalidraw/excalidraw` to 0.18.1 (lines 496-498).

- **canvas-core's `ExcalidrawAdapter`** is used as-is from `@web/canvas/adapter/excalidraw`.
  Only `commit()` is overridden, so writes go through the Y binding (amendment A1).
  The link tool uses the adapter's `provenanceArrow` and `bindArrow` factories.
- **The Y binding** (`binding.ts`):
  - It diffs element versions from onChange and writes the changed elements with
    the LOCAL origin.
  - The tool's own writes go through `commit()`, which updates the scene and Y in
    one call.
  - Remote, undo and redo writes are applied through `reconcileElements` with
    `CaptureUpdateAction.NEVER`.
  - Y.UndoManager is grouped by gestures: `stopCapturing()` at pointer-down, and
    after the first write that follows pointer-up.
  - `api.history.clear()` runs after each step.
  - Ctrl/Cmd+Z, Cmd+Shift+Z and Ctrl+Y are caught in the capture phase on the wrapper.
  - `.undo-redo-buttons` is hidden by CSS.
- **The virtualised overlay** is one layer, CSS-transformed in the scroll callback,
  with no React render per frame. It holds rbush-culled DOM bodies for typed nodes
  and chips for previews.
- **The sketch-area tool** draws ratio-locked areas. It locks the ratio during a
  resize by re-sending each pointermove with `shiftKey` set. Excalidraw's own
  `shouldMaintainAspectRatio` is `event.shiftKey`, at chunk-4FTI6OG3.js:7951. The
  onChange correction stays as a backstop.
- **The link-port tool** works from DOM out-ports. It highlights the targets
  `canLink()` allows, shows canLink's refusal reason, and saves a bound arrow with
  `customData {kind:'link', id, role}`. Both preview sources are instrumented.
- **Open and double-click**: a capture-phase dblclick opens tool nodes. Text, image
  and frame double-clicks still fall through to Excalidraw. Nodes also have an Open
  button, and the wrapper sets `touch-action: manipulation`.
- **Pages**: `index.html` (bench), `undo.html` (two canvases, U1-U22, and a
  negative control at `?control=1`) and `control.html`.

### Spike O (`production-tool/spikes/own-engine`)

- **Dependencies**, all MIT and pinned exactly:
  - `@tldraw/store` and `@tldraw/state` 5.5.2. Both were checked as MIT on npm, and
    the `LICENSE.md` files shipped in the packages say MIT. `@tldraw/utils` 5.5.2
    is MIT too.
  - `rbush` 4.0.1, perfect-freehand 1.2.0 and yjs 13.6.33.
  - `fractional-indexing` 3.2.0, which is CC0-1.0.
- `npm ls tldraw @tldraw/editor` is empty, and verify fails if either appears.
- **The model** (`model.ts`) mirrors store records into the same Y shape.
  - Local writes use `extractingChanges`, which is synchronous. `store.listen` would
    not do: it is throttled to the next frame (`throttleToNextFrame`, Store.mjs:156).
  - Remote, undo and redo writes go in with `mergeRemoteChanges`.
  - The model is DOM-free, so U1-U18 also run in vitest.
- **The renderer**: a canvas2d renderer with a camera and rbush culling. It caches a
  Path2D per stroke (perfect-freehand), keyed by the immutable record, and keeps
  preview ImageBitmaps with a 160 px level of detail below 0.4x. A separate live-ink
  canvas draws the stroke in progress straight away. Typed nodes are DOM bodies in
  one layer, moved in the same frame the canvas draws.
- **Input**: pointerType routing.
  - Pen draws, and every touch is ignored while the pen is down.
  - Touch: one finger pans and two fingers pinch. A touch never draws.
  - Mouse draws, selects and drags, or pans, depending on the tool.
  - The wheel pans, and ctrl+wheel zooms by `exp(-deltaY/100)`.
- Double-click and Open work as in Spike E, and so do undo keys and Delete.
- The pages are the same three as Spike E's.

## 2. Headless results (NOT device measurements)

These were run with `npm run measure:e` and `npm run measure:o`.

| | |
|---|---|
| Machine | AMD Ryzen AI 7 350 (Radeon 860M), Linux |
| Browser | Headless Chromium 153.0.8010.52 |
| Viewport | 1366x900, DPR 1 |
| Network | Loopback |
| Scene | Seed 1, fingerprint `f8082c81`: 5,310 elements, or 5,810 with the 500 nodes |
| Build commits | E `a2e5fa6`, O `6e46757` (both clean) |
| Raw JSON | `production-tool/spikes/results/*-headless-*.json` (gitignored; re-run to reproduce) |

Headless Chromium caps rAF at 60 Hz, and its frame times sit on 16.7 / 33.3 / 50 ms
steps. Synthetic wheel input skips touch and the Pencil entirely.

### G5: one undo per person (22 scenarios)

| | Result |
|---|---|
| Reference driver, wrapped Y shape (vitest) | U1-U20 pass; U21-U22 skipped (no engine) |
| Reference driver, flat Y shape (the design's literal shape) | **U5 and U6 fail** (see §4, finding F1) |
| Spike E, undo lab, two real Excalidraw 0.18.1 canvases | **22/22 pass** |
| Spike E negative control (`undo.html?control=1`, Excalidraw's own undo left in) | U21 and U22 fail, as they must. Desktop: "the engine's undo/redo buttons are visible". Mobile: "5 undo/redo shortcut(s) reached the engine". So the probe can see what it guards against. |
| Spike O, vitest on the model and in the browser undo lab | **U1-U18 pass** (its gate); U19-U22 skipped (not built / no engine history) |

### G3 and G4: frames and overlay drift, driven by synthetic wheel input

Each cell gives frame time p50 / p95 / share of frames ≤16.7 ms, then the in-page
drift p95.

| Run | Spike E | Spike O |
|---|---|---|
| Pan 2,000 px/s, working zoom, no nodes | 33.3 / 50.0 / 22% (drift 0.01 px, 102 chips) | 16.7 / 16.7 / 95% (no nodes) |
| Pan, working zoom, 500 nodes | 33.3 / 50.1 / 24% (drift 0.01 px, 260 bodies) | 16.7 / 16.7 / 95% (drift 0.01 px, 151 bodies) |
| Pan, fit zoom, no nodes | 16.7 / 50.0 / 89% | 16.7 / 33.3 / 88% |
| Pan, fit zoom, 500 nodes | 16.7 / 50.0 / 88% | 16.7 / 33.4 / 87% |
| Pinch 0.25x→2x in 3 s, no nodes | 16.7 / 16.7 / 96% | 16.7 / 16.8 / 93% |
| Pinch, 500 nodes | 16.7 / 16.7 / 95% | 16.7 / 16.8 / 89% |

Spike O's static-canvas draw takes 1.4-1.8 ms p50 and 2.0-4.5 ms p95 per frame.

How to read this table:

- On this desktop, Spike E misses G3's working-zoom rule during a pan: p95 50 ms
  against a threshold of 20, and 22% of frames under 16.7 ms against 95%. Spike O
  meets it. That shows a direction, nothing more. The iPad numbers decide.
- In-page drift is near zero for both, by construction. Spike E moves its overlay
  in the same scroll callback that changes the camera. Spike O moves its layer in
  the same rAF that draws the canvas.
- The in-page meter cannot see whether Excalidraw's canvas paints a frame after the
  overlay moves. Only the 240 fps film shows that, so G4's painted-alignment half is
  device work.

### G1: input-to-paint, 20 strokes of 120 points sent as CDP pen input

| | p50 | p95 | p99 |
|---|---|---|---|
| Control page | 15.3 ms | 16.3 ms | 16.6 ms |
| Spike E (5,310-element scene; Excalidraw `penMode` and `penDetected` became true) | 32.3 ms | 33.8 ms | 34.6 ms |
| Spike O (same scene) | 15.1 ms | 16.3 ms | 17.5 ms |

Spike E is measured to its onChange. Excalidraw paints the new-element canvas in
its own pass, so this is close but not exact. The gate itself is G1's film: tip to
ink, at most 50 ms median and 70 ms p95, and no more than 15 ms over the control
page. On this desktop, E sits about 17 ms over control and O about 0.

### G6, G7 and G8: tool checks driven by trusted CDP mouse input

| Check | Spike E | Spike O |
|---|---|---|
| G7: Open button | opens | opens |
| G7: double-click on a tool node | opens | opens |
| G8: script → storyboard | saved as a bound arrow, role `drives` | not built |
| G8: video → script | refused: "A video cannot feed a script" | not built |
| G8: script → picture | refused: "A script cannot feed a reference" | not built |
| G6: one 16:9 area, resized by its corner handle | error 2e-16 after pointer-up; **0** off-ratio passes during the drag (shift lock) | not built |
| G6: 16:9 + 9:16 + 1:1 areas plus a stroke, resized together by the selection corner | all three exact after pointer-up | not built |
| G6: before the shift lock (correction in onChange only) | 29 of 30 moves were >2% off before correction. Each could have been painted, which would fail "at most 1 frame per drag". | n/a |

The shift lock fixes that last row, and it is adapter work, not a fork. See finding F4.

### G9: two clients on Hocuspocus over loopback, fuzz bot for 60 s each

| | Spike E | Spike O | Y only (`fuzz:headless`, Node, 5 s) |
|---|---|---|---|
| Converged (ids, positions, sizes, deletion, z) | yes (374 elements) | yes (374) | yes |
| One-way latency p95 (ping-pong / 2) | 4.5 / 4.1 ms | 2.4 / 2.3 ms | 1.9 ms |
| Undo depth = local steps (no remote change in the stack) | 1175/1175 and 1174/1174 | 1174/1174 and 1174/1174 | 98/98 |
| Index repairs Excalidraw wrote by itself | 6,612 and 5,360 elements | n/a | n/a |

Index repairs are explained in F2. The full 10-minute G9 is a device run (§5).

## 3. Licence result

`npm run licences` passes on both branches.

- E's branch has 382 packages and O's has 158. Every licence field is on the
  design's list (MIT, Apache-2.0, BSD-2/3-Clause, 0BSD, ISC, CC0-1.0, OFL-1.1),
  except the flagged ones below.
- **Flagged for the owner.** All are permissive, but they are not on the design's list:
  - `lightningcss` and its platform package: MPL-2.0. Vite's build tool, used
    unmodified from npm, and never shipped in the bundle.
  - `minimatch` 10.2.6: BlueOak-1.0.0, a dev tool.
  - `robust-predicates` 3.0.3: Unlicense, inside Excalidraw's mermaid dependency.
  - `pako` 2.0.3: MIT AND Zlib, inside Excalidraw.
  - `khroma` 2.1.0 has no licence field. It ships an MIT licence file, which the
    check re-reads on every run.
- `tldraw` and `@tldraw/editor` are not installed on either branch.
- **Excalidraw's bundled fonts** (234 files, 9 families) were read from their own
  WOFF2 name tables (`harness/scripts/fontnames.mjs`):

| Family | What the font says | Upstream check still to do by hand |
|---|---|---|
| Assistant, Cascadia, Lilita, Nunito, Virgil | SIL OFL 1.1 | confirm the upstream repos |
| ComicShanns | MIT | confirm upstream |
| **Excalifont** | "Copyright (c) 2024 by Excalidraw. All rights reserved." No licence string. | find Excalifont's published licence (excalidraw/excalidraw repo, fonts) |
| **Liberation** (LiberationSans-Regular) | The 1.x Ascender string: "use … is subject to the license agreement under which you accepted the Liberation font software". | Liberation 1.x was GPLv2 with a font exception; 2.x is OFL. Confirm which one Excalidraw ships. |
| **Xiaolai** | "Copyright © 2020 LXGW". No licence string. | confirm the upstream licence (LXGW, believed OFL-1.1) |

The plan's §7 font gap stays open until the three bold rows are checked against
their upstream sources.

## 4. Findings so far (for live-sync, canvas-core and the decision)

- **F1. The Y scene shape needs a small change.** The design says "one Y.Map entry
  per element holding the element JSON". Under Y.UndoManager that shape cannot undo
  a create after someone else has edited the element: U5 and U6 fail on the
  reference driver in flat mode. Undoing the create deletes A's item, but B's later
  write sits to its right and survives. The fix is to keep one entry per element,
  but make the entry a small `Y.Map` with the JSON under `el`
  (`harness/src/yscene.ts`):
  - A create inserts the entry.
  - An edit replaces `el` inside it, which is still last writer wins per element.
  - Undoing the create deletes the whole entry, together with the other person's
    later edits.
  - Both spikes and the reference driver use this shape, and U1-U20 pass with it.

  live-sync should adopt this shape or record a decision against it.
- **F2. Excalidraw repairs z-order by itself.** It rewrites fractional indices
  (version, versionNonce, index, updated) after concurrent adds on top. These writes
  arrive in onChange looking like the person's own edits. With the binding as first
  written, they entered the undo stack (depth 641 for 587 steps) and were synced as
  local edits. The binding now writes index-only changes as system writes, and depth
  equals steps again.
  - The cost is traffic: about 5 elements rewritten per fuzz op. live-sync must
    budget for it, or canvas-core must assign indices that do not collide, for
    example a per-client jitter.
  - Spike O has no such repair pass.
- **F3. Excalidraw's `version` cannot be the sync version under per-person undo.**
  An undo restores older JSON with a lower `version`, and `reconcileElements` would
  discard it. The binding applies Y's value at `max(local + 1, remote)`. So
  Excalidraw's version only drives rendering, and Y's last writer decides conflicts.
  live-sync must not compare Excalidraw versions across clients.
- **F4. Ratio-locked areas are possible in the adapter.** Re-sending pointermove
  with `shiftKey` during a resize makes Excalidraw's own resize keep the ratio, for a
  single area and for a multi-selection with a stroke. That takes off-ratio passes
  per drag from 29 to 0. A selection that holds an image is left alone, because
  Excalidraw inverts shift for images.
  - The cost is that the person cannot use shift for free resize on sketch areas,
    which is wanted anyway.
  - If the iPad film confirms 0 off-ratio frames, G6 is an adapter workaround and
    not a FORK trigger.
- **F5. `onPointerUpdate` is not a usable preview source for a port drag.** It never
  fired during a link drag. The drag starts on a DOM port, the port takes the
  pointer, and the canvas never sees the moves. 0 updates were seen; the wrapper
  listener took 15.8 ms p50 from event to handler, i.e. the next frame. Its type
  also lacks pressure, pointerType, coalesced and predicted points
  (types.d.ts:410-418). Spike E uses the capture-phase wrapper listener with
  `getCoalescedEvents`. That goes into amendment A2.
- **F6. Synthetic PointerEvents cannot take pointer capture**, and Excalidraw calls
  `setPointerCapture` on pointer-down. Headless pen input therefore has to go
  through CDP (`Input.dispatchMouseEvent`, `pointerType: 'pen'`). The harness's
  in-page `stroke()` works only on engines that tolerate this, such as Spike O. This
  is a test-method note for canvas-nodes' perf budgets.
- **F7. Spike O moves DOM and canvas in the same frame.** The node layer's
  transform is written inside the canvas render. In Spike E the overlay follows the
  scroll callback, while Excalidraw's static canvas renders on its own throttled
  rAF. Whether that shows as a one-frame separation is G4's film question.

### Adapter amendments for canvas-core (draft)

- **A1. `commit(els, {undoable})` routes through the sync binding.** `undoable` maps
  to the Y origin (LOCAL for the person's step, SYSTEM otherwise), not to
  Excalidraw's CaptureUpdateAction. Engine history is never used. Add
  `gesture(fn)`, or begin/end, so a multi-write drag is one step.
- **A2. A pointer stream.** The adapter exposes `pointer$`, with pointerType,
  pressure, coalesced points, buttons and modifiers, taken from a capture-phase
  wrapper listener. It is not taken from `onPointerUpdate`.
- **A3. A viewport-transform subscription that fires in the frame that paints.**
  `onScroll` fires before Excalidraw's canvas paints.
- **A4. `lockRatio(ids)`, or a ratio constraint on a node intent.** Spike E
  implements it as shift re-dispatch, and other engines implement it natively.
- **A5. `isBusy()` must also count our own gestures**, such as port drags and sketch
  drafts, not only Excalidraw's.
- **A6. Region export.** Still expected. The spikes did not need it.

### What live-sync's UndoCoordinator needs from PatchBus (from U8-U10)

- An origin tag on every patch.
- A way to group one scene step with one patch step and one document step, as one
  undo entry.
- Inverse patches sent as forward writes on the **current** `base_version`. That is
  a rebase, not a rewind. The stub refuses a stale base, and U10 checks the inverse
  carries the current one.
- Document steps that skip `stage` and `jobs`, because `doc/undo.ts` leaves those out.

### "Not built" lists (with estimates)

- **Spike E.** Every gate's machinery is built.
  - Not built: the iPad palette and the real toolbar (the spike hides Excalidraw's
    toolbar and uses a minimal one, the same in both spikes).
  - Not built: Pencil double-tap handling, which is recorded, not implemented.
  - Estimates for the live canvas are canvas-nodes' to make.
- **Spike O.** At the plan's scope. The plan's §4 total to reach today's level is
  35-50 engineer-weeks; these are the parts of it.

| Not built in Spike O | Estimate (agent estimate, for review) |
|---|---|
| Text and IME | 6-10 ew |
| Export (PNG/SVG, region) | 2-3 ew |
| Shapes and arrows (rough style, binding, elbow) | 8-12 ew |
| Link ports and a link tool (G8) | 1-2 ew |
| Ratio-locked resize and transform handles (G6) | 2-3 ew |
| Selection UX (marquee, multi-select transform, groups, frames) | 4-6 ew |
| Images: crop, insert and paste | 2-3 ew |
| Accessibility and keyboard | 2-4 ew |
| Hardening (Safari quirks, memory, very large scenes, tiled raster LOD for zoomed out) | 4-6 ew |

## 5. Device runs pending: what a person must run

Nothing below can be done by an agent. Use the devices and raters the design
proposes, until Shrey names others:

- **Primary iPad**: current Air or Pro, with a Pencil 2 or Pro, on the latest iPadOS
  Safari. Note it if the display is 120 Hz.
- **Floor iPad**: the oldest model we will support, with its own Pencil.
- **Laptops**: a MacBook Air on Apple silicon (Safari and Chrome), and a Windows
  laptop with integrated graphics (Chrome and Edge).
- **Phone**: an iPhone on Safari, for the view-only check.
- **Raters**: Shrey, Laurence if available, and one working creative.

**Hard gates must pass on the floor iPad and on the Windows laptop.**

### 5.1 Set up (the laptop on the office LAN, once per day)

Use two worktrees, so both spikes can be served at once. Run these from the repo:

```sh
git fetch
git worktree add ../spike-e spike/canvas-excalidraw
git worktree add ../spike-o spike/canvas-own-engine
```

Build and serve Spike E in terminal 1:

```sh
cd ../spike-e/production-tool/spikes
npm ci
npm run premeasure        # = npm run verify; it must pass
npm run build:e
npm run preview:e         # vite preview --host on :4173
```

Build and serve Spike O in terminal 2:

```sh
cd ../spike-o/production-tool/spikes
npm ci
npm run premeasure
npm run build:o
npm run preview:o         # :4174
```

Start the sync server in terminal 3. It prints the LAN address:

```sh
cd ../spike-e/production-tool/spikes
npm run sync              # ws://<laptop-ip>:1234
```

Before you start:

- Put the devices on power, with Low Power Mode off.
- Run both spikes on the same OS version on the same day.
- Close other tabs.
- The page shows "DEV BUILD: numbers refused" on anything other than the
  production preview.

Every page has a **save** button. It downloads a JSON file of every number taken,
with its context: user agent, commit, seed and fingerprint. Send it to the laptop
(AirDrop or mail) and keep it under `production-tool/spikes/results/devices/<date>/<device>/`.
That folder is gitignored. Videos go to the team drive and are linked here, never
committed.

### 5.2 URLs (replace IP with the laptop's LAN address)

| Page | Spike E | Spike O |
|---|---|---|
| Control page (start of each device day) | `http://IP:4173/control.html` | `http://IP:4174/control.html` |
| G3 scene, no nodes | `http://IP:4173/index.html?seed=1&scene=g3&nodes=0` | `http://IP:4174/index.html?seed=1&scene=g3&nodes=0` |
| G3 scene with 500 typed nodes | `…:4173/index.html?seed=1&scene=g3&nodes=1` | `…:4174/index.html?seed=1&scene=g3&nodes=1` |
| Undo lab (runs U1-U22) | `…:4173/undo.html?auto=1` | `…:4174/undo.html?auto=1` |
| G9, device side | `…:4173/index.html?scene=empty&sync=ws://IP:1234&room=g9-e&seed=2&tag=ipad` | `…:4174/index.html?scene=empty&sync=ws://IP:1234&room=g9-o&seed=2&tag=ipad` |
| G9, desktop side | the same with `&seed=1&tag=desk` | the same with `&seed=1&tag=desk` |

Check that the status line shows scene `f8082c81` on every G3 page.

### 5.3 The gates, per device (fixed thresholds from the record)

**Control first.** Open the control page. Draw 20 strokes with the Pencil, then
press "record G1 input-to-paint" and then save. Do this on every device, every day.

**G1, pen latency (hard).** Film the Pencil tip and the ink at 240 fps with a phone
on a tripod. Draw 20 strokes of 300 mm at a steady speed:

1. On the control page.
2. On E's G3 page (`nodes=0`): press **pen**, then **G1 start**. Draw the 20
   strokes, then press **G1 stop** and enter 20.
3. On O's G3 page, the same steps.

Count video frames from the tip moving to the ink under the tip.

- Pass: median ≤ 50 ms, p95 ≤ 70 ms, and ≤ 15 ms worse than the control page on
  the same device.
- Also record from the saved JSON: in-browser input-to-paint, and `pointer.coalesced`
  and `pointer.predicted` in the context. For E, also record `penMode` and
  `penDetected`.

**G2, palm and touch (hard).** In the pen tool, on both spikes:

1. Draw 20 strokes with the palm resting on the glass. Pass: 0 stray marks, and 0
   unintended pans or selections.
2. Pan and pinch with two fingers, the pen lifted, 20 times. Pass: 20/20.
3. Tap with a finger. It must not draw.

In O, **input stats** shows `palmIgnored` and `touchTaps`. In E, Excalidraw's pen
mode decides. Note what it does, and video it.

**G3, frames (hard).** Use the G3 pages, `nodes=0` and then `nodes=1`:

1. On the laptops, press **G3 pan**, **G3 pan fit** and **G3 pinch**. These use the
   synthetic driver.
2. On the iPads, press **rec 20 s**, type what you will do, and pan by hand at
   about one screen width per half second. Repeat for a pinch from fit to 2x, then
   for a pan when zoomed out to fit.
3. Spend 10 minutes in each spike in Safari, with Web Inspector attached from a Mac
   (Timelines → Memory). Note any tab reload and the peak memory.

Pass at working zoom: p95 ≤ 20 ms and ≥ 95% of frames ≤ 16.7 ms. Zoomed out to fit:
p95 ≤ 33 ms. No reload. Spike O must also pass with `nodes=1`.

**G4, overlay lag (hard).** The in-page drift comes with every G3 record
(`drift.p95` ≤ 4 px). Then film a fast pan at 240 fps in each spike, with
`nodes=1` and a node in view, plus a fast pinch. Stick high-contrast tape markers on
the screen where a node corner sits.

Pass: separation between the node body and the canvas content is no more than one
display frame (4 video frames at 60 Hz, 2 at 120 Hz) in at least 95% of sampled
frames.

For the baseline, measure today's app (`production-tool/web`, Character stage) the
same way.

**G5, undo (hard).** Open each undo lab on every device, with `?auto=1`. Save.

- Pass: E 22/22, O U1-U18.
- On the iPads, also check by hand in E that the toolbar shows no Excalidraw
  undo/redo, and that a keyboard's Cmd+Z undoes only your own step.

**G6, ratio areas (soft; E required).** In E, press **sketch 16:9**, **sketch 9:16**
and **sketch 1:1**, and drag out one area of each. Add a stroke with **pen**. Then:

1. Press **select** and select all four.
2. Resize by a corner and by a side handle, 10 times each, with the mouse and then
   with the Pencil.
3. Press **tool stats**. `ratioOffFrames` per drag and `ratioLockResent` are shown.
4. Film 2 drags at 240 fps.

Pass: after pointer-up every area is within 0.5% of its ratio. At most 1 frame per
drag deviates by more than 2%. Undo takes it back in one step, and the other client
(open the same room on a second device) sees it as one change.

**G7, double-click and Open (hard).** Use E and O with `nodes=1`:

1. Double-click a Script, Storyboard or Video node 20 times. The status line shows
   "opened …".
2. Tap Open 20 times by touch.
3. On iPad, record what a finger double-tap does and what a Pencil double-tap does.
4. In E, double-click a text (it edits), an image (it crops) and a frame name (it
   renames), 20 times each.

Pass: 20/20 on each, and no Safari double-tap zoom.

**G8, link ports (soft; E required).** In E with `nodes=1`, press **link** if the
port drag does not start on its own. Then:

1. Drag from a Script's right port to a Storyboard: it links.
2. Drag from a Video to a Script: refused, with the reason shown.
3. Drag from a Script to a Reference: refused, with the reason shown.

Do each with the mouse and with the Pencil, 10 times. Move each end, including from
the other client: the arrow must stay attached. Then press **tool stats** and save.
`lag.wrapperMs` is the preview lag.

**G9, two users (hard).** Start `npm run sync`. Open the desktop URL on the laptop
and the device URL on each iPad, one spike at a time. Press **G9 fuzz** on both
within a few seconds of each other. It runs for 10 minutes by default; `&fuzzMs=`
changes that. Save on both.

Pass:

- Both saved results carry the **same `digest`**, which means converged.
- `latencyOneWayMs.p95` ≤ 150 ms.
- `undoDepth` = `localSteps` on each side.

While the bot runs, also edit the same element by hand from both devices. The later
writer wins per element.

**Feel (margin only).** Three or more raters use the control page, E and O on the
primary iPad, in an order randomised per rater (write it down). Use the same minimal
toolbar. Score pen feel, pan and pinch smoothness, and (E only) port use from 1 to 5.

A spike gets a feel margin only if its median is at least 1 point higher and no
rater scores it lower.

**Phone (view only).** Open E's and O's G3 page (`nodes=0`) on the iPhone. Press
**rec 20 s** six times while panning and zooming, about 2 minutes in all.

Pass: no crash or reload, and p95 ≤ 33 ms.

### 5.4 Then

1. Fill in the per-gate table below. Give pass or fail, raw p50 and p95, the
   device, the OS and browser versions, the build commit from the saved JSON, and
   the video links.
2. Apply the decision rule in the record: STAY, FORK (fork-now from 0.18.1 if the
   App.tsx split has not settled) or OWN.
3. Record the owner's decision with `clan patch-decision`.

| Gate | Device | Spike E | Spike O | Video |
|---|---|---|---|---|
| G1 … G9, feel, phone | (to fill) | | | |
