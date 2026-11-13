# Shared brief for a Napkin OS Phase 1 builder

You are building ONE approved feature record, `<slug>`, in the repo Napkin-Studio/napkin-os.
Work ONLY in your git worktree `/Users/saieeshwar/Projects/Work/work/napkin/napkin-b-<slug>`
(branch `feat/<slug>`, cut from the integration branch `spike/fabletest`). Never touch any
other folder under `~/Projects/Work/work/napkin/`.

## Read first
1. `CLAUDE.md` at the worktree root (workflow, commit format, checks table).
2. Your record and its approved design: `unzip -p features/<slug>.clan shared/data.yaml`
   (never Read the .clan zip directly). `done_when`, `design` (chosen approach, prior_art,
   contracts, test_plan, breakage, rework_risks, rollout) and `non_goals` are your spec.
   Build the chosen approach exactly.
3. `docs/napkin-os-build-prompt-v3.1.md` sections 5, 6, 8, 9, and the parts of
   `docs/napkin-os-build-prompt-v2.md` your record cites (read below its own
   "Prompt starts here" line). Use the v2 section 2 glossary words.
4. What is already on this branch (seven Phase 1 records are merged): the client wall
   (`docs/adr/0004-client-wall.md`; the host returns 400 for a `patch-data` with no agent or
   no action), the harness (spend guard, Cannes filter, secret scan, em dash check), the nine
   screen states (`app/src/components/states/`), roles and homes (`app/src/shell/home/`,
   `crates/napkin-web/src/roles.rs`), the agency look (three modes, `--agency-accent`), the
   Brief gate (`crates/napkin-host/src/ops/gate.rs`, `app/src/shell/gate/`), and the
   acceptance suite.
5. The acceptance suite: `app/e2e/j001-pilot.spec.ts`, `app/e2e/seed/j001/`,
   `app/e2e/README.md`, `app/e2e/stack.mjs`. The stack runs an anonymous napkin-web and a
   roster-mode one on port 18082 (with the Brief gate on); specs choose by baseURL
   (`open(..., {roster:true})`), and `seedJ001({ fresh: true })` gives a fresh client.
   The pilot tests marked `test.fixme` with your slug are yours: fix their selectors and
   routes to what you build, remove the fixme (and set the slug to null in `TESTS`), and make
   them pass at 390 and 1440 px. If one cannot pass because behaviour outside your record is
   missing, leave it fixme, say exactly what is missing and which record owns it. Never fake a pass.

## Design direction (the owner's rule)
Take the visual language from the shell and apps as they exist on this branch: `app/src/theme.ts`,
`app/src/index.css`, `app/src/brand/`, the agency skins, the three modes, existing components and
the screen-state components. Geist, warm paper and ink, the existing pill buttons. The Discovery
proposal (`docs/design/`) and v2 decide content, wording and behaviour; where their styling
differs from the existing shell, the existing shell wins. No new font, palette or component
style. One exception: on a screen meant for a phone, primary buttons are at least 44 px tall, in
the same pill style. Taste matters: if a screen looks like generic AI tooling it is not done.
Use de-identified content only ("Client A, an Irish whiskey").

## Hard rules
- Never read, print, copy or source any `.env` file or real key. No paid provider call, no model
  call: fixtures and the repo's mock middleware only. Run everything with provider keys unset.
- No real client or brand names in the repo; crop or avoid a real agency's name in screenshots.
  Never open Cannes, Effie or WARC content.
- No em dashes in any interface text, test title or copy.
- Every document write names an agent and an action. `crates/napkin-host` stays wasm32-clean
  (no `std::fs`, subprocess or HTTP outside the `native` feature).
- Change only what your record asks. If you find something else broken, report it, do not fix it.
  Nine older e2e tests already fail on develop and here: bar Share, briefSheet x2, landing 320,
  registry x2, research x2, tools spin-off. Not yours.
- Git: commit on `feat/<slug>` only, as the existing git identity. Subject
  `<area>: <imperative summary>`, 72 chars max (areas: shell, host, sdk, cli, web, wasm, desktop,
  apps, engine, rag, eval, server, mock, layers, infra, ci, docs, features, spec). NO
  `Co-Authored-By`, no "Generated with" lines. Never `--no-verify`, never set `NAPKIN_ALLOW_MAIN`,
  `NAPKIN_SKIP_CHECKS` or `NAPKIN_NO_FEATURE`. Do NOT push and do NOT open a pull request.
  Never run `terraform apply`.
- The record: start with `FEATURE_AGENT=claude scripts/feature status <slug> building`. After each
  meaningful commit run `scripts/feature log <slug> "<what changed>"` and keep `next_step` and
  `open_questions` current (`clan patch-data features/<slug>.clan '<json>' --agent claude
  --action "..."`). Commit the record with the code. If the design proves wrong, record a decision
  with `clan patch-decision` and say so in your report; do not drift silently.

