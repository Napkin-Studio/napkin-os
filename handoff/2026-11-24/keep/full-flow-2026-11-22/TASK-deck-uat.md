# UAT deck round: Hollow Oak "Still" campaign deck on UAT (2026-11-23)

You are the only agent. No sub-agents. Don't edit, commit or push code. Don't redeploy anything. Never use the
Claude in Chrome extension.

## Goal
The last leg of the full flow, now on UAT itself: from the existing Hollow Oak "Still" Production project, make a
campaign deck with Deck Maker through the prod→deck spin-off, and export it. UAT now runs develop with Deck Maker
installed and the deck engine beside the middleware (features/deck-cloud.clan). Visuals only: no film in the deck.

## Steps
1. Sign in as mock@napkin. Open the Hollow Oak "Still" Production project (/production/); create no new project.
2. Tidy the finals:
   - Un-mark Final on the OLD key visual v2 (asset sha256 84ab8768…, 928x522) and on its two old crops (3b994319…, 451c0c77…).
     That un-mark from the image editor was a bug, now fixed (PR #269), so it must stick. Check it stuck by reloading.
   - Final must remain on: the whole-can key visual ccc8f864… (1365x768), its OOH sizes (48-sheet, 96-sheet, 6-sheet,
     uk-d6), the 4 storyboard frames, the packshot and the mood frame.
   - Use the new rights menu to set rights "Generated" where a final shows "Rights?". Leave the one uploaded picture
     as "Don't know yet" (the deck must show it as "Rights to supply").
3. "New deck from this project" (or Continue in → Deck Maker) → Deck Maker opens with the Production project carried.
   Check the deck sees the brief's real objectives and research (not "No research brought in").
4. Build the deck LIVE through the three gates (storyline, territories, idea). Read each gate and approve. Change one
   thing at one gate (Edit / Ask to try again) and note what happens.
5. When built: review screen (thumbnails?), then export PPTX and PDF (the PDF is printed from the web deck by napkin-web).
   Download both into your output folder.
6. Check in the deck:
   - the whole-can key visual is on the cover and idea slides;
   - the OOH sizes sit in billboard/poster frames;
   - the storyboard strip shows the 4 frames;
   - the packshot is real;
   - no repeated key visual in wrong slots;
   - no "~~", no "field is null", no "(to confirm)" leaks in titles;
   - the upload, if used, is labelled "Rights to supply";
   - no film.

## Where / tools
- UAT: http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com (http). Sign in: POST /api/auth/sign-in
  {"user":"mock","agency":"napkin"}, or type mock@napkin in input[placeholder="name@agency"].
- Driver: copy /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/drv/driver.mjs (set OUT to your folder),
  run from /home/batunii/Documents/Code/napkin-wt-territory-plan/app (it has node_modules with @playwright/test).
  Headless Chromium 1440x900.
- Middleware logs (read-only, if something fails): `AWS_PROFILE=napkin aws logs filter-log-events --region eu-west-1
  --log-group-name /napkin/napkin-uat/middleware --start-time <ms>` and the deck container's group /napkin/napkin-uat/deck.

## Money
- Claude via Bedrock: deck run capped by the engine at $2.00 a run. Allow at most 2 runs ($4).
- No Runway/provider calls (no picture generation). If a step would make a picture, don't.
- Provider ledger: `cd /home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/tools && AWS_PROFILE=napkin python3 jobs.py <ISO start>`.

## Output: /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/deck-uat/
- shots/NNN-step.png for every step
- the exported PPTX and PDF
- slides/ (an image of every slide) and deck-sheet.png (contact sheet)
- report.md: per step worked or broke; bugs S1-S4 with steps, screenshot and suspected file (read-only look at
  /home/batunii/Documents/Code/napkin-wt-develop-tf, a clean develop checkout); spend; a frank judgement of the deck.
If a file write is refused, put the content in your final message. Stop the driver and browser at the end.
