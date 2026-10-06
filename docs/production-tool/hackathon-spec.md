# Production Tool — Hackathon Spec (handoff)

Oct 5, 2026 · @Shrey

## Scope and decisions

Wednesday 7 Oct ships one web tool for 80 live hackathon participants: draw and reference a 2D character, generate it, refine it by region, get a four-view turnaround, then generate a 10–20 s ad from it. Participants compete on results, so reliability under load and output quality rank above features.

| Decision | Choice | Why |
| --- | --- | --- |
| Form factor | Static web app + stateless relay; no desktop binary | No code-signing in two days; one URL runs on every machine; hotfixes land instantly |
| Canvas library | Excalidraw (MIT) | Freedraw, images, named frames, export-selection-to-PNG, plain-JSON scene; tldraw needs a license key in production |
| Source of truth | CLAN file + local blob store (IndexedDB) | Server holds no job state; a relay outage pauses Generate and loses nothing |
| Providers | Runway first (keys in hand); fal through the same adapter when its key lands; partner character API later | Build never blocks on a missing key |
| Director | Fast vision model, one call per user action, strict JSON, no agent loops | Replaces the chat UI; bounded latency and cost at 80 users |
| Hosting | AWS on credits: S3 + CloudFront, Lambda Function URL, DynamoDB, S3 assets | Same serverless shape as Workers, already paid for |
| Director model | Direct Anthropic key for Haiku 4.5 (vision); Bedrock only if a current vision model is enabled in-region | Bedrock in this account has older models; \~$13/day either way |
| Brief input | Start afresh; Brief Maker file becomes the input in the post-hackathon version | Keeps Wednesday standalone |
| 3D | None; 2D character + turnaround sheet only | Not needed for the ad step |

Cut from Wednesday, in the order they get cut if time runs out: brush masks (rect only), drop-a-reference-onto-a-region, critic pass, generated audio for ads, multi-user canvases, Brief Maker input, partner character API.

## Architecture

Three layers: the participant's browser holds all state, AWS runs a stateless relay on credits, and the providers do every generation and reasoning call.

&#91;embedded content: architecture · browser, AWS relay, providers\]

Bytes move between the browser and S3 by presigned URL and providers read their inputs from those same URLs, so the Lambda only ever moves small JSON; a relay outage pauses Generate and loses nothing, because the CLAN file and blob store are in the browser. Costs excluding generation: about 1.2¢ a job, under $20 a day at full load, almost all of it the director.

## Canvas and UI

Everything is a node on one Excalidraw canvas: outputs land beside their inputs with provenance arrows, and text exists only where it is anchored to a region. No chat window anywhere.

| Node | Excalidraw element | customData |
| --- | --- | --- |
| ref | image + text label (grouped) | `{kind:'ref', id, label, sha256}` — label doubles as the provider @tag |
| frame | frame, name = template | `{kind:'frame', id, template}` — template ∈ ig-1x1, ig-4x5, story-9x16, hoarding-3x1 |
| gen | image | `{kind:'gen', id, jobId, parentIds[], version, status, provider, requestId}` — status ∈ pending, done, failed, accepted |
| pin | rectangle over a gen | `{kind:'pin', id, genId, region:{x,y,w,h} (0–1 of the image), note, chips[], resolvedBy}` |
| edge | arrow | `{kind:'provenance', from, to}` — auto-drawn, never hand-made |
| shot | image thumbnail with play badge | `{kind:'shot', id, firstFrameGenId, requestId, durationS, order, sha256}` |

Every node `id` is also the CLAN artifact id (§CLAN), so the arrow graph and the log cannot drift apart.

