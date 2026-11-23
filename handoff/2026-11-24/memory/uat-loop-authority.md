---
name: uat-loop-authority
description: "Owner decisions 2026-11-12 for the continuous UAT test-fix loop (merge power, spend, consent, driver, AWS watching)"
metadata:
  node_type: memory
  type: project
  originSessionId: 0319b040-afe9-4a0c-af55-88a0e12450dd
  modified: 2026-11-12T17:02:07.188Z
---

Shrey asked (2026-11-12) for a standing loop: full UAT pass on napkin-uat → fix every bug → push → redeploy UAT → retest, forever.

Owner answers:
- **Merge power:** I may squash-merge fix PRs into `develop` once CI is green, then run Deploy → uat from develop and retest. main/staging/production untouched.
- **Driver:** both a Playwright UAT suite in the repo and /loop in-session with Chrome for exploratory clicking.
- **Spend:** no limit on Research/Brief runs, but report the count each round.
- **Beta notice:** may click "I understand" for mock UAT accounts (plu@pluto etc.).
- **Watch AWS live:** while a run is in flight, watch ECS/CloudWatch for napkin-uat to tell working from hung; treat hangs and slowness (frontend, backend, harness, workflow) as bugs to fix.

- **Design approved** (features/uat-loop.clan) with addition: insufficient backend logging is itself a bug; every job for every user must be traceable to the minutest step with the correct error.
- **Fix gate:** loop fix records may carry standing approval ("Shrey, standing UAT-loop approval 2026-11-12") if they change no contract, no infra, no screen look; otherwise stop for him.
- **Aurora cold start:** no infra change; show a "waking up" state in the UI.
- Live job visibility today: curl sign-in as ann@napkin on UAT, then GET /api/dogfood/runlog?job=<id> (jobs listed in /api/dogfood/export). Middleware CloudWatch is empty until the stdout events land.

- **Round 1 contract decisions (2026-11-12):** all-stages-failed run ends `failed` (no-halt stays for runs that can still produce something); no-progress 10 min fails the job; deploy-killed jobs → UI says "interrupted, run again" (no drain/durable store yet); server-composed document page: design it for approval.

- **Queued after bug fixes (2026-11-12):** smooth appear/disappear motion everywhere (Brief Maker block moves, tool panels). Look change → own record + clickable mock approved first ([[verify-ui-before-handoff]], [[build-matches-mock]]).

- **Round 4 decisions (2026-11-12):** Research questions get a plain "Skip this one" (like Brief's); Continue in → Link to existing may list any client's briefs (keep); archived clients' work stays on the desk counts/lists (keep).

- **Link → redraft (2026-11-12, approved):** after a research is linked into a brief, a side-panel notice ("Research linked: <name>, N facts, M findings came in") with one button running the existing Draft it again (same Agents screen, one press, keeps edits) + "Not now". No new progress UI; rewriting with research IS the brief redraft. Mock ~/Documents/napkin-design-mocks/brief-research-linked-v1.html.

- **Superseded later on 2026-11-12:** Draft it again / research rewrite now runs IN PLACE (sweep on every part, agent in side panel, current parts + authorship to the Brief agent; PR #210), not the Agents screen. Link menu: this client first, search, "all clients" (PR #209).
- **UAT resources (2026-11-12):** no more CPU for UAT web (web_cpu stays 256); fix slowness in code, not by sizing.
- **engineer@napkin (Shrey's own account) may be used on UAT for People-admin checks** (add a test person, sign in as them, remove). Only that account, only for that; everything else stays on mock accounts.

**Why:** the owner wants the test-fix cycle to keep running without them.
**How to apply:** don't ask per-round for merge/deploy-UAT; still never touch main/staging/prod deploys or terraform apply. Related: [[uat-environment]] [[build-speed-rules]] [[keep-merged-branches]].
