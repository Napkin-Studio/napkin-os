# Production Tool relay

Python 3.12 AWS Lambda behind a Function URL (CloudFront sends `/api/*` here).
Implements `production-tool/contracts/relay-api.schema.json`, contract 3
(features/contract-v3.clan).

## Contract 3

- A `JobRequest` or `JobAnswer` whose `contractVersion` is not "3" gets 400 `invalid_input`
  "This build reads contract 3; reload the page." before anything else is read; nothing is written.
- A job carries `tenantId`, `projectId`, `startedBy` (`human:<participantId>`), `crew` (dex plans,
  wren (Fin) films, edie stitches, …), `node`, `nonce` and `purpose`. Any member of its agency may read
  it, stop it and answer its question; its cost stays on its starter's budget.
- Ops contract 3 names but the relay does not build yet (frame_edit, clip_patch, bridge, cutout,
  transcribe, write, read, check, resize, cutdown, upscale) answer 422 `capability_missing`.
- When the director asks (`question`), the job waits in `needs_input`: uncharged, holding no
  in-flight place or provider slot, never timing out. `POST /jobs/{jobId}/answer` (`JobAnswer`)
  records the first answer (`answeredBy`, `answer`) with the ledger's conditional write and re-runs
  the director on the same job; a second answer is 409 `AnswerConflict` with the winner. Change is
  a new job with `input.answer` and `parentIds: [jobId]`. Locally, words with `[ask]` make the
  passthrough director ask (a Mock run of the whole flow). Skye (`write`, writer.py) never makes a
  person answer a question that offers no choice: a nudge with one option ("Draft it") is answered
  for them and she drafts (skye.v3); a real choice or a missing fact still waits in `needs_input`.
- Stitch: a clip with `endCard` is left out of the stitch payload (stitch draws its own card).
- The library is shelved: `GET /library/{shelf}`, `GET|POST /library/{shelf}/{key}[/{ver}]`, at
  `tenants/<tenantId>/library/<shelf>/…`; kinds key, brand_kit and format_pack.
- The director runs `prompts/director.v6.md`; its role lines are written from common.schema.json's
  `refRoleTable` at load. An older prompt version in config.json fails the job loudly.

| File | What |
|---|---|
| `service.py` | Routes, job ledger, quotas, fair-share queue, spend stop, the Runway floor, output copy |
| `identity.py` | Who is asking: `who(method, path_and_query, headers, body) -> {"pid", "h", "t", "name"?, "tenant"}` or `None` (then 401) |
| `rank.py`, `time_rules.py` | Order keys and the note window, the twins of clan-store's (contracts/examples/ranks.json, windows.json) |
| `store.py` | `MemoryStore` (tests, local) and `DynamoStore` (Lambda) |
| `blobs.py` | `LocalBlobs` and `S3Blobs` (`in/`, `out/`, `ads/` keys) |
| `runtime.py` | `config.json` cache (30 s, keeps the last good one), provider keys from Secrets Manager |
| `handler.py` | Lambda entry: HTTP and the one-minute EventBridge sweep |
| `local.py` | The dev server |
| `providers/base.py` | The adapter interface (harness lane writes `providers/<name>.py`) |
| `director/base.py` | The director hook, with a passthrough default |

## Run it locally (no AWS)

```bash
cd production-tool/relay
uv run python -m local            # http://localhost:8787
```

- Standalone (no `TOKEN_SECRET`), every request is the local person:
  `NAPKIN_LOCAL_USER="handle@agency"`, else `local@napkin`. The startup line says who it runs as.
- Behind napkin-web (the full stack), set `TOKEN_SECRET` to the same dev value (32 bytes or more)
  as napkin-web's `NAPKIN_PRODUCTION_RELAY_SECRET`: every request must then carry napkin-web's
  signed `X-Napkin-Identity`, as on AWS.
- Tenants on: `NAPKIN_LOCAL_TENANTS="napkin,acme"`, else `napkin` and the local person's agency.
  Everyone in an agency shares its projects and library; other agencies get "not on for your agency".
- `--port` and `--data <dir>` (default `.local-data/`) choose where it listens and keeps files.
- Routes answer both bare (`/jobs`) and under `/api` (`/api/jobs`). CORS is open.
- `GET /me` says who the relay takes the caller to be (`relay-api.schema.json#/$defs/Me`):
  participant id, handle, team, workspace, today's remaining quotas and saved projects.
- `POST /clan` takes the person's `.clan` bytes (`Content-Type: application/vnd.clan+zip`, `X-Clan-Reason: interval|accept|manual`, at most 4.5 MB). With `X-Project-Id: <project id>` it is a saved project of the agency (`projects.py`): kept under `tenants/<tenantId>/projects/<projectId>/` (every save, plus `latest.clan`) and listed in `tenants/<tenantId>/projects/index.json`; it answers the save's ETag, and with `If-Match` a save someone else got in before is a 409. Without the header it keeps `clan/<participantId>/latest.clan` plus a timestamped copy and answers 204.
- `GET /projects` lists the agency's saved projects; `GET /clan/<projectId>` answers the newest `.clan` with its `ETag`; `PUT`/`GET /clan/<projectId>/canvas` keep the canvas that goes with it.
- Pruning, once the data has been studied: `scripts/prune_workspaces.py` (dry run unless `--yes`; see its docstring).
- Uploads: `putUrl` is `http://localhost:8787/_upload/in/sha256:…` (PUT the bytes).
  Files are served from `.local-data/` at `/in/`, `/out/` and `/ads/`.
