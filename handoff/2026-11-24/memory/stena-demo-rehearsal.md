---
name: stena-demo-rehearsal
description: Laurence's Deloitte Digital / ACNE demo (Stena Line brief + Research) — rehearse, fix, judge until it ranks highly; brief saved in napkin-local-keep (2026-11-19)
metadata:
  type: project
---

Laurence asked (for Thursday 2026-11-19) for a full Napkin OS rehearsal for a Deloitte Digital / ACNE demo: Brief Maker produces a one-page Stena Line Summer 2027 brief (British families, Harwich–Hook of Holland), then the Research Tool answers "What would persuade a British family to choose Stena over flying…" with claim-by-claim citations, evidence types, confidence, FACT/INTERPRETATION/HYPOTHESIS/RECOMMENDATION, and QC traps (reject Rosslare–Cherbourg as live — withdrawn Sept 2025; Europe-wide preferences ≠ Stena share). Full text: ~/Documents/napkin-local-keep/stena-rehearsal/laurence-brief-2026-11-19.md. Expected-result video: https://vimeo.com/1230165402/1c10d9262e.

**Why:** Shrey: "Make the entire thing, either on UAT or local over the ACNE account. Whatever fails, we fix it. Keep building till a judge ranks it very highly, clicking on anything doesn't break anything, and it feels like the system."

**How to apply:** run on UAT as the ACNE test account (ace@acne), in a separate browser profile (never Shrey's Chrome); record screen/screenshots and timings; fix through feature records; re-run and judge against Laurence's checklist until it ranks highly. Treat the brief as illustrative, not client material — still never commit it. Related: [[post-build-live-testing]], [[blank-canvas-entry]].

Scope (Shrey, 2026-11-19): only the Brief Maker and the Research Tool. A feature Laurence asks for that isn't in those two tools, or any tool that doesn't exist, is ignored — not built, not counted as broken.

Goal refined (Shrey, 2026-11-19): ignore any feature not yet in the system, in any tool. Focus on one flow ending in a deck — Brief Maker → Research Tool → Deck Maker — shown as a system achieving that, not a set of tools. Hand-offs between tools (no retyping, claims and citations carried through, one look) are what matter most.
