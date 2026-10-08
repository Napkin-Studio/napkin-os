# Production Tool relay

Python 3.12 AWS Lambda behind a Function URL (CloudFront sends `/api/*` here).
Implements `production-tool/contracts/relay-api.schema.json` (v1, locked).

| File | What |
|---|---|
| `service.py` | Routes, job ledger, quotas, fair-share queue, spend stop, output copy |
| `store.py` | `MemoryStore` (tests, local) and `DynamoStore` (Lambda) |
| `blobs.py` | `LocalBlobs` and `S3Blobs` (`in/`, `out/`, `ads/` keys) |
| `runtime.py` | `config.json` cache (30 s, keeps the last good one), secrets |
| `handler.py` | Lambda entry: HTTP and the one-minute EventBridge sweep |
| `local.py` | The dev server |
| `providers/base.py` | The adapter interface (harness lane writes `providers/<name>.py`) |
| `director/base.py` | The director hook, with a passthrough default |

## Run it locally (no AWS)

```bash
cd production-tool/relay
uv run python -m local            # http://localhost:8787
```

- Event codes: `LOCAL` (participant), `ORGLOCAL` (organiser).
- Routes answer both bare (`/jobs`) and under `/api` (`/api/jobs`). CORS is open.
- `POST /clan` takes the participant's `.clan` bytes (`Content-Type: application/vnd.clan+zip`, `X-Clan-Reason: interval|accept|manual`, max 5 MiB) and keeps `clan/<participantId>/latest.clan` plus a timestamped copy. It answers 204.
- Uploads: `putUrl` is `http://localhost:8787/_upload/in/sha256:…` (PUT the bytes).
  Files are served from `.local-data/` at `/in/`, `/out/` and `/ads/`.
- Config: `contracts/examples/config.testing.json` with every step routed to
  `mock` and own keys on, or `LOCAL_CONFIG=path/to/config.json` (re-read every 30 s).
- Your own keys: run the web app against this relay (`npm run dev:relay` in
  `production-tool/web`), sign in with `LOCAL`, and type a fal or HeyGen key
  into **Your keys**. Those steps then run on that account; with no key they run on
  mock. Inputs reach providers inline (data URIs), since they cannot fetch
  `http://localhost`.
- Providers: whatever `providers/<name>.py` adapters exist. Without
  `providers/mock.py`, a stub stands in for mock: after 2 s it returns the
  job's first input asset as the output, labelled `kind: "mock"`.
- Director: `director/claude.py` (`make()`) when it exists, otherwise the
  passthrough (the shot list is split evenly from the script).
- Stitch runs in-process when `ffmpeg` is on the PATH (the end card's pieces are PNGs in
  `production-tool/stitch/endcard/`, so no font is needed).
- Local mode accepts `http://localhost` asset URLs; AWS requires `https://`.

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

Polls call `status` no faster than the sheet's `minPollS`. On success the
outputs are downloaded, hashed and written to `out/sha256:<hex>` before the job
is `completed`. Failed and uncertain jobs carry `error` inside the `Job` body
(the Job schema allows it); route errors are non-2xx `ErrorResponse`s.

Spend: the higher price among the routed providers is reserved at admission and
re-reserved at the chosen provider's price; the confirmed cost replaces it when
the provider reports one. A sheet with no price (HeyGen) reserves $1.
Organisers get 10× the quotas.

## Logs

One JSON line per request: `method route participant jobId op provider model
status latencyMs state error costUsd`. The saved Logs Insights queries are in
`infra/envs/hackathon/observability.tf`.
