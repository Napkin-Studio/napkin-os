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
