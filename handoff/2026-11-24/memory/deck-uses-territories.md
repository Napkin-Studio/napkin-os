---
name: deck-uses-territories
description: Owner 2026-11-23 (for later): Deck skips its territory step when Territories is upstream; without it, Deck runs a light Territories engine (like Brief runs light Research)
metadata:
  type: project
---

Owner (Shrey), 2026-11-23: "if it has territories, it uses that and skips the step, but if it doesnt then it runs a rather smaller version of that tool - just like Brief runs a smaller version of research for its facts."

**Why:** one tool per job; no duplicate territory engines; consistent quality and rules; upgrade path from light to full.
**How to apply:** with a Territories upstream the deck uses greenlit routes, no stage-c call, gate 2 picks the lead (being built in territories-spinoff-out-deck). Without it, plan a deck change that calls engine/territory in a light mode and removes the deck's own stage c — after the deck folds into the middleware. Recorded as a pinned decision in features/territories.clan. Related: [[territories-build]], [[spinoff-carries-everything]].
