# Full-flow test on UAT: bad client brief → good campaign deck (2026-11-22)

You are the only agent. Do NOT start sub-agents. Model: you run on sonnet.

## Goal
Take a messy client brief all the way through Napkin Studio OS on UAT and end with a
good campaign deck that uses the pictures made and locked in Production:

1. Brief Maker: start from the bad brief, let the tool challenge it, answer its
   questions as a sensible agency planner would, end with a sharp brief. Lock it.
2. Research: continue from the brief (Continue in → Research), run it, keep the
   findings worth keeping, lock. Link research back into the brief, rewrite with it, lock v1.
3. Production (Continue in → Production, this is the new brief→prod SPIN-OFF; check
   the Brief node carries the brief): make the campaign visuals:
   - a key visual (no apples anywhere, the client's legal ask; fictional brand only),
   - format sizes of it (Resize: e.g. 4:5, 9:16, 16:9),
   - a 15 s ad: Script → Plan shots → Storyboard frames → Make clips (cheapest model
     that works) → Edit → Render a 15 s ad,
   - mark the finals; state rights on each final (generated) so the deck can use them.
4. Deck (this is the new prod→deck SPIN-OFF): from the Production project use
   "New deck from this project" (or Continue in → Deck), build a good campaign deck.
   The deck shows VISUALS ONLY (key visual, sizes, storyboard stills). No film/video in
   the deck: that is the owner's decision. Check finals come first, rights labels are
   right (generated = usable; unknown/unstated = "Rights to supply"), pictures load
   (they are fetched by link through the signed assets pass, not embedded).
   Export the deck (PPTX and/or PDF) and save it.

The bad brief: /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/bad-brief-hollow-oak.md
(fictional brand Hollow Oak Cider, product "Still"). Paste/upload it as the client's email.

## Where
- UAT: http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com (http, not https)
- Sign in: POST /api/auth/sign-in with JSON {"user":"mock","agency":"napkin"} (cookie), or type
  `mock@napkin` into input[placeholder="name@agency"]. Click "I understand" on the beta notice.
  Production Tool is at /production/ (same origin; API /production/api/...).
- UAT runs branch feat/production-spinoff at b9cca83a (web, middleware, relay).
- Code: /home/batunii/Documents/Code/napkin-wt-prod-spinoff (READ ONLY for you; do not edit,
  commit or push). Design of the spin-off: features/production-spinoff.clan
  (`clan read agent features/production-spinoff.clan`). Deck engine: engine/deck/
  (from_production.py). Shell spin-off: crates/napkin-host/src/library.rs.

## Tools
- Drive with Playwright (headless Chromium, viewport 1440x900). Run scripts from
  /home/batunii/Documents/Code/napkin-wt-prod-spinoff/app so @playwright/test resolves.
  A reusable persistent driver (HTTP server taking JS bodies, helpers for clicks,
  frames, screenshots, waits) is at
  /home/batunii/Documents/napkin-local-keep/campaign-walkthrough-2026-11-21/drv/driver.mjs
  (+ d.sh). Copy it into your output folder and change OUT/BASE/require path; do not write
  into the old folder. No video recording needed; screenshots are.
- NEVER use the Claude in Chrome extension (mcp__claude-in-chrome__*).
- Spend: `cd /home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/tools && AWS_PROFILE=napkin python3 jobs.py <ISO start time>` (DynamoDB ledger, provider + claudeUsd per job). Note the start time before your first paid action.

## Money
- Hard cap: $25 total provider spend (Runway etc.) for the whole run. Check the ledger
  after each paid step and keep a paid.log line per paid action (what, model, count, $).
- Use the cheapest model that does the job; draw only frames you need; one take per shot
  unless a take is broken. Stop and report if you reach $20.
- Claude/agent spend: report separately (claudeUsd from the ledger; say plainly where it is
  not exposed, e.g. Brief Maker / Research).

## Rules
- Fictional brands only; no real business names, no real people. No apples in pictures.
- No prices/costs in the UI except Decisions/History (a $ elsewhere is a bug).
- Don't restart or redeploy anything. Don't touch other accounts' projects.
- If something blocks you, try the obvious workaround once, log it as a bug with
  screenshots, and carry on to the end of the flow if at all possible.

## Output (folder /home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/)
- shots/NNN-step.png for every step and every result; deck slides as images (render or screenshot each).
- the exported deck file(s); the rendered 15 s ad (download it).
- paid.log; report.md with: what worked per stage, bugs (S1 blocks the flow, S2 wrong
  result, S3 rough edge, S4 cosmetic) each with steps, screenshot and the code file
  you suspect; spend (provider vs Claude); whether the brief got better (bad → good,
  quote the before/after key lines); a judgement on the deck (would a client accept it?).
- contact-sheet.png of the key screenshots.
- Close the browser/driver when done.
