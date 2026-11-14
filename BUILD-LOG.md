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

**Checks.** `node app/e2e/phase2-fixme.mjs`: 38 of 55 Phase 2 tests live. Phase 1: 18 of 18. The wave check on `fix/phase2-verify-b` (13 commits) ran `scripts/check.sh --all` green (twelve suites) and a full e2e run with 149 passed and 6 failed (pilot tests 3, 10 and 14 at both widths: a signer was matched by display name). That is fixed and the six pass alone. The last full run (r5, 1.4 h) ended with 153 passed and 2 failed, both pilot tests at 1440 px and both timeouts: test 7 (the axe scan, 240 s limit, 31.7 minutes on the clock) and test 18 (no work item appeared in 60 s). A second local stack ran beside it for a demo, which may explain test 7 (it passed in the other seven runs). Test 18 is not explained by that: it also failed once in a baseline run, both times on the large shared tenant. The wave check also found that some document handlers (`attach-targets`, `library`, the Judge card) scan the whole store while holding a lock, so a tenant of about 1,000 documents stops answering for over 10 s, and that the Judge's role-wide notes reach every art director and copywriter in the agency. Both need a design decision. It fixed a real leak: client-link and session tokens were written to the request log. Neither was re-run: Sai paused the build. `fix/phase2-verify-b` was merged all the same on Sai's word (12 Nov), with tests 7 and 18 at 1440 px still to be re-run.

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

