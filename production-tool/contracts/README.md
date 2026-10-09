# Production Tool contracts (v1, locked 2026-10-06)

These files are the contract between the three lanes:
- `production-tool-ui`: Shrey designs it, then Sai wires it
- `production-tool-harness`: Sai
- `production-tool-infra`: Shrey

**Locked (D1) by Shreyansh Soni on 2026-10-06.** From now on a contract changes only by: (1) asking Shrey, (2) a decision recorded in `features/production-tool.clan` (`clan patch-decision`), (3) a bump of `contractVersion` when the change breaks an existing payload, (4) `check.py` passing. Adding an optional field is not breaking; renaming, removing, tightening or changing a meaning is.

Check after any change:

```bash
uv run --no-project --with jsonschema --with rfc3339-validator python production-tool/contracts/check.py
```

| File | What it fixes | Who writes / who reads |
|---|---|---|
| `common.schema.json` | ids (prefixed ULIDs), `sha256:` hashes, keys, variants, ref names, wire tags, roles, views, the 0-1 region, ops, quota classes, job states, cost, asset refs, outputs, error codes | everyone |
| `relay-api.schema.json` | request and response bodies of every relay route, and the job ledger item | infra writes the relay; ui calls it; harness plugs in behind it |
| `capabilities.schema.json` + `capabilities/*.json` | what each provider can do, with which model, at what price | harness writes; the director, relay and UI read |
| `director.schema.json` | the director's strict JSON output and the logged agent block | harness |
| `document.schema.json` | the CLAN document (shared/data.yaml): keys, refs, script, shots, frames, takes, jobs, reviews | ui writes; export and the Viewer read |
| `customdata.schema.json` | Excalidraw `customData` on the canvas (pic, drawn, note, gen, pin, provenance) | ui |
| `config.schema.json` + `examples/config.*.json` | remote `config.json`: routing per op, director models, quotas, timeouts, spend stop, flags, banner | Shrey edits during the event; web and relay read |

## Relay routes

| Route | Body → response | Notes |
|---|---|---|
| `POST /session` | `SessionRequest` → `SessionResponse` | Event code and handle. The token lasts 24 h. Organiser codes give the `organiser` role. |
| `POST /uploads` | `UploadRequest` → `UploadResponse` | The browser hashes first; an artifact the relay already has needs no upload. `url` is the CloudFront path that providers read. |
| `POST /jobs` | `JobRequest` → `Job` | Idempotent on `jobId`: sending the same id again returns the same job and is never paid twice. Quotas are checked here, never on polls. |
| `GET /jobs/{jobId}` | → `Job` | Poll no faster than `nextPollS`. |
| `DELETE /jobs/{jobId}` | → `Job` (state `cancelled`) | Also cancels at the provider where it can. |
| `POST /log` | `LogEntry` → 204 | Client errors and the Report button. |
| `GET /library` | → `LibraryIndex` | The workspace's keys, latest version each. Added 2026-10-07 (v2). |
| `GET /library/{key}[/{ver}]` | → `LibraryEntry` | One version; the latest without `{ver}`. |
| `POST /library/{key}` | `LibraryPublish` → `LibraryEntry` | Publishes the next version. 409 `conflict` when `baseVer` is not the latest. Assets must be uploaded first. |
| `POST /clan` | `.clan` bytes → `ClanSaved` (with `X-Project-Id`) or 204 | The person's project, saved on Save, on accept and every 5 minutes (`ClanMirror` lists the headers). Max 5 MiB. With `X-Project-Id` it is one of the person's saved projects: `If-Match` (its last ETag) makes a save that someone else got in before a 409 `conflict`, never an overwrite. Every save is kept with a timestamp. Added 2026-10-06; projects and ETags 2026-10-09. |
| `GET /projects` | → `ProjectList` | The caller's saved projects, from any browser, newest first. Added 2026-10-09 (features/personal-workspaces.clan). |
| `GET /clan/{projectId}` | → `.clan` bytes (`ProjectOpen` lists the headers) | The newest save, with its `ETag`. 404 when it is not the caller's; 413 above 4.3 MB. |
| `PUT /clan/{projectId}/canvas`, `GET /clan/{projectId}/canvas` | `ProjectCanvas` → 204, → `ProjectCanvas` | The canvas that goes with the saved project, so it opens elsewhere as it was. |
| `GET /config` | → `config.json` | Served by CloudFront; public. |

Errors are a non-2xx status with `ErrorResponse`. A 2xx body never carries an `error` key. A provider failure never becomes a success, and a mock output is always `kind: "mock"`.

## The adapter interface (harness)

Every provider implements this, in the relay's Python:

```python
class Provider(Protocol):
    name: str                                    # mock | runway | fal | heygen
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
- **Cancel:** where `results.cancel` is false (HeyGen), the UI hides Cancel; a cancelled job may still bill and its `cost.confirmed` says so.
- **Moderation:** never retry a moderated job (Runway `SAFETY.INPUT.*`, fal `content_policy_violation`). It becomes `moderated`, which can't be retried.
- **`config.json` is public.** Event codes, keys and the blocked list live in Secrets Manager and DynamoDB, not in it.

## Decided at D1

1. **Field names.** The document is snake_case, like all CLAN data here; the API is camelCase. `shot` is shared and keeps snake_case in both. The shape (separate lists joined by id) borrows from Advertising Studio, but this is its own app and does not promise compatibility with it (owner, 2026-10-06).
2. **Job states** are pipeline.yaml's nine, in the relay and the document alike.
3. **Views:** front, three_quarter, side, back, plus an optional side_2. Replaced in v2: views are variants of a key (`front`, `three-quarter`, `side`, `back`).
4. **`blocked` and per-handle overrides** moved out of `config.json`, because it is public.
5. **Director models:** Claude on Amazon Bedrock (eu-west-1, IAM, no API key): `eu.anthropic.claude-sonnet-5-5` per click and for the shot list (`config.director`), checked ACTIVE on 2026-10-06. Per-click direction runs `director.v5` (one section per op; the shot list keeps `director.v4`); it was Haiku 4.5 on v4 until 2026-10-09 (features/director-v5.clan). Locally, `NAPKIN_MODEL_API=claude-cli` runs the same models on the developer's Claude Code login.
6. **Spend caps:** $200 in `config.testing.json`, $1,300 in `config.event.json` (D2, 2026-10-06: Runway's org has 20 concurrent per model and about $3.2k of credits, so no tier purchase). This is the relay's own stop, not a limit at Runway.
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
12. **Personal workspaces (2026-10-09, feature personal-workspaces).** Each name is its own workspace: `SessionResponse.workspace` is the participantId (it was the team an event code belonged to, via the EVENT_CODES `workspaces` map, which is gone), so the library is the person's own. `SessionResponse` gains `projects` (how many projects the name has saved), and the relay adds `GET /projects`, `GET /clan/{projectId}`, the project canvas, and ETag-checked saves on `POST /clan` (If-Match, 409). Only the relay and the web app read these; both change together. `contractVersion` stays "2": no document or job payload changes.
11. **Character cards (2026-10-09, feature character-cards).** The agent block in `director.schema.json` gains an optional `cards` list: for each ref the director was told about, its wire `tag`, `sha256`, `kind` and `card` (2-4 lines one vision call wrote about the picture; relay/cards.py). Additive: `contractVersion` stays "2", and the director's output is unchanged. Since a .clan keeps the contract it was created with (item 9), the web app keeps `cards` out of the document's `jobs[].agent` and records them in the director's decision-chain entry instead, where the History panel reads them.
