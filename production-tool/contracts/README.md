# Production Tool contracts (contract 3, 2026-10-13; locked 2026-10-06)

These files are the contract between the three lanes:
- `production-tool-ui`: Shrey designs it, then Sai wires it
- `production-tool-harness`: Sai
- `production-tool-infra`: Shrey

**Locked (D1) by Shreyansh Soni on 2026-10-06.** From now on a contract changes only by: (1) asking Shrey, (2) a decision recorded in `features/production-tool.clan` (`clan patch-decision`), (3) a bump of `contractVersion` when the change breaks an existing payload, (4) `check.py` passing. Adding an optional field is not breaking; renaming, removing, tightening or changing a meaning is.

Check after any change (every example must pass, and every `examples/invalid/` case must be refused):

```bash
uv run --no-project --with jsonschema --with rfc3339-validator python production-tool/contracts/check.py
```

| File | What it fixes | Who writes / who reads |
|---|---|---|
| `common.schema.json` | ids (prefixed ULIDs), `sha256:` hashes, keys, variants, ref names, wire tags, roles, views, the 0-1 region, ops, quota classes, job states, cost, asset refs, outputs, error codes | everyone |
| `relay-api.schema.json` | request and response bodies of every relay route, and the job ledger item | infra writes the relay; ui calls it; harness plugs in behind it |
| `capabilities.schema.json` + `capabilities/*.json` | what each provider can do, with which model; the `models` catalogue with each model's checked limits and published price | harness writes; the director, relay and UI read |
| `pricing.py` + `pricing-cases.schema.json` + `examples/pricing-cases.json` | the one price function: credits and USD for a model and its settings, from the sheet; its vectors | check.py, the relay (bundled), ad_costs.py and provider_reference.py |
| `cost-model.schema.json` + `cost-model.json` | what one ad costs at list prices: scenarios of jobs (no prices of their own), placeholders, fixed monthly infrastructure, the tier's ceilings | relay/scripts/ad_costs.py, provider_reference.py, later tenant-limits |
| `spend-policy.schema.json` + `spend-policy.json` | every agency's defaults until its tenant item says otherwise: no monthly cap, daily quotas off, allow {claude, makers} (features/tenant-limits.clan) | the owner decides; the relay (bundled), tenants.py and the web read |
| `subprocessors.schema.json` + `subprocessors.json` (+ generated `subprocessors.md`, `subprocessors.py`) | who receives an agency's material, what decides it, and where, when confirmed; every sheet maker must be listed | the owner and counsel; the Data sharing sheet, check.py and tenants.py read |
| `director.schema.json` | the director's strict JSON output and the logged agent block | harness |
| `document.schema.json` | the CLAN document (shared/data.yaml): the project, and id-keyed maps of boards, sketches, scripts, scenes, storyboards, shots, beats, frames, videos, takes, renders, reviews, links, keys, refs, documents, format sets, sizes, checks, asks, suggestions, spin-ins, jobs, stale marks, exports and assets | clan-store writes through its buses; web, the export and the relay's JobInput read |
| `patch.schema.json` | the field-level patches PatchBus carries: Patch, PatchBatch (with its decision), PatchResult | clan-store, later the sync service |
| `collab.md` | who writes what: fields and live text, the Y.Doc layout, field owners, checkpoint, the leaf rules, decision verbs, addresses, undo | everyone who writes the document |
| `format-packs.schema.json` + `format-packs.json` | the industry format packs (owner's draft) | Make all sizes, scamp sheets |
| `examples/ranks.json`, `windows.json`, `links.json` | the rank keys, the note window and canLink, asserted in both vitest and pytest | clan-store, relay, canvas |
| `examples/patches.json` | Fix this moment's arithmetic: the note window on a take, the range or cut send, the keyframe, the price per second, the spliced take's segments, asserted in both vitest and pytest | clan-store `src/patch.ts`, relay `time_rules.py` |
| `customdata.schema.json` | Excalidraw `customData` on the canvas (pic, drawn, note, gen, provenance; {kind, id} tags for board, sketch, script, storyboard, video, link, document, format_set, suggestion) | ui |
| `config.schema.json` + `examples/config.*.json` | remote `config.json`: routing per op, director models, quotas, timeouts, spend stop, flags, banner | Shrey uploads it; web and relay read |

## Relay routes

| Route | Body → response | Notes |
|---|---|---|
| `GET /me` | → `Me` | Who the relay's identity seam (`relay/identity.py`) says is asking: workspace, the agency's allowlist, today's quotas (null while the agency's daily quotas are off, the default), saved projects. There is no sign-in of the tool's own: locally a fixed person, elsewhere 401 on every route until the Napkin OS sign-in is wired in (features/os-sign-in). |
| `POST /uploads` | `UploadRequest` → `UploadResponse` | The browser hashes first; an artifact the agency already holds (it uploaded it first, or the relay made it for the agency) needs no upload, and no agency is told of another's file. `putUrl` is bound to the hash: the browser sends the `putHeaders` the relay names (`x-amz-checksum-sha256`, base64 of the digest) and S3 refuses other bytes (features/tenant-limits.clan). `url` is the CloudFront path that providers read. |
| `POST /jobs` | `JobRequest` → `Job` | Idempotent on `jobId`: sending the same id again returns the same job and is never paid twice. Quotas are checked here, never on polls. |
| `GET /jobs/{jobId}` | → `Job` | Poll no faster than `nextPollS`. |
| `DELETE /jobs/{jobId}` | → `Job` (state `cancelled`) | Also cancels at the provider where it can. |
| `POST /log` | `LogEntry` → 204 | Client errors and the Report button. |
| `POST /jobs/{jobId}/answer` | `JobAnswer` → `Job` | Answers the job's question (state `needs_input`): the job resumes on the same jobId and its starter's budget. Any member of the job's tenant may answer; a second answer is 409 `AnswerConflict` with the winner. Added in contract 3. |
| `GET /library/{shelf}` | → `LibraryIndex` | One shelf's items (a client's, or `agency`), latest version each, at `tenants/{t}/library/{shelf}/index.json`. Contract 3. |
| `GET /library/{shelf}/{key}[/{ver}]` | → `LibraryEntry` | One version; the latest without `{ver}`. |
| `POST /library/{shelf}/{key}` | `LibraryPublish` → `LibraryEntry` | Publishes the next version of a key, brand kit or format pack. 409 `conflict` when `baseVer` is not the latest. Assets must be uploaded first. |
| `POST /clan` | `.clan` bytes → `ClanSaved` (with `X-Project-Id`) or 204 | The person's project, saved on Save, on accept and every 5 minutes (`ClanMirror` lists the headers). Max 5 MiB. With `X-Project-Id` it is one of the person's saved projects: `If-Match` (its last ETag) makes a save that someone else got in before a 409 `conflict`, never an overwrite. Every save is kept with a timestamp. Added 2026-10-06; projects and ETags 2026-10-09. |
| `GET /projects` | → `ProjectList` | The caller's saved projects, from any browser, newest first. Added 2026-10-09 (features/personal-workspaces.clan). |
| `GET /clan/{projectId}` | → `.clan` bytes (`ProjectOpen` lists the headers) | The newest save, with its `ETag`. 404 when it is not the caller's; 413 above 4.3 MB. |
| `PUT /clan/{projectId}/canvas`, `GET /clan/{projectId}/canvas` | `ProjectCanvas` → 204, → `ProjectCanvas` | The canvas that goes with the saved project, so it opens elsewhere as it was. |
| `POST /dogfood/consent` | → 204 | The person read the beta notice: kept as `dogfood/consent/<participantId>.json` (handle, team, workspace, time). 404 unless `config.flags.dogfood`. Added 2026-10-09 (features/production-tool-dogfood.clan). |
| `POST /dogfood/events` | `DogfoodBatch` → 204 | The web app's events, one S3 object per batch under `dogfood/events/<date>/<participantId>/`. 403 before consent, 413 over 256 KiB, 404 when off. The relay records its own events too: every write and refusal (bodies of `/jobs` and `/library/{key}` capped at 64 KiB, never headers) and every job state change. Read with `relay/scripts/dogfood_record.py`. |
| `GET /config` | → `config.json` | Served by CloudFront; public. |

