# Production Tool overhaul: the canvas is the studio

The plan for making the canvas the place where an ad comes together: Script, Storyboard and Video nodes with full editors behind them, while solving all eleven points in Laurence O Byrne's review (2026-10-10). Owner: Shrey. Approved as the overhaul's baseline on 2026-10-13; each roadmap item still gets its own feature record and approved design (`features/production-tool-overhaul.clan` lists them).

It was built from a map of today's code, research into prior art and open-source tools (licences fact-checked), three competing designs scored by three judges, a completeness critic, a comparison of the tools the licence rule excluded, and a build-vs-fork-vs-keep study of the canvas.

## Owner decisions

These win wherever the plan below differs.

- **Audience.** External paying customers first: accounts through the Napkin OS sign-in, per-customer limits, privacy of customer material.
- **Licences.** Permissive open source (MIT, Apache, BSD, ISC, CC0, OFL for fonts). Never buy a software licence. MPL-2.0 is allowed if installed from npm and never modified; GPL is allowed on our servers only, never shipped to users. No non-commercial model weights.
- **Canvas.** Keep Excalidraw as a package behind a strict adapter, and build the node and tool registries independent of it. Before the live canvas, two prototypes run head to head: Excalidraw on a real iPad with Pencil (latency, 300 images, overlay lag, per-person undo) and a 2-week prototype of our own engine. Their results decide: stay, fork, or build our own.
- **First slice.** Straight to the overhaul. Laurence's fixes (8, 10, 5 and the rest) land inside the new canvas and editors, not on today's three-stage UI.
- **Collaboration.** Live multi-user editing must work before the first external customer. Earlier features write through a patch interface so live sync slots in without rework.
- **Where it lives.** Inside napkin-web at /production, on the same domain as Napkin OS and its sign-in. Advertising Studio is retired; the OS card points here.
- **Editors.** Full-screen editors inside the tool, not Napkin OS apps (the research decided; see 2.5).
- **Devices.** Desktop browsers, iPad with Pencil, and phones for viewing and review.
- **Script editor.** Both views from the start: screenplay and two-column AV (Video | Audio), over one shot model.
- **Customer data.** A per-customer allowlist for Claude (Bedrock) and the models Runway routes to; defaults set by Napkin, adjustable by the customer's admin.
- **Old projects.** Hackathon and dogfood projects stay in S3 and the logs stay in AWS, untouched. No importer; nothing else carries over.

What they change in the plan below:

