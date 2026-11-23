---
name: own-engine-default
description: "Owner decision 2026-11-16 — the Production Tool's own canvas engine is THE default; Excalidraw is fallback only; landing on develop goes with it"
metadata:
  node_type: memory
  type: project
  originSessionId: 5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67
  modified: 2026-11-16T09:50:53.706Z
---

On 2026-11-16 Shrey said: "Our own engine is what we are going ahead with anyways. That's the default now."

- The own canvas engine (`production-tool/web/src/canvas/adapter/own`) is the default, not a flag-gated option. Excalidraw is only a fallback (`?engine=excalidraw`) until the canvas-engine cutover removes it.
- The Production Tool reaches develop from `feat/art-director` (the newest line, incl. the 4 Nov script-editor + full-test fixes committed as b2632e15 on 2026-11-16), with the own engine as default. `tool-unblock`'s uncommitted 22 Oct Phase 0 fixes are parked for a follow-up.
- New Production Tool work is built and checked on the own engine; don't add Excalidraw-only paths.

**Why:** the owner tested art-director on Excalidraw on 2026-11-03 and said the changes must sit on the own engine.
**How to apply:** design and verify canvas features on the own engine; treat Excalidraw gaps (e.g. Make all sizes) as won't-fix. Related: [[production-tool-overhaul]], [[design-before-code]], [[verify-ui-before-handoff]].
