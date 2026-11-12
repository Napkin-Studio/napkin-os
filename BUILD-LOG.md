# Napkin OS build log

One entry per session, newest last. Entries are never edited after the session ends.
The prompt for this build is docs/napkin-os-build-prompt-v3.1.md. It wins over v2 and v3.

## 2026-11-11 · Discovery · session 1

**Run settings.** Claude Code, Fable 5.2, billed to the Claude API (napkin Console org).
Subagents on Sonnet 5.5. Branch feat/discovery, cut from develop at ea34367b,
in the worktree ../napkin-discovery. Started 00:57 UTC.

**Plan for this session.** The five hand-back items in section 9 of the prompt:

1. The audit: docs/discovery/audit.md
2. The design proposal: docs/design/ (static HTML, 390 and 1440 px)
3. The Phase 1 feature records: features/*.clan, status exploring
4. The harness record and the Cannes removal record
5. The open questions list: docs/discovery/open-questions.md

**Progress.**

- Read napkin-studio.clan, the feature list (66 records) and all three prompts.
- Started nine read-only audits. Five cover this repo: the shell, the brief path,
  the platform, where Cannes material sits, and the production tools.
  Four cover the seven outside repos this login can reach (docs/sources/repos.md).
- Started scripts/check.sh --all on the branch, with no provider key in its environment.
- Harness read by hand: .claude/settings.json holds only the attribution switch,
  so there is no deny rule on .env. The hooks are commit-msg and pre-push; neither
  scans for secrets. CI has no secret scan. scripts/check.sh has an optional e2e suite
  (`--only e2e`), never part of `--all`.

**Could not verify at the start.**

- Eleven of the eighteen outside repos answer Not Found for this login.
- No file in the repo is named ADR-004.
- The raw J001 brief and the v2 section 13 artifacts are not on disk.

**What changed.** Three commits on feat/discovery after the prompt files:

- `846dd472` docs: the audit (docs/discovery, eight files: the index and seven detail files) and the design proposal (docs/design, 13 pages, 26 screenshots, CHECKS.md).
- `3ebed317` features: 13 records at status exploring, decisions for each default taken, open decisions in napkin-studio.clan, audit.md and open-questions.md.
- This log.

**The five hand-back items.**

1. Audit: docs/discovery/audit.md, with seven detail files.
2. Design proposal: docs/design/index.html. Squint and Count results in docs/design/CHECKS.md.
3. Phase 1 records: j001-pilot-suite, roles-and-homes, agency-look, job-index-dashboard, brief-gate, client-confirm-link, visual-brief, timesheet-sessions, screen-states, brief-versions-undo, client-wall.
4. Harness record: harness. Cannes record: cannes-removal.
5. Open questions and the ADR-004 summary: docs/discovery/open-questions.md.

**Checks.** `scripts/check.sh --all`: ten suites pass on the branch (rust, wasm, conformance,
frontend, desktop, engine, middleware, mock-backend, terraform, production-tool).
`scripts/feature verify`: passes for all 79 records.

**What went wrong, and what I did.**

- The first full check failed two suites, middleware and production-tool. Cause: this Mac has uv 0.4.25, which skips `[dependency-groups]`, so pytest and moto were missing. I ran the checks with uv 0.13.7 from a scratch folder. The installed uv was not changed. CI is not affected.
- Running the checks rewrites four tracked lock files and one generated wasm type file. I restored each with `git checkout --` and committed none of them.
- An audit subagent ran a relay test offline, which rewrote production-tool/relay/uv.lock. Restored the same way.
- Playwright's own browser was not installed, so the screenshots use the installed Chrome.
- The claude.ai doc could not be re-read after the switch to API billing. The repo copy of the prompt was already complete.

**Could not verify.**

- Eleven of eighteen outside repos (no access), so Shopper, Experiential, timesheets, the canon and three deck repos are unaudited.
- Any path that needs a paid call.
- The content of any Cannes, Effie or award data file, by rule.
- The live state of AWS and the hosted Qdrant cluster.
- The design proposal against the TBWA 1.0 prototype: the artifact is not on disk.
- No Playwright video was filmed. There is no J001 path to film until Phase 1; the screenshots stand in.

**Cost of Discovery.**

- Wall clock: about 45 minutes, in one session.
- Subagents (Sonnet 5.5): ten runs, about 900,000 tokens in all, as reported by the harness.
- Main session (Fable 5.2): not visible from inside the session. Run `/cost` in Claude Code, or read the Console, and add the figure here.
- Money: not measured for the same reason. I have not quoted a figure I could not see.
- Paid provider calls: none. Media credits: none.

**Re-estimate of each phase.** Discovery changes the estimate more by what it found than by what it cost.

- **Phase 1.** v2 treated it as wrapping what exists. The audit shows it is new work on every line but the brief. The 13 records carry their own build estimates, which add up to 123 working days for one builder (2, 10, 8, 10, 10, 10, 8, 15, 10, 10, 15, 10 and 5, in the order the records are listed above, then harness and cannes-removal). Run as three parallel lanes (shell, brief path, platform) that is 8 to 10 weeks, plus the owners' time to approve 13 designs and Laurence's time at the gate. It cannot start until ADR-004 is written and signed.
- **Phase 2.** Not smaller than Phase 1: Idea room, Script editor, Judge out of 30, the Brain, voice, search, single sign-on and five more homes are all new, and the idea sources could not be opened. Estimate 8 to 12 weeks.
- **Phase 3.** The largest. No outside repo is ready to wrap: Art Director Tool is a prototype, Resize covers four ratios, the outdoor repo is a different product, and the recipe runner, cost engine, tiers and ledger do not exist. Estimate 12 to 16 weeks, and it needs paid calls on.
- **Phase 4.** Cannot be estimated: Shopper and Experiential are unaudited. Deck Maker needs its server side. Hold v2's figure.
- **So v2's 19 to 31 weeks is a floor, not a ceiling.** The honest range for all four phases is 36 to 50 weeks of agent-led build at three lanes, before human hours. A money figure follows once the main session's cost is read.

**Next action.** Laurence writes nothing yet: Shrey approves the `client-wall` design, so ADR-004 can be written for Laurence to sign. It blocks everything else in Phase 1.

## 2026-11-11 · Phase 1 · session 2

**Run settings.** Claude Code, Fable 5.2 directing and reviewing, billed to the Claude API (napkin Console org, prepaid). Builders and auditors on Sonnet 5.5; one security review on Opus 5.5. Branch `spike/fabletest`, cut from feat/discovery at 37a0c8e6, in the worktree ../napkin-fabletest. Each record was built on `feat/<slug>` in ../napkin-b-<slug> and merged here. About 11:50 to 17:30 GMT for the build.

**Approvals, as given.** Sai approved all build phases and relayed Laurence's approval to build them all and to take Laurence's approvals as given (chat, 2026-11-11). Laurence has signed nothing himself: ADR-004's signature line is blank. Sai's rules for this run: everything lands on this one branch, no pull request to any branch, design follows the shell on develop where it differs from the Discovery proposal, and the branch is pushed once built and tested.

**Done.** All 13 Phase 1 records are built and merged: harness, client-wall, screen-states, j001-pilot-suite, agency-look, roles-and-homes, brief-gate, brief-versions-undo, visual-brief, client-confirm-link, job-index-dashboard, timesheet-sessions, cannes-removal.

**Checks at the end.** `scripts/check.sh --all`: twelve suites pass (rust, wasm, conformance, frontend, desktop, engine, middleware, mock-backend, terraform, production-tool, secrets, copy), run with uv 0.13 and a pinned gitleaks. The pilot suite, `app/e2e/j001-pilot.spec.ts` in installed Chrome: 47 passed, 1 skipped (test 16 at 390 px, desktop only by design), all 18 tests at 390 and 1440 px. Gate screenshots: docs/design/phase1-gate/.

**What went wrong, and what was done.**

- Records built side by side collided when merged: one `NAPKIN_ENV` with two meanings (harness and client-wall), the relay's byte copy of model_routes.py left behind, a seed writing with no agent, a lost test helper. Each was fixed on this branch. From the third wave on, each builder merged this branch into its own before reporting.
- An independent review of the client's link found the "full brief" showed the client every field but seven, including the Judge's review, the capture notes and the source passages. It now draws from an allow list of 13 fields, with a test seeded from every schema key.
- The Production Tool's quiet writes named no agent, which ADR-004 now refuses. Default taken: they name the participant and an action, folded by a 1.5 second wait. To be confirmed by Sai and Laurence.
- Three builders found the same race in `Session::open` (a read outside the lock). One fix is kept.
- The accessibility scan, once it ran on the right server, found three real contrast and naming faults. Fixed.

**Could not verify, or weaker than it reads.**

- Pilot test 12 runs the engine's retrieval path over stand-in rows; the test stack has no engine, so it is not the J001 brief's own trace.
- Nine older e2e tests fail here as they do on develop (bar Share, briefSheet x2, landing 320, registry x2, research x2, one in tools that passed in the last run).
- No model call was made by any test. The brief check questions, Run failed in the two apps and the gate on the Ballymaloe brief are unproven with a real model.
- The `eu.` Bedrock profile ids for the 5.5 models are unconfirmed.
- Nothing is applied to AWS. A read-only UAT plan showed only the roles attribute in Cognito and the two task definitions.

**For a person.**

- Laurence: sign docs/adr/0004-client-wall.md; judge the look (Geist and the warm palette were kept, by Sai's rule); the timesheet Friday rule; whether consent is a clan document.
- Run the Cannes removal (docs/runbooks/cannes-removal.md) and check the award workbook.
- Decide: Effie in the default exclusion list; the client link defaults (single use, 30 days, dead after any change, confidential parts hidden); who has which role.
- Confirm the Runway token in the deleted production-tool/relay/results/delayer-tests.json (still in history) has expired.
- Shrey: contract changes in docs/contracts/os-layer.md 7.5, 7.5.9, 7.7, 7.8 and 13.
- UAT: `terraform apply` in infra/envs/uat (cap 10 euro a day, paid calls on, set by Sai), then deploy this branch. `NAPKIN_BRIEF_GATE` is not set there.

**Cost.** Subagents reported about 5.1 million tokens across 23 runs (the sum of the harness figures). The main session's cost is not visible from inside it: read `/cost` or the Console.

**Phase 2, started.** Four read-only audits are done (Judge and the Brain; the bar, search, Ask Nap, voice, Needs you and the homes; sign-on, agency setup, approvals, the client link and timesheet signals; the Idea room and Script editor). No Phase 2 record is opened yet. Findings worth keeping: nothing scores creative work today and the calibrated judge backend is still planned; no bar, search, Ask Nap or voice code exists; larryob78/the-canon holds one Cannes data file and nothing usable; sign-on and the calendar, Slack and email signals each need an outside account a person registers.

**Next action.** Open and design the Phase 2 records, in this order: approval-route, a job page with the full Needs you, remaining-homes, one-bar-search, idea-room (cards and the five-card gate first), script-editor, judge (routing and overrule first, on fixture scores), agency-setup, client-review-full, napkin-brain (page store first), first-day, ask-nap, sso, timesheet-signals, voice. Show Sai the designs, then build as in this session.

## 2026-11-12 · Phase 2 · session 3

**Run settings.** As session 2. Fable 5.2 directed and wrote the designs; builders on Sonnet 5.5, at most three at once; security reviews and the wave checks on Opus 5.5. From the next session the directing session moves to Sonnet 5.5 to cut cost (Sai, 12 Nov): Fable stays for design agents only.

**Approvals, as given.** As session 2, repeated by Sai on 12 Nov ("take yes from Laurence's side"). Each record's `design.approved_by` reads "Sai (chat, 2026-11-11 and 12: approved all build phases; Laurence's approval relayed by Sai)". Laurence has signed nothing himself.

**Designed.** 17 Phase 2 records: job-page, needs-you-full, remaining-homes, one-bar-search, first-day, ask-nap, voice, j001-phase2-suite, idea-room, script-editor, judge, napkin-brain, approval-route, client-review-full, agency-setup, sso, timesheet-signals. The acceptance list is `docs/design/phase2-acceptance.md`, tests 19 to 73.

**Built and merged (11 of 17).** j001-phase2-suite, job-page, remaining-homes, approval-route, agency-setup (stages 1 to 3), idea-room (slice 1), script-editor (without the AI margin), needs-you-full, client-review-full, judge, one-bar-search. Also: the job index is stamped per document (`PartStore::stamp`, os-layer.md 13.3; 17 s down to 3 ms at 300 documents) and saves go through a temp file and a rename.

**Checks.** `node app/e2e/phase2-fixme.mjs`: 38 of 55 Phase 2 tests live. Phase 1: 18 of 18. The wave check on `fix/phase2-verify-b` (13 commits) ran `scripts/check.sh --all` green (twelve suites) and a full e2e run with 149 passed and 6 failed (pilot tests 3, 10 and 14 at both widths: a signer was matched by display name). That is fixed and the six pass alone. A last full run was still going when this was written: read `/tmp/phase2-verify-b-cfg/r5.log`, or run it again, before merging.

**What went wrong, and what was done.**

- An Opus review of the client review link found five faults (pieces loaded by re-hashing, a staff member as their own approver, a second round leaving old links open, no limit on email codes, a missing actor check). All fixed on `fix/client-review-hardening`.
- Four builders with a check running put the machine at a load of 26 to 36 and made e2e results unreadable. The cap is three builders, and the full e2e runs once per wave on a quiet machine.
- Finished worktrees held about 150 GB of `target/`. They are deleted when a record merges. A builder runs its own `npm ci`; a linked `node_modules` was wiped once.
- Finished builders re-sent their reports while waiting on their own background runs. Stop a builder once its work is merged.

**Could not verify, or weaker than it reads.**

- No model call was made. The Judge's rubric (`server/napkin/judge/rubric.json`) is a draft and no calibrated score exists; the Idea room's AI ideas and the Script editor's AI margin are not built.
- The email code on the client link goes to a file in tests; no SES sender exists.
- The per-client AI switch (`server/napkin/client_ai.py`) is a seam that returns False.
- Nothing is applied to AWS.

**For a person.** Everything in session 2's list still stands. New: Laurence reads the Judge rubric draft; the strict approver rule and the client link rounds; who may invite people; which Needs you rows can be marked done; whether budget hours count as money; Advertising Studio in the production image; the napkin-radio licence in writing; Shrey reads os-layer.md 7.8 to 7.10, 13.1 to 13.4, 14, 15 and `PartStore::stamp`; outside accounts for sso, timesheet-signals and the SES sender.

**Cost.** Not read from inside the session. Run `/cost`. Builders used 300,000 to 550,000 tokens each.

**Next action.**

1. Merge `fix/phase2-verify-b` into `spike/fabletest` once its last e2e run is green, then push `spike/fabletest` (no pull request). Origin is at a658a60a; four records and the fixes are local only.
2. Build `first-day`, `ask-nap` (the offline core) and `napkin-brain`, three at once, builders running only their own tests. Then one wave check on Sonnet.
3. Then: the per-client AI switch as a small record; agency-setup stages 4 and 5; idea-room slices 2 and 3; the Script editor's AI margin (held until the spend cap is decided).
4. Held until their outside accounts exist, unless Sai says otherwise: `sso`, `timesheet-signals`, `voice`.
5. Write the Phase 2 close, then design Phases 3 and 4 (not started).
