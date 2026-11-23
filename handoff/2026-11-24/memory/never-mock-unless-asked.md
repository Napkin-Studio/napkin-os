---
name: never-mock-unless-asked
description: "When running the Production Tool locally for the owner, always start the live stack (real director + Runway); never a mock unless explicitly asked"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9571cd9f-15f0-4344-9a2e-3c237923fedc
  modified: 2026-11-02T13:54:24.596Z
---

When asked to "run the tool locally", start it live: real Runway (RUNWAY_API_KEY from the worktree-root `.env`), the real director via `scripts/model-local` (`eval "$(scripts/model-local env --sh)"`), and a config copy with capUsd 50 / warnUsd 40. Never run the passthrough director or the mock provider unless the owner asks.

**Why:** 2026-11-02 I started the relay bare (no model, no Runway key) and the owner got a dead AI director; they were very frustrated ("PLEASE for the love of god dont mock it UNLESS I ASK").
**How to apply:** use non-8091/8788 ports for agent-run stacks (e.g. relay 8791, vite 5191), say plainly that clicks cost money, and watch the relay startup log for "no model configured" / "provider runway is off", which mean it is NOT live. Never `pkill -f` a pattern that appears in your own command line. Related: [[local-live-relay]], [[owner-test-builds-live]].
