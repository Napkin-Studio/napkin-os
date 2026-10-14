# Canvas storage and the Production Tool as an OS app: the owner's report

*Question asked: "Is the canvas a CLAN app as well?" (Shrey, 2026-10-14)*

## 1. Answers

**Where the scene lives: use a hybrid.** The live scene is a Y.Doc in its own store. It is not the `.clan`. The `.clan` holds one compacted checkpoint of the scene as a single binary member, `human/assets/canvas.ybin.zst`, written quietly in a Worker. Checkpoints happen at the 5-minute mirror, accept/lock, handoff and export, never on each edit. Writing the scene into the `.clan` on every write would freeze the main thread. Keeping it beside the `.clan`, as we do today, already fails at G3 size. The hybrid is the only option that passes all four criteria.

**Is the canvas a CLAN app? No, and it should not become one.** The project is a CLAN document that the OS knows about: home card, recents, spin-off from Brief Maker, lineage and the decision chain. The Production Tool stays a first-party, same-origin route at `/production`. That is already built on contract-v3 (`crates/napkin-web/src/production.rs`) and already decided (overhaul-plan D5 "Same origin", D7 "In-tool routes").

Moving the tool into the OS sandbox would not cost GPU speed; we measured no loss. It would cost features: storage, workers, threaded WASM, fullscreen, clipboard, downloads, multi-document access and, in device mode, sockets.

## 2. The numbers that decide it

The test scene is G3: 10 boards, 500 nodes, 300 previews referenced by hash, and 5,000 strokes with about 299k points. Runs used napkin-wasm from contract-v3 and the native `clan` 1.2.1 CLI.

| | Inside (scene as a `canvas` data member) | Beside (relay JSON, as today) | Hybrid (live Y.Doc, asset checkpoint in a Worker) |
|---|---|---|---|
| Save / checkpoint | 1.0–1.6 s median (p90 2.1 s in wasm, 3.2 s in the CLI) | 10–32 ms | 100–130 ms, in the Worker |
| Main-thread block per save | All of it. Every unrelated field edit also costs 0.6–1.0 s (against 67–84 ms without the scene) | 23–34 ms (4–9 frames missed in 5 saves) | 0.04 ms, with 0 of about 720 frames missed. Each live update costs 34 µs to hand to the Worker |
| File after 50 checkpoints | 2.47 MB, holding a 14.5 MB `data.yaml` | 4.7 MB JSON (quantised), 5.7 MB (float) | 2.17 MB (1.79 MB at the first checkpoint). Growth comes from content, not from checkpoints |
| Open | 7.6 s (6.5 s of it is the JS YAML parser, so this is overstated) | 6–38 ms | 0.35 s, then live |
| Collaboration | Whole-file If-Match conflict and a manual choice. Conflicts with the one-editor lease | Last writer wins: `put_canvas` has no If-Match | Y merges per element. A peer apply takes 0.01–0.02 ms |
| Failure modes | Schema change needed (root `additionalProperties:false` returns 422). Over the caps once a scene is inside. Non-atomic `FsStore` write | Refused with 413: the G3 JSON is over `CANVAS_MAX_BYTES` 4,000,000. Not atomic with the `.clan`, so the two can drift | Needs one writer of the `.clan` (see §5). Needs a contract amendment for multi-writer editing |

How the current alternatives compare, for reference:

- **Checkpoint on the main thread.** It blocks for 125–140 ms, about 36 missed frames over 5 saves.
- **Previews inside the `.clan`.** The file reaches 10.5 MB, a checkpoint doubles to 196 ms, and uploading the 300 previews took 27 s.

## 3. The four criteria

**Speed.** Every `.clan` write repacks the whole archive, so its cost follows archive size, not change size:

- It inflates, re-deflates and SHA-256s every entry.
- It re-validates the whole schema.
- It re-serialises `data.yaml` and the decision chain.

(Sources: `crates/clan-sdk/src/pack.rs` `pack()`, `container.rs:205-230`.) A scene of 2–8 MB inside the write path taxes every field edit. Y itself is cheap: a local transact takes 0.02–0.03 ms, and opening a compacted state takes 25–38 ms.

