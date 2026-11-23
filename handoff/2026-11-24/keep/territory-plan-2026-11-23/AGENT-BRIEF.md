# Brief for every Territories feature agent

You build ONE approved feature record (or the few named in your task) of the Territories tool, to its design.

## Setup
- Integration branch: `feat/territories` (worktree /home/batunii/Documents/Code/napkin-wt-territory-plan; DON'T work in it).
  It is develop + the 24 approved territories records + feat/deck-cloud (Bedrock path in engine/brief_llm.py, the deck
  engine sidecar pattern, Chromium PDF of HTML).
- Make your own worktree and branch from it:
  `cd /home/batunii/Documents/Code/napkin-wt-territory-plan && git worktree add /home/batunii/Documents/Code/napkin-wt-t-<short> -b feat/territories-<short> feat/territories`
  then `cd` there and `git config core.hooksPath .githooks`. Branch names ≤ 40 chars.
- Read CLAUDE.md, then `scripts/feature show <slug>` (the design is data.design; the owner approved it). Read the umbrella
  `scripts/feature show territories`: its pinned decision lists the owner defaults (demo pipeline, sketches not frames in v1,
  cap before paid calls and prices ONLY in Decisions/History, name Territories / ie.napkin.territories, fonts limited to
  Newsreader + Geist Extra Bold, Booth imported, landscape out, never merge feat/territory-slice).
- Product intent and look: the owner's demo on origin/claude/ad-campaign-territory-explorer-auewh5
  (design/territory-explorer/prototype.html, README.md, walkthrough/*.jpg stills, features/territory-explorer.clan).
  Read with `git show origin/claude/ad-campaign-territory-explorer-auewh5:<path>`. UI must match it (house style).
- Lessons to guard against: /home/batunii/Documents/napkin-local-keep/territory-plan-2026-11-23/LESSONS.md.
- Build plan and order: /home/batunii/Documents/napkin-local-keep/territory-plan-2026-11-23/BUILD-PLAN.md.

## Architecture (owner, 2026-11-23)
- Territories runs INSIDE the middleware like Brief and Research: middleware task handlers (server/napkin/handlers) call
  engine/territory in-process. NO separate engine HTTP server, NO sidecar container, NO new ECR repo or Terraform switch.
  Packages go in the middleware image (server/pyproject.toml, server/Dockerfile) and must stay light. See the pinned decision
  in features/territories.clan. Ignore any older text in a record that says otherwise and update that record's design.

## Build
- `FEATURE_AGENT=claude scripts/feature status <slug> building` at start.
- Follow the design. If it proves wrong: `clan patch-decision features/<slug>.clan ...`, then STOP and report (don't drift).
- Log each meaningful commit: `scripts/feature log <slug> "<what changed>"`. Keep open_questions / next_step current.
- Commit subject `<area>: <imperative>` ≤ 72 chars, area from CLAUDE.md. NO Co-Authored-By / Generated-with lines.
  Don't use the `Feature: none` trailer.
- Tests: unit + contract tests per the record's test_plan. "Live" checks are LOCAL ONLY for now (owner: no UAT yet):
  models through the local model backend on your own port (`MODEL_LOCAL_PORT=<18xxx> scripts/model-local start`;
  env from `scripts/model-local env`), or stubbed. Never ports 8091/8788/8797/8191/8888/8897; use 18xxx/19xxx and pick
  ports not used by other agents (your task names your range). No Runway / provider calls. Claude cap per feature: $1.50
  computed (price table); say what you spent.
- Run `scripts/check.sh` for the suites you touch (engine needs `source` of PY_ENGINE_DEPS in bash; see check.sh), then
  `scripts/feature checked <slug> pass "<suites>"` (and `scripts/feature status <slug> verifying` when done).
- Push YOUR branch (`git push -u origin feat/territories-<short>`). If SSH drops: GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60".
  Never --no-verify or NAPKIN_* bypass variables. Never push to develop/main/feat/territories; no PRs; no deploy; no terraform apply.
- Don't start sub-agents. Never bare `git stash`. Never commit secrets, .env or client material; fictional brands only.
- Stop every process you started (servers, model-local, browsers) before you finish.

## Final message
What you built (per done_when item), commits, tests and checks, local verification and spend, anything not done and why,
open questions, the pushed branch head, and files other features will need to know about (contracts, module names).
