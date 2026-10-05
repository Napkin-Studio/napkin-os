# Napkin Studio OS: working here

Repo: **Napkin-Studio/napkin-os** (private, organisation-owned; `origin`).
Default branch `main`. **Changes reach `main` only through squash-merged PRs**, and
each merge builds the images and deploys staging (`.github/workflows/deploy.yml`).
Production deploys only by hand, through Actions → Deploy → production. Never
trigger that yourself.

**Before any task, read `napkin-studio.clan`** (`clan read agent napkin-studio.clan`).
It holds the project's standards, testing policy, git workflow, plan, components
and handoffs. The `clan-steward` skill (`.claude/skills/clan-steward/`) keeps it
current: at the start of a session, give its status check, and at the end of
a task, propose its update.

## The workflow for every feature

Agents write most of the code here, so design comes before code. Each piece
goes in on purpose, the existing checks keep the old pieces working, and
nobody finds out a week in that a better design was there from the start.

1. **Find or open the feature record.** Run `scripts/feature list`. If the work
   belongs to an existing feature, read it first with `scripts/feature show <slug>`.
   Otherwise open one with `scripts/feature new <slug> "<title>"` and work on
   the branch `feat/<slug>`. Write with `FEATURE_AGENT=claude`.
2. **Design before code (`status: exploring`).** Read the code, then answer every
   question in the record's context: problem and `done_when`, prior art,
   two or more approaches with build and run costs, **rework risks** (what
   would make us redo this or slow the process later), reach and contracts,
   breakage and its guards, test plan, rollout. Write the answers with
   `clan patch-data features/<slug>.clan '<json>' --agent claude --action "design: …"`.
   Use paths and names, not impressions.
3. **Stop and show the owner the design.** Don't write feature code until
   they approve it. Then set `design.approved_by` to their name and run
   `scripts/feature status <slug> designed`. That command refuses an
   incomplete design.
4. **Build to the design.** Run `scripts/feature status <slug> building`. If
   the design proves wrong, record a decision with `clan patch-decision`, update
   `design`, and tell the owner before changing course. Don't drift silently.
5. **Log as you go.** After each meaningful commit, run
   `scripts/feature log <slug> "<what changed>"`. Keep `open_questions` and
   `next_step` current, so anyone can pick the feature up cold.
6. **Check, push the branch, open a PR.** Run `scripts/check.sh` (the CI
   suites the change reaches). Record the result with
   `scripts/feature checked <slug> pass "<suites>"`. Commit the record with the
   code, push `feat/<slug>`, and open a PR using `.github/PULL_REQUEST_TEMPLATE.md`.
   The hooks enforce this. Never push to `main`.

Typo-sized fixes don't need a record. Add the trailer `Feature: none` to the
commit message instead, as the last line of the message, or git won't read it as
a trailer.

Details: `features/README.md`. Schema: `features/feature.schema.json`.

## Checks

`scripts/check.sh` maps changed paths to the CI jobs in `.github/workflows/ci.yml`
and runs only those. Use `--all` for everything, `--only rust,wasm` to pick
suites, and `--list` to see what would run.

| Suite | Runs | Triggered by |
|---|---|---|
| rust | fmt, clippy, test on clan-sdk, clan-cli, napkin-host, napkin-web | `crates/`, `Cargo.*`, `spec/` |
| wasm | wasm32 builds of clan-sdk, napkin-host (no `native`), napkin-wasm | sdk, host, wasm, `spec/` |
| conformance | `test-sandbox/pipeline/conformance.mjs` against the release CLI | sdk, cli, `test-sandbox/` |
| frontend | `npm run lint`, `npm test`, `npm run build` in `app/` | `app/` (not src-tauri), sdk |
| desktop | `cargo check -p clan-app` (CI also bundles a .deb) | `app/src-tauri/` |
| engine | offline pytest: engine/rag, engine/agent-server, mock-agent | `engine/`, `mock-agent/` |
| middleware | `uv run pytest` in `server/` | `server/` |
| mock-backend | unittest in `mock-backend/` | `mock-backend/`, `mock-middleware/` |
| terraform | fmt, validate, mocked-provider test on staging | `infra/` |

The hooks are `.githooks/pre-push` and `.githooks/commit-msg`. Turn them on
once per clone with `git config core.hooksPath .githooks`. The pre-push hook
refuses pushes to `main`, failing checks, code without a feature record, and
records without an approved design. Never use `--no-verify`. The bypass
variables `NAPKIN_ALLOW_MAIN`, `NAPKIN_SKIP_CHECKS` and `NAPKIN_NO_FEATURE`
are only for a person to set.

