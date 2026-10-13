# Production Tool relay

Python 3.12 AWS Lambda behind a Function URL (CloudFront sends `/api/*` here).
Implements `production-tool/contracts/relay-api.schema.json` (v1, locked).

| File | What |
|---|---|
| `service.py` | Routes, job ledger, quotas, fair-share queue, spend stop, the Runway floor, output copy |
| `identity.py` | Who is asking: `who(headers) -> {"pid", "h", "t"}` or `None` (then 401) |
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

- Every request is the local person: `NAPKIN_LOCAL_USER="handle@agency"`, else
  `local@napkin`. There is no sign-in; the startup line says who it runs as.
  Each name is its own workspace: the same name on any browser finds its projects
  and library.
- `--port` and `--data <dir>` (default `.local-data/`) choose where it listens and keeps files.
- Routes answer both bare (`/jobs`) and under `/api` (`/api/jobs`). CORS is open.
- `GET /me` says who the relay takes the caller to be (`relay-api.schema.json#/$defs/Me`):
  participant id, handle, team, workspace, today's remaining quotas and saved projects.
- `POST /clan` takes the person's `.clan` bytes (`Content-Type: application/vnd.clan+zip`, `X-Clan-Reason: interval|accept|manual`, max 5 MiB). With `X-Project-Id: <project id>` it is a saved project (`projects.py`): kept under `clan/<participantId>/<projectId>/` (every save, plus `latest.clan`) and listed in `clan/<participantId>/projects.json`; it answers the save's ETag, and with `If-Match` a save someone else got in before is a 409. Without the header it keeps `clan/<participantId>/latest.clan` plus a timestamped copy and answers 204.
- `GET /projects` lists the caller's saved projects; `GET /clan/<projectId>` answers the newest `.clan` with its `ETag`; `PUT`/`GET /clan/<projectId>/canvas` keep the canvas that goes with it.
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
- Director: `director/claude.py` (`make()`) when it exists, otherwise the
  passthrough (the shot list is split evenly from the script).
- Stitch runs in-process when `ffmpeg` is on the PATH (the end card's pieces are PNGs in
  `production-tool/stitch/endcard/`, so no font is needed).
- Local mode accepts `http://localhost` asset URLs; AWS requires `https://`.

## Who is asking

Every route but `GET /health` and `GET /config` takes its person from `identity.who(headers)`
(features/drop-hackathon-extras.clan). It fails closed: with no identity source, every other
route answers 401 `unauthorised`. Today the only source is the local person (`local.py`); on
Lambda the relay refuses everyone until Napkin OS sign-in implements the seam. The person's
team and handle make their workspace (`participant_id`); a blocked name or team/name is refused
on every write ("This name has been blocked.").

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
