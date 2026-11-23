---
name: spinoff-carries-everything
description: Owner rule (2026-11-23): a spin-off carries the whole upstream doc except heavy media; Production's Brief node uses only the spine; deck reads the full brief from upstream
metadata:
  type: project
---

Owner (Shrey), 2026-11-23: "spinoff carries everything to the next doc except the heavy media. So production should have had everything brief has, but when adding a brief node, that should only carry the spine ... and power the next steps. Which would make it easy for deck to extract the correct information from brief."

**Why:** the deck's objectives slide said "field is null" because Production only carried the briefSpine (no objectives); downstream tools must read the full upstream, not a summary.
**How to apply:** any tool-to-tool hand-off (Brief/Research → Production → Deck, Territories in/out) carries the full upstream document data (fields, decisions, asset links not bytes); summaries like the spine are for the receiving tool's own steps only. Related: [[production-tool-overhaul]], [[territories-build]].