**Plan change, 12 Nov, late (Sai: "modify the plan to accommodate those changes and keep the build in this branch going").** Develop moved 39 commits on 12 Nov (to 5f828631): the jev judge runs the first-draft checks and judges every brief (#206, #208); a document opens with one GET and the host composes the frame page (#172); jobs end failed when they stall and are traced (#171, #167); a UAT loop with journeys (#169, #204); Brief Maker and Research fixes. A trial merge conflicts in 10 files: AppHost.tsx, AppRuntime.tsx, structuredEditBridge.js, SaveStatus.tsx, napkin-host routes.rs, napkin-web lib.rs and tests/api.rs, server app.py and registry.py, Cargo.lock.

**Next action.**

1. PAUSED by Sai on 12 Nov before it finished; nothing is running. The merge of `origin/develop` is committed on `chore/merge-develop` (worktree `napkin-b-merge-develop`) with follow-up fixes, but it is unproven: the agent was stopped while three check suites were failing and before any e2e run. It is NOT merged into `spike/fabletest`. On resume: read that branch's commits, then finish it. The task was: merge `origin/develop` on `chore/merge-develop`, keep both sides' behaviour, run all checks and the full e2e (this also re-runs pilot tests 7 and 18). Merge it in, then push `spike/fabletest` (no pull request; the push needs Sai's permission rule or his own hand).
2. Re-read three designs against develop and amend them where it changes them: `judge` (jev now exists, so a calibrated score may back the threshold), `client-review-full` and the Cmd K frame fix (the frame is loaded differently), `job-page` (new job end states). Small fix records where needed.
3. From then on merge develop into this branch at the start of every wave, so the gap never grows past a day.
4. Build `first-day`, `ask-nap` (the offline core) and `napkin-brain`, three at once, builders running only their own tests. Then one wave check on Sonnet.
5. Then: the per-client AI switch as a small record; agency-setup stages 4 and 5; idea-room slices 2 and 3; the Script editor's AI margin (held until the spend cap is decided).
6. Held until their outside accounts exist, unless Sai says otherwise: `sso`, `timesheet-signals`, `voice`.
7. Write the Phase 2 close, then design Phases 3 and 4 (not started).


## 2026-11-13 · Phase 2 alignment, Phase 3 and 4 designs · session 4

**Run settings.** Fable 5.2 directing, and for designs; Sonnet 5.5 for the merge, audits and builders, three at once. CI now runs on push to `spike/fabletest`; the first run passed.

**Owner's rules this session (Sai, in chat).** Develop is the model for how the product looks and behaves, from the landing page to working in a tool. Alignment is built before new records. Cmd K stays; the bar has no search field. The Idea room's AI ideas and the Script editor's AI margin leave Phase 2 until the spend cap is decided. All the designers' recommended picks were taken for the alignment and for Phase 3. Release #229 (develop into main) was merged by the agent on Sai's word, as a one-off.

**Done.**
- Develop is merged in up to 34235abb (`chore/merge-develop`). All check suites green. Full e2e: 212 passed, 18 failed: the nine known older ones; `shots.spec.ts:44` (a seeding tie, every time); and pilot 18, Judge 59 and six Visual Brief tests, which passed when run alone. The server log showed 4 to 12 s waits on the view lock in the full run.
- Five alignment designs approved: `align-landing-look`, `align-booth`, `align-needs-lock-people`, `align-confidential-prices`, `ask-nap` (amended). The audit behind them is `docs/build-handoff/develop-alignment-audit.md`.
- Phase 3 designed and approved: 35 records, about 98 builder-hours, in 13 waves (the order is in `j001-phase3-suite`). Wave 0 is `production-line-merge`: Shrey's `feat/make-and-edit` merged into this branch.
- Phase 4 designed, NOT yet approved in the records: 14 records, about 31.5 builder-hours. Its ten picks were reported to Sai; he paused before answering.
- `docs/build-handoff/` holds the briefs, audits and a README for a teammate.
- Pushed to origin at 3b0fcf7e. Later commits (the Phase 3 and 4 designs and approvals) are local.

**Stopped part-way when Sai paused (work kept in each worktree, some of it uncommitted).**
- `feat/align-confidential-prices` (`napkin-b-align-confidential-prices`): the host change is committed; 41 files uncommitted; it was about to run the Phase 2 tests.
- `feat/align-landing-look` (`napkin-b-align-landing-look`): five commits, three files uncommitted; it had merged the branch and was re-running tests.
- `fix/store-scan-under-lock` (`napkin-b-store-scan`): two commits, five files uncommitted; it was on its last e2e checks.
None is verified or merged.

**Could not verify.** That the eight run-alone failures are the slow-server fault; the fix is not merged and the full run was not repeated. Nothing in Phase 3 or 4 was run. Staging runs release #229 (confirmed in AWS: both services on the image from 614ee59b).

**Next action.**
1. Finish the three stopped builders (resume each in its worktree: read `git status`, finish, run its own tests, merge `spike/fabletest`, report). Merge them, then one full e2e on several workers and a Fable security review of the confidential change.
2. Then `align-needs-lock-people` beside `align-booth` (split the Booth move across three builders once its shared snippet lands), then `ask-nap`.
3. Get Sai's answer on the ten Phase 4 picks, then approve those 14 records.
4. Phase 3 wave 0 (`production-line-merge`, with `j001-phase3-suite` beside it) can start as soon as a builder slot is free; `align-confidential-prices` must be merged before Phase 3 wave 1.
5. Then `first-day`, `napkin-brain`, the per-client AI switch, the Phase 2 close, and the Phase 3 and 4 waves.
6. Push `spike/fabletest` after each wave; merge `origin/develop` at the start of each.

## 2026-11-13 · Machine proof on Linux ARM64 · session 5

**Machine.** Linux aarch64. Installed: Rust stable (rustfmt and clippy added; they were missing), wasm32 target, Node 22.23.5 via nvm, uv 0.13.8 (was 0.12.24), gitleaks 8.30.1 in `~/bin` (`GITLEAKS_BIN`), Playwright's own Chromium (`npx playwright install chromium`; `--with-deps` needs sudo, and the system libraries were already present). The sudo password is not available to the agent.

**Differences from the Mac run (`scripts/check.sh --all`).**
- rust: failed first because rustfmt was not installed; re-run after adding it is recorded below.
- terraform: FAIL, `terraform: command not found`. Not on the install list; not installed. Infra is not touched by this build.
- production-tool: FAIL, `wasm-bindgen: not found` (the wasm-bindgen CLI is not installed). Its Python tests passed (one xfail).
- wasm, conformance, frontend, desktop, engine, middleware, mock-backend, secrets, copy: pass.

**Branches.** `feat/align-confidential-prices`, `feat/align-landing-look` and `fix/store-scan-under-lock` are NOT on origin (checked with `git ls-remote`). Their work lives only on the first machine, so they are rebuilt from their records' designs.

**Rust and e2e on this machine.** rust suite: pass (23 min, cold build). Full e2e, one worker, Playwright's Chromium, 52 min: 213 passed, 17 failed, 51 skipped (the Mac: 212 passed, 18 failed).
- Same as the Mac: the known older failures bar Share, briefSheet x2, landing 320, registry x2, research x2, and `shots.spec.ts:44`.
- Different: the tools spin-off test passed here. Judge 59 failed at 390 and 1440 (Mac: Judge 59 once). Pilot 9 failed at 390 (Mac: pilot 18). Visual Brief failed 3 (Mac: six). The Mac's run-alone failures are not yet re-run here, so the slow-server explanation is still unverified.
- Not installed, so two check suites fail on this machine: terraform and the wasm-bindgen CLI (production-tool).

**align-confidential-prices: three security reviews, then a redesign (session 5).**
- Built on `feat/align-confidential-prices` (Sonnet), three Fable 5.2 reviews, three fix rounds. Heads: 30bfbaf0, babd6462, 38cae6e1. Not merged; not pushed.
- Round 1 blocker: `proxy.rs` sent the whole document context (confidential parts included) to the middleware on every app call; the READERS test could not see it. Fixed by scrubbing the context.
- Round 2 blockers (fixed, proved at runtime in round 3): a spin-off dropped the mark on a carried research fact; carried member facts reached `upstream_payload`; `projection.pins/findings/sources` copies were not dropped.
- Round 3 blockers, open: (1) version history: an edit of a confidential field records `fields_changed` and `before` with no `targets`, and the chain goes to agents, so the old words leave (`confidential.rs:449-452`); (2) a confidential source's quote is dropped under `projection.pins` only, not under `facts[f].quotes` (`confidential.rs:195`).
- Open should-fix: the mark does not follow a fact copied under a new id or cited by a finding; a confidential file's name stays in attachments and free text, and some path spellings get through; app-built payloads pass numbers, strings under 24 characters and partial quotes.
- Cause: the context is built from the whole document and confidential bits are subtracted, so every new copy of the data is a new leak. Decision (Sai, in chat): try an allow-listed agent context (each outgoing field named, read only from non-confidential nodes), designed by Fable 5.2, then rebuilt. The design is not approved until Sai says so.
- Also found: `an_open_racing_a_write_does_not_lose_the_write` (`crates/napkin-host/tests/client_link.rs`) hangs or fails 10 times in 20 on plain `spike/fabletest`, on this machine. It is not caused by this branch. It looks like the view-lock fault that `fix/store-scan-under-lock` was meant to fix, and that branch has no record on this branch.
- `align-landing-look` built (head 3f83aa71, Sonnet), not merged: pilot 4 fails because the Needs you list left the landing; the bar search field remains; a wider e2e was not run. Waiting on Sai's decision.
- Cost log: three Fable reviews of about 100-125k tokens each; Sonnet builders about 450-520k tokens each per round.

**align-confidential-prices: held after the fifth review (14 Nov, session 5).**
- Approach A (allow-listed outgoing context, `outgoing.rs`) was built (head 23fa385b after a fourth fix round) and reviewed a fifth time by Fable 5.2 with runtime probes. The four blockers of the fourth review are closed at runtime, and a loopback capture of the real `api_proxy` body shows no canary, cost, signer or closed file on the wire. Verdict: NOT SAFE to merge. The branch is held, unmerged and unpushed. No further fix round without Sai's decision.
- Open blockers: (1) `/script/propose` copies a confidential beat into `script.proposals[].was` and every script task sends it (`ops/script.rs:118`, `outgoing.rs:620`); (2) a closed fact's value goes out in `upstream_payload.decisions` from the frozen copy's `selection.contested` (`outgoing.rs:886`); (3) regression: the campaign-research template writes every material as `client-confidential`, so `start_campaign` gets zero attachments, and the prompt material's text still leaves as `data.brief_input` (`outgoing.rs:1272`, template `index.html:4135`); (4) regression: `locked`, `locked_fields` and `signers` are no longer sent, but the middleware's lock refusals read them (`regenerate_field.py:18,24`, `draft_brief.py:25`) and the host has no lock check.
- Should fix: schema-shaped `replaced_by` leaks `stale.current_value`; renamed-copy gaps (sidecar sent as `image`, legacy `%20` uploads); a confidential field's words via `capture.items[].value`, `review.*` and position-keyed `edits`. Minor: free text in the agent-kind `task` string and Id slots; the typed-text net passes spelled-out numbers and fragments under 12 characters.
- Cause, across five rounds: both the filter design and the allow-list design are closing leaks one at a time because the middleware tasks, the templates and the edit paths each carry their own copies of the data. Blockers 3 and 4 show that the allow list also cuts what the middleware needs.
- Not proven: the real middleware's behaviour for 3 and 4 (no model call was made); a mark put on a parent after a spin-off; e2e on the fifth head.
- Cost: five Fable reviews of about 100-180k tokens each, one Fable design of about 115k, and Sonnet builder rounds of about 450-660k tokens each.
- Phase 3 wave 1 stays blocked, since it needs this branch merged. Napkin Brain records 6 onward wait on it too.

**align-landing-look merged (14 Nov, session 5).**
- `feat/align-landing-look` is merged into `spike/fabletest` (1a2d97ae, `--no-ff`), with `origin/develop` (7 commits: ACNE, the Agencies tab, style switches, parts sharing a row) merged into it first (924a062a). Not pushed.
- Conflicts: `bootLook.ts` (kept develop's saved agency-style read and the branch's white/grey to light and black to dark migration), `briefSheet.spec.ts` (a comment). `palette.test.ts` and pilot 6 followed develop: a People-page agency may rename a registry agency, and a new agency is a draft until published with the `rev` from the add response.
- Needs you is mounted on the desk (22cd11d7). Five stale selectors fixed in the approval-route and job-page specs (606cd99b).
- Checks on the merged code: frontend, copy, secrets pass; napkin-host and napkin-web cargo tests pass (the racing test skipped); pilot, agency-setup, roles-homes, remaining-homes, approval-route, job-page, visual-brief pass at 390 and 1440. Not fixed: Judge 59 and the known older failures. Judge 64, pilot 15 and visual-brief 247 and 319 fail only in a long single run and pass alone (the slow-server pattern).
- Not done: the bar search field is still in the bar; Old "Open Brief" and "The map" bar commands are gone; a full multi-worker e2e on the merged branch is still to run.
- Cost: Sonnet builders about 450k tokens for the build, 66k for the e2e fixes, 67k for pilot 6.

**Baseline after the landing and develop merges (14 Nov, session 5).**
- Full e2e on `spike/fabletest` at c03fb068 with 6 workers: 204 passed, 28 failed, 125 skipped, in 14 min (one worker took 52 min). The skips rose from 51 to 125 because `j001-phase3-suite` adds 74 waiting tests.
- 16 of the 28 are the known list (bar Share, briefSheet x2, landing 320, registry x2, research x2, `shots.spec.ts:44`, Judge 59 x2, visual-brief 189 and 247) or were seen before in long runs.
- 12 were new. Run again at one worker in a small set: idea-room 50, 51 and 52, phase 2 suite 73, Judge 58, pilot 13, landing 180, roles-homes 113 and visual-brief 319 all pass, so they fail only under parallel load (the view-lock and slow-server pattern; `fix/store-scan-under-lock` is still missing). Judge 64 fails at both widths when Judge 58 runs before it and passes alone: it depends on test order, cause not yet known. Visual-brief 137 failed once at 390 and passed at 1440.
- Until the lock fix exists, 6 workers is a quick smoke run, not a gate; a failure there is re-run alone before it counts.
- In progress: `align-needs-lock-people` stage 1 (the host slice) and `align-booth` stage 1 (the shared Booth snippet), one Sonnet builder each. `production-line-merge` waits for them. `align-confidential-prices` is still held.

**A fault in how e2e was run on this machine (14 Nov, session 5).**
- The e2e stack starts a stand-in middleware on port 18081 unless `NAPKIN_E2E_MW_PORT` is set (`app/e2e/stack.mjs:41`). Builders were given their own `NAPKIN_E2E_PORT` and roster port but not this one, so every stack running at the same time shared one stand-in. Its state (`variants`, `failNext`, the job state, `app/e2e/standin.mjs:28-31`) is not kept apart per run or per tenant.
- Effect: an e2e result obtained while another stack was running may be wrong in either direction. That covers the builders' runs on `align-landing-look`, `align-confidential-prices` and `j001-phase3-suite`, and the lead's re-runs made while builders were testing. It is the likely cause of the Judge 64, Judge 59, pilot 15 and visual-brief results that passed alone and failed in company, and probably of the failures seen only with 6 workers (one stand-in, shared by parallel tests). Not proven: the investigation could not reproduce Judge 64 or 59 on a quiet machine (the whole Judge spec passed 14 of 14).
- No sign of state crossing tenants in napkin-web was found; the caches were not probed directly.
- Fixed in the briefs: every builder now sets three ports. Still to do: a full e2e on `spike/fabletest` with nothing else running, to get a clean baseline, and keying the stand-in's state per tenant so several workers can be trusted (a small e2e change, not yet started).
- Earlier log lines that blame the view lock or a slow server for these failures are unproven and may be wrong.
