# Audit: the platform

Area: `crates/napkin-host`, `crates/napkin-web`, `server/`, `layers-service/`, `infra/`,
`docs/contracts/`, and the three architecture documents. Read at d64e0899 by a read-only
subagent. Nothing was run; each line is from reading code and documents.

## Five findings that change the plan

1. **ADR-004 does not exist as a record.** The name appears only in the build prompts. No contract, .clan file, code or infra file carries it. The wall it describes is real and is recorded as foundation-spec decisions S3 and S8. "Only scored telemetry leaves a vault" is written nowhere but the prompts.
2. **Client text can leave the EU today.** The default model route (Sonnet 5.5) uses a Bedrock `global.` profile, which can run in any region. The owner accepted that on 30 Sep 2026 (peripherals.md:234). Web grounding falls back to Amazon Nova in us-east-1. Tavily, jev and NVIDIA's hosted API state no region.
3. **The middleware runs as one fixed tenant.** It takes its scope from `NAPKIN_DEV_ORG`, not from the signed-in person (`server/napkin/config.py:121`; staging sets `org/sandbox`). Per-agency databases and stores exist as Terraform modules, but the `agencies` map is empty by default.
4. **There are no roles.** An account is username, agency and name. Every person in an agency sees every client and document in it (os-layer.md:1770).
5. **The meter counts calls, not money.** One cap per tenant per server start (400 on staging), in memory, in napkin-web only. The middleware's model calls are not counted at all. Nothing can pause paid calls.

## ADR-004: what the records actually say

| Rule | Where it is written | Status |
| --- | --- | --- |
| One database per agency, row-level security inside it | foundation-spec.clan, decision S3 | Decided. Modules exist: `infra/modules/tenant-databases/main.tf` |
| Row-level security is forced; the app role owns no tables; the tenant is set per transaction | foundation-spec.clan; `layers-service/migrations/0002_agency.sql:73-90` | Built for facts, evidence and decisions. The policy columns are `org` and `brand`, not `brand_id` |
| One vector store per agency. "Isolation between agencies is a deployment boundary, not a filter" | foundation-spec.clan, decision S8 (replaces S6) | Decided. Not deployed: no agency store exists by default |
| A caller cannot widen its own scope | `docs/contracts/peripherals.md:638-650` | Contract |
| EU hosting, single-tenant deployment stays a config change | foundation-spec.clan, requirement | Decided |
| Only scored telemetry leaves a vault | Build prompts only (v2 lines 569, 583) | **Not recorded anywhere in the repo** |
| Judge and the night watch run inside the client's vault | Build prompt v3.1 only | **Not recorded. No night watch code exists** |

**Still open in the records.** Whether anything leaves eu-west-1 (backups, logs, telemetry,
support access) and whether hosted inference has an EU region: both are unanswered vendor
questions in judgement-architecture.clan. foundation-spec marks the scope filter as "found
missing" in brief loops 3 to 7. Brands inside one agency are split by forced row-level
security in Postgres, but only by a scope filter in the RAG store.

## The rest

| Line | What exists | Missing |
| --- | --- | --- |
| Where work is stored | .clan files on EFS: `<root>/<tenant>/documents/<slug>.clan` (`crates/napkin-web/src/store.rs`). Not Aurora, not S3 | S3 buckets exist but nothing writes blobs to them |
| Tenant | A UUID made from the agency name (`tenant.rs:31`). The agency is the tenant | |
| Clients | One registry document per tenant (`crates/napkin-host/src/clients.rs`). A client record has name, initials, material, owner, dates | Vault, client brain |
| Knowledge layers | Postgres migrations 0001 to 0009 with forced row-level security. Staging connects to them | The prompt says this is not ported. It is |
| Runs | Middleware jobs: queued, running, needs_input, done, failed, and cancelled (`server/napkin/jobs.py:114`). Held in memory, 500 at most, lost on restart | The prompt says cancelled needs a contract change. The code has it; one sentence in middleware-api.md is stale |
| Run log | One JSONL file per job (`server/napkin/runlog.py`): stages, model calls with tokens and a cost estimate, decisions. Bodies off unless switched on; staging switches them on | No trace id. The log is keyed by job id |
| Retries | One retry on model calls (`model.py:205`). No provider idempotency key | The prompt asks for two retries and an idempotency key |
| Decisions | Thirteen kinds, including approve, client_review, verdict and unlock (os-layer.md:133). The newest approve on a document locks it. A locked write returns 409 | Lease (one editor at a time) is specified but not enforced in code |
| Live updates | One server-sent event stream per tenant (`crates/napkin-web/src/events.rs`) | An index built from the chains. None exists |
| Sign-in | None, local, Cognito or roster. Staging and UAT use roster. No production environment exists in `infra/envs` | Roles, permissions, memberships |
| Agency record | None. No name, logo, accent or credit cap anywhere | All of it |
| Rate card, job, timesheet, alert | None, in any migration, crate or module | All of it |
| Backups | Aurora 7 days. RAG disk snapshots 14 days, daily at 03:00 | The prompt asks for 30. A person applies that |
| Budgets | Two account-wide AWS budgets that send email at 80% and 100%. They stop nothing | A cap that refuses a run |
| Judgement | Two ports (judgement, generation), four backends, ten gates. Rules: a score and a reason never come from the same backend; thresholds only against a calibrated score; only the attribution gate fails closed | The score out of 30 is a new gate |
| Export | `clan_sdk::export_html` (`crates/clan-sdk/src/export.rs:58`). A provenance appendix exists, off by default: agent, action, rationale, date, 50 entries at most | No AI-generated label. No model, seed or prompt in the appendix. No stripped client export |

## Providers that can receive client text

| Provider | Used for | Where it runs, per config |
| --- | --- | --- |
| Claude on Bedrock, `global.` profiles (Sonnet 5.5, Opus 5.x, Haiku 4.5) | The default route | Called from eu-west-1. Can run in any region |
| Claude on Bedrock, `eu.` profile (Opus 4.6) | Fact extraction | EU |
| Anthropic API direct | The default when `NAPKIN_MODEL_API` is unset | No region set |
| Amazon Nova 2 Lite | Web grounding fallback | us-east-1 (`websearch.py:53`) |
| Tavily | Web search | Not stated |
| jev (TypeSafe) | The brief judge on staging | Not stated |
| NVIDIA hosted API | Embeddings, rerank, vision, backstop generation, in `engine/` | Not stated. On a prototyping key (open question N1) |

No data processing agreement is recorded in the repo for any of them.

## Where the prompt is wrong about the code

- "clan-sdk bound in through PyO3": there is no PyO3 in the repo.
- "Claude on Amazon Bedrock in the EU": true only for Opus 4.6.
- "Production signs in through Cognito": there is no production environment in `infra/envs`.
- "An index the server builds from the chains": no such index exists.
- "Every run writes a trace id": it writes a job id.
- "Extend the per-tenant meter to a daily cap per environment and a cap per run": the meter has no notion of money, environment or run. This is a new component, not an extension.
- "The layers schema is not yet ported to Aurora": it is.
- "Row-level security on brand_id": the columns are `org` and `brand`.
