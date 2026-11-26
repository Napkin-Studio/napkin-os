# Status, 2026-11-26 18:40 (read this before README.md)

## Verdict

**The 5-tool flow works on UAT** (develop 7871d97a, ECS web and middleware :83, relay live alias v35). It was proven across two clients, each with two Brand Clans:
- Track A: Brúach Kombucha, report in scratchpad uat5a/.
- Track B: Sólás Lights, reports in uat5b/, uat5b2/ and uat5b3/.

**One blocker is left:** a deck made with Continue in from a **Production** project has no Brand Clan logo on its cover (deck doc-ie-napkin-deck-maker-27cb410a). From a brief it works.
- It's being fixed on `fix/deck-production-logo`. The agent also takes:
  - the finals count needing a reload after Update;
  - the PDF title falling back to DejaVu when the Brand Clan face is missing;
  - a deck that dead-ends when its type changes after the first build.

## Where things are

- **On develop:** all 5 tools, Production as a CLAN app, Brand Clan phase 2, the beat editor, and every fix #336–#376 except #370.
- **Infra:** hackathon and UAT are both applied; nothing is pending.
- **HELD, do not merge: #370.** Shrey's rule: Confidential = kept out of Napkin RAG/layers/training only; Bedrock and Runway may take it. The Confidential mark still writes licence `{model:false, corpus:false}`, and the Brief engine, the deck and the middleware honour model:false. This needs ONE design record approved by Shrey: what the mark writes, whether "never to any model" stays as a separate option, every reader, and existing documents.

## Next steps

1. When the `fix/deck-production-logo` PR is green:
   - merge it with scratchpad merge-queue2.sh (or `gh pr merge --squash`);
   - deploy UAT: `gh workflow run deploy.yml --ref develop -f environment=uat -f ref=<FULL 40-char develop sha>`;
   - check ECS for a new revision with rollout COMPLETED and the image tag equal to that sha;
   - re-check one Continue-in-from-Production deck cover on UAT for the logo.
2. **Staging release** (develop → main, merge commit, PR title `release: …`):
   - infra/ changed since main, so first run `terraform plan` in infra/envs/staging (AWS_PROFILE=napkin);
   - it needs the staging relay values; staging web has no relay settings today;
   - Shrey applies, then deploy, then verify in AWS;
   - never trigger production.
3. **Minors for a later round:**
   - A frame held for a person shows "Needs you" with no reason and no action.
   - "A weekend with it" shows sketches, not the made frames.
   - Production route nodes hide frames below the fold.
   - Version labels after a re-theme ("built with v2" vs "v1 · changed").
   - A Continue in menu was empty until a reload.
   - A second deck tab showed "sandbox token expired".
   - `?open=` lands on All projects.
   - The Film node shows "Clips 0 of 7" with a take in the Bin.
   - The legal line "from the brief" is reasoning, not a legal line.
   - A 2 s Veo box is billed as 4 s.
   - "What arrived" shows Draft for 5–10 s.
   - The first Lock click returns 409.
   - Research's category guess for kombucha.
   - The insight judge passed 0 of 3.
   - Accented names are garbled in the media zip.
   - The Territories picture ledger shows $0.
   - The Brand Clan dropdown ignores Escape.
   - "Make it" is disabled without a reason.
   - A Plan shots click is dropped while the planner is busy.
4. **Owner decisions taken 2026-11-26** (all recorded in the feature records):
   - Update refreshes the direct parent (#363).
   - "The Work" picking finals from every route is parked with the multi-route deck.
   - Brand Clan: fall back by order now (#368); a role picker mock later.
   - Confidential (above).
   - Picture check: hard rules only (#374).
   - Territories on UAT: EFS store, pictures on at $2 per document.
   - Frames are stored by the host as linked assets (#355).