**Smoothness, iPad included.** Only the Worker that owns its own Y.Doc replica kept frames intact. Every other save path dropped frames, beside-JSON included. Drawing touches only the in-memory Y.Doc, so the cost a pen stroke sees is microseconds.

**Reliability.** The incremental live store means no work is lost between checkpoints. The checkpoint is one consistent snapshot, packed in the same write as data. Prior art agrees: tldraw, Figma, Excalidraw+, Penpot and Miro all keep a live room or log and treat the file as a snapshot. Figma's lesson was that checkpoints alone lost up to 60 s of work, and a journal brought that under 1 s. Store the Y binary, never a Y.Doc rebuilt from JSON: Hocuspocus warns that content duplicates.

**Maintenance.** The scene has one format, Yjs. The hybrid reuses the pattern we already ship for text, where `LocalTextBus` keeps a live Y.Doc and checkpoints it as quiet writes (`contracts/collab.md` §4). It also follows os-layer §2.5: a `.clan` is "a snapshot, never a working copy".

## 4. The OS-app question

Apps open in `<iframe sandbox="allow-scripts allow-popups">` with no `allow=` attribute (`app/src/shell/AppRuntime.tsx:291`). Device mode adds `FRAME_CSP` (`app/src/host/wasmFrame.ts:25-37`). Measured on Chromium 153 and Firefox:

| Capability | Web frame (today) | Device frame | Cause |
|---|---|---|---|
| canvas2d, WebGL2, WebGPU | Allowed | Allowed | — |
| IndexedDB, OPFS, Cache, cookie | Blocked | Blocked | No `allow-same-origin` |
| Worker from a URL; module worker from a blob: (Chromium) | Blocked | Blocked | Opaque origin |
| `WebAssembly.compile` | Allowed | Blocked | No `'wasm-unsafe-eval'` |
| SharedArrayBuffer (threaded ONNX) | Blocked | Blocked | No COOP/COEP, `cross-origin-isolated` not delegated |
| fetch, WebSocket, remote `<img>` | Allowed (no cookie) | Blocked | `connect-src 'none'`, `img-src data: blob:` |
| Fullscreen, clipboard, download, modals | Blocked | Blocked | No `allow=` and no `allow-downloads`/`allow-modals` |
| More than one document per project | Blocked | Blocked | One-document `Grant` (`tokens.rs:36-41`) |
| Pointer drag across the frame edge | Lost moves and `pointerup` (synthetic input, Chromium) | Same | The iframe boundary |

**GPU performance is not lost.** canvas2d, WebGL2 at 30k and 600k vertices, and the rAF gap all stayed within 0–5% of top level. What the frame costs in practice:

- ML runs single-threaded, because there is no SharedArrayBuffer.
- There is no model or asset cache, so the model downloads again each session.
- In device mode workers are blocked, which pushes rendering onto the main thread.

**What would make the sandbox work** is a trusted first-party tier on its own origin:

- set `NAPKIN_SANDBOX_ORIGIN`;
- add `allow-same-origin allow-downloads allow-modals` and `allow="fullscreen; clipboard-*; cross-origin-isolated"`;
- add a per-tier CSP and a manifest trust flag;
- add project-level grants and a WebSocket proxy in napkin-web (axum has no `ws` feature today).

In the probe, that frame matched top level. It is M–L work, including Terraform that a person applies, and it carries a real security trade-off. It buys no speed.

**Recommended path:**

1. Keep `/production` as a first-party route.
2. Add a strict CSP header to it now (size S): named `connect-src` for collab, S3 and the model host, plus `'wasm-unsafe-eval'` and `worker-src 'self' blob:`.
3. Give the project's CLAN human view a launcher that opens `/production/p/:id`.
4. Revisit the trusted tier only if third-party or other GPU-heavy editors need to run inside the OS.

## 5. What this changes in the canvas-engine design

