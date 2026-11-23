# Full flow on UAT, Hollow Oak "Still" (2026-11-22)

UAT on feat/production-spinoff b9cca83a, account mock@napkin. Written from the test agent's hand-back.

## Stage by stage
| Stage | Result |
|---|---|
| 1 Brief Maker | Worked, with bugs. Email pasted, 4 agents, 9 open questions answered, redrafted, locked (locks as v2, not v1). |
| 2 Research | Worked. 3 scoping questions, 20 sources / 46 facts / 3 findings kept, locked. Link and "Rewrite with the research" worked. |
| 3 Production | Worked. Spin-off brought the Brief node (labelled "V1 frozen copy" though the brief is v2). Key visual, crops, extend, redraw, storyboard, clips, edit, ad, 6 s cutdowns, exports, finals all worked. |
| 4 Deck | BROKE (S1). Deck Maker is not on UAT. |

## Bugs
S1 Deck leg blocked: "New deck from this project" says "Napkin could not find the saved project"; real cause is 404 from POST /api/t/{tenant}/production/{prj}/spinoff: `app not installed: app-ie.napkin.deck-maker`. Desk dial shows Deck "Soon".
- Root cause (checked after the run): the Dockerfile `device` stage packs only brief-maker, campaign-research and production into /srv/napkin/seed; deck-maker is never packed. And no deck engine runs in the cloud at all: UAT has only `web` and `middleware` services, no NAPKIN_DECK_ENGINE_URL; features/deck-maker-server.clan made deployment a non-goal.
- The wrong message comes from production-tool/web/src/projects/spinoff.ts (should say the app isn't installed).

S2
- Redraft loses answers: after linking research, "Draft it again" dropped the 9 answered open questions and asked them again. app/templates/brief-maker redraft path. Shots 017 vs 052.
- "Fix this with the agents" does nothing on the 4 Review-rejected parts (insight, proposition, reasons, barrier): click logged, no job. Shots 022-025.
- Invented text on the can ("PREMIUM DRINKING WATER", "ACCEPTABLE ALUMINIUM"): model quality; one regenerate with explicit words fixed it. Shots 070, 083.
- 9:16 crop cuts the can top and bottom (shot 085).

S3
- Production project not attached to the client (dial says Production "Nothing yet"): crates/napkin-web/src/spinoff.rs brief_to_production.
- Raw error in booth after lock: `invalid_input (400): input.verdict is not a bad verdict still standing...` (shot 032).
- Answered questions stay in the brief as "Question - Answer: ..." text.
- Resize crop waits ~30 s on "Starting..." before jobs post; new picture lands on top of an older size set.
- The 15 s ad file is 17.3 s (15 s + 2.5 s studio card).
- End card: no logo (no brand book), empty call to action, so first render had no legal line.
- Sound view loudness target, + Line, + Effect say "later version"; Script/Storyboard PDF and Fountain say "not in this version yet".
- Cut panel "Source:" line doesn't change after swapping a take (render did use the retake).
- Image editor Fill "came back unchanged" (still charged $0.08).

Agent's own slips: created a stray client "Drinks"; picked market IE so research says Ireland.
No "$" outside Decisions/History.

## Features used
- Brief Maker: paste, 4 agents, answers, Draft it again, Keep-and-say-why, Lock, Unlock, Link research, Rewrite with research worked; Fix with agents broke; Show what changed / extra lenses not tried.
- Research: Market/Brands/Consumer/Codes lenses, Keep x3, Lock.
- Canvas: Generate/again, Crop 4:5/9:16/16:9, Extend 21:9, Redraw 9:16, Name + product + other views, image with refs (packshot, mood), Board with Brand purpose, Upload, Keep a person. Sketch area not used.
- Image editor: Whole frame, Upscale 2x, Apply as new version, Final worked; Fill unchanged.
- Script: write, Plan shots, tone ask with inline diff, Why, Discard. No "draft from brief" button found.
- Storyboard: Plan shots, Draw frame 1, Draw the rest, Keep a person.
- Film room: Make clips, tray with no price, Not now, cut between shots, Veo 3.1 with sound, Camera agent retake (agent chose Veo $1.60, not cheapest).
- Edit room: Assemble, Captions, lower third, Mute, Sound view, trim, swap take, end card, Render x3. Split not tried.
- Rendered tab: Download, Make all sizes (6 s 9:16 + 1:1), Export zip, Download all media (32 files), Project as .clan.
- Finals/rights: 8 finals (kv v2, 3 crops, 4 frames) + 1 upload with rights unstated.
- Deck: unreachable on UAT. Offline `python3 -m deck.from_production` on the exported zip: 9 items offered, finals first, 8 generated/usable, the upload reference_only ("Rights to supply"); no film carried.

## Spend
- Provider: $6.67 of $25 (33 jobs, all completed). paid.log has each action.
- Claude/agents: $0.46 on Production jobs (ledger agentUsd). Brief Maker and Research agent cost not exposed in the ledger.

## Brief: bad → good
Before: "Everyone who drinks. Maybe women 25-40... or students... pub landlords"; four "Still" lines; budget "Small".
After: lead audience 25-40 rare cider drinkers; one line "Still. Hollow Oak."; proposition "the whole orchard in every glass, with nothing fizzy or heavy in the way"; barrier "Cider without bubbles sounds flat"; 30% tied to a baseline and 12 months; no apples as a hard rule; research adds GB crafted cider value +7.6%, volume -1.7%. Still carries "To confirm" tags. Full text: brief-final.txt.

## Files
- downloads/hollow-oak-still-ad-final.mp4 (17.3 s, 1280x720, sound); older renders alongside.
- downloads/hollow-oak-still_campaign.zip (6 s 9:16 + 1:1), downloads/Hollow-Oak-'Still'-media.zip, downloads/napkin-hollow-oak-still-production.zip.
- deck-local/STAND-IN-* : hand-built stand-in, NOT made by Deck Maker.
- contact-sheet.png, shots/ (205), paid.log.