## Map

- `crates/clan-sdk`, `crates/clan-cli`: the CLAN format and the `clan` CLI.
  `spec/` is built into the SDK.
- `crates/napkin-host`: the OS layer (see `docs/contracts/os-layer.md`).
  It must stay wasm32-clean, with no `std::fs`, subprocess or HTTP outside the
  `native` feature. `crates/napkin-web` is the HTTP shell, and
  `crates/napkin-wasm` is the browser host.
- `app/`: the shell (React + Vite), `app/src-tauri` the desktop app (`clan-app`),
  and `app/templates/` the apps (Brief Maker, Research Tool, …).
- `engine/`: the briefing engine (Python). `server/` is the middleware (FastAPI, uv).
- `mock-backend/`, `mock-middleware/`, `mock-agent/`: local stand-ins.
  `layers-service/` holds the knowledge layers.
- `infra/`: Terraform for AWS (staging and production). `docs/contracts/` holds
  the contracts every track reads.
- `foundation-spec.clan`, `judgement-architecture.clan`, `napkin-studio-os.clan`:
  the architecture documents. Read them with `clan read agent <file>`.

## Git workflow (locked 2026-10-05)

- **Branches:** `<type>/<short-kebab>`, where type is one of feat, fix, docs,
  chore, eval, refactor, spike. Use lowercase and keep it to 40 characters or
  fewer. A feature's branch is `feat/<slug>`. Delete branches after they merge.
- **Commit subject:** `<area>: <imperative summary>`, 72 characters or fewer,
  for example `shell: name the tool in the OS bar`. The area is a component:
  shell, host, sdk, cli, web, wasm, desktop, apps, engine, rag, eval, server,
  mock, layers, infra, ci, docs, features or spec. Add `!` after the area for
  a breaking change. Put the detail in the body. Use the trailer
  `Feature: none` only for typo-sized fixes. Older commits use long sentences;
  leave them as they are.
- **Authorship:** a commit belongs to its author, the feature's owner, alone.
  No `Co-Authored-By` trailers and no "Generated with" lines, from agents or
  anyone else. An agent commits as the owner's git identity.
  `.claude/settings.json` turns off Claude Code's attribution, and
  `.githooks/commit-msg` rejects the trailer.
- **Merging:** open a PR from the branch and squash-merge it. The PR title is
  the commit subject. Never force-push a shared branch.

## Infrastructure changes reach AWS only by `terraform apply`

The Deploy workflow (`.github/workflows/deploy.yml`) **only swaps images**. It
takes the newest task definition already in AWS, puts the new image into it,
and rolls that out. Anything else under `infra/` reaches AWS only when a person
applies Terraform: a task's environment variables (`NAPKIN_AUTH`,
`NAPKIN_DOGFOOD`, …), secrets, ports, sizes, and every other resource.
Merging such a change and seeing "Deploy: success" does not mean it is live.

The order, every time a change touches `infra/`:

1. **Plan, read, apply, before the deploy.** In `infra/envs/staging`, run
   `AWS_PROFILE=napkin terraform plan -out=<f>.tfplan` (log in first with
   `aws sso login --profile napkin`). Read the plan and check that it changes
   only what the feature's `design.rollout` says it will. A person runs
   `terraform apply <f>.tfplan`; an agent may plan and read, never apply.
2. **Then deploy.** Merge the PR, or run
   `gh workflow run deploy.yml -f environment=staging`. The deploy reads the
   task definition at its rollout step, so if the merge's deploy got there
   before the apply, deploy again.
3. **Verify in AWS, not in the workflow.** Check that the running service's
   revision carries the new values:
   `aws ecs describe-services --cluster napkin-staging --services web`, then
   `describe-task-definition` on its `taskDefinition`. Then check the
   behaviour itself (e.g. `/api/session` on staging).

Until all three are done, say "deployed, not yet live", not "live".
(2026-10-05: roster sign-in and dogfood were merged, deployed "successfully",
and still not live. Their settings were applied after the deploy had read the
old task definition.)

## Never commit

`.env` and `*.env`, `.napkin-dev-signing-key`, `client_briefs/`,
`engine/rag/golden/labels/client/`. Client material is confidential.
