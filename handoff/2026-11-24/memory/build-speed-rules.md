---
name: build-speed-rules
description: "How builds run fast: no hand-run full check before a push, at most two build agents, small fixes done directly"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3d71f1a1-d9ea-4ce6-a4cf-d0a3ceb37045
  modified: 2026-10-21T15:23:28.743Z
---

Owner decision, Shrey 2026-10-16 ("go ahead with A, C, D, E" after asking why builds take an hour and why checks run twice):
- **A.** Agents do not run the full `scripts/check.sh` by hand before pushing. While building they run only the tests for what they touched; the push's pre-push hook runs the full check once, and its pass is what `scripts/feature checked` records.
- **E.** At most two build agents run at a time (load average 13–14 with four made every check slow and the perf test flaky).
- Small fixes (a CSS clash, a one-file bug) are done directly in the session, not delegated.
- Agents report in stages: merge into the owner's test build as soon as browser checks pass.

**Why:** each build took about an hour: the full check ran twice (by hand, then again in the hook) on unchanged code, under load from 3–4 parallel agents, plus flaky-test retries.

**How to apply:** put "do not run scripts/check.sh by hand; the push runs it" and the two-agent limit in every build agent's brief. That includes the whole suites run one by one: never brief "run lint, vitest and build:web" or "run relay pytest" in full. Brief "run the tests for the files you changed (named files), lint and typecheck on them". Shrey asked again on 2026-10-21 why checks ran twice; it was my briefs asking for the full suites. The browser click-through on a copy stays ([[verify-ui-before-handoff]]). C (parallel suites in check.sh) and D (perf test quarantined) are in the code. Related: [[owner-test-builds-live]], [[clean-up-worktrees]].

Third time on 2026-11-09 (new-ui rebuild): my briefs again said "run scripts/check.sh --only frontend and the full e2e" after every round, and Shrey asked "any chance you are running the harness checks twice? I need this fast". Before sending any build brief, check that it has no check.sh and no full e2e line.

Fourth time, 2026-11-11: I briefed builders to run "one full node tests/run.mjs at the end"; Shrey: "make sure you are not running the tests twice, as it will run with push anyways." The full unit suite counts as a full run too. Briefs say: only the test files for what changed; no full suite, no check.sh, no e2e.

Fifth time, 2026-11-18 (new-ui P4–P6): a builder ran the full vitest suite by hand after a rename, and my brief said "push often" (to survive worktree removal), which re-runs the full frontend suite + e2e in the hook on every push. Commits survive worktree removal (the branch lives in the shared repo), so briefs say: commit locally often, push once per phase. Every build brief must carry, verbatim: "Run only the test files for what you changed; no check.sh, no full unit suite, no full e2e, no build:web by hand. Push once per phase."