- Phase 0 no longer ships on today's app. Its three fixes (clip-moment-edit, frame-aspect, frame-change-edit) are still built first as relay operations and pure helpers, but they reach users through the new canvas and editors.
- The interim pieces (frame-lightbox, frame-rail, ref-roles-ui on today's UI) are dropped; the Image editor, art boards and open reference roles replace them.
- D3 (saved v2 projects) is settled: no importer. D5 (same origin), D7 (in-tool editors), D12 (per-customer allowlist) and D15 (retire Advertising Studio) are settled as recommended. D14 changes: both script views from the start.
- The licence exceptions settle D6: keep the GPL ffmpeg build on the server (no openh264 switch), and Mediabunny (MPL, unmodified) becomes available for on-device stills and waveforms.
- Phone review joins the device list, so the Video editor needs a review mode that works on a phone: watch, scrub, leave a timed note.
- Aleph 2 access on our Runway key is being checked by Shrey; item 8's plan assumes it, with Veo first/last-frame as the fallback.

## The plan

### 1 Summary

**The acceptance scenario.** Laurence opens a project. The canvas already has these art boards:
- Script
- Characters
- Locations
- References
- Products
- Storyboard
- Video

Script → Storyboard → Video is already wired. He works through it like this:
1. He drops pictures on Locations, and they become location references without any naming dialog.
2. He sketches inside a 16:9 sketch area and gets a 16:9 image back.
3. He double-clicks the Script node and writes the ad. `@maya_front` autocompletes, he adds long performance direction, and he adds a timed moment ("at 2 s her eyes open, she says 'It's perfect!'").
4. He draws the frames, inserts a bridge shot between 1 and 2, opens a frame full-screen, masks an area, and types "make this an overhead aerial shot". The frame changes, and the shot's camera fields show the change as a diff.
5. He gets clips, drops a note at 0:03, and only about 2 s around that moment is regenerated and spliced back.
6. Two colleagues edit the same canvas at the same time. Their cursors are visible and their jobs show "Running, started by Maya".

**The decisions.**
- **Canvas: keep Excalidraw 0.18.1 (MIT).**
  - tldraw is ruled out: its source-available licence needs a production key.
  - React Flow (MIT) has no whiteboard, so it would lose the drawing Laurence praised.
  - Typed nodes are Excalidraw elements tagged through `customData`, where the element id is the document id. Their previews are real image elements. A viewport-virtualised React overlay draws the node chrome.
  - All engine calls go behind `CanvasAdapter` and `NodeRegistry`.
- **Collaboration from the start, as a hybrid model.**
  - A Yjs document (MIT) holds the scene geometry, the script rich text and presence.
  - The project entities (boards, shots, refs, links, jobs) stay in the validated `.clan`. They are written as field-level, server-authoritative patches.
  - A self-hosted **Hocuspocus** (MIT) carries both channels. It is the only writer of the `.clan` and of job results.
  - Every list is ordered by a fractional `rank`, so concurrent reorders never conflict.
- **Editors are full-screen routes inside the tool** (`/p/:project/:kind/:id`), not Napkin OS apps. The OS supplies sign-in, tenants, the home card and Brief Maker spin-off.
- **Runway stays the only paid generator.** Local AI uses permissive code and permissive weights. Handwriting goes to Claude via Bedrock.
- **Fix items 8, 10 and 5 first**, on today's app. Each fix is built as a relay op or a pure helper, so the overhaul reuses it without changes.

### 2 Architecture

#### 2.1 Canvas foundation
Excalidraw 0.18.1 stays. These primitives are verified in the installed package:
- frames, groups and bound arrows
- `customData` and `convertToExcalidrawElements`
- `exportToCanvas` / `exportToBlob` with `exportingFrame` (`scene/export.d.ts:7`)
- `scrollToContent`
- `reconcileElements` and `CaptureUpdateAction`
- live collaborators through `updateScene({collaborators})` together with the `isCollaborating` prop. `collaborators` is SceneData, not a prop.

Excalidraw has no custom element types: issue #8184 is closed as "not planned". A node is therefore made of three parts:
- **Geometry and identity:** one element (a rectangle, or a frame for a board) with `customData {kind, id}`.
- **Preview:** an Excalidraw **image element** showing a rendered PNG, such as a script excerpt, a storyboard strip or a video poster. It is re-rendered, with throttling, when the entity changes and stored by sha256 like any other asset. It keeps z-order, selection and export. We avoid `embeddable` because it sits outside z-order and export and only becomes interactive once activated.
- **Chrome:** the React overlay, extending today's `toView` / JobNode pattern. It draws ports, Open, job state and presence avatars, only for nodes inside the viewport. This fixes today's re-render of every overlay on each scroll.

npm releases are about yearly. MIT lets us pin a fork if a fix is blocked.

#### 2.2 Node types and their data
The scene holds geometry only. Content lives in the document.

| Node | Element | Document entity (v3) |
|---|---|---|
| Board | `frame`, `{kind:'board'}` | `boards[id]{title, purpose, rank}` |
| Sketch area | aspect-locked rectangle, `{kind:'sketch'}`, white fill | `sketches[id]{ratio}` |
| Script | rectangle + preview | `scripts[id]{title, target_s}`, with the body as a Y.XmlFragment that is checkpointed as ProseMirror JSON |
| Storyboard | rectangle + strip preview | `storyboards[id]{script_id?, ratio}`; `shots[id]{storyboard_id, rank, …}`; `frames[id]` |
| Video | rectangle + poster | `videos[id]{storyboard_id, edl[]}`; `takes[id]{segments[]}`; `reviews[id]{range}` |
| Ref / pic / gen | image (as today) | `refs` / `keys` with an open `role`; `jobs` |
| Link | bound arrow, `{kind:'link'}` | `links[id]{from, to, role}` |
| Note / ink | text element (as today) | none |

**Excalidraw frames cannot nest.** A frame is single-membership, so a sketch area is a tagged rectangle inside a board, not a frame. To export it, export the rectangle together with the strokes that intersect it, then crop the canvas to the rectangle's bounds. A user-drawn top-level frame exports through `exportingFrame`.

#### 2.3 Links and what a link means
A link is typed, and the port UI checks it against the contract's link table. Dragging from a `+` port lists only compatible targets, as Krea Nodes and Runway Workflows do. The role is what tells the director what an input is for. The lesson from Higgsfield: "linked" is not "understood".

| From → To | Role | Effect |
|---|---|---|
| Script → Storyboard | `drives` | "Plan shots" reads this script. Re-planning is a **merge keyed by shotId**, never the wipe that `applyShotList` does today. |
| Storyboard → Video | `renders` | One clip per shot, from the selected frames. |
| Ref → Script / Storyboard / Shot / Video | `character`, `location`, `lighting`, `composition`, `product`, `style`, … | The ref joins that node's @ vocabulary. The director names its role ("lighting reference: match its light only"). |
| Image / gen → Shot | `frame` or `layout` | Used as the frame, or as a layout guide. |

Selecting Script + Storyboard and choosing **Make video** creates the Video node and both links in one undo step. The selection logic is `planGraph(selection)`, a pure, tested generalisation of `planSelection`. The stale marks in `jobs/stale.ts` become badges on links: a script edit marks the storyboard, a frame marks its clip, and a clip marks the ad. FollowScope and UpdateBox then run the update.

#### 2.4 Groups and art boards
- Excalidraw groups (Ctrl+G) are used as they are.
- Boards are frames, listed in a left rail by rank. Clicking a board runs `scrollToContent(frame, {fitToViewport, animate})`, and Alt+1…9 cycles through boards.
- New projects start from the **Ad template**. It also includes a "References: Lighting" board.
- A picture dropped on a board takes the board's purpose as its role.
- Prerequisite: the `drawn` wrapper stops reusing frames (`controller.ts:228-231`). It becomes a tagged group, so strokes stay inside their board.

#### 2.5 Double-click and where editors live
A capture-phase `dblclick` listener on the canvas wrapper uses the `arrowHit` pattern. It hit-tests tool nodes and calls `stopPropagation` only for them, so Excalidraw keeps its own double-click for text, crop and frame rename. Every node also has an **Open** button for touch screens. Opening pushes `/p/:project/:kind/:id`, and the editor mounts full-viewport over a canvas that stays mounted, so jobs keep landing. Edits are live, so there is no "save on close". An editor cuts a **new frame or take version** only when you explicitly Apply or Generate, because versions cost money and drive staleness.

**Decision: in-tool editors, not OS apps.** The reasons:
- A sandbox token grants one document (`tokens.rs` `Grant.doc`).
- Spin-off upstreams are frozen copies (os-layer §5).
- `store.rs` rewrites the whole file on every write.
- There is one editor lease per document.
- App frames are `sandbox="allow-scripts allow-popups"`, with no same-origin and no fullscreen. The device-path CSP sets `connect-src 'none'` and has no `wasm-unsafe-eval` (`wasmFrame.ts:25-36`). That blocks IndexedDB, ONNX/WebGPU and WebSocket sync.

Each editor is still a self-contained module behind `EditorContract {open(nodeId, ydoc, awareness, services)}`, so it can become an OS app later if the OS gains project-level grants.

#### 2.6 Collaboration, jobs and tenancy
- **Sync service (`napkin-collab`).** Hocuspocus on ECS Fargate.
  - `onAuthenticate` verifies a napkin-web handoff (tenant, person, project).
  - The Y.Doc holds `scene` (a Y.Map of elements, bound by our own ~400-line binding over `reconcileElements`; remote changes are applied with `CaptureUpdateAction.NEVER`), `scripts/<id>` (y-tiptap) and awareness.
  - Snapshots go to `tenants/{t}/projects/{p}/` in S3 with KMS.
- **Entity writes.** Field-level patches `{entity, id, field, value, base_version}` travel as stateless messages.
  - The service validates each patch with ajv against the whole document and applies it through clan-store.
  - It writes an attributed decision-chain entry, then broadcasts the change.
  - Concurrent writes to different fields merge. A conflict on the same field gets a visible notice.
  - Rank fields mean a reorder is a single-field write, so concurrent reorders never conflict.
  - Data writes go through a debounced checkpoint, so the `.clan` is never rewritten per keystroke.
- **One undo per person.** An `UndoCoordinator` groups the local Y.UndoManager step and the inverse entity patches from one user action into one step.
  - Excalidraw's own history is bypassed: Ctrl+Z is intercepted and its undo buttons are hidden.
  - `doc/undo.ts` list-diffing retires. No `move` op is needed, because rank is a field.
- **Jobs.**
  - The relay or the sync service is the only writer of outcomes. `applyFrame`, `applyTake` and `applyStitch` move server-side.
  - `JobCtx` moves into `jobs[id].purpose`.
  - In-flight dedupe is keyed by `(node, op, input hash)` while a job is running, plus a client nonce so an intentional "another take" is not deduped. A second presser sees "Running, started by Maya".
  - Results land even when nobody has the project open.
- **Tenancy.**
  - Every job, asset and quota carries `tenant_id`.
  - The existing DynamoDB quotas table holds per-tenant spend caps.
  - Batches show a sheet-driven cost estimate and need a confirm.
  - A privacy notice names the subprocessors: Runway and the models it routes to, and Anthropic via Bedrock.
  - Cut-outs and selection run client-side, so those pixels stay on the device.

### 3 Editors

| Editor | Built on (verified licence) | Behaviour |
|---|---|---|
| **Script** | Tiptap v3 (MIT): `react`, `starter-kit`, `extension-mention`, `suggestion`, `unique-id`, `drag-handle-react`, `table-of-contents`, `collaboration`, `collaboration-caret`, `y-tiptap`; fountain-js (MIT, low maintenance) for import. No Tiptap Cloud or paid add-ons. | Scene, Shot (holds the `shotId` and references the shot entity, never a copy of it) and inline Moment (`at_s`). `@` lists refs grouped by role with thumbnails, `#` lists shots, and mentions store `{refId}`. Tab/Enter cycles element types (the Trelby pattern, no code taken). Outline rail. Fountain import remaps Fountain's `@` character syntax. |
| **Storyboard** | Today's FrameCard, RegionImage and VersionThumb extracted and bound to a storyboard id; dnd-kit for reorder (licence confirmed by the CI gate) | Cards ordered by rank, with fields underneath: action, direction, camera {size, angle, movement, lens}, dialogue, beats. `+` between any two cards, drag to reorder, **Bridge**, soft duration check with rebalance. Clicking a frame opens the Image editor. |
| **Image** | Konva 10 + react-konva 19 (MIT); transformers.js (Apache-2.0) in a Web Worker running `onnx-community/BiRefNet_lite-ONNX` (MIT weights) and SAM 2 (Apache-2.0 code and weights) or `Xenova/slimsam-77-uniform` (Apache-2.0); server cut-out with rembg (MIT) **pinned to `birefnet-general`** (its default is CC BY-NC RMBG-2.0); Runway `ideogram_4_5` (`maskUri`, black = edit; `preciseEdit`), `gemini_image3_pro`, `magnific_precision_upscaler_v2` | Full-screen with zoom and pan, the stage locked to the frame ratio. Layers, brush, eraser, text, crop, mask. Click-select, Remove BG, Fill area, Change whole frame, Upscale. Edits are a non-destructive op list, and Apply produces a frame version with `kind:'edited'`. A cut-out can be saved as a named ref with a role. |
| **Video** | `@xzdarcy/react-timeline-editor` (MIT); a `<video>` sequencer for preview; `<video>` seek + canvas `drawImage` for filmstrips; server ffmpeg for exact stills and render | A magnetic main track of shot clips. A notes row in which each note widens into a time range that drives `clip_patch`. A beats row, an audio lane (eleven_v4) and an end card. Render sends the EDL to stitch. |
| **Ink** (canvas tool) | $Q recognizer, vendored (BSD-3); Claude Haiku 5.5 via Bedrock | Strokes are clustered by time and distance into groups. Holding the pen snaps a shape. **Convert to text** returns `{kind: text|shape|sketch, text, confidence}`, fuzzy-matches the text to @refs, and keeps the original ink in customData, so one undo restores it. Progress and errors are always shown. |
| **Reference sheet** (later) | Konva, BiRefNet | Multi-view entity (front, 3/4, profile) and its role. |

Excluded:
- **Paid or commercial licences:** tldraw (production key), Polotno (subscription), Pintura (paid), Photopea (closed, ad-supported), Remotion (company licence).
- **Copyleft:** @imgly/background-removal and Upscayl (AGPL); ffmpeg.wasm core and Etro (GPL).
- **Restrictive or weak-copyleft licences:** Twick (Sustainable Use Licence); BlockNote (MPL core, GPL XL packages); Mediabunny (MPL-2.0).
- **Model weights:** BRIA RMBG (CC BY-NC); LaMa (weights licence not stated).
- **Rejected as the editor base:** Filerobot (React 19 support is still `5.0.0-beta`, and it has no layers or masks).

### 4 Document and contract changes

**Phase 0 (additive D1 decision, `contractVersion` stays "2").** Existing documents remain valid. Web and relay change in the same PR.
- `refRole` gains `layout`.
- Shot `composition` (document.schema.json:242) gains `overhead`, `aerial`, `high_angle`, `low_angle`, `dutch`.
- `common.op` gains `frame_edit` and `clip_patch`.
- A spliced take is a normal new take with `parent`, and its window is kept in the job input.

**Contract v3 (breaking, one batch).** Requires Shrey's approval, a clan decision, `check.py`, `types.ts`, the relay contracts, the clan-store bundle (`npm run app`) and `contracts.test.ts`.
- **Root lists, all id-keyed:** `boards`, `sketches`, `scripts`, `storyboards`, `shots`, `frames`, `videos`, `takes`, `links`, `refs`, `keys`, `reviews`, `jobs`, `stale`, `exports`. The singleton `script`, `shots maxItems 8` and the `stage.current` enum are removed.
- **Shot:**
  - `rank` replaces `order` and array position.
  - `action` ≤600; `direction` ≤4000.
  - `camera{size, angle, movement, lens}` replaces `composition` and `camera_move`.
  - `beats[{id, at_s, text, kind: action|line|camera}]`.
  - `refs` become mention ids.
- **Ratio:** lives on storyboards, sketches and videos. `ratio`, `targetS` and `jobCtx` leave `ProjectUi`.
- **refRole:** an open set (character, product, prop, location, lighting, composition, style, wardrobe, pose, texture, colour, layout, other) plus `label`. Only character, product and location get a front and views.
- **frames:** `kind` gains `edited` and `edits[]`. **asset.origin:** gains `edited`. **takes:** gain `segments[{source_take, in_s, out_s, job_id?}]`. **reviews:** `range{from_s, to_s}`.
- **jobs:** gain `purpose`, `started_by`, `nonce`, `tenant_id`.
- **customdata:** kinds `board`, `sketch`, `script`, `storyboard`, `video`, `link`. `drawn` becomes a group tag. `pin` is removed (unused).
- **ops:** add `bridge`, `cutout`, `transcribe`. **director.schema:** `audio` is no longer const false.
- **relay-api:** `tenant`, nonce, structured shot fields. Text limits come from the capability sheet. `ProjectCanvas` PUT is replaced by sync snapshots.
- **capabilities/runway.json:**
  - Prices refreshed: veo3.1 with audio 40 cr/s ($3.20 per 8 s); aleph2 28 cr/s with a 56-credit ($0.56) minimum.
  - `ideogram_4_5` and Magnific added.
  - A CI test checks limits, ratios and durations against `/openapi.json`.
- **Migration:** a one-shot v2→v3 importer: one Script, one Storyboard and one Video node on default boards. No runtime shim (owner decision D3).

### 5 Reviewer items

| # | Fix | Phase |
|---|---|---|
| 8 | `clip_patch`, in five steps: (1) The note's range defaults to `[floor(t)-1, ceil(t)+1]` and can be adjusted. (2) Stitch cuts a sub-clip of at least 2 s plus context. aleph2 bills the clip it receives, so this is cheaper. (3) ffmpeg grabs the still at `t`, which can be fixed in an editor and is passed through `extra_hashes` (claude.py:78). (4) aleph2 runs with `keyframes[{uri, seconds, range}]`. (5) Stitch splices `orig[0,a)+new+orig[b,end)` with short crossfades. This branch moves ahead of `fixInShot` in `Video.tsx`, and `videoRegionEdit` is turned on only after an end-to-end test. Fallback: veo3.1 first/last frame on the window, generated at 4 s and trimmed. A seam-quality eval is added. | 0 |
| 10 | Stop `planSelection` skipping user frames (selection.ts:245). Export with `exportingFrame`, and leave strokes where they are. Send the frame's ratio, snapped to the provider's sizes: 1344:768 is 1.75, not 16:9, so generate, centre-crop to 16:9, and give the director the true target. Remove `'4:5'` (controller.ts:347, 438) and replace `viewRatio.test.ts`. Use the `layout` role in place of "character, full body". Size M. | 0 |
| 5 | `frame_edit`: send the current frame as `image`. A director step classifies the words. A local change becomes an instruction edit (gemini with a `current` ref, or ideogram masked). A camera change patches `composition` (camera fields in v3), shows the change as a diff, writes it to the shot, and redraws without @previous/@anchor. The words lead the v5 frame section. Shot text no longer counts in `_within_budget`. When the passthrough was used, the user is told. Eval cases such as "overhead aerial" are added. | 0 |
| 9 | A shared `MentionInput` that stores `{refId}` tokens and underlines unknown names. Names are validated against Runway's `^[a-z][a-z0-9_]{2,15}$` when a ref is named. "Did you mean" is added to `names.py`. | 1 |
| 6 | `direction` ≤4000 plus camera fields. The director condenses to Veo's 1000-character limit. Character counters come from the capability sheet. | 1 |
| 3 | Rank ordering, `+` between cards, drag reorder, drift marks on neighbours, soft durations. **Bridge** uses veo3.1 with first = last frame of N and last = first frame of N+1. | 1 |
| 4 | An interim full-screen lightbox with zoom and pan around RegionImage first (P1), then the Image editor (P4). | 1 / 4 |
| 1 | An interim rail over frames (P1), then boards and the Ad template (P3). | 1 / 3 |
| 2 | Open roles in the Name dialog (P1), then role defaults from the board (P3). | 1 / 3 |
| 7 | `beats` written in the Script and Video editors. Veo gets `[MM:SS-MM:SS]` timestamp prompting. aleph2 places a keyframe at a given second. Spoken lines go in as an eleven_v4 clip, and audio is kept through stitch. | 4 |
| 11 | Ink clustering, $Q shape snap, and `transcribe` through Claude. | 4 |

### 6 Build vs reuse

| Component | Choice | Licence | Alternative | Cost |
|---|---|---|---|---|
| Canvas | Excalidraw 0.18.1 + adapter | MIT | tldraw (paid key, excluded); React Flow (no whiteboard) | M |
| Node chrome, ports, link table | Build: overlay + customData | ours | — | M |
| CRDT | Yjs, y-indexeddb | MIT | — | — |
| Scene binding | Build over `reconcileElements` | ours | community y-excalidraw (licence unverified) | M |
| Sync server | Hocuspocus on ECS | MIT | yrs inside napkin-web (slower to ship) | M + infra |
| Rich text | Tiptap v3 OSS packages | MIT | Lexical (MIT, pre-1.0) | M |
| Fountain import | fountain-js | MIT | own parser | S |
| Reorder | dnd-kit | MIT (gate-checked) | Tiptap drag-handle | S |
| Image editor | Konva / react-konva, our own tools | MIT | Filerobot v5 beta | L |
| Remove BG, select | transformers.js + BiRefNet_lite + SAM 2 / SlimSAM | Apache-2.0 / MIT / Apache-2.0 | U2-Net (Apache-2.0) | M |
| Server cut-out | rembg `birefnet-general` + a test on the model name | MIT | — | S |
| Inpaint, edit, upscale | Runway ideogram_4_5, gemini_image3_pro, Magnific | paid API (already used) | — | per use |
| Timeline | react-timeline-editor | MIT | Omniclip (MIT, not React) | M |
| Render and splice | stitch Lambda, LGPL ffmpeg + openh264 | LGPL / BSD-2 | today's GPL static build (verified: johnvansickle, libx264) | M |
| Clip edits | aleph2, veo3.1 first/last | paid API | seedance2_5 / wan3 (after eval) | per use |
| Shapes | $Q | BSD-3 | — | S |
| Handwriting | Claude Haiku 5.5 via Bedrock | paid API | TrOCR (MIT, single line only) | S |
| Licence gate | CI allowlist (npm, pip) + model-weights manifest | — | — | S |

### 7 Phased roadmap

**Phase 0: make the claims true (today's app)**
- `clip-moment-edit`: Windowed moment edit. Covers the sub-clip cut, still grab, aleph2 range, splice, gate order, `extra_hashes` and seam eval (item 8). Depends on: confirming aleph2 access on our Runway tier. **M**
- `frame-aspect`: Honest frame ratio. Covers `exportingFrame` export, removing the drawn-wrapper frame reuse, ratio snap and crop, the `layout` role, and removing 4:5 (item 10). **M**
- `frame-change-edit`: Change-this-frame as an edit. Covers classification, the composition patch with diff, budget fix, visible passthrough and evals (item 5). **M**
- `p0-contract-additions`: Additive D1 decision (§4). **S**
- `runway-sheet-sync`: CI check against openapi, plus refreshed prices. **S**

**Phase 1: foundations + Laurence's "next" tier**
- `os-sign-in`: napkin-web handoff, `identity.who`, tenant on every call. **M**
- `tenant-limits`: Caps, estimate and confirm, S3 prefixes with KMS, subprocessor notice. Depends on: os-sign-in. **M**
- `licence-gate`: Allowlist and weights manifest. **S**
- `contract-v3`: §4 and the importer. Depends on: owner approval. **L**
- `mention-input`: Item 9. **S**
- `shot-direction`: Item 6. Depends on: contract-v3. **S**
- `shot-insert-reorder`: Item 3, including Bridge. Depends on: contract-v3. **M**
- `frame-lightbox`: Interim item 4. **S**
- `frame-rail` + `ref-roles-ui`: Interim items 1 and 2. Depends on: frame-aspect, contract-v3. **S**

**Phase 2: live canvas**
- `sync-spike`: Proves napkin-wasm/clan-store runs in Node, and prototypes the scene binding. Fallback: the service calls the native `clan` CLI. **S**
- `live-sync`: Hocuspocus, binding, presence, field patches, UndoCoordinator, checkpoints. Depends on: sync-spike, os-sign-in, contract-v3. **L**
- `server-job-landing`: Single writer, dedupe and nonce, `purpose` in the job record. Depends on: live-sync. **M**
- `canvas-nodes`: NodeRegistry, image-element previews, virtualised overlay, ports, link table, dblclick/Open, Make video. Depends on: live-sync. **L**

**Phase 3: boards and the writing editors**
- `art-boards`: Board frames, rail, Ad template, roles from board (items 1 and 2). Depends on: canvas-nodes. **M**
- `script-editor`: Depends on: canvas-nodes, mention-input. **L**
- `storyboard-editor`: Depends on: shot-insert-reorder, canvas-nodes. **M**

**Phase 4: media editors**
- `image-editor`: Item 4. Depends on: canvas-nodes. **L**
- `video-editor`: EDL takes. Depends on: clip-moment-edit, canvas-nodes. **L**
- `shot-beats`: Item 7. Depends on: video-editor. **M**
- `ink-to-text`: Item 11. Depends on: canvas-nodes. **M**

**Phase 5: reach**
- `reference-library`: Tenant library, copy-on-use via `library_id`. **M**
- `os-home-card`: "Make an ad" card plus Brief Maker → Script spin-off. **S**

### 8 Rework risks and how they are avoided
- **Fixing items 8, 10 and 5 twice.** The fixes are relay ops and pure helpers (`exportSketch`, `clipPatch`, `classifyChange`), and the editors call them unchanged.
- **Adding collaboration after the nodes are built.** `live-sync` and `server-job-landing` come before `canvas-nodes` and before any editor.
- **CRDT merges that break schema validation.** Entities never go into a CRDT. They are validated patches with one writer.
- **Hitting Excalidraw's limits.** Semantics live in the `.clan`, the scene holds geometry plus ids, and engine code sits behind `CanvasAdapter`. A swap would touch about 2,000 lines.
- **Split undo and undo of reorders.** One coordinator per person, and ranks are fields.
- **"Plan again" wiping storyboard work.** Planning becomes a merge keyed by shotId. Tiptap Shot nodes only reference shot entities.
- **Two contract migrations.** Phase 0 is additive only. Everything breaking goes in v3.
- **Licence drift.** CI gate, pinned versions, and a test on the rembg model name.
- **Silent degradation.** Every passthrough, fallback or splice failure is shown to the user.
- **Cost blow-ups.** In-flight dedupe, cutting the clip before aleph2, per-tenant caps, and estimate plus confirm.
- **Sync service in Node can't run napkin-wasm.** The spike comes first, and a CLI fallback exists.

### 9 Open questions (facts to establish)
1. Does our Runway API tier include aleph2? The claim that it is Enterprise-gated has not been verified.
2. The `ideogram_4_5` mask polarity and parameter, checked against the OpenAPI spec (described as black = edit).
3. Does napkin-wasm load under Node for the sync service? (`sync-spike`)
4. Seam quality of 2 s aleph2 patches with crossfades (eval).
5. The commercial terms in Runway's API agreement (not yet read).

### 10 Prior art: what others did and what we copy
- **Flora, Krea Nodes, Runway Workflows:** typed, colour-coded ports and a picker that offers only compatible nodes. We copy them for the link table. Krea's Section nodes are the model for art boards.
- **Freepik Spaces (Magnific):** the Designer node opens a full-screen editor over the canvas. We copy it for double-click-to-route, minus save-on-close.
- **Figma Weave (Compositor):** an editor is a node whose inputs arrive as locked layers. We copy that the Image editor's upstream inputs are locked layers.
- **Higgsfield Canvas:** a visual link does not tell the model the reference's role. We copy that links carry a role the director words.
- **Google Flow and Runway Gen-4 References:** an `@` library of named ingredients, plus start/end frames. We copy them for MentionInput and Bridge.
- **LTX Studio Retake:** regenerate a 2-16 s segment. We copy it for `clip_patch`.
- **Boords and StudioBinder:** structured shot fields, drag reorder, and the ratio fixed per board. We copy them for the shot schema and the storyboard editor.
- **Katalist:** one-click "swap camera angle". We copy it as the camera-patch path for item 5.
- **Invoke (Apache-2.0):** regional guidance layers. We copy the mask-plus-instruction tool.
- **OneNote Ink to Text and Obsidian Excalidraw OCR:** classify, then recognise, as an explicit action that never fails silently. We copy them for ink-to-text.
- **Warnings:** ComfyUI (GPL, graph-programmer UX) and Kaiber/Visual Electric (canvas without production structure).

### 11 Decisions needed from the owner

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Contract v3 and the Phase 0 additive change | approve / defer | Approve both now. Phase 0 is additive and stays at v2. |
| D2 | Canvas engine | Excalidraw / React Flow / tldraw (excluded) | **Excalidraw**, behind CanvasAdapter. |
| D3 | Saved v2 projects | one-shot import / read-only / drop | **One-shot import**, with no runtime shim. |
| D4 | Sync server | Hocuspocus (Node, ECS) / yrs in napkin-web | **Hocuspocus** on the staging ECS cluster, as the single `.clan` writer. |
| D5 | Origin | serve under napkin-web `/production/*` / own domain + handoff | **Same origin** (shared `napkin_session`, one domain for customers). |
| D6 | ffmpeg licence (stitch is a GPL libx264 static build today) | keep GPL server-side / LGPL + openh264 / MediaConvert | **LGPL build + openh264 (BSD-2)**, after a quality eval. Self-built openh264 carries H.264 patent obligations, so confirm. |
| D7 | Editors as OS apps | OS apps / in-tool routes | **In-tool routes** behind EditorContract. |
| D8 | aleph2 cost for moment edits | whole clip / cut sub-clip / veo patch | **Cut sub-clip + aleph2**, with veo first/last as fallback. |
| D9 | Second clip model for long direction and drafts | none / seedance2_5 / wan3 | **None until an eval**. Then seedance2_5 (15k-char prompt, draft mode). |
| D10 | Audio and dialogue | now / Phase 4 | **Phase 4** (shot-beats). |
| D11 | Where ML runs | client WebGPU / relay | **Client by default**, relay fallback. |
| D12 | Data sent to Runway-routed models and to Claude | allow / per-tenant opt-out | **Allow, with a per-tenant opt-out** and a subprocessor notice. |
| D13 | Ink conversion | automatic on idle / explicit | **Explicit Convert, plus a suggestion chip on idle.** |
| D14 | Script shape | screenplay / two-column AV | **Screenplay elements** with a Shot block (an AV view later). |
| D15 | Advertising Studio template | retire / make it the OS card | **Retire it**. The OS card points to this tool. |
| D16 | Per-tenant caps | monthly cap set by Napkin / by tenant admin | **Monthly cap set by Napkin**, which tenant admins can lower. |
## Canvas: build, fork or keep Excalidraw

Three options were scored against 57 canvas needs drawn from the plan and the review and ranked by two judges (engineering and product). Both ranked them: keep Excalidraw as a dependency, then a fork, then our own engine. The owner chose the dependency, plus a head-to-head prototype of our own engine before the live canvas.

### 1. Answer

**Keep Excalidraw 0.18.1 (MIT) as an npm dependency, behind a strict `CanvasAdapter`. Don't build our own canvas now, and don't fork yet.**

The reasons, plainly:

- **The canvas is not what we sell.** The ad pipeline is. What makes Napkin different is the meaning on the canvas: typed nodes, typed links, reference roles, boards, the editors and generation. All of that is our own code and lives in `.clan`, whichever engine draws it.
- **Excalidraw has already solved the parts a small team builds worst.** Pressure ink, text editing with IME, arrows that stay attached, frames, export cropped to a frame, collaborator cursors, and skipping off-screen elements. These are also the parts coding agents speed up least, because they are judged by feel and on real devices.
- **All five of the reviewer's canvas items work without a fork.** Those are art boards with jumps, open reference roles, @ autocomplete, a 16:9 sketch area, and handwriting to text with scribbles that move as one object. They can ship on the plan's schedule.
- **Our own engine costs 30–60 more engineer-weeks and 5–7 months of delay.** It would also need about 0.5–1 engineer on the canvas for good. tldraw took about 3 years and 8–20 people. Penpot needed more than 18 months just to get a new renderer to beta. Flora and Weavy (now Figma Weave) built their canvases on React Flow, not on an engine of their own.

Our own engine would fit the product best on paper. But the one thing people picture it giving us, live React node bodies, still has to be turned into bitmaps for export and when zoomed out, so we would rebuild a preview pipeline anyway. **A fork is the escalation path, and only on measured evidence.** Rewriting from scratch is the last resort.

### 2. How far Excalidraw can be customised

Checked against the installed 0.18.1 types (`types.d.ts` props at 405–464, API at 616–638) and upstream at `541653c`.

| Capability | As a dependency (0.18.1) | In a fork | Not possible at all |
|---|---|---|---|
| Our own data on every element (`customData` {kind, id}) | Yes | Yes | |
| Our own tools (`setActiveTool({type:'custom'})`) | Partly: Excalidraw reports only pointer down and up, with no move hook, so our overlay draws the preview | Yes, with full pointer handling | |
| Hide or replace the toolbar and menus | Hide with `UIOptions` and CSS. `ui={false}` and an `activeTool` prop exist only in `next` snapshots | Yes | |
| Chrome around the canvas (sidebar, menus, top-right UI) | Yes | Yes | |
| React overlays on top of the canvas | Yes (positioned with `sceneCoordsToViewportCoords`) | Yes | |
| Replace ids on duplicate (`onDuplicate`) | Yes, already in 0.18.1 (`types.d.ts:431`) | Yes | |
| Art boards: frames, fit and jump, export cropped to a frame | Yes | Yes | |
| Frames inside frames (a sketch area inside a board) | No. We use a tagged rectangle instead | Yes, but it touches about 20 files | |
| New element types (node, link, sketch) | No (#8184 closed as not planned; #4957 open for 4+ years) | Yes, about 2–4 weeks for the first one | |
| Our own hit areas, resize handles, aspect lock while resizing | No. We correct the ratio after the resize | Yes | |
| A double-click hook | No. We catch the event before Excalidraw does | Yes | |
| Replace the built-in undo | Can only switch it off and hide it | Yes (`Y.UndoManager`) | |
| A live React node body drawn in canvas z-order and included in export | No | No | **Neither.** A body drawn by React always sits in a layer above the canvas |
| Pencil tuning (pressure curve, hover, finger pans while the pen draws) | Basic: pen mode ignores touch while drawing | Yes, by patching | |

### 3. Tools built for our needs

The pattern on every path is a `ToolRegistry`, where each tool is `{id, icon, shortcut, onActivate, Overlay, commit}`, plus a `NodeRegistry`. Neither depends on the engine, so they carry over to a fork or our own engine.

- **Dependency (A).** We draw our own Napkin toolbar and hide the native one. Picking a tool calls `setActiveTool({type:'custom'})`. A transparent overlay then takes over the pointer, draws the preview, and saves typed elements through the adapter as one undo step.
- **Fork (B).** Tools become part of Excalidraw's own tool handling, with full pointer events and previews drawn by its renderer.
- **Own engine (C).** Tools are first-class state machines that get the whole pointer stream, including pressure, tilt and coalesced points.

| Tool | A (dependency) | B (fork) | C (own engine) |
|---|---|---|---|
| **Shot-frame sketch tool (16:9 and provider ratios)** | The overlay draws a rectangle locked to the ratio. We save it as a tagged rectangle with a white fill. A resize gets its ratio corrected afterwards, which can flicker for a frame. Export crops to its bounds | A real sketch element type, ratio-locked while resizing, nested inside its board | A child record of its board, with the aspect lock in its own resize handler |
| **Reference drop onto boards** | We catch the drop before Excalidraw does, or detect the new image in `onChange`. We read the board from `frameId`, then set role = board's purpose. No dialog | A patched drop handler | Our own drop handler |
| **Mask / region tool** | The overlay draws a tagged rectangle or lasso over the image. `regionWords` already exists. Pixel masks go in the Konva image editor | A mask element type tied to an image | A region record on an image node |
| **Link-port tool** | Ports are DOM elements in the overlay. Dragging from one shows a line, highlights only the targets the link table allows, and refuses others with a reason. Then we save a bound arrow carrying its role | Real port handles, plus a check that can refuse a link at the moment it attaches | The same check, inside our own link layer |

**Easy as a dependency:** any tool whose result is an existing element type (rectangle, frame, image, arrow, text) with our data attached.

**Needs a fork:** our own resize handles, our own hit areas, and catching a freehand stroke while it is being drawn. Hold-to-snap needs DOM listeners outside Excalidraw as a workaround.

### 4. Cost and timeline

| | A: keep as dependency | B: fork Excalidraw | C: our own engine |
|---|---|---|---|
| Canvas work to v1 (engineer-weeks) | **20–30** (about 24) | **About 24–47** (16–28 of fork work, plus the shared work, minus 6–10 weeks of workarounds it removes) | **60–85** (35–50 just to match today) |
| Calendar time, 3 engineers plus agents | About 2.5 months | About 3–4 months, starting after upstream's restructuring settles | 5–7 months, plus a long polish tail |
| Ongoing | 0.5–2 engineer-days a month, plus 3–8 days to re-check each yearly upgrade | 1–3 engineer-days a month to keep in step with upstream, plus about 2–3 days a quarter of visual and device QA | About 0.5–1 engineer full-time, permanently |
| Needs scored (out of 57) | 13 work as-is, 38 clean to build, 6 need workarounds | Mostly clean to build or better | Best fit, but weakest on free drawing, Pencil and performance |
| Main risk | The undo workaround, Pencil feel, performance with 300+ images, the overlay lagging during pan | Upstream is splitting the 11,446-line `App.tsx` right now (#12195, #12197, #12258), the very files a fork would patch. Knowledge would sit with one person | Time to value, input feel, text and IME, and owning every bug forever |

The shared work costs the same on every option, so it is left out above: Hocuspocus, tenancy, editors, jobs, and the contract-v3 data format.

### 5. What we borrow

**From tldraw: ideas only, plus its MIT foundation packages.**

- The ideas:
  - a typed record store with migrations;
  - one utility per shape (geometry, rendering, handles, resize behaviour);
  - a binding utility for arrows;
  - tools as hierarchical state machines;
  - node bodies as HTML in a DOM layer moved with CSS transforms, with off-screen culling;
  - signals that recompute only what changed.
- **Usable code:** `@tldraw/store`, `@tldraw/state`, `state-react`, `utils`, `validate` and `tlschema` 5.5.2 are MIT. `@tldraw/core` v1 is MIT but archived.
- **Off limits:** `tldraw` and `@tldraw/editor` are under the paid licence. Agents must never be given that source to adapt; ideas come from docs and blog posts only.

**From Excalidraw (MIT, code can be reused):**

- Ideas:
  - `version`/`versionNonce` on every element, so concurrent edits resolve predictably;
  - fractional indices for z-order;
  - presence kept out of the shared document;
  - a per-element canvas cache and culling of off-screen elements.
- Code:
  - `@excalidraw/math`, which is clean and stands alone;
  - `perfect-freehand` (MIT);
  - roughjs (MIT).
- `@excalidraw/element` is tied to Excalidraw's own element model. Copy pieces from it, don't depend on it.

**From the AI-canvas products:** they set themselves apart through typed ports, the editors that open from nodes, and model breadth, not through their canvas engine.

### 6. A staged path that keeps every option open

1. **Now (phases 0–1, on A).**
   - Fix `wrapDrawing` reusing frames (`controller.ts:220`, called from `:302`) and add the export cropped to a frame.
   - Put every `@excalidraw` import behind `src/canvas/adapter/` and enforce it with a lint rule.
   - Keep the scene to geometry and ids only; all meaning stays in `.clan`.
   - Build the engine-independent pieces first: NodeRegistry, ToolRegistry, link table, `planGraph`, the board rail, mention-input, the lightbox and ref roles.

   This is in effect C's core, built once and portable to any engine.
2. **Spike, 1–2 weeks, before `live-sync` / `canvas-nodes` (phase 2).** Measure on a real iPad with Pencil:
   - pen latency and palm rejection;
   - 300 image previews and 5,000 strokes at 60fps;
   - overlay lag during fast pan and pinch;
   - a prototype of one undo per person, built on `Y.UndoManager` with Excalidraw's own history switched off;
   - ratio lock under multi-select resize.

   If the owner still wants C considered, run the 2-week C spike alongside it: a record store, ink drawn on canvas, DOM nodes, two-user Yjs sync and 500 nodes.
3. **Decision point: the end of the spike, before phase 2 code.**
   - **Stay on A** if pen feel is acceptable, performance holds, and the undo prototype is sound.
   - **Escalate to B** (a thin patch queue rebased monthly, started after the `App.tsx` split settles) if any of these is measured:
     - the undo workaround proves unsound;
     - pen feel needs patching inside Excalidraw;
     - ratio-locked or nested sketch areas misbehave in ways users notice;
     - port handles can't be done well in the overlay.
   - **Choose C only if** its spike clearly beats Excalidraw on the iPad **and** the owner accepts a 5–7 month delay to the reviewer's items. It must be decided before phase 2, or the Excalidraw Yjs binding and the preview pipeline get built and then thrown away.
4. **Later:** revisit if upstream ships custom element types (#4957), or if we hit a measured limit such as more than 1–2k elements, or element types that even a fork can't provide.

### 7. Corrections the judges found

- **Option A's score count was wrong.** The correct count is 13 needs that work as-is, 38 clean to build and 6 needing workarounds (N19, N24, N32, N35, N41, N48), not 11/38/8. N29 was scored 2, not 1.
- **`onDuplicate` with replacement is already in 0.18.1** (`types.d.ts:431`). Option B and the excalidraw-depth investigation wrongly called it `next`-only; at most the veto part is new.
- **`fractional-indexing` 3.2.0 is CC0-1.0, not MIT.** It ships to clients inside Excalidraw on every option, not only C, so the owner should approve CC0 or we replace it.
- **Font licences have not been checked.** The bundled fonts (Excalifont, Virgil, Nunito, Lilita, Liberation, Xiaolai, Cascadia, ComicShanns, Assistant) are probably mostly OFL-1.1, but ComicShanns is MIT. They need the licence check on every option.
- **The cost baselines didn't agree.** Option B quoted A at 24–35 weeks (A's own figure is 20–30) and stated its own total as 30–45 when its parts add up to about 24–47.
- **Option C's live-preview claims (N02–N04) were optimistic.** Exporting and zooming out still need bitmaps rendered for each node kind.
- **Excalidraw has no native highlighter.** The nearest is freehand drawing at lower opacity.
- **Excalidraw has no naming dialog on image drop.** Any naming dialog is Napkin's own code, so it is not a reason to fork.
- **`src/canvas` is 1,704 lines.** Option C's "about 900" counts only `controller.ts`, `scene.ts` and `sync.ts` (859 lines). The adapter should be sized from the full 1,704 lines plus `Character.tsx` (793).
- **Collaboration on A and B merges whole elements, not fields.** If two people edit the same element at once, the last write wins and the other edit is lost.

## Tools the licence rule excluded

**Bottom line.** The permissive-only rule costs us the most on the **canvas**. tldraw (paid) with tldraw sync is a better fit for typed nodes and live multi-user editing than Excalidraw plus our own glue. Two other rejections come from misreading the rule, not from real licence risk: **GPL ffmpeg on the server** and **MPL Mediabunny used unmodified**. Both carry no meaningful obligation for a hosted SaaS. Every other rejected tool is either worse or the wrong shape for what we're building. One fact has changed: **BlockSuite is now MIT**, so its rejection over the MPL licence no longer stands. It is still the wrong choice, for other reasons.

I did not re-check prices on the web in this pass. They come from the earlier research. tldraw's ~$6k/yr and MyScript's prices are reported figures, not published list prices.

| Area | Rejected tool | Licence & price | Gain vs chosen | Main drawback | Verdict |
|---|---|---|---|---|---|
| Canvas | tldraw SDK 5.5 + sync | Proprietary key; ~$6k/yr reported (<10 staff), "value-based"; comments add-on extra | Native React nodes, port bindings, nesting frames, dblclick hook, multiplayer undo and sync; **6–10 eng-weeks** saved | Kill switch if key lapses; opaque renewal; runs a second sync server next to Hocuspocus | **Clearly better, worth the licence** |
| Canvas | BlockSuite (AFFiNE) | **Now MIT** (npm 0.22.4) | Yjs-native | Lit not React; no stable SDK since Jul 2025 | Chosen better |
| Canvas | Penpot | MPL-2.0, free | Rich art boards | Clojure app, not an SDK | Chosen better |
| Script | Tiptap Comments/History | $149–999/mo, cloud doc server | Finished comments and version compare (~4–6 wks) | Splits the single-writer Y.Doc; client data hosted off-site | Better, not worth it |
| Script | Tiptap Tracked Changes | Custom price, on top of a plan | Suggestion mode (4–8 wks to build) | Same hosting issue | Better, not worth it (yet) |
| Script | Tiptap AI / Pages | Paid platform | Inline AI UI; paged view | Duplicates our engine; generic pagination | Chosen better |
| Script | BlockNote core | MPL-2.0, free | Free comments, versioning, menus (**3–5 wks**) | Pre-1.0 churn; patching it triggers MPL | Roughly equal |
| Script | BlockNote XL | GPL-3 or $2,340/yr per app | Exporters, multi-column | Generic layout; only useful on top of BlockNote | Better, not worth it |
| Script | Liveblocks | SaaS, $30–3,750/mo; server AGPL | Comments on every surface | Replaces the .clan single writer | Better, not worth it |
| Image | Polotno | Proprietary, quote-only, no modification | Mature Konva editor (2–4 wks) | Single-user; template tool | Better, not worth it |
| Image | Pintura / Photopea | €749/seat/yr; $6–24k/yr self-hosted | Polish; Photoshop-class tools | No layers/collaboration (Pintura); iframe (Photopea) | Not worth it |
| Image | @imgly/background-removal | AGPL | Turnkey API | Weaker IS-Net model | Chosen better |
| Image | BRIA RMBG-2.0 | Non-commercial weights; fal ~$0.018/img | Claims +5 pts (vendor's own figure) | Unproven; third-party API | Roughly equal |
| Image | LaMa | Weights licence unstated | Cheap object erase | IP risk; unmaintained | Better, not worth it |
| Video | **Mediabunny** | MPL-2.0, free | Frame-exact stills and waveforms on device (**1–2 wks**) | Needs WebCodecs (iPadOS 26+) | **Clearly better, worth the licence** |
| Video | Remotion + Editor Starter | ≥$100/mo + $600 | Finished NLE timeline (3–5 wks) | No collaboration; render rewrite | Better, not worth it |
| Video | **GPL ffmpeg (server)** | GPL, free; no obligation for SaaS | libx264 quality; no rebuild (**1–2 wks**) | Must never be distributed | **Clearly better, worth the licence** |
| Video | Diffusion Studio / Twick / ffmpeg.wasm / Etro / OpenCut | Watermark key / SUL / GPL / GPL / MIT | Compositing or full editors | Licence, maintenance or fit | Chosen better |
| Ink | MyScript iink | Paid API (~$10/1k, unverified) | Better handwriting; text/shape split | New data processor; Claude still needed for @refs | Better, not worth it |
| Ink | Tegaki / Qwen-VL-3B | GPL / non-commercial | Offline | Poor Latin quality / not commercial | Chosen better |
| Nodes | ComfyUI UI | GPL-3 client | Typed graph | Wrong UX; GPL in the client | Chosen better |
| Gen | ComfyUI headless | GPL-3, server-only: **no obligation** | Cheaper per image at volume; LoRAs | GPU fleet ops; weight licences | Better, not worth it (now) |

### Where the licence rule costs us the most

1. **Canvas: tldraw SDK + sync.** About **6–10 engineer-weeks** up front, plus ongoing upkeep of the fragile pieces: the PNG-preview, overlay and customData node, the Yjs binding built over reconcileElements, and the Ctrl+Z interception. Against that, ~$6k/yr and 1–2 weeks to convert existing scenes. This is the only case where paying clearly beats building.
2. **Script comments and versioning (BlockNote, MPL).** About 3–5 weeks saved. It costs nothing in money, but trades away control over screenplay behaviour, and the library is pre-1.0.
3. **Server ffmpeg (GPL).** 1–2 weeks of rebuild and evaluation, plus a **quality loss**: openh264 is a baseline-profile real-time encoder against libx264 with CRF and high profile, and the difference shows in client renders and splice seams. The switch also leaves the patent question open. The rule is misapplied here.
4. **Mediabunny (MPL).** 1–2 weeks, a Lambda call for every still, and worse frame accuracy on iPad/iOS Safari. The rule is misapplied here too.
5. **ComfyUI headless.** No cost today. The GPL reason for rejecting it is simply wrong; record that, and keep ops cost as the real reason.

### Options

**A. Buy a tldraw commercial licence (canvas + sync).** About $6k/yr reported. Risks: the production kill switch, value-based renewals as external customers grow, two sync servers (tldraw sync for the canvas, Hocuspocus for script text), and a paid commenting add-on. **Recommendation: yes, with conditions.** Get a written quote first with a 2–3 year renewal cap, a grace period for a lapsed key, and the add-on price. Use the 100-day trial for a spike on Script/Storyboard/Video nodes. If the quote is uncapped, stay on Excalidraw and keep `CanvasAdapter` strict.

**B. "MPL allowed if npm-installed and unmodified."** Cost: $0, one attribution line and a source link. Risk: someone patches a vendored file. Enforce it with a CI licence gate that also blocks GPL XL packages. **Recommendation: adopt.** It unlocks Mediabunny now and leaves the BlockNote decision open on its merits.

**C. "GPL allowed server-side, never distributed."** Cost: $0. Risk: an accidental bundle in Tauri or an on-prem build. Write the rule down and add a check. **Recommendation: adopt.** Keep the GPL static ffmpeg build and drop plan D6's openh264 switch.

**D. Commercial RMBG (Bria via fal, $0.018/img).** **Recommendation: not yet.** Run a 50-frame bake-off (BiRefNet_lite, BiRefNet_HR, Bria) on our own ad frames. Add Bria as an optional "HQ cut-out" provider only if it clearly wins on hair and product edges, and it must never fail a job.

**E. Tiptap Platform, Liveblocks, Remotion, Polotno.** **Recommendation: decline.** Each one breaks the single-writer .clan design, keeps client material off-site, or skips the hard part (collaboration). Revisit Tiptap Tracked Changes only if customers ask for redlines, since Yjs 14 attributions may give an open-source route by then.

**Corrections to the plan:** BlockSuite is MIT. y-excalidraw is MIT but stale, so it is a reference, not a dependency. The GPL objection to ComfyUI doesn't apply to server-only use.

## Gaps the critic found

Each is to be closed in the feature records.

- **high.** No first shippable slice and no path to Laurence. The plan never names what ships first. Today the relay fails closed in identity.who until os-sign-in lands, and deploy-production-tool.yml must not run before then. So the Phase 0 fixes for items 8, 10 and 5 cannot reach the reviewer until os-sign-in, which the plan puts in Phase 1 as one item among nine. *Fix:* Make Slice 1 explicit: os-sign-in (minimal, same-origin or handoff), frame-aspect, frame-change-edit, clip-moment-edit, and an internal-only tenant. Ship it to Laurence on staging and get his re-test before contract-v3 starts. Move os-sign-in into Phase 0, ahead of the three fixes, or run them in parallel with it.
- **high.** The plan says 'collaboration from the start', but the roadmap builds it in Phase 2. contract-v3, mention-input, shot-direction, shot-insert-reorder, the frame lightbox and the rail are all built in Phase 1 on today's single-user ClanBackedStore, which writes napkin-wasm in the browser through IndexedDB. Each one then has to be rewired onto server-authoritative field patches. This is the rework the owner asked to avoid. *Fix:* Either move sync-spike, live-sync and server-job-landing ahead of every Phase 1 feature that writes entities, or require Phase 1 features to write only through a `PatchBus` interface (field patch + base_version). That interface has an in-browser implementation now and the Hocuspocus implementation later, and both run the same tests.
- **high.** Long text that two people can edit lives in last-writer-wins fields. Shot action, direction (≤4000), beats, dialogue and note comments are .clan field patches, and a same-field conflict only gives 'a visible notice'. Two people typing in one shot's direction will overwrite each other. Shot text also exists twice: once in the Script's Y.XmlFragment (the Tiptap Shot node) and once in shots[id].action/direction. The plan says the Shot node only 'references' the entity, but it never says where the user actually types action and direction, or how the two copies stay consistent. *Fix:* Pick one owner per text field. Recommended: long prose fields (direction, beats text, script body) are Y.Text inside the project Y.Doc, and the server copies them into the .clan on checkpoint and validates them at that point. Structured fields (camera, duration, rank, refs) stay as validated patches. The Script Shot node then renders the same Y.Text the Storyboard card edits. Write this into the contract-v3 design and add a two-client concurrency test.
- **high.** Running costs are not estimated per ad, per tenant, or for hosting. The plan refreshes the capability sheet but gives no unit economics. A typical 15 s ad of 6 frames at $0.20 and 6 Veo 3.1 8 s clips with audio at $3.20 costs about $20.40 before retakes. Each aleph2 moment patch is at least $0.56, about $1.12 for a 4 s cut with context. Bedrock handwriting is negligible. Also unpriced: Hocuspocus on ECS Fargate (about $30-80 a month per task plus an ALB with sticky WebSocket sessions), S3, KMS, CloudFront egress for video, and the stitch Lambda at 3 GB. Customers are paying, and D16's caps have no numbers. *Fix:* Add a cost model table: credits per op from runway.json after the refresh, a typical ad and a heavy ad with 3x retakes, the monthly fixed infrastructure, and the margin implied by the price per seat or per ad. Base the default tenant cap on it, and have the estimate-and-confirm sheet read from the same numbers.
- **medium.** Item 8 still has unverified dependencies and edge cases. aleph2 access is not confirmed. config.live.json has videoRegionEdit:false. The aleph2 range is whole seconds, so a note at 3.4 s gets a 2-5 s window. The Veo fallback has a 4 s minimum, so a 2 s window must be generated at 4 s and trimmed, which changes motion speed or timing. The plan does not cover how a splice into a clip that was already trimmed to shot length via trimS maps take time to source time. It also ignores that audio, once enabled in Phase 4 via veo audio, will click or jump at the seams. *Fix:* Do a one-day check of the aleph2 API on our key before committing Phase 0. Define how take-relative time maps to source time across trimS, and add a test for it. Give the Veo fallback a defined behaviour: generate 4 s with first/last frames and keep the middle window, or extend the window to 4 s. Plan an audio crossfade at seams now, even while audio is off.
- **medium.** Item 10's Phase 0 fix and the Phase 3 model disagree. Phase 0 uses user-drawn Excalidraw frames through exportingFrame. Phase 3 makes boards into frames and sketch areas into rectangles, because frames cannot nest. A 16:9 frame the user draws in Phase 0 cannot sit inside a board in Phase 3, and the v2→v3 importer has no rule for those frames. Vertical (9:16) and 1:1 ads are not mentioned. Gemini has no exact 16:9 output and will crop. *Fix:* Ship the Phase 0 fix as the sketch-area rectangle tool, an aspect-locked rectangle with a ratio picker for 16:9, 9:16, 1:1 and 4:5, so the interaction never changes later. Have the importer turn user frames that contain strokes into sketch areas. Add tests for each ratio, including vertical.
- **medium.** Tablet and pen use is unaddressed: no pointerType handling exists in production-tool/web/src. Creatives often draw on an iPad with an Apple Pencil, and item 11 (handwriting) assumes pen input. The plan has no answer for Excalidraw on iPad Safari (palm rejection, pen-only mode), a dblclick intercept that never fires on touch (the plan does add an Open button), Konva brush and mask on touch, transformers.js WebGPU or WASM memory on iPad Safari for BiRefNet and SAM, or editor layouts at tablet width. *Fix:* Name supported devices: desktop Chrome, Safari and Edge, plus iPad Safari with Pencil. Add a pen-input acceptance pass for each phase. Make relay fallback for ML the automatic path when WebGPU is missing or memory is low. Add Playwright touch-emulation tests for Open, board jump and the mask brush.
- **medium.** Some licences and weights are claimed but not verified. dnd-kit is deferred to the 'gate'. The Xenova/slimsam-77-uniform weight licence is only 'tagged'. Transitive dependencies of Tiptap, Hocuspocus, react-timeline-editor and transformers.js (onnxruntime-web is MIT, but check it) are unchecked. The LGPL ffmpeg build is weak copyleft, which the owner said to avoid; running it server-side helps but needs an explicit owner sign-off. Self-built openh264 does not carry Cisco's patent coverage, which applies only to Cisco's binaries, so external customers raise H.264 royalty exposure. Bedrock availability of Claude Haiku 5.5 in our region is unverified. The terms of Runway-routed third-party models (ideogram, gemini, the openai image models) for customer data are unread. *Fix:* Run license-checker / pip-licenses over the full transitive tree before Phase 1 and record the result in the weights manifest, with per-file hashes and the model card licence. Treat ffmpeg as an owner decision: an LGPL server binary, the Cisco openh264 binary loaded at runtime, or AWS MediaConvert, which has no licence issue but costs per minute. Confirm Haiku 5.5 on Bedrock in the target region.
- **medium.** Migrating existing projects is under-specified. v2 projects live in browsers' IndexedDB (kv canvas:<id>, ui:<id>, the clan DB) as well as on the relay (POST /clan, PUT canvas). The importer has no plan for projects that exist only locally, for in-flight jobs and jobCtx at cutover, for moving data out of the napkin-hackathon S3 bucket into tenant prefixes (bucket rename is an open question), or for which tenant dogfood projects belong to. *Fix:* Add a `v3-cutover` feature. It forces a local→server upload on the last v2 build, drains or cancels jobs, maps dogfood owners to a tenant, copies assets by sha256 into tenants/{t}/ (copy, never rename), runs the importer server-side, and keeps v2 exports downloadable for 30 days.
- **medium.** Testing for the new architecture is thin. Nothing is planned for multi-client sync tests (convergence, reorder races, undo across users), job single-writer and dedupe races, the UndoCoordinator against Excalidraw history after intercepting Ctrl+Z, end-to-end browser tests of the canvas-to-editor round trip, performance budgets (frame time with 300 images and 50 nodes, overlay virtualisation), or a regression harness for Laurence's 11 items. *Fix:* Add a Laurence acceptance suite: one scripted Playwright scenario per reviewer item, run on staging for each release. Add a two-client Yjs/Hocuspocus test harness in CI. Set performance budgets and fail CI on regressions. Grow relay/eval with frame-with-text cases, clip-patch seam cases and handwriting cases.
- **medium.** Support and operations for external customers are missing. The plan has no admin console for tenants, caps and seat lists, no audit log of who generated what (beyond the decision chain), no data deletion or export on request (GDPR, the agency client's confidentiality), no status or incident path for Runway outages, and no backups or RPO for the Y.Doc snapshots. *Fix:* Add a Phase 1-2 `tenant-ops` feature: a minimal admin view, a per-tenant delete/export runbook, S3 versioning and lifecycle on snapshots, a CloudWatch alarm on the relay error rate, and a user-facing 'provider is down' state.
- **low.** One factual correction. Open question 3 and sync-spike ask whether napkin-wasm loads under Node. clan-store already declares engines node>=20, runs its store tests (clan-store/test/store.test.ts) under vitest with fake-indexeddb, and the canvas exportingFrame and selection.ts:245 claims check out. The real unknowns are different: whether the wasm-bindgen `--target web` output loads without fetch in a long-lived server, the cost of the whole-document ajv check at 10-25 ms per patch when several users are typing, and memory per open project. *Fix:* Re-scope sync-spike as a load test: N clients each sending patches at 5 per second to one project, measuring p95 apply latency and memory, plus checkpoint size near the 4-5 MB limits.
- **low.** Image-element previews have hidden costs. Each re-render creates new BinaryFiles that go into S3, the Y.Doc and gc. The plan does not say what happens when a user selects, moves or deletes the preview image apart from its node rectangle, or how preview generation runs while nobody has the project open (server-side rendering of a script excerpt or strip). *Fix:* Group or lock the preview with its node, and give it customData kind 'preview' so delete and move follow the node. Render previews server-side in the sync service on checkpoint, keyed by content hash so identical renders are deduplicated. Add previews to the gc roots.
- **low.** Some of the vision is only partly covered. The owner said 'and other apps'; the plan has no story for adding a node type beyond the six (for example a voiceover or music node, or a brief node). Grouping nodes into a reusable sub-flow or template is not covered. Brief Maker spin-off is in Phase 5, even though seeding the Script from a brief is the main OS integration. *Fix:* Document NodeRegistry plus EditorContract as the extension point, with a worked example (Audio node using eleven_v4). Move os-home-card and Brief spin-off earlier if OS adoption matters for sales.

## Still to decide

- **Pricing and spend.** What customers pay (per seat with included credits, per ad, or flat), and the monthly Runway spend per customer we accept. A 15-second ad is about $20 of Runway credits before retakes.
- **Video encoding.** Which ffmpeg build and H.264 route the render service uses: server-only LGPL ffmpeg with Cisco's openh264, or AWS MediaConvert.
- **Second clip model.** Whether to add Seedance 2.5 or WAN 3 for long direction and cheap drafts, after an eval.
- **Art boards.** Whether boards and reference roles are a fixed set the director understands plus free labels (recommended), or fully user-defined.
