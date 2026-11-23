# UAT round 4 · images (slug: images)

Account mock@napkin · project **UAT-R4 images A** (prj_01M7Y0G07W4R59NQY0XBAMB0M2 / relay proj_01M7Y0G425EYSNA4D6FNVYY96W) · UAT fix/pt-uat-loop df0ca1a7 (director.v17) · Playwright headless Chromium 1440x900 · 02:55–03:47 UTC.
Files: jobs.jsonl (17 jobs), jobs/ (records, relay traces, outputs, extend scratch per step, crops, storyboard-mia.jpg, ext916-steps.png), shots/ (136), paid.log, requests/responses.jsonl, browser-log.jsonl.
**Note:** the AWS SSO token expired at ~03:32Z. The jobs after that (sketch ×2, brief plan, brief frame) were read from the web API (`/production/api/jobs/<id>`), so they have no relay trace and no token counts. Their Claude cost comes from cost.agentUsd.

## Summary
- Part A (18 ids): **12 fixed, 3 partly, 2 not fixed / broken (R2-5, R3-12), 0 regressed**, plus new bugs found around the fixes.
- New bugs: **1 S1, 5 S2, 9 S3**.
- Console was clean apart from WebGL ReadPixels warnings. The only failed calls: my own 404 probe, and the .clan refusal (R2-5).
- Prices: none in trays, confirms, Resize, Make all sizes, the storyboard or the editor. **The Decisions panel shows $ on every agent decision (37 in this project)**, which breaks the owner rule (any price is a bug).

## Part A: round-3 retest
| Id | Result | Evidence |
|---|---|---|
| IMG-9 extend seam | **partly**. 21:9 (1 step): no full-height seam, no speckle, mirrored sun/person not kept. But a ~90×60 px smeared block sits on the horizon at each band edge, with a hard vertical edge, plus faint pale streaks in the sky (q 3.5). **9:16 (3 steps) is broken (new S1)** | jobs/ext219*.png, ext916*.png; job_01M7Y0RAQA0YMTM5S5A9KCKQBF, job_01M7Y0Y3FEE55833VHT5F1PR1T |
| R2-3 ask size/uploads | **fixed**. Words-only generate is 9,009 input tokens (was 15.1k). 14 refs upload in parallel (14 POSTs in 0.06 s); job POSTed at 7.5 s, Sending ends at 20.8 s (was 34 s); Dex 11.7 s at 14.5k in | job_01M7Y0JVX87W3X5Z7EE7ZD0KM0, job_01M7Y1TAE39M4XV1XSQS6QCHG4, shots/078 |
| R2-5 brand board → note | **not fixed (broken)**. The web lets you link Brand board → note, then the store refuses it: banner "That change could not be saved to the .clan and was undone", console `links[...]: A board cannot feed a text`. contracts/common.schema.json linkRule has no board(brand)→text rule; web canvas/core/links.ts has one | shots/134, browser-log 03:43:29 |
| R2-11 zoom chips | **partly**. At 18–50 % the Rights? chips turn to dots and the @names and size captions scale or hide. The "Ruby · 3 views" group label stays screen size | shots/074, 079 |
| R2-14 tags | **fixed**. provider tag `ruby_back_3q` | job_01M7Y34PG986T6XBS0ABCY09XT |
| IMG-22 group overlap | **fixed**. Group label and @labels are clear, with a gap | shots/067 |
| R3-1 note's storyboard overwrites script | **fixed**. New storyboard from note B made "Script 2" with B's words. Script A (picnic) is untouched (0 shots) | shots/050-054, job_01M7Y1CHJ3FH161GZ5A0CJEEF8 |
| R3-2 palette poster | **fixed**. Brand generate: "With navy and coral accents", a real photo. Plain photo (sketch+note) and sky Fill: no palette. Tray ticks + Accents/Strict toggle work | jobs/brand.png, sketchB.png, shots/039-041 |
| R3-3 unchanged fill | **fixed** (message, Try again, Discard; Discard takes the mask). But see S2-3: Try again resends the same request | shots/088-092 |
| R3-4 upscale no growth | **fixed** on an applied v2 ("no bigger · Already full size…", button disabled). Partly: before Apply, the same editor still offers 2× → 3072 × 1318 on top of the pending upscale | shots/093-096 |
| R3-5 ask beside storyboard | **fixed**. "The Director agent has a question: see beside this storyboard" + NEEDS YOUR CALL + ask card next to the node | shots/127 |
| R3-6 brief Link | **fixed**. Linked on the first click in about 1 s, and the brief lands clear. (New S2-5: "+ › A brief from Brief Maker…" does nothing while the Booth holds a character card) | shots/122 |
| R3-7 1536 caption | **fixed**: "1536 × 864 · kept at 1536 px for the models" | shots/011 |
| R3-8 Name on existing key | **fixed**: "@harbour is a palette… type a new name", button "Add to @harbour as palette" | shots/023 |
| R3-9 shift-click text | **fixed** for shift-click (selection ""). But drawing a sketch area and pen strokes did highlight toolbar text (S3-1) | shots/100 |
| R3-10 near angles | **fixed**: "1 view of @ruby: 3/4" | shots/070 |
| R3-11 Dex slow on frames | **fixed**. Frames 2.5–3.1 s, 329–448 output tokens (was 34.8 s / 2,091) | jobs.jsonl |
| R3-12 frame beat only | **not fixed**. `script` now holds only "Shot 1 (@anchor): …", but `input.text` still carries the whole 4-beat note on every frame (the note linked into the script reaches shots via jobs/linkedText.ts withLinkedText / model/scope). Frame 3 came back as a **2×2 storyboard collage** (S2-1) | jobs/storyboard-mia.jpg, job_01M7Y1GSY5640S7QKRM9ADX403 |
| UX 10 Draw the rest | **fixed**. 2 at a time: frames 2+3 together, then 4. 65 s for 3 frames (round 3: 108 s for 2) | shots/060-061 |