1. **Scene shape.** Keep F1's per-element `Y.Map` wrapper. Split each element into `el` (small props) and `pts` (quantised Int16 at 0.1 px plus a pressure byte, as a `Uint8Array`). Measured: the scene goes from 8.1 to 2.4 MB, load from 70 to 25 ms, and a move from 1,483 to 130 B.
2. **Cap the per-person UndoManager.** Unbounded, it reached 38 MB. Checkpoints carry no undo history.
3. **Keep session state separate from document state.** Camera, selection and viewport stay per person and never go into the shared scene.
4. **Live store.** Locally, a y-indexeddb style store that appends updates and compacts at about 500. Once collaboration lands, Hocuspocus persistence as a binary blob per project in S3, with a 2 s debounce and a 10 s maximum, outside the 4–6 MB Lambda caps.
5. **One store Worker.** Move `ClanDocumentStore`/`route()` into a single Worker that owns both the `.clan` and the scene replica. Two wasm hosts holding diverging `.clan` bytes would bring back the clobber problem.
6. **Checkpoint member.** `human/assets/canvas.ybin.zst`: compressed with zstd before upload, quiet (no decision entry), with a format version. Never name it `.json`, because `ops/mod.rs:117` would add a text sidecar on every write. A read-only JSON projection for agents goes in only at export or handoff.
7. **Previews stay referenced by hash.** Link geometry lives in the scene; the document keeps only `{from, to, role}`.
8. **clan-sdk.** Raw-copy unchanged ZIP entries (`raw_copy_file`) and cache the compiled validator. This is needed whatever we decide: 300 maximum-size thumbs already push a write from 67 to 208 ms.
9. **Retire `PUT /clan/{id}/canvas`,** or turn it into the zstd-Y checkpoint with If-Match.
10. **Contract amendment.** The one-editor lease in os-layer §2.4 conflicts with a multi-writer canvas. D4 (Hocuspocus as the single `.clan` writer) has to go into os-layer before collaboration ships.
11. **Plan for headroom.** The compacted scene is 1.8–2.2 MB, about half of the 4.3 MB open cap. About 2.5× G3 reaches the cap, so plan direct-to-S3 open and save before then.

## 6. Corrections the judges found

- **Wasm build size.** The storage report cited a 37.9 MB napkin-wasm build. The contract-v3 file is 6,579,225 B, so the storage report's absolute timings may come from a different (likely debug) build. Its runs also shared the machine with other benchmarks, which raised its baseline to 67–84 ms against the README's 55–60 ms.
- **Why 600 ms and 100 ms are both right.** The storage report's 600 ms per write with the scene inside used the raw 8 MB float Y update, which is re-inflated on every repack. The bench's 100 ms used a 1.77 MB pre-compressed blob. The lesson is to quantise and compress before upload; 600 ms is not the cost of the hybrid checkpoint.
- **Relay caps differ by branch.** `CLAN_MAX_BYTES` is 5 MiB on `feat/production-tool-overhaul` (`service.py:96`) and 4,500,000 on contract-v3 (`:120`) and overhaul-integration (`:137`). Plan against 4.5 MB. `CANVAS_MAX_BYTES` = 4,000,000 exists on this branch too (`:105`, contract-v3 `:132`, integration `:149`). The storage report's "—" and ":147" were wrong.
- **The 7.6 s open is overstated.** Most of it is the JS `yaml` parser. The verdict stands on write cost and the schema change alone.
- **"0 frames missed" is a direction, not a guarantee.** It was measured with Node `worker_threads`, a `setTimeout` frame loop and tmpfs. It also assumed the Worker is the only `.clan` writer, which is why point 5 in §5 is required.
- **Blob workers in the device frame.** The storage report inferred they were blocked without testing. The os-sandbox probe has now confirmed it.
- **Weak prior-art sources.** The Excalidraw 1 MB Firestore story, the Obsidian plugin format, Penpot's pointer-map and Miro's `.rtb` came through secondary or mirror sources. None of them decides the outcome.
- **iPad, Safari and WebKit are unmeasured** in every report: WebKit did not launch, and there was no pen input, no IndexedDB in a real browser and no real disk. Every iPad claim is an extrapolation. Measuring on a real iPad is the next check before `designed`.

Evidence and scripts are in `/tmp/claude-1000/-home-batunii-Documents-Code-napkin-studio-production-tool/7bc8bbbd-c824-44c4-8437-6b45cfd195e7/scratchpad/canvas-clan-bench/`, in the `storage/`, `os-sandbox/` and `priorart/` subfolders and in `01`–`05*.mjs` with their `out-*.txt` outputs.