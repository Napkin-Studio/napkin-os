---
name: production-refs-and-studio-card
description: "Owner rules 2026-11-23 for Production jobs - refs and brief only when linked, \"no real faces\" = unrecognisable, no studio card on client ads"
metadata:
  node_type: memory
  type: project
  originSessionId: 5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67
  modified: 2026-11-23T10:23:30.778Z
---

Owner decisions (2026-11-23, after the Ferncliff UAT run where frames ignored the named can and the ad ran 17.4 s):
- A named product picture (@name) reaches a frame/clip **only when linked** into the script/storyboard/video scope. Never auto-required. Fix = make linking obvious, not change the rule.
- A project's Brief node feeds Production jobs **only when linked**. No implicit brief feed.
- A brief's "no real faces" means **unrecognisable only**: people may appear (crowds, from behind, blurred, hands) but no one identifiable.
- Client ads **never carry the "Napkin Studio" studio card** (it made a 15 s ad render at 17.4 s).

**Why:** owner wants explicit links as the contract, not hidden inference; studio branding does not belong in client deliverables.
**How to apply:** don't propose auto-linking refs/brief again; the end card legal line still needs its own field ([[uat-loop-production-2026-11-21]]). Diagnosis: napkin-local-keep/full-flow-2026-11-24/diagnosis-ad.md.
