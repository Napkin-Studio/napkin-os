---
name: production-on-relay-question
description: Owner (2026-11-23) is not sure why Production Tool projects live in the relay (S3) rather than the OS library; to be discussed later before building on it
metadata:
  type: project
---

2026-11-23, while fixing "Production projects aren't listed under their client" (uat-flow-fixes item 6): Shrey said "I am still not sure why Production lives on relay. We will need to discuss this later."

**Why:** the relay-hosted projects (S3 via the hackathon relay, bridged by napkin-web production.rs) cause seams: no client listing, separate asset store vs the workspace blob store (spinoff-asset-links), export/import re-homing, separate deploys.
**How to apply:** don't build further features that deepen the relay-as-store choice (e.g. client lists on the relay) without raising this; when it comes up, bring the trade-offs (production-spinoff design approach B "DocStore migration" was rejected earlier for cost) so the owner can decide. Related: [[production-tool-overhaul]], [[spinoff-carries-everything]].

Update 2026-11-23: owner: "This should be just another clan app right? So it should work like one as well?" → asked for a design. Record `production-as-clan-app` (branch feat/production-as-clan-app) being designed: doc into the OS library, UI in the shell, work via middleware, relay shrinks to provider/media service; fresh start vs migration is the owner's call. Territories → Production held until it lands.

Priority (owner 2026-11-23): 1) Production as a CLAN app, 2) Territories, 3) Brand Clan — all three reach UAT only AFTER the 4-tool flow (Brief→Research→Production→Deck) passes on UAT. Status that day: stage 0+1 in develop (#277) and on UAT; stage 2 built (feat/pc-page, PR); stage 3 (jobs via host) next; follow-ups: ajv precompile before CSP enforce, delete relay 410 stubs one release after stage 1.
Stage 3 uploads (owner 2026-11-23, agreed): the browser uploads bytes straight to S3 with short-lived single-use presigned links from napkin-web; the Production page CSP connect-src names the upload (S3) origin as well as the media base. Apply when merging lanes E1+E2 (adjust the S3-1 test accordingly).
