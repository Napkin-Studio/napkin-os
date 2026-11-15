# The platform rules on the Production line

Record: `features/production-platform-rules.clan` (Phase 3). What the relay (`production-tool/relay`) enforces
before anything leaves it, and what a person sets per environment. No figure here is a decision: the caps are a
person's, at Laurence's gate.

## The euro guard fails closed

`director/spend.py` (held in step with `server/napkin/spend.py`) is the only meter for model calls (director,
Skye, Dex's cutdown plan, cards) and stands beside the ledger in front of every Runway submit. Until this record
it decided "local, paid on, no cap" when nothing was set, and the hackathon relay Lambda sets nothing.

Now a paid call goes out only when **both** are set:

| Variable | Value | With it unset or unreadable |
| --- | --- | --- |
| `NAPKIN_PAID_CALLS` | `on` | off: every paid call is refused |
| `NAPKIN_SPEND_CAP_EUR` | the most the environment spends in a UTC day | 0: every paid call is refused, and paid calls stay off |
| `NAPKIN_SPEND_RUN_CAP_EUR` | the most one run (one job) spends | no run cap; the day cap still applies |
| `NAPKIN_ENV` | the environment's name | `local`. It names the totals only: it loosens nothing |

Modes, as the start-up line says them (`spend.describe()`, logged once by `handler.py` and `local.py`):

- `paid calls OFF (NAPKIN_PAID_CALLS is not on)`: nothing set, or the switch off.
- `paid calls OFF (NAPKIN_SPEND_CAP_EUR names no cap)`: the switch on with no cap.
- `paid calls ON, day cap N euro, run cap M`: both set.

A developer turns paid calls on by hand (`NAPKIN_PAID_CALLS=on NAPKIN_SPEND_CAP_EUR=5`). The mock provider and
the passthrough director never ask the guard, so the tests and the e2e stack run free with nothing set.

The guard's estimate is the sheet's price through `contracts/pricing.py`, the dearest case where the provider
job does not say (tier, plate size, input length), and never below the ledger's reservation for the job
(`priceUsd` on the provider job). `tests/test_guard_estimate.py` walks every op and model in
`capabilities/runway.json` and asserts guard >= sheet price. An edit (`clip_edit`) is priced by the stored
clip's real length, read from the relay's own copy (`cliplength.py`, the MP4's movie header), never by a length
the request declares; a clip whose length cannot be read is refused. A clip refused by Runway's text check after
it took the task is billed, and the plainer resend is billed too: the job settles at both.

`NAPKIN_PAID_CALLS` reads `on` only (`1`, `true`, `yes` do not turn paid calls on).

**Dollars count as euro.** Every price comes from the sheets in USD and no exchange rate exists in the relay, so
the guard counts a dollar as one euro against the euro caps. That errs high while a dollar is worth less than a
euro; the owner decides whether it is acceptable.

A refusal reads one plain line with no figure and no money word: "Paid runs are off here. Nothing was sent."
"Paid runs have reached today's limit here. Nothing was sent." "This run has reached its limit for paid calls.
Nothing was sent." The cap and the amount go to the log only.

**Totals are per process, in memory.** Each Lambda instance counts its own spend and starts at zero on every cold
start, so a day cap of N is N per instance per cold start, not N per day. Proposed, not built (it needs storage):
keep the guard's day total in the quotas table as the ledger does (`guard#<env>#<UTC day>`, one conditional ADD
under the cap, `ledger.py`'s pattern), so every instance shares one total. Owner: spend-guard-unified.

### What each relay needs (a person plans and applies the Terraform)

The relay Lambda is `infra/envs/hackathon/lambda.tf` (`aws_lambda_function.relay`); staging and production
napkin-web proxy to it (`production_relay_url`). Its `environment.variables` set none of the above today.

| Relay | `NAPKIN_ENV` | `NAPKIN_PAID_CALLS` | `NAPKIN_SPEND_CAP_EUR` | `NAPKIN_SPEND_RUN_CAP_EUR` | `NAPKIN_MODEL_PIN` |
| --- | --- | --- | --- | --- | --- |
| hackathon (the one deployed) | `napkin-hackathon` | `off` until the gate, then `on` | `0` until the gate, then the cap Laurence names | the per-run cap Laurence names, or leave unset | `eu` |
| staging (when a relay of its own exists) | `napkin-staging` | `off` | `0` | unset | `eu` |
| production (when a relay of its own exists) | `napkin-production` | `off` until Laurence switches paid calls on | the cap Laurence names | the run cap Laurence names | `eu` |

Until a person applies this: the relay deployed today runs the older code with no euro cap. Once this record's
code is deployed with nothing set, the relay refuses every paid call (fails closed), which is safe but stops
paid work until the variables are set.

## The EU pin

Every model call of the relay resolves through `director/model_routes.py` (`director/claude.py`
`pinned_routes`): the director, Skye (`writer.py`, now the alias `sonnet-5.5`), Dex's cutdown plan and cards share
one port and one set of routes. `NAPKIN_MODEL_PIN` unset (or `eu`, however written) is `eu`; any other value
stops start-up, so nothing unpins the relay. Start-up stops on a route or a model the relay names that the pin
cannot vouch for: an allow list, on Bedrock only an `eu.` inference profile (`global.`, `us.`, `apac.`, a bare id
and an ARN all stop it), and any other wire refused, and a config edit to `perClickModel` or
`shotListModel` that would leave the EU is refused and logged, keeping the model in force.

## Scope, the AI switch, hooks, fetches

- Scope: the tenant comes only from the X-Napkin-Identity claims (`identity.py`). `tests/test_platform_rules.py`
  sends agency A's identity with agency B's ids to every route in `relay-api.schema.json` (404) and tries a
  tenant in a query, a header and a body (ignored).
- The per-client AI switch: `relay/client_ai.py`, a copy of `server/napkin/client_ai.py` (always no until a
  record builds the switch). A job that would send client material out (a model, or a provider that is not the
  mock) is refused before any quota or spend with "AI is off for this client, so nothing was sent." (403
  `flag_off`). A crop, a layout, a stitch, and the mock with the passthrough still run.
- Hooks: `relay/hooks/NN_<record>.py`, `before_submit(job, ctx)` and `after_complete(job, result, ctx)`, in
  file-name order (`relay/hooks/__init__.py`). `before_submit` runs before every paid or model send: a provider
  submit, a shot list, Skye, Dex's cutdown plan and a plainer resend, each with the spend guard's run set to the
  job. A later record adds a file; `service.py` is not edited.
- Fetches: every URL a request names must be one of the relay's own, or the job is refused at the door (400)
  before anything reads, sends or reserves. `blobs.fetch_own` takes: `in/sha256:<hex>` and `out/sha256:<hex>`
  (content-addressed) and `ads/...` (stitched and cut films), which CloudFront serves publicly by design, so
  reading one tells the caller nothing the CDN would not; and the caller's own `tenants/<tenant>/...`, the
  tenant from the verified identity. Everything else is refused on the key alone: another agency's
  `tenants/<id>/` (saved projects, the library, canvases), `clan/`, `library/`, `dogfood/` (consent and events
  per person) and `cards/` (what the director was told a picture shows). A missing object answers as a refused
  one, so it is no existence oracle. The Runway adapter reads a job's own asset through the relay's reader
  (`providers.base.read_asset`), never with its own client. A provider's output goes through `blobs.http_fetch`: https only, every
  address the host resolves to must be public (no private, loopback, link-local or metadata address, and no IPv6
form that carries or translates to an IPv4 address: NAT64, IPv4-compatible, 6to4, Teredo, site-local), the
  connection pinned to the vetted address, and a redirect refused, never followed. `tests/test_fetch_sites.py`
  walks the source so a new fetch site, or a new HTTP client call (httpx, requests, aiohttp, urllib, http.client,
  a socket, boto3) outside the named sites, cannot skip either wall.