Errors are a non-2xx status with `ErrorResponse`. A 2xx body never carries an `error` key. A provider failure never becomes a success, and a mock output is always `kind: "mock"`.

## The adapter interface (harness)

Every provider implements this, in the relay's Python:

```python
class Provider(Protocol):
    name: str                                    # mock | runway
    def capabilities(self) -> dict: ...          # capabilities/<name>.json
    def submit(self, job: ProviderJob) -> str:   # director.schema.json#/$defs/providerJob
        """Send the job and return the provider's request id. Raise CapabilityMissing
        if the sheet rules it out. Never wait for the result here."""
    def status(self, request_id: str) -> Status: # state, queue position, output URLs, error
    def cancel(self, request_id: str) -> None: ...
```

The relay owns everything around the adapters:
- the job ledger and idempotency
- quotas, the fair-share queue and the spend stop
- copying outputs to S3 and hashing them
- choosing a provider with `config.routing[op]` (the first that supports the op and has a free slot)

The director, given the routed sheet, owns:
- the prompt, written with plain `@tag` names
- refs and roles
- ratio strings

The adapter owns the exact request:
- field names
- rewriting `@tag` into the provider's syntax (`tagSyntax`), with one deterministic function; a prompt already in that syntax is left alone (decided 2026-10-06)
- asset URLs, through the relay's `providers.base.asset_url(sha)`: HTTPS, the real mime type, answers HEAD, no redirects
- mask polarity: ours is white = change, and the adapter converts it to the endpoint's convention
- audio off wherever the model has a switch (`video.audioControl`); where it has none, the field is omitted and the director writes "no music, no dialogue" into the prompt (decided 2026-10-06)
- the provider's error codes mapped onto ours