1. Add references: drag or paste images; each gets a label chip (default `ref1`, rename inline). Imports are downscaled to ≤1536 px before hashing; that downscaled file is the artifact.
2. Draw: pen tool inside a template frame. A Generate button floats on the selected frame; nothing else on the canvas has one.
3. Generate: export the frame's children to PNG, collect refs (all refs on the canvas by default; only arrow-linked refs if the user has drawn any arrows), run the director, submit to the provider. A pending gen node appears to the right of the frame showing queue position and elapsed time; arrows are drawn from frame and refs to it.
4. Versions: later gens stack in a column under the first. Accept marks one canonical (badge); Accept unlocks Turnaround and Ad on that node. Reject keeps the node but greys it; both are logged.
5. Focus mode: double-click a gen opens it large in an overlay (plain HTML canvas, outside Excalidraw). Drag a rect; a popover anchors to it with a one-line text field, fixed chips (`match [label]` per ref, `more detail`, `fix anatomy`, `change colour`, `remove`) and Send. The result is a new gen node whose parent is this one; the pin stays on the parent with its note and flips to resolved when the child lands.
6. Turnaround: button on the accepted gen → one sheet gen (front, three-quarter, side, back) → the client crops the grid into four view nodes linked to the sheet.
7. Ad: button on the accepted gen (§Ad generation).
8. Export: Download → zip of `clan.json`, `canvas.excalidraw`, `assets/<sha256>.<ext>`.

Errors render in the node, never in a toast: quota exhausted, queue full, provider failed, with Retry and a Report button that posts the job id to the log. Excalidraw keeps image bytes in a separate `files` map — persist elements and files together.

## Director agent

One stateless call per user action turns canvas state into a provider job. It reads CLAN entries, never a chat history, and its own decision is logged as the resulting entry's `agent` block (model, prompt version, inputs, output JSON, one-line rationale).

Inputs the relay assembles per action:

| Action | What the director sees |
| --- | --- |
| generate | frame PNG, refs `[{id, label, url}]`, template, house-style snippet, provider capability sheet |
| refine | parent gen, crop of the pinned region, pin note + chips, refs, seed used, last 3 verdicts in this lineage |
| turnaround | accepted gen, refs |
| ad\_plan | accepted gen, four views, the ad brief (one line + chips), target length |
| ad\_refine | paused frame, pin note, the shot's first frame, refs |

Output, enforced as strict JSON through structured output:

```json
{
  "action": "generate",
  "provider_job": {
    "model": "gen4_image",
    "prompt": "@hero full body, jacket in @texture, flat 2D illustration ...",
    "negative": "",
    "refs": [{"id": "ref_a", "tag": "hero", "role": "identity"}, {"id": "ref_b", "tag": "texture", "role": "material"}],
    "control": {"kind": "sketch", "artifact": "sha256:..."},
    "ratio": "1080:1350",
    "seed": 1234,
    "mask": null
  },
  "needs_user": null,
  "rationale": "one line",
  "confidence": 0.8
}
```

`needs_user` is either `null` or `{question, options}` with 2–4 options; the client shows them as chips in the pin popover and one tap resubmits with the answer appended. This is the whole clarification mechanism.

Prompt rules: never request a capability the sheet says the provider lacks; keep the seed across refines in a lineage; a region under \~25% of the image is a masked inpaint where masks exist, otherwise a reference-based regenerate with the parent tagged `@current`; write in the provider's dialect (Runway: @tags in the prompt; fal: ordered image URLs named in the prompt); honour the template ratio; temperature low.

Models: Haiku 4.5 through a direct Anthropic key for every per-click action (vision, 1–3 s, about 1¢ a call); a Sonnet-class model with extended thinking for `ad_plan` only, since it runs once per ad. Bedrock is a later swap if a current vision model is enabled in the account's region. Prompt files live in the repo as `prompts/director.v<N>.md`; the version string goes in every CLAN agent block so a logged entry can be re-run against a new prompt and diffed. Cache the static system prompt.

Critic (cut-able): after a turnaround, an async Haiku call compares the four views to the accepted front and writes a short badge on the sheet node ("left view lost the scar"). It never blocks the person. No retry loops this week; one bounded retry on a critic fail is the only loop allowed, and only for turnaround.

## Provider adapter

One interface, three implementations; the UI never learns which provider ran. Build the whole UI against `Mock` on Tuesday morning, switch to `Runway` by Tuesday afternoon, add `Fal` when its key lands.

