# Final four-tool run on UAT, fresh brand (Harrowgate): bad brief → client-ready campaign deck

You are the only agent. No sub-agents. Don't edit, commit or push code. Don't redeploy anything. Never use the
Claude in Chrome extension.

## Goal
The owner's gate: Territories goes to UAT only after this flow passes end to end. Run it as a planner would,
on UAT, with a NEW fictional brand (bad-brief-harrowgate.md), and judge it honestly. Every step that a fix
claimed to cure is checked, with a screenshot.

1. Brief Maker: paste the bad brief, let the agents challenge it, answer the open questions as a sensible
   planner (keep them consistent: one line "Proper crunch.", logo top left, the legal line exact), redraft
   (answers KEPT), "Fix this with the agents" on any part Review rejects, lock.
2. Research: Continue in → Research, run it, keep the good findings, lock. Link research into the brief,
   rewrite, lock.
3. Production (now a library app — Production Stage 1 is on UAT; check it):
   - Continue in → Production. The project appears in the library (shell) with the client; it opens from there.
   - Library checks: rename it, reload within a second (the name and an edit survive); open the same project
     in a second tab, edit in both (the second save gets the conflict box and overwrites nothing); delete a
     throwaway Production project → it is in Trash → restore it. `/production/` with no document shows the
     library list, not an "Untitled project".
   - LINK the bag picture (@name) and the Brief node into the Script, Storyboard and Video scope by hand
     (owner rule: they reach jobs only when linked). Screenshot the links.
   - Key visual (4:5): the bag is the hero and whole, bag text reads only "HARROWGATE OVEN CRISPS" or similar,
     no recognisable faces, no alcohol. Regenerate once if wrong.
   - Make all sizes: social (9:16, 4:5) AND out of home (48-sheet, 96-sheet, 6-sheet, a digital size).
   - A 15 s ad: script → plan shots → storyboard frames → one clip (cheapest working model) → edit → render.
     Checks: the storyboard frames show THE named bag (not a generic one); people, if any, are unrecognisable;
     the end card headline is the line (not stage directions) and carries the legal line; the rendered ad is
     15 s (no Napkin Studio card appended). Download it and measure its length (ffprobe).
   - Mark finals with rights (Generated for made pictures).
4. Deck: "New deck from this project", through the gates. Check:
   - pictures in the app's Review AND Present views, the PPTX (count ppt/media) and the PDF (count images);
   - the key visual, OOH sizes in billboard/poster frames, the storyboard strip with the right frame count;
   - no "Flagged", no red outlines, no clipped or overlapping labels, no title running into body text,
     no headline covering the bag on the cover/idea slides;
   - no film slide; no DRAFT / CHECK FAILED / "[Agency]" / "To confirm" in titles; questions slide ≤ 8 items;
   - "Built from" lists production; the evidence panel knows the brief and research; the Start form prefilled.
   Export PPTX AND PDF through the real buttons (Playwright download events). Render every slide to images.

## Where
- UAT: http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com (http). Sign in: POST /api/auth/sign-in
  {"user":"mock","agency":"napkin"}, or type mock@napkin. Click "I understand" on the beta notice.
- UAT runs develop (deployed and verified in AWS by the coordinator just before you start).
- Driver: copy /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-24/drv/driver.mjs into your folder, set
  OUT and BASE; run from /home/batunii/Documents/Code/napkin-wt-territory-plan/app (has @playwright/test).
  Headless Chromium 1440x900 (executablePath $HOME/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
  if the default is missing). Downloads via Playwright download events.
- Spend ledger: `cd /home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/tools && AWS_PROFILE=napkin python3 jobs.py <ISO start>`.

## Money
Hard cap $25 provider spend; stop at $20. Cheapest working model, one take per shot unless broken. Claude spend
reported separately. Write paid.log, one line per paid action.

## Rules
Fictional brand only; no real people; no alcohol in shot; no prices in the UI except Decisions/History (a $
elsewhere is a bug). Don't touch other accounts' projects. If something blocks you, try the obvious workaround
once, log it as a bug with screenshots, and carry on to the end if at all possible.

## Output: /home/batunii/Documents/napkin-local-keep/full-flow-round3-2026-11-23/
shots/NNN-step.png for every step; downloads/ (the ad, the PPTX, the PDF, the media zip, the deck document);
deck-slides/ and deck-sheet.png; paid.log; report.md:
- per tool: worked / broke; a PASS/FAIL table of every check above;
- bugs S1-S4 with steps, screenshot and the suspected file (read-only look at
  /home/batunii/Documents/Code/napkin-wt-develop-tf after `git -C … fetch -q origin && git -C … checkout -q --detach origin/develop`);
- spend split; brief before/after;
- a frank verdict: would a client accept the deck and the ad?
Stop the driver and browser at the end (only what you started).

## Round 3: what changed since the Tidewell run (Tidewell was round 2) (check each, PASS/FAIL)
- Production: faces unrecognisable in EVERY frame AND the final clip (stronger line, also on one-video clips);
  key visual comes out in the asked ratio (4:5), bag whole; a rename right before leaving the page survives;
  library Delete is clickable; cards don't say "Canvas · empty"; the client's Production dial counts the
  project; the "1 out of date" bar never covers a button; size captions don't overlap; opening is fast
  (time it). The end card has its own Legal field filled from the LINKED brief ("Contains wheat. See pack for
  allergens."), the call to action is only the CTA, and the RENDERED ad shows the legal line. Link notices:
  before Plan shots / drawing / Make film, an unlinked @bag or Brief shows "… is not linked … Link it / Run
  without it" (screenshot it, then link).
- Two-tab conflict: reproduce it on purpose (two tabs, edit both, save the second). If the box does not appear
  at once, save the browser console log and the network log (HAR) of both tabs to downloads/ — the coordinator
  needs them.
- Deck: no evidence ids (f_…, brief:, req:) anywhere in slides, notes or Present; no "To confirm" in the clean
  export; no invented persona; questions slide lists only open questions; no mandatory printed as copy; title
  is "Client: line"; no "(agreed …)" provenance; Built from lists production; storyboard title counts the
  frames shown; no empty bullets; cover title clear of the picture in Present; no "[Agency]"; Start form
  prefilled including the prompt; pictures in Review AND Present (count them).
