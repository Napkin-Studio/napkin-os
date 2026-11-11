# ADR-004: the client wall

Status: written, **not signed**. Feature record: `features/client-wall.clan`.
Until it is signed, everything is built to the strictest reading below.

## The rule

1. Each agency has its own database and its own search store. Nothing is shared between agencies but a read-only house store.
2. Inside an agency, each client's brand is walled off by a rule the database enforces on every query.
3. Client text is processed in the EU only.
4. Only scores, with the client's content stripped out, may leave a client's vault to teach the system.
5. Judge and the Compliance night watch read client work, so they run inside that client's vault.

## Where it comes from

Lines 1 and 2 are already decided in `foundation-spec.clan`:

- **S3**: one database per agency, with row-level security forced on `org` and `brand` (`layers-service/migrations/0002_agency.sql`, lines 73 to 90). The real columns are `org` and `brand`, not `brand_id`.
- **S8**: one vector store per agency. "A deployment boundary, not a filter." The `tenant` field stays as a cross-check on the boundary and is not the boundary.

Lines 3, 4 and 5 are not in `foundation-spec.clan`. Line 3 comes from the build prompts and from the owner's reading of "in the EU". Lines 4 and 5 appear only in the build prompts. This ADR is the first place the repo states them. It adds nothing else to S3 and S8.

## What is built, and what is not

| Line | Built | Not built |
| --- | --- | --- |
| 1 | The database and store modules exist (`infra/modules/tenant-databases`, `infra/modules/rag-host`); the agencies map is empty by default. **The middleware takes its scope from the signed-in person's agency on every request**: napkin-web sends it in `x-napkin-agency`, the middleware refuses a request with none outside local development. A test runs two agencies in one run and neither reads the other's layer facts (`server/tests/test_client_wall.py`). `NAPKIN_DEV_ORG` is refused when `NAPKIN_ENV` is not `local`. | Per-agency Qdrant stores in staging (their own record). Moving documents from EFS to Aurora and S3 (S1). Staging still serves every request as its test tenant `org/sandbox`, by a recorded exception (`NAPKIN_DEV_ORG_EXCEPTION=1`), until the roster carries agencies that have a database of their own. A person then removes the variable. The `brand` in the scope is still the configured one, not one chosen per request. |
| 2 | Forced row-level security in Postgres (`0002_agency.sql`). | In the search store brands are split by a scope filter, not by a separate store. Whether client learnings need their own store inside an agency is an open question for Shrey. This record states it and leaves the default. |
| 3 | `NAPKIN_MODEL_PIN=eu`: aliases resolve to `eu.` profiles, a route that still resolves to a `global.` profile, or runs on a wire the pin cannot vouch for, stops startup and refuses a routes-file edit, unless it is listed with a reason in `server/napkin/model_route_exceptions.json` (none is listed). A test fails if a route used for client work resolves to a global profile. Nova web grounding (US regions only) is off under the pin. Every provider is listed in `0004-providers.md`. | The pin is off in code until the environment sets it, so a deploy alone changes nothing: staging sets it in `infra/envs/staging/main.tf` and it reaches AWS only by `terraform apply`, run by a person. The `eu.` profile ids for the 5.5 models are not verified against AWS (no call was made). Tavily, the model APIs the pin does not cover, and the NVIDIA hosted endpoints: where they process data is not recorded. No data processing agreement is recorded for any provider. `uat` and any environment that does not set `NAPKIN_ENV` still run as before. |
| 4 | Nothing. "Only scored telemetry leaves a vault" is written nowhere else in the repo and no code enforces it. | The whole line. It needs its own record: what a score is, what is stripped, and where it goes. |
| 5 | Nothing. | The whole line, with line 4. |

Also built here, because the wall is no use if a change can arrive with no author: **the host refuses a write with no agent or no action** (`POST /patch-data` returns 400). The rationale stays optional, so a look edit (theme, palette) still goes through. Staging logs what it would refuse for one week first (`NAPKIN_UNATTRIBUTED_WRITES=dry-run`), then a person removes that line. The CLI already refused; its `--no-decision` flag stays for local tooling.

A fake canary key set on the server is in no response the browser gets and not in the shell's bundle (`crates/napkin-web/tests/canary.rs`, `app/tests/canary.test.ts`, `server/tests/test_client_wall.py`).

## What this changes, and what it reopens

- **The 30 Sep 2026 decision to accept global Bedrock profiles** (`docs/contracts/peripherals.md` section 1.9; `server/napkin/model_routes.py`) conflicts with line 3. This ADR takes the strictest reading: EU-pinned for client work. EU profiles cost about 10% more. **Open for Shrey**: confirm the pin, or record an exception per route in `model_route_exceptions.json`, with who decided and when. A regression is then a decision, not an outage.
- **Web search** falls back to Nova grounding in `us-east-1`. Under the pin the fallback is off.
- **Where the DPAs are held, and who holds them**, is open. `0004-providers.md` writes "not recorded" wherever the repo does not say.
- **Ordering**: sign first, then the client confirms the brief (default taken for question 2 of `docs/discovery/open-questions.md`). Not part of this ADR's code.

## Signature

Only Laurence signs this record.

Signed: ______________________  Laurence    Date: ______________