## Running things
- `export PATH=/tmp/uv13/bin:$PATH` before anything that uses uv (this Mac's uv is too old).
  If `node`/`npm`/`npx` fail with an nvm error in a non-interactive shell, call the real binary by
  full path (under `~/.nvm/versions/node/<version>/bin/`).
- Playwright's bundled chromium build is not installed; install nothing system-wide. Run e2e in the
  installed Chrome through a throwaway config outside the repo (for example
  `/tmp/<slug>-cfg/chrome.config.ts` extending the repo config with `channel: 'chrome'`). Other
  builders run in sibling worktrees at the same time: use free ports, never kill other processes,
  expect slow cargo builds.
- The `secrets` check suite needs `GITLEAKS_BIN`; find a binary with
  `find /tmp /private/tmp -maxdepth 4 -name gitleaks -type f`.
- Running checks rewrites some tracked lock files and a generated wasm type file: restore those
  with `git checkout -- <file>` and never commit them.
- Save screenshots of each new screen at 390 and 1440 px under `docs/design/<slug>/`.

## Before you report: merge the integration branch into yours
Other records land on `spike/fabletest` while you work. When your own work is green, run
`git merge spike/fabletest` in your worktree (a merge, never a rebase), resolve any conflicts
keeping both sides' behaviour and every live test, then on the merged code: run
`scripts/check.sh` for the suites reached, your pilot tests and every other live pilot test at
both widths, and `node app/e2e/phase1-fixme.mjs`. Record `scripts/feature checked <slug> pass
"<suites>"` only if it is green.

## Report back (under 400 words)
1. Each `done_when` line: met or not, with the exact command and result that proves it. Your pilot
   tests: pass, or fixme with what remains, at both widths. The fixme count.
2. Commits (hash and subject), changed files by area, screenshot paths, the merge commit hash.
3. What you could not verify and why; anything in the design that proved wrong; anything else you
   found but did not fix; anything that needs a person (a Terraform apply, a decision).
State plainly if anything is unfinished; do not call it done unless the checks ran green.

## Phase 2 addendum (read this too; where it differs from the text above, this wins)
- Phase 1 is complete on `spike/fabletest`: all 13 records merged, all 18 pilot tests live. You are
  building a Phase 2 record. Its design was written on 12 Nov 2026 from an audit of this branch; the
  design is approved (owner: Sai approved the build phases and relayed Laurence's approval).
- Start by creating your worktree if it does not exist:
  `cd /Users/saieeshwar/Projects/Work/work/napkin/napkin-fabletest && git worktree add -b feat/<slug> ../napkin-b-<slug> spike/fabletest`
  and, if the record is at `designed`, `FEATURE_AGENT=claude scripts/feature status <slug> building`.
- The Phase 2 acceptance list is `docs/design/phase2-acceptance.md` (tests 19 to 73) and the record
  `features/j001-phase2-suite.clan`. Each record has its own spec file under `app/e2e/`; do not add
  Phase 2 tests to `j001-pilot.spec.ts`. If the suite's spec file for your record already exists on the
  branch with your tests marked `test.fixme`, make them real and passing at 390 and 1440 px; if it does
  not exist yet, write your record's tests in your own spec file to the wording in the acceptance list.
- Keep the 18 Phase 1 pilot tests passing. One plain run covers them all now (tests 5, 6, 7 open the
  roster server themselves).
- Keep your surface narrow. The design's `touches` and `breakage` name the shared files you may edit
  (`roles.rs`, `jobindex.rs`, `api.rs`, `App.tsx`, `doors.ts`, the seed, `stack.mjs`): change only the
  lines your record needs there, and merge `spike/fabletest` into your branch before reporting.
- A record with stages: build the stage your task names, leave the later stages unbuilt, and say so in
  `next_step`.
- An allow list, never a deny list, for anything shown to a client or sent outside an agency; seed
  tests with every field of the schema, not a minimal document.

## Design addendum, 13 Nov 2026 (the owner's rule; this wins over every design line above)
Develop is the model for the whole system, not only for colours: how it looks AND how it behaves, from the landing page and the desk to working inside a tool. After the develop merge, read these on the branch before designing or building any screen, and build the way they do:
- Shell: `app/src/shell/nui/tokens.css`, `nui.css`, `shell.css`, `app/src/components/Toolbar.tsx`, `barMenus.ts`, `app/src/shell/agency/palette.ts`, `app/src/shell/AppRuntime.tsx` (the postMessages a tool page uses: `clan:jobs`, `clan:edit-mode`, `clan:booth`, `clan:feedback-pick`). Use these, never a new mechanism.
- The two finished tools: `app/templates/brief-maker/index.html`, `app/templates/campaign-research/index.html`, `app/templates/shared/`. Open them in a browser on the local stack, do not only read the code.
- The Booth is the one right-hand panel where agents sit. It pushes the document aside and never overlaps it. Evidence, review, agents, asks and actions for whatever is selected go there, not in a new side panel, band or drawer.
- No chat panel in any tool. Agents act in place: inline drafts with who-wrote-it marks, Keep / Keep mine / Why, asks with options, answered in the Booth.
- Needs you is the one settle-before-lock list. Lock and the status pill agree with it.
- No prices or costs in the interface. Costs are recorded per job and shown only in the decision tree.
- Confidential means Napkin's own systems never take the part in; the agency and the client see everything.
- "Napkin Studio" appears once. Every part, control and node is named for point-at-it feedback through `window.ClanFeedbackTarget`.
- Motion is calm: slide and push, never bounce; reduced motion becomes a short fade.
Where an approved record's design on this branch differs from the above, stop and report the difference instead of building either.

## Speed addendum, 13 Nov 2026
- Do not cold-build Rust in a new worktree. Right after creating the worktree, clone the integration worktree's build cache (instant on this disk, copy-on-write): `cp -Rc /Users/saieeshwar/Projects/Work/work/napkin/napkin-fabletest/target ./target` if `./target` does not exist yet. Cargo then rebuilds only what you change. Do the same for `app/node_modules` only by running `npm ci` (never copy or link it).
- Never run the whole e2e suite. Your own spec files and the pilot tests your design names, both widths, one worker.
- No timers, monitors or sleep loops. Foreground commands with long timeouts. No background process left behind.
