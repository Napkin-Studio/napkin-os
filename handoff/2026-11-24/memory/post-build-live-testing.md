---
name: post-build-live-testing
description: "After ANY tool build (Production, Territories, Deck, Brand Clan…) and BEFORE handing the owner a local stack, agents click through it live end to end against the real backend, then fix what they find"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67
  modified: 2026-11-17T21:02:23.900Z
---

When a build is done, run agent-driven local testing before calling it finished: agents make real projects on a local live stack (real Runway + director), drive the UI in the real Chrome via the Claude in Chrome extension (Playwright for scale), check what the backend actually did (job records, outputs, saved document), list every bug, then fix them and re-test.

**Why:** Shrey asked for this on 2026-11-18 for the Production Tool new-UI build; green unit tests and mock screenshots have repeatedly missed real breakage (live QA of the image editor found 25 broken/partial controls).

**Missed again 2026-11-23:** Territories was handed to the owner on a local stack tested only against fakes; the owner hit two dead ends in minutes (no way to start the first run; look-ups disabled with no path forward) and said "What kind of tool is this, where UI doesnt interact with the backend". Every tool, every hand-off: a live click-through first.

**How to apply:** use a separate test stack on spare ports (never the owner's 8091/8788/8797, not the demo 8191/8888 the owner uses), a copy of projects, never Shrey's own; name the expected spend up front and set the stack's spend stop; report counts works/partly/broken with job ids and screenshots; fixes go through the feature record. Related: [[verify-ui-before-handoff]], [[build-matches-mock]], [[never-mock-unless-asked]], [[owner-test-builds-live]].