## BUG list (new in round 4)
- **S1-1 Extend 9:16 (3 steps) multiplies the mirrored seed.** Steps: upload a 1536×864 sunset beach › Resize › 9:16 › Extend › Send 1. Expected: a seamless tall sky and beach. Actual: 4 suns stacked in the sky (3 blurred ghosts), two ghost leg pillars and a zig-zag mirrored shoreline across a blurred bottom half, and a hard horizontal seam where the master ends. Cost $0.75 (reserved and confirmed = 3 × $0.25, correct). The scratch files show the cause. canvas-1 mirrors the sun (top) and the woman's legs (bottom) into the bands; Ideogram keeps them (step-1.png); each later step mirrors again. Each step grew ×1.47, not the ≤35 % the design says: the 3-step cap forces a bigger step. Suspect: relay/formats.py `_mirrored`/`STEP_SEED_BLUR` (0.04, so the seed is almost sharp) + `step_plans` when the growth needs more than 3 steps. Seed with a heavy blur / a flat colour, or refuse/redraw beyond 3 × 35 %. jobs/ext916.png, jobs/ext916-steps.png, job_01M7Y0Y3FEE55833VHT5F1PR1T.
- **S2-1 Storyboard frame 3 is a 4-panel collage** (R3-12 not fixed). Dex at effort low copied the whole note ("1: … 2: … 3: … 4: …") into frame 3's prompt, and Gemini drew all four beats in a grid. "No panels" did not stop it. Frames 1, 2 and 4 are fine. Fix: don't add linked note words to shot jobs when the shot has its own action (jobs/linkedText.ts READS_WORDS includes 'frame'; readers() → storyboard → script scope). job_01M7Y1GSY5640S7QKRM9ADX403.
- **S2-2 Brand board → note is refused by the store** (R2-5): see Part A. web/src/canvas/core/links.ts allows it; contracts/common.schema.json linkRule (read by clan-store/src/integrity.ts linkRuleFor) does not.
- **S2-3 "Try again" on an unchanged fill repeats the identical call.** It sends the same 2 %-wide mask and the same words, comes back unchanged again (strip RMSE 0 vs try 1), and is charged again ($0.16 for nothing). Expected: Try again widens the mask, changes the seed or words, or says the mask is too thin before sending. job_01M7Y2443B4F5V29CRMYSRST3E, job_01M7Y26F7B8FS9Y1SK73G4VD3T.
- **S2-4 Prices in the Decisions panel**: "$0.23", "$0.063"… on every agent decision (37), and the Resize confirm says "What each costs is in History". The owner rule says any price in the UI is a bug. shots/135.
- **S2-5 "+ › A brief from Brief Maker…" does nothing** when the Booth last showed a character card (@ruby): the Booth stays on @ruby (collapsed or open). Twice. Workaround: ← Assets › From Napkin. shots/115-118.
- **S2-6 Dex casts other films' characters into a brief storyboard.** The answer said "a young renter … no people from other films"; the plan still used @ruby and @mia (the Harbour/Mia tests' characters) and the Harbour palette/typography for the Quietboil ad's end card. A brief counts as brand work, so the project's only brand goes on any brief. job_01M7Y31MKPCGH8MWGG2JKTRRAV, job_01M7Y34PG986T6XBS0ABCY09XT.
- S3-1 Drawing a sketch area / pen strokes highlights toolbar and chip text (page selection). shots/100.
- S3-2 The pen options flyout (x 72–195) covers the canvas and swallows strokes that start under it; with a sketch area near the left, the house, roof and ground line were silently not drawn. shots/100-103.
- S3-3 Pen strokes are not on the undo stack: Ctrl+Z after a stroke undid the earlier paid "apply edits as v2" instead (Redo restored it). Its toast is clipped off-screen at the bottom-left ("…ts to the picture as v2"). shots/104-105.
- S3-4 The image editor opens with its tools hidden in a collapsed Booth, and two BOOTH tabs are stacked on the right edge. shots/080.
- S3-5 Generate-tray chips under YOUR WORDS list unticked brand refs (@harbour_colours…) as if they go. The summary "Sketch, brand (brand rule)" omits the linked note.
- S3-6 The storyboard made from a brief says "planned 3 shots from the script" (there is no script).
- S3-7 Keep a person… stores the **whole frame** as @mia_front (sha = frame 1), so the "character" ref carries the bench and street.
- S3-8 Sketch "Use it as a layout only" with no words gives flat clip art and the sun drawn as a literal yellow pentagon: Dex wrote "a pentagon" from the card.
- S3-9 Region fill on a 2048×878 picture came back 1536×659 (the model's size); not checked whether v2 keeps 2048.
- Rough: the script node's action bar covers the note's last line (shots/048); a fresh /production/ load showed a blank page for ~8 s.

## Dex findings (effort low)
- **Got:** words, refs with roles and cards (now also a card for a sketch), context per op (brand rule always; palette and type only on brand work), shot + anchor beat, the brief, the answer to its own ask.
- **Sent well:** palette as "accents" (brand) and none on photo, sky Fill or edits; a brand rule rewritten as "no alcohol, nobody smokes"; the one-character line for 3 views; no trademarks; "kept as they are" for people.
- **Should send / not send:** not the whole note on every frame (S2-1); not project characters into a brief the person said has new people (S2-6); "sun", not "pentagon"; for layout-only with no words, a photo, not clip art.
- **Tokens / latency** (relay `director` events): words-only generate **9,009 in / 203 out / 2.0 s** (round 3: 15,129 / 1,026 / 7.6–10 s); brand generate 9,527 / 240 / 1.7 s; 14 refs 14,497 / 1,432 / 11.7 s (was 20,184 / 2,851 / 24.9 s); frames 9,702–10,144 in / 329–448 out / 2.5–3.1 s (was 15.4–16.6k / 1.5–2.3k / up to 35 s); region_edit 8,402 / 305 / 2.9 s; shot_list 7,980 / 1,058 / 7.2 s (was 14.1–14.6k). After the SSO expiry: sketch 4.9 s, sketch+note 2.9 s, brief plan 14.9 s ($0.063), brief frame 5.1 s.
- `job.director.usage` is null on every job record; the usage is only in the relay's director event.

## Quality (1-5)
| Job | Score | Notes |
|---|---|---|
| Paris words-only | 5 | natural, invented signs, no tint |
| extend 21:9 (1 step) | 3.5 | horizon blur blocks + faint sky streaks; no seam, no ghosts |
| extend 9:16 (3 steps) | 1 | mirrored suns ×4, ghost legs, mirrored shoreline |
| brand poster | 4.5 | palette 5, rule 5, type 4, natural 4 |
| storyboard Mia | 5 / 4 / **1** / 5 | f2 near-copy of f1's framing; f3 a 4-panel collage (round 3: 5/5/5/5) |
| 14 refs café | 4 | Ruby held; the bench woman (similar source) reads as a twin; label garbled |
| sky fill / Try again | 1 / 1 | unchanged both times |
| upscale 2× | 4 | exactly 3072×1318 |
| sketch layout-only | 3 | layout exact, clip art, pentagon sun |
| sketch + note photo | 5 | midday photo, layout kept, no palette |
| brief frame 1 | 4 | Ruby held, scene right; brown bottle on the counter; wrong cast |

## Timings (s)
| Step | Time |
|---|---|
| words generate | POST 3.0 · relay 21.5 · UI 23.8 |
| extend 21:9 | relay 42.8 (provider 32.8) |
| extend 9:16, 3 steps | relay ~135 (steps 32.4 / 37.9 / 43.9) · UI ~139 |
| brand generate | 142.6 (Runway 137.7 slow) |
| plan shots (note) | 8.8 |
| frame 1 | 28.2 |
| Draw the rest ×3 | 65 (2+1) |
| 14 refs | uploads ~7 · POST response 20.8 · relay 37.4 |
| fill / retry | click→POST 15.7 (confirm + upload) · relay 27.7 / ~21 |
| upscale | 18 |
| brief Link | ~1 · plan: ask 6.2, answer → plan 16 · brief frame ~35 |

## UX proposals
1. Extend: show "step 2 of 3"; for >3 × 35 % growth, offer Redraw instead; seed bands blurred hard or flat.
2. Fill: refuse or widen masks under ~5 % of the side ("paint wider: a thin stroke comes back unchanged"); make Try again vary something.
3. Frames: send only the shot's beat; keep the note for planning.
4. A brief with no brand board: ask which brand (or none) instead of using the project's only one.
5. Move the pen flyout off the canvas or make it pass strokes through; put strokes on the undo stack.
6. "+ › A brief from Brief Maker…" should always open the Booth on From Napkin.
7. Decisions: hide $ (or put it behind an owner-only switch) to meet the owner rule; change "What each costs is in History" to "Decisions".

## Spend
Provider **$3.41** of $4.00 (13 paid jobs; paid.log names each). Claude **$0.38** (sum of cost.agentUsd over 15 Dex jobs).
