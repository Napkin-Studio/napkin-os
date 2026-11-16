# Handoff: the Napkin OS build on `spike/fabletest`

Written 2026-11-16 for the agent or person who picks this build up next. It is a summary and a
route in. `BUILD-LOG.md` is the full record (one entry per session, never edited afterwards) and
wins wherever the two differ.

## 1. Where things stand

- **One branch holds everything: `spike/fabletest`.** No pull request comes from it and nothing
  from it goes to `develop` or `main` (owner's rule). Each record was built on its own branch in
  its own worktree and merged here with `git merge --no-ff`.
- **Every branch and worktree of this build is merged into it, bar one** (checked 16 Nov: 30 of
  31 local branches and all 32 worktrees are ancestors of the head, with no uncommitted product
  work). The one left out on purpose is `feat/align-confidential-prices`: see section 4.
- **Nothing is running.** No builder, no reviewer, no test stack.
- **`origin/develop` is fully merged in** (up to 0b0d4342, 13 Nov; zero commits behind on 16 Nov).
- **The push.** Before 16 Nov, origin held this branch at e405c27b (13 Nov) and about 730 commits
  were local only, 457 of them Shrey's Production line (`origin/feat/make-and-edit`). Read the
  last `BUILD-LOG.md` entry to see whether the push has gone through since. It needs
  `NAPKIN_LICENCE_APPROVED=Shrey` (the only name in `licences/policy.toml` `approvers`), because
  the Production line changed `licences/*.toml`. That is a person's approval. An agent never sets
  it and never uses `--no-verify`.
- **The push has a second blocker: the `licences` suite fails on this branch** (run 16 Nov; it had
  never been run on the build machine). 3 failed, 110 passed:
  1. `test_repo_tree_passes`: the Google Fonts family Newsreader is used in 21 files (develop's new
     UI: `app/index.html:15`, `app/templates/*/index.html`, `design/new-ui/`) and is not in
     `licences/fonts.toml`. Develop has the font and no licence gate; the Production line has the
     gate and not the font; the merge brought them together. The fix is one `[[family]]` entry
     with its licence and `source_url`, approved by Shrey. An agent does not add it.
  2. `test_pre_push_refuses_a_policy_change_without_napkin_licence_approved` and
     `test_pre_push_ignores_pushes_that_leave_licences_alone`: their throwaway repo has no
     `scripts/check.sh`, and this build's hook runs the secret scan through it before anything
     else (`.githooks/pre-push:68`). A test fixture fault from the same merge; an agent can fix it
     (give the fixture repo `scripts/check.sh`, `.gitleaks.toml` and a gitleaks it can find).
  The `image` suite passes (20 minutes). The other twelve suites were not re-run on 16 Nov.

## 2. What was done

By phase. The log entry for each has the commits, the checks and the review findings.

**Discovery (session 1).** The audit (`docs/discovery/`), the design proposal (`docs/design/`),
the first records, the open questions.

**Phase 1 (session 2): all 13 records built and merged.** harness, client-wall, screen-states,
j001-pilot-suite, agency-look, roles-and-homes, brief-gate, brief-versions-undo, visual-brief,
client-confirm-link, job-index-dashboard, timesheet-sessions, cannes-removal. Acceptance suite:
`app/e2e/j001-pilot.spec.ts`, tests 1 to 18.

**Phase 2 (sessions 3 to 5): 14 of 17 records built and merged.** j001-phase2-suite, job-page,
remaining-homes, approval-route, agency-setup (stages 1 to 3), idea-room (slice 1),
script-editor (without the AI margin), needs-you-full, client-review-full, judge,
one-bar-search, first-day, and Napkin Brain records 1 to 5 (template, page model, append-only
history, rules, rendering). Acceptance list: `docs/design/phase2-acceptance.md`, tests 19 to 73.

**Alignment with develop (sessions 4 and 5).** Develop is the model for how the product looks
and behaves. Merged: `align-landing-look`, all of `align-booth` (one shared Booth in all five
tools, shared folds, the four bands removed), all four stages of `align-needs-lock-people` (one
Needs you, one People store, one People page), and the price half of
`align-confidential-prices` (no price, cost, credit or budget on any screen).

**Phase 3 wave 0 (session 5).** `production-line-merge`: Shrey's `feat/make-and-edit` merged in
as a true merge by the written rule in `docs/production-tool/merge-2026-11.md`, with
`/production` behind the session, live roles and a gate. Then `production-platform-rules` and
three review rounds: the euro guard fails closed, caller URLs and blob keys are checked, clip
length is measured by ffprobe, the per-client AI switch stands in front of every op that sends
client material. `j001-phase3-suite` is merged with 74 waiting tests.

**Faults found and closed along the way.**
- A privilege escalation: any member could write the people registry and make herself admin.
  Closed by the People store (`align-needs-lock-people` stage 3).
- The server slowed as a workspace grew, and one test hung: reads scanned the whole tenant while
  holding a lock. Closed by `store-scan-under-lock` and the lock order follow-up (the slowest
  tenth of reads under 200 ms at 1,000 documents; before, 20 to 100 s).
- Client-link and session tokens in the request log; five faults in the client review link; a
  Cognito sign-in that took the typed name; Script editor redraws that lost state and the caret.

**Designed and approved, not built.** Phase 3: 35 records in 13 waves (the order is in the
`j001-phase3-suite` record; acceptance list `docs/design/phase3-acceptance.md`). Phase 4: 12
records approved on 15 Nov. Napkin Brain: 23 records in its 14 Nov design, 5 built.

**Last known checks** (the head before this handoff, d2930c41, differs from them only by the
lock order merge and docs).
- After the store scan merge: `scripts/check.sh --only rust` passes in 101 s; wasm, conformance,
  frontend, desktop, secrets and copy pass; the Phase 2 suite passes 28 of 28.
- Last full e2e, at a5e36aa7 (15 Nov, before the store scan fix), in seven short sets: every live
  Phase 1 and Phase 2 acceptance test passes. The only failures are the nine inherited from
  develop: bar Share, briefSheet x2, landing 320, registry x2, research x2, `shots.spec.ts:44`.
- **Not run since the store scan and lock order merges: a full e2e.** Do it first (section 5).

## 3. What is left

**Waiting for the owner (Sai). Do not build these before he answers.**

| Item | State | Where |
|---|---|---|
| `registry-documents-closed` | Design written, NOT approved, no record opened. On this branch any member can read and write the jobs registry (`home-jobs-v1`): a copywriter read a budget and emptied the agency's job list with one `patch-data`. Three related holes are on `develop` and `main` too, so staging and production have them. Shrey has not been told. About 20 agent hours. | `designs/design-registry-documents-closed.md`, reproduction in `designs/zz_registry_inventory.rs.txt` |
| The confidentiality half of `align-confidential-prices` | Held after five security reviews, verdict NOT SAFE. To be redesigned with agreed wording. It blocks `ask-nap`, Phase 3 wave 1 and Napkin Brain records 6 to 23. | Section 4; log entries of 13 and 14 Nov; `designs/design-allowlisted-agent-context.md` |
| The per-client AI switch | No design. Until a client's yes can be stored, the relay refuses every Runway or model job. | `server/napkin/client_ai.py`, log entry "Phase 3 and Phase 2 work in flight" |
| The Phase 4 cost plan | Put to Sai on 15 Nov, not answered. | Log, end of session 5 |
| The spend cap for AI features | Undecided, so the Idea room's AI ideas and the Script editor's AI margin are out of Phase 2. | Log, session 4 |
| Open owner questions | About ten, listed in the pause entry of 15 Nov ("Open questions for the owner") and on each record. | `BUILD-LOG.md` |

**Buildable once those are answered, in this order.**

1. `registry-documents-closed` (security; first, once approved).
2. The confidentiality redesign, then its build and review.
3. `ask-nap` (designed and amended; waits on 2).
4. Phase 3 waves 1 to 12 (wave 1 waits on 2).
5. Napkin Brain records 6 to 23 (wait on 2).
6. The per-client AI switch, as a small record.
7. Phase 2 leftovers: agency-setup stages 4 and 5, idea-room slices 2 and 3, the Script editor's
   AI margin (the last two wait on the spend cap). Then write the Phase 2 close.
8. Phase 4: 12 records, `j001-phase4-suite` first.
9. Held until a person registers the outside accounts: `sso`, `timesheet-signals`, `voice`.

**Small open items on merged records** (each is on its record's `open_questions`):
- store scan: two web tasks on one disk (the base check is not atomic across processes); no
  release-build bench; `routes_start` can land one write and refuse the second.
- production rules: the day cap is one total shared by every agency and resets on a cold start;
  USD is counted as euro; a Production job's cost is recorded and shown nowhere.
- people: two web tasks writing `people.json` at once.
- `j001-p2-script-editor.spec.ts:266` depends on test order (passes alone 10 in 10).

**For a person, before any deploy of this branch.** Nothing here is deployed and nothing was
applied to AWS.
- The hackathon relay's Lambda: `NAPKIN_ENV`, `NAPKIN_PAID_CALLS=off`, `NAPKIN_SPEND_CAP_EUR=0`,
  `NAPKIN_MODEL_PIN=eu`, and an ffmpeg layer (Terraform).
- A roles column in `accounts.napkin.tsv` (13 people) and `accounts.uat.tsv` (23), or all 36
  start with no role and lose every tool.
- A People store for production (Cognito sign-in): a task-definition setting, so a Terraform apply.
- `NAPKIN_PUBLIC_ORIGIN`, or no invite mail is sent.
- Laurence has signed nothing himself: `docs/adr/0004-client-wall.md` is unsigned and every
  approval is "Sai, in chat, Laurence's relayed". The Judge rubric is a draft.
- No test made a model call or a paid call. Anything that needs one is unproven.

## 4. The one branch that is not merged

`feat/align-confidential-prices` (head 23fa385b, 18 commits, worktree
`napkin-b-align-confidential-prices`). It is on the build machine only, not on origin.

Do not merge it. Sai's decision of 15 Nov: its price half was rebuilt and merged from
`feat/align-prices`, and "the old branch stays unmerged". The fifth review found that it leaks a
confidential script beat and a closed fact's value, and that it breaks two things the middleware
needs (campaign research gets zero attachments; lock refusals stop working). A trial merge on
16 Nov conflicts in about 20 files, because the price half, the People store and the store scan
fix have all moved the same code since.

Use it as reference for the redesign: `crates/napkin-host/src/confidential.rs`, `outgoing.rs`,
and the review findings in the log. The cause the reviews agree on: the middleware tasks, the
templates and the edit paths each carry their own copy of the data, so both a filter and an
allow list close leaks one at a time.

## 5. How to pick up

1. Read, in order: `CLAUDE.md`; this file; the last two entries of `BUILD-LOG.md`;
   `docs/build-handoff/README.md` (the rules of the build); `docs/napkin-os-build-prompt-v3.1.md`.
2. Look at the records: `scripts/feature list`, `scripts/feature show <slug>`. A record's design
   is its builder's spec. Read a record's data with
   `unzip -p features/<slug>.clan shared/data.yaml`, never the zip itself.
3. Get a clean baseline before changing anything: `scripts/check.sh --all`, then the full e2e in
   short sets, one worker, on a fresh stack with nothing else running. Expect the nine inherited
   failures and no other. Write the result in the log.
4. Take Sai the decisions in section 3, the registry design first. Show a design before building
   it: "go on with all" covered only designs he had already seen.
5. Start each wave by merging `origin/develop`. Build each record on `feat/<slug>` in
   `../napkin-b-<slug>`, cut from this branch, giving the builder `builder-brief.md` with your
   own paths (the brief's paths are for the first Mac). Merge with `--no-ff`. Push after each wave.
6. End each session with a new `BUILD-LOG.md` entry, and keep each record's `next_step` and
   `open_questions` current.

**How the build was run, and what it cost to learn.**
- Models (Sai's rule): Sonnet 5.5 for routine builds, Opus 5.5 for hard or security-bearing
  builds, Fable 5.2 for directing, designs and reviews (at high effort for security), Haiku for
  lookups. Spend cap for the resumed build: 1,500 euro, ledger in `designs/spend-ledger.md`
  (about 21 of the 1,200 open to agents was used).
- At most three builders at once on one machine. A builder runs only its own tests and merges
  this branch into its own before reporting. Stop a builder once its work is merged.
- Every security-bearing record gets an independent review with runtime probes before it
  merges. The reviews found real blockers in most of them, so do not skip this.
- e2e: every stack running at the same time needs its own `NAPKIN_E2E_PORT`,
  `NAPKIN_E2E_ROSTER_PORT`, `NAPKIN_E2E_MW_PORT` and `NAPKIN_E2E_RELAY_PORT`. Run long suites in
  short sets on a fresh stack. Six workers is a smoke run, not a gate: re-run a failure alone
  before it counts.
- Never verify in a builder's worktree while the builder is still testing.
- After a merge that touches Rust, run `cargo fmt --check`. After one that touches the shared
  edit path, run `j001-p2-j001-phase2-suite.spec.ts` at both widths. Run `npm run build` in
  `app/` before the frontend suite (one test reads `app/dist/sw.js`).
- Delete a record's worktree `target/` once it merges (they reached 150 GB).

**Rules that do not bend.** No paid or model call in a test. No `.env` read. Cannes Lions, Effie
and WARC material is never opened. No `terraform apply`, no production deploy, no `--no-verify`,
no bypass variable, no attribution line in a commit (the commit-msg hook refuses it). No push to
`develop` or `main`.

## 6. The build machine, and what lives only there

Linux aarch64, user `napkin`, repo at `~/napkin/napkin-fabletest`, builder worktrees beside it
as `~/napkin/napkin-b-*`. Installed: Rust stable with rustfmt, clippy and the wasm32 target;
Node 22 through nvm; uv 0.13; Playwright's own Chromium; gitleaks 8.30.1 and terraform 1.17.2 in
`~/bin` (put `~/bin` on `PATH`; terraform is for `fmt` and `validate` only); docker. No sudo.

Only on that machine, and not needed to carry on from origin:
- `~/napkin-share/`: the designs (now copied to `docs/build-handoff/designs/`), a design pack and
  a clickable prototype made for Shrey, and scratch benches under `work/`.
- `feat/align-confidential-prices` (section 4).
- Reviewers' throwaway worktrees under `/tmp/review-*` and three detached ones (`napkin-judge64`,
  `napkin-slow-server`, `napkin-snapshot`). They hold uncommitted probe tests only. Every finding
  from them is in the log. They can be removed.
- The other 29 local branches. All are merged here, so they can be deleted.
