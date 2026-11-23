# Full-flow test on UAT, fresh brand: bad brief → good campaign deck (round 2)

You are the only agent. No sub-agents. Don't edit, commit or push code. Don't redeploy anything. Never use the
Claude in Chrome extension.

## Goal
Run the whole flow on UAT with a NEW fictional brand, end to end, as a planner would, and judge the result:
1. Brief Maker: paste the bad brief (bad-brief-ferncliff.md), let the agents challenge it, answer the open
   questions as a sensible planner, redraft (check answers are KEPT on redraft: a fixed bug), use "Fix this with the
   agents" on any part Review rejects (a fixed bug: it must do something), lock.
2. Research: Continue in → Research, run it, keep the good findings, lock. Link research into the brief, rewrite, lock.
3. Production: Continue in → Production. Check the Brief node carries the brief and the full brief is carried.
   - Key visual: the can is the hero, the can text reads only "FERNCLIFF OAT FLAT WHITE" or similar, no real faces,
     no driving. Regenerate once if the can text is wrong.
   - Make all sizes: social (9:16, 4:5) AND out of home (48-sheet, 6-sheet, a digital size).
   - A 15 s ad: script → plan shots → storyboard frames → clips (cheapest working model) → edit → render.
     The end card must carry the legal line (a fixed bug).
   - Mark finals with rights (the new rights menu: Generated for made pictures). Check the Final pill / version strip.
4. Deck: "New deck from this project". Build it live through the gates. Check:
   - finals used: key visual, OOH sizes in billboard and poster frames, a 4-frame storyboard strip, the packshot if made;
   - no film slide, no DRAFT / CHECK FAILED / "[Agency]" / "To confirm" in titles;
   - the evidence panel knows the brief and research;
   - the Start form is prefilled.
   Export PPTX AND PDF and download BOTH through the real buttons in the browser (the PPTX download was a fixed bug).
   Open both files and render the slides to images.

## Where
- UAT: http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com (http). Sign in: POST /api/auth/sign-in
  {"user":"mock","agency":"napkin"}, or type mock@napkin. Click "I understand" on the beta notice.
- UAT runs develop (deployed just before you start; the coordinator verified it in AWS).
- Driver: copy /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/drv/driver.mjs into your folder, set OUT
  and BASE; run from /home/batunii/Documents/Code/napkin-wt-territory-plan/app (it has @playwright/test). Headless
  Chromium, 1440x900. Downloads: use Playwright's download events so the real buttons are exercised.
- Spend ledger: `cd /home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/tools && AWS_PROFILE=napkin python3 jobs.py <ISO start>`.

## Money
Hard cap $25 provider spend in total; stop at $20. Cheapest working model, one take per shot unless broken. Claude
spend: report separately (ledger agentUsd plus the deck engine's own cost). Write paid.log, one line per paid action.

## Rules
Fictional brand only; no real people; no driving; no prices in the UI except Decisions/History (a $ elsewhere is a
bug). Don't touch other accounts' projects. If something blocks you, try the obvious workaround once, log it as a bug
with screenshots, and carry on to the end if at all possible.

## Output: /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-24/
shots/NNN-step.png for every step; downloads/ (the ad, the PPTX, the PDF, the media zip); deck-slides/ (an image per
slide) and deck-sheet.png; paid.log; report.md (per stage worked/broke; bugs S1-S4 with steps, screenshot and the
suspected file (read-only look at /home/batunii/Documents/Code/napkin-wt-develop-tf after `git -C … checkout
--detach origin/develop`); which fixed bugs are confirmed fixed; spend split; brief before/after; a frank judgement
of the deck: would a client accept it?). If a file write is refused, put it in your final message. Stop the driver
and browser at the end.
