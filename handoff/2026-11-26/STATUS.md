# Status, 2026-11-26 15:35 (read this before README.md)

README.md is from 04:00 and partly out of date. This file is the current state.

## Where things are

- **On develop:** all 5 tools (Research, Brief, Territories #352, Production as a CLAN app #281/#292/#304, Deck), Brand Clan phase 2 (#318) and the beat editor (#345). Plus every fix from #336 to #371, and #364.
- **Infra:**
  - Hackathon: applied (SERVICE_KEY secret set; relay live alias **v35**).
  - UAT: applied (web:79+ SERVICE_KEY/UPLOAD_ORIGIN; middleware Territories EFS, pictures on, $2 per document).
  - **No infra change is pending.**
- **UAT runs develop ec9dbf1c** (ECS web and middleware :82).
- **Merge queue** (scratchpad merge-queue2.sh, one at a time):
  - **#372:** Stage 3 closed-tab job landing; the outcome carries projectId/purpose/node.
  - **#373:** the deck engine's per-document index current.json survives restarts.
  - **#374:** the picture check keeps hard rules only; the word list is dropped (Shrey's decision).
- **Being built:** the deck engine allows one build per document but several decks at once, with a visible queue (UAT track B blocker 4).
- **HELD, do not merge: #370** (the deck drops its Confidential holds). Shrey's rule is "Confidential = only kept out of Napkin RAG/layers/training; Bedrock AND Runway may take it". The Confidential mark today writes licence `{model:false, corpus:false}`, and several readers honour model:false (the Brief engine, the deck, the middleware). That needs ONE design record, approved by Shrey, before it's changed everywhere. #369 (merged) already lifted it for Territories pictures.

## Next steps

1. When #372, #373 and #374 have merged:
   `gh workflow run deploy.yml --ref develop -f environment=uat -f ref=<FULL develop sha>`.
   The ref must be the full 40-character sha; a short sha fails at checkout.
   Then check that ECS web and middleware are on the new revision with rollout COMPLETED.
2. **UAT test track A** (main flow, client "Brúach Kombucha"): done through Research → Brief → Territories → Production (3 routes, clips, end cards, renders) → Deck gates 1–3.
   - Still to do: deck export, then add a final and press Update from Production (#363).
   - Its report: scratchpad uat5a/.
3. **UAT test track B round 3** (client "Sólás Lights", invented brand), after the deploy. Re-test:
   - Territories frames: 4 of 4 on a real brief, refusals shown with Try again;
   - frames on Production's route nodes;
   - a closed-tab clip landing;
   - a new deck wearing the Brand Clan (navy #14233F / brass #E0B040, Georgia, logo) and Update look;
   - deck export after a restart.
   Round 2 report: scratchpad uat5b2/report.md.
4. **Minors** for a later fix round:
   - Production route node hides frames below its fold.
   - The Film node shows "Clips 0 of 7 ready" with a take in the Bin.
   - The legal line "from the brief" is reasoning, not a legal line.
   - A 2 s Veo box is billed as 4 s.
   - "What arrived" shows Draft for 5–10 s.
   - The first Lock click returns 409.
   - Research's category guess for kombucha is wrong.
   - The insight judge passed 0 of 3.
   - Accented names are garbled in the media zip.
   - The Territories picture ledger shows $0.
   - The Brand Clan dropdown ignores Escape.
   - "Make it" is disabled without a reason.
   - A Plan shots click is dropped while the planner is busy.
5. **Owner decisions already taken today**, recorded in the feature records:
   - Update refreshes the direct parent (#363).
   - "The Work" picking finals from every route is parked with the multi-route deck.
   - Brand Clan: fall back by order now (#368); a role picker mock later.
   - Confidential (see above).
   - Picture check: hard rules only (#374).
6. **Then:** the staging release (develop → main). infra/ changed since main, so plan staging first and Shrey applies. Production stays manual.