```ts
type Ref = { id: string; tag: string; url: string }
type Job = { provider: 'runway' | 'fal' | 'mock'; requestId: string; model: string }
type Status = { state: 'queued' | 'running' | 'done' | 'failed'; position?: number; outputUrl?: string; error?: string }

interface Provider {
  generate(r: { sketchUrl: string; refs: Ref[]; prompt: string; ratio: string; seed?: number }): Promise<Job>
  refine(r: { imageUrl: string; maskUrl?: string; prompt: string; refs: Ref[]; seed?: number }): Promise<Job>
  turnaround(r: { imageUrl: string; refs: Ref[] }): Promise<Job>
  imageToVideo(r: { firstFrameUrl: string; prompt: string; ratio: string; durationS: number }): Promise<Job>
  videoToVideo(r: { videoUrl: string; prompt: string; refs: Ref[] }): Promise<Job>
  status(job: Job): Promise<Status>
  capabilities(): CapabilitySheet
}
```

All image and video inputs are handed to providers as S3 presigned GET URLs (1 h TTL); nothing passes through the Lambda. Runway accepts https or data URIs for images and needs a publicly reachable https URL for video input.

Runway mapping (keys in hand; every call carries `X-Runway-Version: 2024-11-06`, tasks are polled by id):

| Need | Endpoint | Model | How |
| --- | --- | --- | --- |
| generate | `POST /v1/text_to_image` | `gen4_image` | `referenceImages: [{uri, tag}]`, at least one; prompt names them as `@tag`. The sketch goes in as a tagged reference (`layout and pose as @sketch`) since there is no native sketch control |
| refine | `POST /v1/text_to_image` | `gen4_image` | No mask: parent image tagged `@current`, the instruction describes the region change, same seed |
| turnaround | `POST /v1/text_to_image` | `gen4_image` | `@hero character turnaround sheet: front, three-quarter, side, back, identical outfit, plain background` |
| imageToVideo | `POST /v1/image_to_video` | `gen4_turbo` (any 2–10 s) or `gen4.5` | `promptImage` = the shot's first frame |
| videoToVideo | `POST /v1/video_to_video` | per current docs | Edits an input video of up to 10 s and takes up to 5 reference images; this is the pin-on-a-paused-frame edit |

fal mapping (when the key lands): one image-edit endpoint with multiple reference inputs for generate, refine and turnaround (nano-banana-2 class); a Fill-type endpoint for true masked refine; one image-to-video endpoint. Requests go to fal's persistent queue, which reports queue position and completes by polling or webhook; the relay is fal's documented server-side proxy so the key never reaches the browser.

Capability sheet, one JSON per provider, fed to the director and used by the adapter to refuse impossible jobs early:

```json
{ "masks": false, "sketchControl": "reference-only", "maxRefs": 3, "tagSyntax": "@tag", "ratios": ["1024:1024", "1080:1920"], "videoDurations": [2, 10], "videoEdit": true }
```

`Mock` returns the input image with a stamp after 2 s and a fake queue position, so the entire canvas, pins, versions and export can be built before any key exists.

