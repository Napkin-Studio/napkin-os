# UAT round 5 · images (slug: images)

Account mock@napkin · project **UAT-R5 images A** (prj_01M7Y7MHQW8VYWQTCVC0MSY8H9 / relay proj_01M7Y7MMEEFJK68PX7NB730G9W) · UAT fix/pt-uat-loop f29fc482 (director.v17) · Playwright headless Chromium 1440x900 · 05:00–05:30 UTC. AWS SSO held the whole round (every job has a relay trace).
Files: jobs.jsonl (11 rows), jobs/ (records, relay traces, outputs, extend scratch canvas/mask/step files, crops, storyboard-leo.jpg), shots/ (103), paid.log, requests/responses.jsonl, browser-log.jsonl.

## Summary
- Part A: **14 fixed, 5 partly, 0 regressed** (UX10 counted fixed for speed, but see S2-D); 8 not retested (need a paid run outside T1 or not reachable).
- New bugs: **0 S1, 4 S2, 6 S3** (+ rough notes).
- Prices: none in Resize confirm, Fill confirm, Generate tray, Make all sizes, storyboard or editor. $ only in Decisions (correct).
- Console: clean except the .clan refusals of the brand ask (S2-B) and the 404/ERR_FAILED of my own aborted POST.

## Part A: round-4 retest
| Id | Result | Evidence |
|---|---|---|
| S1-1 extend 9:16 | **fixed**. Extend on 9:16 says "too far … redrawn instead (Redraw)"; confirm "Redraw · Gemini 3 Pro"; POST resize.method=regenerate; relay sent gemini_image3_pro text_to_image with @master, never Ideogram. Output 5/5 (one sun, no ghosts) | shots/009, job_01M7Y7QQPP791CXVFT55DHG5YN, jobs/redraw916.png |
| S1-1 extend 4:5 (3 steps) | **fixed**. canvas-1..3 flat colour bands, no mirror; growth 1.306/1.305/1.304 a step; card "step 1 of 3 / 2 of 3 / 3 of 3"; cost 0.75 = 3 × 0.25 reserved=confirmed. No seam at 6 band edges, no repeated shapes (q 4.5) | jobs/ext45-steps.png, ext45.png, shots/018-021, job_01M7Y7TGVN3G0GVV32VBS6YXST |
| S1-1/IMG-9 extend 21:9 (1 step) | **partly**. Flat seed, no smeared horizon block, no ghosts; but a hard vertical tone seam in the upper sky at both master edges, visible even at canvas thumbnail size (new S2-C). 0.25 | jobs/ext219-edge100.png, ext219-edgezoom.png, shots/023 |
| S2-1 / R3-12 frame beat | **fixed**: frames carry only shot + "Shot 1 (@anchor): …" line, no note; 4 frames, no collage, each its own beat/framing. But see new S2-A | jobs/storyboard-leo.jpg |
| S2-2 / R2-5 Brand board → note | **fixed**: links, no banner, survives reload | shots/074-075 |
| S2-3 thin fill | **fixed (first send)**: 17 px stroke (2 %) sent as 642×49 mask (5.7 %), editor says "The area was very thin, so it was painted wider before sending"; came back with a wispy cloud. Try again not needed, so its variation is unproven | job_01M7Y8548552KAC29AM5F4FPXP, jobs/fill1-compare.png, fill1-mask.png |
| S2-4 prices | **fixed** (owner rule: $ in Decisions only) | shots/084, 098-100 |
| S2-5 brief after character card | **fixed**: @leo card open → + › A brief from Brief Maker… opens From Napkin | shots/064-065 |
| S2-6 brief cast/brand | **partly**: plan input refs [] (no @leo/@ruby), no brand context, cast "a young renter"/"a flatmate". The "Use a brand?" ask can't be answered (new S2-B) | job_01M7Y8T1JM17T5GB1W08275B98, shots/102 |
| S3-6 "from the script" | **partly**: after plan "Planned 6 shots for the storyboard"; before plan the brief storyboard still says "plans the shots from the script" | shots/078 |
| R2-11 group label zoom | **fixed**: "Ruby · 2 views" font 0 (dot) at ≤30 % | shots/092-095 |
| S3-1 page selection | **fixed** (selection "" after strokes) | |
| S3-2 pen flyout off canvas | **partly**: in the top bar after a fresh load; after visiting the picture editor (or Storyboard) and coming back, the pen/text options are again beside the rail over the canvas and swallow strokes (stroke 2 lost) — new S3-1 | shots/033 vs 034, 042 |
| S3-3 pen undo | **fixed**: each stroke one Ctrl+Z, redo works; after Apply v2, Ctrl+Z took the stroke, not v2 | jobs/pen-undo-strip.png, ctrlz-after-apply.png |
| S3-4 editor Booth | **fixed**: tools shown, one Booth | shots/024 |
| S3-7 Keep a person | **fixed**: "This keeps the whole frame … crop first (Edit)" | shots/055 |
| R3-5 ask beside storyboard | **partly**: the ask shows twice in the opened storyboard (two overlapping cards, the second clipped) — S3-3 | shots/081 |
| director.usage | **fixed**: filled on every Dex job | jobs.jsonl |
| UX10 Draw the rest | **fixed** speed (2 at a time) but double-fires the last frame (new S2-D) | |
| Not retested | R3-4 (needs paid upscale), S3-8 (paid generate), S3-5 (no unticked brand refs), R2-3/R2-14/R3-2/R3-9/R3-10 | |

