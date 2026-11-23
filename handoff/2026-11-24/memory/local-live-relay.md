---
name: local-live-relay
description: "How the owner's local Production Tool stack runs on real models (Runway + the model-local backend), with a $50 spend stop"
metadata:
  node_type: memory
  type: project
  originSessionId: 7bc8bbbd-c824-44c4-8437-6b45cfd195e7
  modified: 2026-10-14T23:20:32.249Z
---

2026-11-22: the owner had this stack stopped and its make-and-edit worktree removed (branch feat/art-director kept); it is not running unless restarted.

Since 2026-10-15 the owner's local stack (napkin-web on 127.0.0.1:8091, relay on 8788) runs on REAL models when started with scratchpad `live/run-relay-live.sh`: Runway via RUNWAY_API_KEY read from the gitignored `.env` at the napkin-studio-production-tool worktree root (never print or commit it); Dex/Skye/cards through the one local model backend (scripts/model-local on 127.0.0.1:8797, claude -p on the owner's login; features/model-mock.clan; the old claude-cli mode is removed); hard spend stop capUsd 50 / warn 40 in `live/config.local-live.json`. The owner chose these.

**Why:** the owner wants to try the tool against real backends, not the mock.
**How to apply:** clicks in the tool now cost money: never trigger paid Runway/ElevenLabs calls (agents, smoke tests) without saying so first; agent smoke tests must use their own mock stack on other ports, never 8091/8788. Related: [[production-tool-providers]], [[clean-up-worktrees]].