Sources to fetch before coding the adapter, not from memory: [Runway getting started](https://docs.dev.runwayml.com/guides/using-the-api/), [Runway API changelog](https://docs.dev.runwayml.com/api-details/api_changelog/), [fal queue](https://docs.fal.ai/documentation/model-apis/inference/queue), [fal client overview](https://fal.ai/docs/documentation/model-apis/inference/index.md). Confirm the exact `video_to_video` model name and Runway's accepted ratio strings in the API reference.

## Ad generation

An ad is 2–3 shot nodes in order, each a 5–10 s clip whose first frame carries the accepted character; the relay stitches them into one MP4 with the Napkin end card on export. Same canvas, same pins, no new UI paradigm.

1. Ad button on the accepted gen opens a popover: one line for the product or message, chips for length (10, 15, 20 s), format (9:16, 1:1, 16:9) and tone (playful, premium, bold).
2. `ad_plan` (Sonnet-class, once) returns `shots[]`: `{order, durationS, view, firstFramePrompt, motionPrompt}` summing to the target. 20 s = 2 × 10 s; 15 s = 3 × 5 s; 10 s = 2 × 5 s.
3. Per shot, two jobs in sequence: `text_to_image` with the chosen view tagged `@hero` plus the scene → a gen node; then `image_to_video` on that frame for `durationS` → a shot node linked to its first frame. Shots run in parallel.
4. Shot nodes show a thumbnail with a play badge and sit in an ordered strip; drag to reorder.
5. Refine a shot: play, pause, drag a rect on the paused frame, type one line → `ad_refine` director → `video_to_video` with the instruction and up to 5 references → a new shot version. Fallback when video edit misbehaves: refine the first frame as an image and regenerate the clip.
6. Render: a second Lambda with an ffmpeg layer concatenates the shots from S3, appends the end card, writes `ads/<id>.mp4` back to S3 and returns a download URL. Fallback if the layer fights back: ffmpeg.wasm in the browser, acceptable for 20 s of 720p.
7. Audio: none on Wednesday. Stretch candidates are a video model with generated audio (Runway's changelog lists `gemini_omni_flash` with optional generated audio at 720p) or an ElevenLabs voice-over pass later.

Video jobs take 1–3 min each, so the shot node shows queue position and elapsed time like any gen, and the strip shows how many shots are still rendering. Count video jobs under their own quota (6 per participant to start) because they cost roughly ten times an image.

CLAN: one `ad_plan` entry carrying the shot plan JSON in its agent block, one entry per shot (first frame → clip), one `stitch` entry whose inputs are the shot hashes and whose output is the MP4 hash.

## CLAN mapping and artifact handling

The CLAN file is the source of truth and the canvas is a renderer of it: one entry per job, including pending ones, and every canvas node id is a CLAN artifact or entry id. Map the fields below onto CLAN's own schema; what matters is that each survives.

```json
{
  "id": "job_01J...",
  "kind": "generate | refine | turnaround | ad_plan | shot | stitch | accept | reject",
  "ts": "2026-10-07T10:12:03Z",
  "actor": { "human": "participant:p042" },
  "status": "pending | done | failed",
  "provider": { "name": "runway", "model": "gen4_image", "requestId": "task-..." },
  "inputs": [
    { "artifact": "sha256:...", "role": "sketch", "template": "ig-4x5" },
    { "artifact": "sha256:...", "role": "ref", "label": "texture" },
    { "entry": "job_...", "role": "parent" },
    { "region": { "x": 0.31, "y": 0.52, "w": 0.20, "h": 0.14 }, "note": "brushed steel", "chips": ["match texture"] }
  ],
  "agent": { "model": "claude-haiku-4-5", "promptVersion": "director.v3", "output": {}, "rationale": "..." },
  "outputs": [ { "artifact": "sha256:..." } ],
  "verdict": null
}
```

An artifact is a record, never bytes:

```json
{ "id": "sha256:ab12...", "mime": "image/png", "bytes": 812345, "w": 1024, "h": 1350,
  "locations": ["idb://sha256/ab12...", "s3://napkin-hack/assets/sha256/ab12...", "https://<provider-url, expires>"],
  "thumb": "data:image/webp;base64,... (optional, under 4 KB)" }
```

Open question, decided at implementation. The Viewer already renders images, so the defaults below are what Claude Code should take unless CLAN's schema forces the alternative:

| Case | Default | Alternative |
| --- | --- | --- |
| Image or video output | Hash reference plus locations; bytes in the blob store | Never inline |
| Sketch strokes | The Excalidraw scene is one JSON artifact referenced by frame entries; the frame's rasterised PNG is a second artifact | Inline the frame's stroke JSON only (small) |
| Mask or region | Inline rect in 0–1 coordinates; a brush mask later is a PNG artifact | — |
| Thumbnail for the Viewer | Optional webp under 4 KB inline, so the log renders without the blob store | Viewer resolves `sha256:` to the first reachable location |
| Provider URLs | Store as a location hint with its expiry; copy bytes into own store at Accept at the latest | Copy every output immediately (more egress, simpler) |
| Pending entries | Write at submit with `status: pending` and the `requestId`; patch status and outputs on completion | Append a completion entry if CLAN is append-only |
| Viewer resolution order | `thumb` for the gallery, then `idb://`, then `s3://`, then provider URL | — |
| Export | Zip of `clan.json`, `canvas.excalidraw`, `assets/<hash>.<ext>` | A folder written through the File System Access API (Chrome and Edge only) |

Human verdicts are entries too: `accept` and `reject` carry the version id and the chips chosen, which is the same review step planned for the pitch stage.

Server copies, for live debugging: every entry is also POSTed to the relay and lands at `clan/<participant>/<jobId>.json`; the whole file is pushed at every Accept and on a 5-minute autosave. Participants keep the canonical copy; the server copy is for you two watching the event.

## Auth, quotas, logging and remote config

Participants sign in with an event code and a handle; the relay enforces per-participant quotas in DynamoDB, logs every job to CloudWatch and S3, and reads a remote config file so providers, prompt versions and limits can change mid-event without a deploy.

Auth: `POST /session {eventCode, handle}` returns a 24 h signed token carrying `participantId`; the handle becomes CLAN `actor.human`. No passwords, no email. Organiser codes map to higher quotas. A `blocked[]` list in config revokes a handle instantly.

Quotas live in one DynamoDB table (`pk = participantId#day`, one atomic counter per job type) and are checked at submit only, never on polls:

| Job type | Default per participant per day |
| --- | --- |
| Image jobs (generate, refine, turnaround, ad first frames) | 40 |
| Video jobs (shots, shot edits) | 6 |
| Ad renders | 3 |

Provider concurrency is handled without server state: when Runway or fal returns a rate-limit error, the relay replies `429 retryAfter`, the pending node shows a countdown and retries itself with backoff. fal's own queue absorbs bursts; for Runway, confirm the plan's concurrent-task limit before Wednesday and set the client's max in-flight jobs per participant to 2.

Logging, three layers:

1. Relay: one structured JSON line per request to CloudWatch — participant, jobId, action, provider, model, latency, status, error, estimated cost. Save three Logs Insights queries before the event: errors by provider, p95 latency by action, jobs per participant.
2. Director I/O in full (prompt version, input summary, output JSON) in the same stream, so prompts can be tuned on the fly from real failures.
3. Client: `window.onerror` and `unhandledrejection` post to `/log` with jobId, browser and canvas size; failed nodes carry a Report button that posts the same.

Every CLAN entry is mirrored to S3 as it is written (§CLAN), which is the audit trail for "check later".

Remote config is a `config.json` on S3 behind CloudFront, fetched at load and every 2 minutes:

```json
{ "provider": "runway", "promptVersion": "director.v3", "quotas": { "image": 40, "video": 6, "render": 3 },
  "overrides": { "p042": { "image": 80 } }, "blocked": [], "banner": "", "flags": { "critic": false, "brush": false, "ads": true } }
```

Changing anything in it is uploading a file. Kill switches per action (`flags.ads: false`) and the banner are the two controls you will reach for most during the event.

## Branding

The name travels on the outputs, not in the UI: every rendered ad ends on a one-second Napkin end card, every exported still carries a small corner mark, and the tool itself reads as Napkin OS with one signature element that is visibly alive.

- Outputs: the stitch Lambda appends a 1 s end card ("Made with Napkin Studio OS" plus the event name) to every ad; exported stills get a 24 px corner mark; files are named `napkin-<handle>-<id>.mp4`. Participants will post these, and the end card is what carries the name out of the room.
- The signature element: provenance arrows in the brand colour that animate (a flowing dash) while a job is running, so the canvas visibly thinks. It costs one CSS keyframe and is the thing people screenshot.
- In-app: Napkin OS tokens (type, colour, radius — needed, see Open questions), the mark top-left, branded pending and empty states. Template frames carry a faint mark on the canvas only.
- The export success card shows the mark next to the ad preview: the screenshot moment.
- Never send a marked image back into generation; marks are applied on export and render only.

## Build plan

Two lanes: Canvas (app, focus mode, pins, CLAN writing, export) and Relay (AWS, director, providers, stitch). Suggested owners: Sai on Canvas since CLAN is his repo, Shrey on Relay as the AWS point of contact; swap if it suits. The job JSON, the CLAN entry and the `customData` shapes in this doc are the contract between the lanes; nothing else needs coordinating until integration.

Monday night

- [ ] Both: agree the three schemas; create the repo with `app/`, `relay/`, `prompts/`, `infra/`
- [ ] Canvas: Vite + React + Excalidraw renders; ref node with label; Mock provider round-trips to a pending node that turns into a result node
- [ ] Relay: Lambda Function URL with `/session`, `/jobs`, `/jobs/:id`, `/log`; S3 bucket with presigned PUT; `config.json`; app shell deployed on S3 + CloudFront at a real URL
- [ ] Relay: Runway key in Secrets Manager; one `gen4_image` call with @tags verified from a script

Tuesday morning

- [ ] Canvas: four template frames; Generate button on the selected frame; frame export to PNG; presigned upload; submit; pending node with queue position; arrows; result node; version stacking
- [ ] Relay: director on Haiku 4.5 with structured output, prompt v1; Runway `generate` + `status`; DynamoDB quota; structured log lines

Tuesday afternoon

- [ ] Canvas: focus mode overlay, rect select, popover with text + chips, `needs_user` chips; Accept and Reject; CLAN entries written to IndexedDB with the hash blob store; export zip
- [ ] Relay: Runway `refine` and `turnaround`; director prompt v2 with the capability sheet; entries mirrored to S3; config served and polled

Tuesday night

- [ ] Both: turnaround grid split into four view nodes; end-to-end on the Windows and Mac machines; 10-tab load test; fix list ranked

Wednesday morning

- [ ] Canvas: ad popover; shot nodes and ordered strip; play, pause, pin on a frame → `ad_refine`
- [ ] Relay: `ad_plan` on a Sonnet-class model; `image_to_video` and `video_to_video` adapters; stitch Lambda with ffmpeg layer and end card; video quota
- [ ] Both: every error state rendered in-node; banner and kill switches exercised once

Wednesday afternoon, freeze at 15:00

- [ ] Seeded example canvas so nobody starts blank; organiser codes; three Logs Insights queries saved; spare keys printed; event code set; freeze

If a lane falls behind, cut in this order: brush mask, drop-ref-on-region, critic, `video_to_video` refine (keep first-frame refine + regenerate), ffmpeg stitch (ship shots as separate files), turnaround split (keep the sheet).

## Open questions

Defaults are in place for each; replace them when the answer arrives rather than waiting.

- [ ] Template sizes: exact Instagram set and Napkin's hoarding specs. Defaults: 1080×1080, 1080×1350, 1080×1920, 3600×1200.
- [ ] Napkin OS design tokens (type, colour, radius) and the logo as SVG.
- [ ] Runway API: exact `video_to_video` model name, accepted ratio strings for `gen4_image`, reference-image limit per call, the plan's concurrent-task limit, price per call.
- [ ] fal: key ETA; which endpoints give multi-reference edit, masked fill and image-to-video.
- [ ] Partner character API: labelled refs per call? sketch as control? mask inpainting? multi-view? plus auth, rate limit, response format and a hackathon quota.
- [ ] Bedrock: is a current vision model enabled in the chosen region? Default until then: direct Anthropic key.
- [ ] CLAN schema: append-only or patchable entries? Is there an existing artifact or blob concept? How the Viewer resolves `sha256:` and whether it reads `thumb`.
- [ ] Event: wifi quality, how the event code is handed out, and whether all 80 hit Generate in the same minute at kickoff.
- [ ] Judging: do judges want the MP4 and stills only, or a gallery page of exported ads? A gallery is a half-day add and doubles as the organiser view.
- [ ] Haiku 4.5 is listed with a retirement date not sooner than 15 Oct 2026; if the tool outlives the event, plan the model swap.
