# Deck leg, locally: Hollow Oak "Still" campaign deck from the Production project (2026-11-22)

You are the only agent. Do NOT start sub-agents. Don't edit, commit or push code. Never use the
Claude in Chrome extension.

## Why local
The UAT run (report: /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/report.md) made the
brief, research, pictures and the ad, but Deck Maker isn't deployed on UAT (no deck engine in the cloud yet).
So finish the last leg on a local stack, from the same project, with the REAL deck engine (live, not replay).

## Goal
A good campaign deck for Hollow Oak "Still", made by Deck Maker via the prod→deck spin-off
("New deck from this project" in Production), using the Production finals as visuals. VISUALS ONLY: no
film/video in the deck (owner's decision). Then exercise every Deck Maker feature: deck type, size, look,
the storyline / territories / idea gates (read, change one thing, approve), picking and reordering
pictures, any rewrite/ask-a-change control, rebuild, export PPTX and PDF. Check: finals first; rights
labels (8 generated finals usable; the one upload with rights unstated must show "Rights to supply");
pictures actually render on slides (fetched by link through the assets pass, not embedded).

## Inputs (from UAT)
- Production project export: downloads/napkin-hollow-oak-still-production.zip (33 files, has the media).
  Import it in the local Production with the doc menu "Open a .clan file…" (it says "A .clan or an Export
  zip becomes a new project"). Then set rights/finals again if the import lost them (8 finals: key visual v2,
  3 crops, 4 storyboard frames = generated; 1 upload left unstated).
- The brief: brief-final.txt (the locked UAT brief, v2). If the deck lacks the strategy, give it the brief:
  best via a local Brief Maker document → Continue in Production / the deck's upstream; else paste it as the
  deck prompt. Say in the report which way you used.
All paths relative to /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/.

## Local stack (ports 18xxx only; never 8091/8788/8797/8191/8888/8897)
Template: /tmp/claude-1000/-home-batunii-Documents-Code-napkin-studio-production-tool/5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67/scratchpad/ps/up.sh
(and down.sh). It was used for the earlier local spin-off test and runs relay 18788, deck engine 18793,
middleware 18795, napkin-web 18090 with a roster (ann@napkin etc.), the seed folder (has deck-maker.app.clan),
built app/dist and production-tool/web/dist, and target/debug/napkin-web, all from
/home/batunii/Documents/Code/napkin-wt-prod-spinoff at b9cca83a (the same code as UAT).
Copy it to your own folder (deck-local/stack/) and change it:
- LIVE deck engine: drop NAPKIN_DECK_REPLAY, set NAPKIN_DECK_LIVE=1, NAPKIN_DECK_MAX_USD=3.00, and
  BRIEF_CLAUDE_TRANSPORT=cli (the Claude Code login; don't strip what the cli transport needs). Read
  scripts/deck-local.sh and engine/deck/server.py for the exact variables.
- Fresh data dirs under deck-local/stack/ (not the old scratchpad ones).
- No provider keys (no Runway); the relay must not make pictures. The deck only reads pictures.
Stop the stack (all its processes) when done.

## Tools
Playwright headless Chromium, 1440x900, run from /home/batunii/Documents/Code/napkin-wt-prod-spinoff/app.
Reusable driver: /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/drv/driver.mjs (copy it,
change BASE to http://127.0.0.1:18090).

## Money
Live deck runs are paid Claude calls (~$0.65-1.25 a deck per the script). Cap: $6 total for this leg
(at most ~4 full builds). Record each build's cost (engine status / run status reports usd) in
deck-local/paid.log.

## Output (folder /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/deck-local/)
- shots/NNN-step.png for every step; every slide of the final deck as an image (slides-final/).
- Exports: hollow-oak-still-deck.pptx and .pdf.
- deck-report.md: features worked / broke / not found; bugs S1-S4 with steps, screenshot, suspected file;
  spend; your honest judgement (would a client accept this deck? what's weak?).
- deck-sheet.png contact sheet of the final slides.
If the harness refuses a file write, put the content in your final message instead.
Final message: stage results, S1/S2 bugs with files, spend, paths to the deck and the sheet.