## Rules that hold everywhere

- **Hashes are the identity.** URLs are only hints. Every provider output is copied to our S3 and hashed before a job is `completed`.
- **One id everywhere.** A job's id is also its Excalidraw element id and its document entry id.
- **Names and tags.** People name images `key_variant` (`maya_laughing`); variants are free text. A provider job uses wire tags in the strictest form (`^[a-z][a-z0-9_]{2,15}$`), derived by the relay from the names (`relay/names.py`), which also rewrites `@name` in the job's words. Unnamed inputs become `in_1`, `in_2`…
- **Region:** 0-1 coordinates of the image it sits on, origin top-left.
- **Cancel:** where `results.cancel` is false, the UI hides Cancel; a cancelled job may still bill and its `cost.confirmed` says so.
- **Moderation:** never retry a moderated job (Runway `SAFETY.INPUT.*`). It becomes `moderated`, which can't be retried.
- **`config.json` is public.** Keys and the blocked list live in Secrets Manager and DynamoDB, not in it.

## Decided at D1

1. **Field names.** The document is snake_case, like all CLAN data here; the API is camelCase. `shot` is shared and keeps snake_case in both. The shape (separate lists joined by id) borrows from Advertising Studio, but this is its own app and does not promise compatibility with it (owner, 2026-10-06).
2. **Job states** are pipeline.yaml's nine, in the relay and the document alike.
3. **Views:** front, three_quarter, side, back, plus an optional side_2. Replaced in v2: views are variants of a key (`front`, `three-quarter`, `side`, `back`).
4. **`blocked` and per-handle overrides** moved out of `config.json`, because it is public.
5. **Director models:** Claude on Amazon Bedrock (eu-west-1, IAM, no API key): `eu.anthropic.claude-sonnet-5-5` per click and for the shot list (`config.director`), checked ACTIVE on 2026-10-06. Per-click direction runs `director.v5` (one section per op; the shot list keeps `director.v4`); it was Haiku 4.5 on v4 until 2026-10-09 (features/director-v5.clan). Locally, the anthropic wire pointed at `scripts/model-local` (the one local model backend) runs the same model ids on the developer's Claude Code login.
6. **Spend caps:** $200 in `config.testing.json`, $1,300 in `config.live.json` (D2, 2026-10-06: Runway's org has 20 concurrent per model and about $3.2k of credits, so no tier purchase). This is the relay's own stop, not a limit at Runway.
7. **Example `routing` for the event:**
   - fal first for images, with Runway as fallback
   - clips: fal, then HeyGen, then Runway
   - clip_edit on Runway only (aleph2)

   Replaced 2026-10-09 (features/runway-fallback.clan, owner's rule): every op routes to Runway only,
   on the event's key. fal and HeyGen run only on a participant's own keys (HeyGen then fal for clips,
   fal for pictures and frames), and Runway is the floor of every job: one that fails on fal or HeyGen
   for any reason but moderation or invalid input is made again once on Runway's default model, on the
   event's key (Job.fallbackFrom, Job.fallbackReason). `fallbackOnly` is no longer read.
8. **Sequential storyboard frames (2026-10-07).** Frames are drawn one after another with three anchors: the character views (identity), frame 1 (setting, light and style) and the previous frame (continuity). `JobInput` gains an optional `anchorFrame` (assetRef: the first storyboard frame) beside `previousFrame`, and a frame request may carry the `script` for the setting. Additive: `contractVersion` stays "1". The director names them `@anchor` and `@previous` (prompt `director.v3`). To name it, `promptVersion` in `config.schema.json` and the agent block in `director.schema.json` now also take a minor version (`director.v3`); this loosens a pattern, so every existing value stays valid.
9. **Prompt names stay `director.vN`** (2026-10-07). A .clan keeps the contract it was created with, so documents made before the pattern was loosened refuse `director.v2.1`. The frames prompt is `director.v3`, which every document accepts; don't use dotted versions.
10. **Contract version 2 (2026-10-07, feature canvas-solid-refs).** Breaking, so `contractVersion` is "2". The document's `character` (refs, combines, views, lock) becomes `keys[]` + `refs[]`. A shot names its refs (`shots[].refs`) instead of `lead_view`. `JobInput.sketch` and `JobInput.character` go: every image input is a ref with an optional `name` and a `kind`, and a view takes its source as `image`. The `combine` op folds into `generate` (1-14 inputs). customData `ref` and `sketch` become `pic`, `drawn` and `note`. The relay adds the workspace library routes and `workspace` on the session. The live `config.json` must drop its `combine` routing before this relay is deployed.
11. **Character cards (2026-10-09, feature character-cards).** The agent block in `director.schema.json` gains an optional `cards` list: for each ref the director was told about, its wire `tag`, `sha256`, `kind` and `card` (2-4 lines one vision call wrote about the picture; relay/cards.py). Additive: `contractVersion` stays "2", and the director's output is unchanged. Since a .clan keeps the contract it was created with (item 9), the web app keeps `cards` out of the document's `jobs[].agent` and records them in the director's decision-chain entry instead, where the History panel reads them.
12. **Personal workspaces (2026-10-09, feature personal-workspaces).** Each name is its own workspace: `SessionResponse.workspace` is the participantId (it was the team an event code belonged to, via the EVENT_CODES `workspaces` map, which is gone), so the library is the person's own. `SessionResponse` gains `projects` (how many projects the name has saved), and the relay adds `GET /projects`, `GET /clan/{projectId}`, the project canvas, and ETag-checked saves on `POST /clan` (If-Match, 409). Only the relay and the web app read these; both change together. `contractVersion` stays "2": no document or job payload changes.
13. **The beta's record (2026-10-09, feature production-tool-dogfood).** `config.flags.dogfood` (optional, absent = off), `SessionResponse.dogfood` {consented} (present only when on), and `POST /dogfood/consent` and `POST /dogfood/events` (`DogfoodBatch` of `DogfoodShellEvent`). Additive: `contractVersion` stays "2". The stored line is `{ts, participant, source: web|relay, kind, name, project?, stage?, data}`; a run of identical events is its first line plus `kind: "repeat"` {of, count (times after the first), first, last}.
14. **After the hackathon (2026-10-13, feature drop-hackathon-extras).** Breaking. fal and HeyGen are gone: the provider enum is `mock | runway`, their capability sheets and pathway configs are deleted, and `tagSyntax` and `refs` keep only what Runway uses. Participants' own keys go with them (`X-Own-Keys`, `flags.ownKeys`, `Job.keySource`). A document's history records `madeBy`, a free string, so projects saved on fal or HeyGen still open (`examples/document.hackathon.json`). The tool's own sign-in goes: `POST /session`, event codes and the organiser role give way to `GET /me` behind the identity seam. `config.json` loses `eventName` and `fallbackOnly`; `config.event.json` is `config.live.json`. The web app and the relay change together.
15. **Contract 3 (2026-10-13, feature contract-v3).** Breaking, so `contractVersion` is "3", in one batch with no importer and no shim (owner). The document's lists become maps keyed by id, every entity carries `v` and `field_v`, and order is `rank` (fractional keys). Gone: `participant`, `stage`, the singleton `script`, shots' `maxItems 8`, `order`, `composition`, `camera_move`, `dialogue`, `selected_take`, and `selected` on frames and takes. New: the root `project` and the read-only `upstream`; boards, sketches, scripts, scenes, storyboards, beats, videos (the cut, with picks and alternates), renders, links, documents, format sets, sizes, checks, asks, suggestions and spin-ins; shot `camera` (size with `graphic`, angle, movement, speed, `lens_mm`, `macro`), `kind` (the end card is a shot), action 600 and direction 4,000 as live text with Dex's `direction_condensed`; the open ref roles with `refRoleTable` (one line per role for the UI and the prompt); `linkRule`; the question shape with `needs_input`; the crew, tenants and people; formats. Writes go through `patch.schema.json`; who writes what is `collab.md`. The relay refuses any other `contractVersion` with "This build reads contract 3; reload the page.", answers jobs' questions at `POST /jobs/{jobId}/answer`, stores the library by shelf, and runs `director.v6`. A v2 `.clan` is refused, never read or overwritten. napkin-host's `/patch-data` gains optional `targets` and `cites`. The web app, clan-store and the relay change together and flip in one announced window.
16. **Prices from the catalogue (2026-10-13, feature runway-sheet-sync).** Breaking, folded into contract 3 because contract 3 has not been released and no deployed client reads the sheet (Shrey approved the design and its recommended contractVersion answer). `estimateUsd` goes from ops and alternates: there is one copy of each price. Each op and alternate gains `defaults` (the settings one job assumes), and the sheet gains `usdPerCredit`, `sources` and a `models` catalogue (endpoint, ratios with resolution tier, durations or input limits, promptMax in UTF-16 units, refs, mask polarity, preciseEdit, keyframes and range, targetAspectRatios, firstLastFrame, audioDefault, scaleFactors, and a structured `pricing` with the verbatim published rows it came from). Every price is computed by `pricing.py` (standard library only) and held to `examples/pricing-cases.json`; `relay/tests/test_runway_sheet.py` holds the catalogue to the committed snapshots of Runway's openapi.json and pricing.md, and a weekly workflow (`runway-sheet-sync.yml`) opens an issue when they move. The UI shows no price (Shrey, 2026-10-13): costs are recorded per job and shown only in History.
17. **Fix this moment (2026-10-14, feature clip-moment-edit).** Additive: `contractVersion` stays "3". The op `clip_patch` makes a note's window of a take again and splices it back; it answers 403 `flag_off` unless the optional `flags.clipPatch` is on, and the optional `clipPatch` block (model, send, contextS, crossfadeS, seamMin) tunes it. `JobInput` gains `window` (whole seconds of take time) and `still`; `atS` is the note's moment in take time. `Job` gains `patch` {send, window, cut, range, keyframe, model, exact, seams, rawOutput} and `handoff` {op: "clip"} (the person chose "Remake the whole clip": the job is cancelled free and the client makes a clip). The sheet's `ops.clip_patch` names its model and `minS`; the relay prices max(minS, ceil(seconds)) of it through `pricing.py` from the models catalogue (item 16), and an alternate may say `mode: "first_last"`. **The range send is the default (owner, 2026-10-14):** the whole take goes to Aleph 2 with the window as the keyframe's range, and Aleph edits and bills only the range, keeps the take's sound, and returns to the original frames at the range's end (pathway tests 2026-10-13/14); a take over 30 s is cut instead (`send: "cut"`). The relay runs the job in three stages, each with its own clock: stitch reads the take (and cuts on a cut send), the model makes the window, stitch splices the window back (every parent GOP away from it copied untouched). One patch runs per take at a time (409 `conflict` naming the running window). The landed take always keeps the take's own sound. The relay builds the provider job's keyframe itself; Dex writes only the prompt (`director.v7`, section clip_patch) and refuses to write a keyframe.
18. **The own canvas engine flag (2026-10-14, feature engine-adapter under canvas-engine).** Additive: `contractVersion` stays "3". `config.flags.ownCanvas` (optional, absent = off) puts new projects on our own canvas engine instead of Excalidraw; a person can ask for it with `?engine=own`. A saved scene always opens in the engine that made it. No relay change: the relay only serves the file.
19. **A link to a whole key (2026-10-15, owner; features/canvas-nodes.clan).** Additive: `contractVersion` stays "3". `linkEndpointKind` gains `key`: a link from `keys[id]` stands for the whole character or thing, so every named ref with that key, each of its views, is in the target's scope through the one link, including views named later. `linkRule` gains its row: a key feeds any generating node or a shot in its ref role, many per target, one per key and target. clan-store's integrity check finds the key in `keys`. The web app writes it (linking any view of a key that has two or more, or its group, links the key once); the relay never reads link endpoints.
20. **The references a shot sends (2026-10-15, owner; features/canvas-nodes.clan).** Additive: `contractVersion` stays "3". A frame or clip sends the references its shot's words mention (a bare `@samurai` is that key's views, the front first, at most 4) and those linked into the shot: these are required, and the director may neither leave one out nor swap it for another picture (another view of the same key included). A `JobInput.refs` item may carry `optional: true`: a reference in the node's scope that nothing asked for, which the director may send only when it gives a definite advantage, naming it in the director output's new `added` list (`{name, why}`). The relay refuses an answer that drops or swaps a required ref (the passthrough then makes the job as written), strips an optional ref sent without a reason, and cuts optional refs first when the sheet's `refs.maxCharacter` is short. `director.v8` writes this; v6, v6.1 and v7 stay bundled for a rollback. Skye's `write` context lists whole keys by their bare name, so `@samurai` in a person's line stays `@samurai` (`skye.v2`).
20. **Text on the canvas as a link end (2026-10-16, owner: "yes, text should link to nodes too"; features/canvas-text.clan).** Additive: `contractVersion` stays "3". The document gains the optional map `texts` (`text_` + ULID → {id, v, field_v, node, words}): one entry per text written on the canvas, `node` its canvas element (a sceneId), `words` what it says, kept in step with the canvas (an edit rewrites them, a delete takes the entry out with its links, the canvas's undo puts both back). Optional so a document made before it opens and moves to this schema unchanged (the store's schema move only loosens). `linkEndpointKind` gains `text`, and the note row of `linkRule` gains it as a source: a text feeds any generating node as a `note`, many per target, one per text and target. Nothing feeds a text, and a text feeds no other text (no rule). The web app sends a linked text's words as the node's input words (`JobInput.text`, after the person's own, as the words in a sketch area are) and shows it as a "Text: <first words>" input chip. clan-store's integrity check finds it in `texts`; the relay never reads link endpoints.
21. **Clip quality: Draft, Standard and Final (2026-10-15, owner; features/clip-quality.clan).** Additive: `contractVersion` stays "3". `common.schema.json` gains `clipQuality` (draft, standard, final). `JobRequest` gains `quality` and `promoteFrom` (clip and clip_edit only; refused on any other op), and `Job` gains `quality` `{level, size}`: what ran. A request without `quality` runs Standard, today's size. `promoteFrom` (Remake as Final) names a finished job of the same project: the relay runs that job's own input on the model it ran on, reusing the director's request, and a Seedance 2.5 draft under 7 days old is made final by Runway (`draftTaskId`). The capability sheet's ops and alternates gain `quality` (the size each level makes: a ratio tier, Hailuo's `resolution`, Seedance's `draft`), `family`/`familyLabel` (Kling O3 and Kling 3.0 Standard and Pro: one menu entry, Quality picks the id) and `keepsSize` (an edit that keeps the clip's size); `models[m]` gains `draftPromote` and `v2v.ratio`. The document gains `videos[].quality` (the project's default for its clips) and `takes[].quality` and `size` ("Draft 360p"). The web app, clan-store's bundled schema and the relay change together.