## BUG list (new in round 5)
- **S2-A Frames lose the person's look from the note.** Steps: note "Leo, a man in his forties with a short grey beard and a red knitted beanie… 1: … 4: …" › New storyboard › Plan shots › Draw frame 1. Expected: frame 1 shows the described Leo. Actual: Dex's shot list drops the look on purpose ("Leo's look is in the script, so it is not repeated in the actions"), and since the S2-1 fix the frame gets only shot.action ("Leo unlocks his bike outside a bakery at dawn."). Frame 1: a 60+ man in an olive beanie; Keep a person then carries that wrong look to all frames. Suspect: web jobs/linkedText.ts (frame reads only shot links) + director shot_list rule; send frames a character line from the script/note (or have shot_list keep look words in shot 1), keep the beats out. job_01M7Y8BRBCAVJQ48E6A8P1DPKY, job_01M7Y8DZR64JMXTW3C6XWA9YNB, jobs/lf1.png.
- **S2-B The brief storyboard's "Use a brand?" ask cannot be answered.** Steps: brief storyboard with a Brand board in the project › node shows "No Brand board on this brief. Use a brand? Brand / No brand" › click either. Actual: "That change could not be saved to the .clan and was undone"; console `/asks/q_…/question/allow_text must be equal to constant; …/options/0/id must match pattern "^[a-z][a-z0-9_]{0,31}$"; …/answers/0/option_id must match pattern`. Cause: web jobs/briefBrand.ts answerBrand uses board ids (board_01M…, upper case) as option ids and kind 'nudge' with allow_text:false. So no brand can be linked and "No brand" is never kept (asked forever). shots/102, browser-log 05:28:39/46/59.
- **S2-C Extend 21:9 leaves a hard vertical seam in the sky** at both master edges (x≈243 and ≈1805 of 2048), a tone step visible at canvas thumbnail size and plainly at 100–200 %. The flat seed next to the master is greyer than the master's edge (fades to the band mean), and Ideogram keeps the step; feathered() ramps only inside the master. Suspect relay/formats.py _smeared/padded (seed colour at the edge) for the 1-step path. 4:5 (3 steps, top/bottom) shows no seam. jobs/ext219-edge100.png, shots/023.
- **S2-D Draw the rest starts the last frame twice (double charge).** Frames 2 and 3 landed 1 s apart; each completion called continueDrawing → drawSideBySide, both saw shot 4 open with no job yet, and two frame jobs for shot 4 were POSTed in the same ms (job_01M7Y8H6K4DXA9ZT46BPY85SVY, job_01M7Y8H6K28S8SW12T5X08D2H5), both charged $0.20 + agent; shot 4 shows v2. Suspect web jobs/frames.ts drawSideBySide: no synchronous claim of a shot before the awaited drawFrame (wire.ts:36 completion hook).
- S3-1 Pen/text options fall back beside the rail after the picture editor or storyboard: CanvasChrome.tsx finds #pt-tool-options once on mount; the ShellBar re-creates the span, the old one is disconnected, so inBar=false. Strokes starting under the flyout are lost. shots/033, 042, 097.
- S3-2 Extend prompt still says "soft bands that only mirror its edge" (relay/formats.py EXTEND_PROMPT) though the seed is now flat.
- S3-3 The opened storyboard shows the Dex ask twice (panel card + a second overlapping, clipped card). shots/081.
- S3-4 "Draft a script from the brief — a script you check before shots are planned" planned 6 shots straight away; no script to check.
- S3-5 @leo card: "Used in · 0" though @leo_front is on 3 frames; "Show it on the canvas" is disabled with no reason given.
- S3-6 Frame 1 drew a readable "PAIN QUOTIDIEN" (a real chain's name) on the bakery despite "No brands, logos or readable trademarks".
- Rough: a fresh /production/ load is blank for ~12 s (shots/001-002); naming a 2nd view places it in the next free spot away from the 1st, so the "Ruby · 2 views" label sits on an unrelated picture (shots/091); region_edit Dex input grew to 17,161 tokens / 7.2 s (round 4: 8,402 / 2.9 s) for a words-only fill.

## Dex findings
- **Got:** frame: shot (action, camera), kept character ref + card, "Shot 1 (@anchor)" line, previousFrame on frame 4; shot_list: note/script, targetS, brief; region_edit: image, mask, region, words.
- **Sent well:** one character ref as character; "setting comes from this shot's own action"; previous frame "for continuity only… show each person once"; brief plan with the mandatory end line, no celebrities, no other films' people.
- **Should send:** the person's look on frames (S2-A); nothing that implies a script check that doesn't happen.
- **Tokens / latency** (job.director.usage, now filled): shot_list 6,920 in / 525 out / 3.0 s; frames 9,112–9,723 in / 215–400 out / 1.7–5.6 s; region_edit 17,161 / 623 / 7.2 s; brief ask 7,602 / 483 / 5.4 s, brief plan 7,707 / 1,541 / 11.3 s. Resize (extend/redraw) is passthrough, no Dex.

## Quality (1-5)
| Job | Score | Notes |
|---|---|---|
| 9:16 Redraw | 5 | clean recompose, one sun |
| extend 21:9 (1 step) | 4 | no block/ghosts; sky seam both sides |
| extend 4:5 (3 steps) | 4.5 | per step: canvas flat, step-1 4.5, step-2 4.5, final 4.5; no seams |
| thin fill | 4 | widened mask, a real wispy cloud on half the stroke |
| storyboard Leo | 3 / 5 / 5 / 5 | f1 wrong look (olive beanie, older) + trademark sign; f2-f4 own beats/framing, identity held from f1, no collage |
| brief plan | 4 | 6 shots, right cast, end card |

## Timings (s)
| Step | Time |
|---|---|
| 9:16 redraw | relay 35.4 (provider 27.1) |
| extend 21:9 | POST 2.1 · relay 58.3 (provider 49.0) |
| extend 4:5, 3 steps | relay 135.9 (43.9 / 32.6 / 37.8) · UI ~147 |
| thin fill | click→POST 10.3 · relay 31.9 · UI 35.2 |
| plan shots (note) | 5.1 |
| frame 1 | 22.2 |
| Draw the rest ×3 (+dup) | POSTs at 5 / 12 / 38 s, all landed ~70 s |
| brief Link | ~1 · ask 5.4 · answer → plan 11.3 |

## Spend
Provider **$2.28** of $2.50: 9:16 Redraw 0.20 (unplanned: I aborted the POST to check it free, the web retried it after I removed the intercept), extend 21:9 0.25, extend 4:5 0.75, thin fill 0.08, frames 1–4 0.80 + duplicate frame 4 0.20 (S2-D). Claude **$0.22** (sum of cost.agentUsd, 8 Dex jobs).
