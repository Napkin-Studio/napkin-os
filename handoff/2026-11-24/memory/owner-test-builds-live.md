---
name: owner-test-builds-live
description: "When handing Shrey a build to test, run it on real backends (--live), and lead with what is NOT in it"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 7bc8bbbd-c824-44c4-8437-6b45cfd195e7
  modified: 2026-10-15T18:11:16.514Z
---

Give the owner test builds wired to the real backend: `scripts/run-production-local --live`, with Runway from `.env` and Dex/Skye on scripts/model-local under the spend stop. Never hand him a mock build to test. Mock is for agents' own smoke tests. Before he tests, say plainly at the top which decided items are not built yet.

**Why:** on 2026-10-15 a mock test build plus a blank-canvas decision that wasn't built yet made him say "AGAIN YOU DIDN'T wire to backend... What am I supposed to test here then?"

**How to apply:** start his test stack with --live (pass RUNWAY_API_KEY from the production-tool worktree's .env when the worktree has no .env). Build approved items he will look for (e.g. the blank canvas) before calling it testable, or put "not in this build" first. Related: [[local-live-relay]], [[relay-restart-inflight]].