- Config: `contracts/examples/config.testing.json` with every step routed to
  `mock`, or `LOCAL_CONFIG=path/to/config.json` (re-read every 30 s). With a config
  that routes to Runway and `RUNWAY_API_KEY` set, inputs reach Runway inline (data
  URIs), since it cannot fetch `http://localhost`.
- Providers: whatever `providers/<name>.py` adapters exist. Without
  `providers/mock.py`, a stub stands in for mock: after 2 s it returns the
  job's first input asset as the output, labelled `kind: "mock"`.
- Director: `director/claude.py` (`make()`) when a model is configured, otherwise the
  passthrough (the shot list is split evenly from the script). To run the real director, the
  character cards and Skye on your own Claude Code login, start the relay under the one local
  model backend: `../../scripts/model-local run uv run python -m local` (the anthropic wire with
  `NAPKIN_MODEL_BASE_URL` on 127.0.0.1:8797, answered by `claude -p`; model.py refuses that URL
  on Lambda). The config's Bedrock ids (`eu.anthropic.…`) are accepted there as they are.
- Stitch runs in-process when `ffmpeg` is on the PATH (the end card's pieces are PNGs in
  `production-tool/stitch/endcard/`, so no font is needed).
- Local mode accepts `http://localhost` asset URLs; AWS requires `https://`.

## Who is asking

Every route but `GET /health` and `GET /config` takes its person from `identity.who(...)`
(features/drop-hackathon-extras.clan, features/os-sign-in.clan). It fails closed: with no identity,
every other route answers 401 `unauthorised`.

- On Lambda the source is napkin-web's `X-Napkin-Identity` v1 assertion
  (`docs/contracts/production-tool-identity.md`), signed with `TOKEN_SECRET` (Secrets Manager,
  re-read at most every 5 minutes; `new,old` during a rotation) and bound to the method, path,
  query and body. Browsers reach the relay only through napkin-web's `/production/api`.
- The person's agency is their tenant. Only agencies with `enabled: true` in the tenants table
  (`TENANTS_TABLE`) may use the tool; anyone else gets 403 `flag_off`. Turn one on or off with
  `scripts/tenants.py` (a person's credentials). Every job carries the internal `_tenant`, and
  request logs carry `tenant`.
- Projects and the library are the agency's (`tenants/<tenantId>/…`). Quotas and in-flight
  limits stay per person (`participant_id` of agency and handle). A blocked name or team/name is
  refused on every write ("This name has been blocked.").

## Tests

```bash
uv run pytest        # offline: hand fakes and moto
```

## How a job moves

`POST /jobs` checks, in order: the ledger (same `jobId` → the same job, never a
second submit), flags and routing, the spend stop, the in-flight limit
(`queue_full`), the daily quota (`quota_exhausted`). Then the job is `queued`
and tries to take a slot at the first provider in `config.routing[op]` whose
sheet supports the op and whose concurrency (sheet `concurrency.image|video`)
has room. Jobs that find no slot wait in the fair-share queue: participants
with fewer jobs at a provider go first, then the oldest. Every poll of a
queued job retries for that job only; the minute sweep advances jobs nobody
polls, so closed tabs give their slots back.

Submit outcomes: an id → `submitted`; `Moderated` → `failed/moderated`, never
retried or rerouted; `CapabilityMissing` or `provider_unavailable`/`queue_full`
with `accepted=False` → the next provider; any other exception → `uncertain`
(the provider may have it; it is never sent again).

Runway is the floor (features/runway-fallback.clan): when `config.routing[op]`
names `runway`, a job's chain is its routing (or the picked provider) with Runway
last. A provider in front of Runway that fails for a provider or account reason,
before or after submit (uncertain and timeouts included), sends the job once to
Runway's default model for the op; `Job.fallbackFrom` and `fallbackReason` say so.
Moderation and invalid input never move, and Runway failing fails the job. A new
provider is an adapter (`providers/<name>.py`) plus its sheet; the chain needs
nothing else.

Polls call `status` no faster than the sheet's `minPollS`. On success the
outputs are downloaded, hashed and written to `out/sha256:<hex>` before the job
is `completed`. Failed and uncertain jobs carry `error` inside the `Job` body
(the Job schema allows it); route errors are non-2xx `ErrorResponse`s.

Spend: the higher price among the routed providers is reserved at admission and
re-reserved at the chosen provider's price; the confirmed cost replaces it when
the provider reports one. A sheet with no price reserves $1. A job that falls
back after its first provider may have charged keeps that reservation, and the
spend stop applies again to Runway's price.

## Logs

One JSON line per request: `method route participant jobId op provider model
status latencyMs state error costUsd`. The saved Logs Insights queries are in
`infra/envs/hackathon/observability.tf`.
