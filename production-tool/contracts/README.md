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
| `common.schema.json` | ids (prefixed ULIDs), `sha256:` hashes, tags, roles, views, the 0-1 region, ops, quota classes, job states, cost, asset refs, outputs, error codes | everyone |
| `relay-api.schema.json` | request and response bodies of every relay route, and the job ledger item | infra writes the relay; ui calls it; harness plugs in behind it |
| `capabilities.schema.json` + `capabilities/*.json` | what each provider can do, with which model, at what price | harness writes; the director, relay and UI read |
| `director.schema.json` | the director's strict JSON output and the logged agent block | harness |
| `document.schema.json` | the CLAN document (shared/data.yaml): character, script, shots, frames, takes, jobs, reviews | ui writes; export and the Viewer read |
| `customdata.schema.json` | Excalidraw `customData` on the Character canvas | ui |
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
- each provider's prompt syntax and reference names (`tagSyntax`)
- refs and roles
- ratio strings

The adapter owns the exact request:
- field names
- mask polarity: ours is white = change, and the adapter converts it to the endpoint's convention
- setting audio explicitly
- the provider's error codes mapped onto ours

## Rules that hold everywhere

- **Hashes are the identity.** URLs are only hints. Every provider output is copied to our S3 and hashed before a job is `completed`.
- **One id everywhere.** A job's id is also its Excalidraw element id and its document entry id.
- **Tags** are stored once in the strictest form (`^[a-z][a-z0-9_]{2,15}$`). Canvas badges (A, B, C) are for display only.
- **Region:** 0-1 coordinates of the image it sits on, origin top-left.
- **Moderation:** never retry a moderated job (Runway `SAFETY.INPUT.*`, fal `content_policy_violation`). It becomes `moderated`, which can't be retried.
- **`config.json` is public.** Event codes, keys and the blocked list live in Secrets Manager and DynamoDB, not in it.

## Decided at D1

1. **Field names.** The document is snake_case, like all CLAN data here; the API is camelCase. `shot` is shared and keeps snake_case in both. The shape (separate lists joined by id) borrows from Advertising Studio, but this is its own app and does not promise compatibility with it (owner, 2026-10-06).
2. **Job states** are pipeline.yaml's nine, in the relay and the document alike.
3. **Views:** front, three_quarter, side, back, plus an optional side_2.
4. **`blocked` and per-handle overrides** moved out of `config.json`, because it is public.
5. **Director models:** `claude-haiku-4-5` per click, `claude-sonnet-5-5` for the shot list (`config.director`).
6. **Spend caps:** $200 in `config.testing.json`, $1,300 in `config.event.json`. Placeholders until D2.
7. **Example `routing` for the event:**
   - fal first for images, with Runway as fallback
   - clips: fal, then HeyGen, then Runway
   - clip_edit on Runway only (aleph2)
