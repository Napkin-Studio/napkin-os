---
name: verify-ui-before-handoff
description: "Production Tool UI changes need an approved clickable mock first, real-store tests, and a click-through on a copy before telling Shrey it works"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3d71f1a1-d9ea-4ce6-a4cf-d0a3ceb37045
  modified: 2026-10-19T22:56:18.708Z
---

On 2026-10-19 the connected-video build went through four timeline layouts in one day (chips, strips, rows, one track). Each was built from a text description, without a mock-up Shrey approved. Shrey then hit, one after another: joins and notes refused by the store, the end card dropped from the render, and the player playing stale takes. He called the tool "a mess".

**Why:** the tests ran against SnapshotDocumentStore, which never refuses a write. Headless checks also saved into Shrey's live project while he had it open. Several features were reported as working when nobody had clicked through them.

**How to apply:**
- For any new or changed screen, show a clickable mock-up with fake data on the design canvas first and build only after approval ([[design-before-code]]).
- Test document writes through the real CLAN store (`modelStore()` in web/src/test/model.ts).
- Click through every flow in a browser on a copy of the project or a mock stack, never his live project, before saying it works ([[owner-test-builds-live]]).
- When something breaks, step back and fix the model behind it, not only the symptom he hit.
