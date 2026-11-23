---
name: design-before-code
description: "In napkin-studio, every feature is designed (alternatives, rework risks) and approved before any code, and tracked in features/<slug>.clan"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 6795df4e-4928-4968-8820-22f4a6239577
  modified: 2026-10-05T14:10:26.887Z
---

Before coding any feature in napkin-studio, explore the design first: prior art, two or more approaches with their build and run costs, and rework risks ("we kept redoing xyz, which made the process slower, when it could have been designed better from the start"). Get the owner's approval before writing code. Keep the feature's `features/<slug>.clan` current, so anyone can pick it up.

**Why:** AI agents write most of the code here. The user wants nothing to break, and no slow rework that a better upfront design would have avoided.
**How to apply:** follow the workflow in CLAUDE.md, using `scripts/feature` and `scripts/check.sh`. Never bypass `.githooks/pre-push`.
