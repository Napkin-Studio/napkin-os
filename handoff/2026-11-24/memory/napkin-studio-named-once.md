---
name: napkin-studio-named-once
description: "Wherever the studio is Napkin itself (Napkin accounts, no agency, desktop, local), show \"Napkin Studio\" once — never a placeholder or a second line"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0319b040-afe9-4a0c-af55-88a0e12450dd
  modified: 2026-11-12T08:56:56.323Z
---

When the agency is Napkin, or there is no agency at all (anonymous, desktop, a local or test server), the agency pill and any similar label say **"Napkin Studio" once**. Never "Napkin" over "Napkin Studio", never a placeholder like "Your studio" over "Napkin Studio".

**Why:** Shrey corrected this twice: 2026-11-11 ("just Napkin Studio, not Napkin twice") and 2026-11-12 on a local-stack screenshot showing "Your studio / NAPKIN STUDIO" (PR #180). He also circled an empty gap between two divider rules where a missing client chip would go.

**How to apply:** when reviewing screenshots (mine or an agent's), check the top-left pill and the bar for doubled names, placeholder names and rules framing empty space; treat them as bugs. Related: [[build-matches-mock]], [[uat-loop-authority]].
