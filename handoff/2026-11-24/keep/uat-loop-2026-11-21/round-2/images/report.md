# UAT round 2 · T1 images & canvas (slug: images)

Account mock@napkin · project **UAT-R2 images A** (prj_01M7XGYEX0DPPWYQ94A6TNYQE7 / relay proj_01M7XGYHHBMFVZQHJSECMCND8E) · code fix/pt-uat-loop @ 80b20aa2 · Playwright headless Chromium 1440x900 · 2026-11-20 22:24–23:20 UTC.
Files: jobs.jsonl (27 jobs: ask, web POST, director.input/output, provider_submit, stage timings, cost, quality), jobs/ (records, relay traces, outputs, montages), shots/ (162), browser-log.jsonl, exports/ (media zip 47/47 files, versions-menu download), uploads/, paid.log.

## Summary
- 27 relay jobs (24 paid, 2 free crops, 1 shot_list); **spend $5.03 of $6.00** (ledger agrees).
- Part A: 22 round-1 bugs: **17 fixed, 4 partly, 0 not fixed, 0 regressed**, IMG-12 not reproduced.
- Controls touched ~60: 47 work, 8 partly, 5 broken. New bugs: 1 S1, 6 S2, 8 S3.
- Relay trace lines present for every job (job_stage, provider_submit, director / director_rejected). director.input now stored on every Dex job except the one where Dex timed out.
- Console: only the two .clan write refusals (R2-1), WebGL perf noise, a pre-sign-in 401, S3 PUT ERR_ABORTED artefacts (objects exist).

## Part A — round-1 retest
| Bug | Result | Evidence |
|---|---|---|
| IMG-1 Dex ask clipped | **fixed**: full card beside the node at 28 %, answerable; Later → pill; off-screen → ask dock; Decisions Open pans back and opens it | shots/092-096, job_01M7XJ2G9QDG6AF6CYPG0WGJN1 |
| IMG-2 unnamed = human | **fixed**: unnamed → subject object; tray switch → human | job_01M7XHVJ02EP1F4HFX62HMFZGQ (in_1..5 human, in_6..14 object), job_01M7XJ2G9QDG6AF6CYPG0WGJN1 |
| IMG-3 Whole/Upscale dead before 1st edit | **fixed** | shots/111-116, job_01M7XJF6Y3FBRSQBFKSRK0EKAV, job_01M7XKXRAS8VJ6J9RGRKZHAVXG |
| IMG-4 crop cuts subject | **fixed** (protect box + draggable frame reach the POST). Rough: a drag made before marking is dropped; the protect box is not remembered for the next Resize | job_01M7XJSR5CE1FFJ732A4H30ZY2 (protect), job_01M7XJVDPY3YTBA2005BY8TVM3 (crop x=526) |
| IMG-5 linked-note label | **fixed** ("note (linked) · goes as words"), but see R2-2 | shots/105 |
| IMG-6/7/8 limits after upload | **fixed**: live count "5 people, 9 things · up to 5 people, 9 things, 14 in all", refuses before upload with the exact excess, Generate disabled | shots/063-067 |
| IMG-9 extend seams | **partly**: ground continues seamlessly; sky bands still flat/smeared with a hard vertical seam (21:9), faint seam (9:16) | jobs/extend219-topleft.png, job_01M7XJWSWAAQ6EC8Y7YTKH540W / …540X |
| IMG-10 Apply on mask alone | **fixed** ("A mask alone changes nothing: Fill or Remove it first") | shots/123 |
| IMG-11 views as object | **fixed**: subject human, "@current is marco: this one person" | job_01M7XHA5M4BSVGSP6TZNW2XJQS + 2 |
| IMG-12 view jumps on landing | not reproduced in 27 landings | — |
| IMG-13 toolbar pinned off-screen | **fixed** (hides when the selection leaves view) | shots/222 |
| IMG-14 uploads in one row | **fixed** (16 uploads in a 5-wide grid) | shots/062 |
| IMG-15 stale caption | **fixed** | shots/226 |
| IMG-16 no download | **partly**: versions-menu Download works (exports/…-v2.png); a sketch-made v1 still has no ↓ in its bar (appears after an Apply) | shots/108, 125 |
| IMG-17 resize remembers shapes, tags overlap | **fixed** (shapes cleared, How remembered) | shots/139 |
| IMG-18 note→unnamed picture | **fixed** ("Nothing links into a reference: it is an input only."); empty canvas gives a styled "Make a new one from this text" menu | shots/200, 232 |
| IMG-19 text clipped | **fixed** | shots/200 |
| IMG-20 mask over fill result | **fixed** (dashed edge only) | shots/121, jobs/fill-compare.png |
| IMG-21 internal wording | **fixed** ("Make the views with", no features/… in Decisions); "Every film you can open" remains in the project menu | shots/024, 230 |
| IMG-22 saved lag / group overlap | **partly**: "saved hh:mm" kept up; the Marco views group frame runs under the row of scene results made from it | shots/100 |

## BUG list (new in round 2)
- **R2-1 S1 Brand refs cannot be made, so input.context is never filled from the UI.** Name… → More… → palette (or typography) shows "keeps to these colours" / "sets type in this font"; Save → banner "That change could not be saved to the .clan and was undone." Console: `refs[…]: a palette ref holds swatches` / `a typography ref holds font`. The Name popover never asks for swatches, font or rule text; no brand_rule ref can be made either. jobs/context.ts brandItems therefore has nothing; T1.3 worked only via a linked text note. Code: clan-store/src/integrity.ts:176 vs the Name popover (stages/Character.tsx). shots/164-168.
- **R2-2 S2 A sketch with a linked note still asks "What is this sketch of?"** Tray says the note "goes as words"; Generate asks anyway (no job); answering "layout only" then sends input.text = the note. Suspect canvas/controller.ts:683 checks `text` before linked text is merged. shots/105-106, job_01M7XJ970F7Y3QV7E4K9AV5MG3.
- **R2-3 S2 Dex times out on a 14-ref Generate → passthrough.** director_rejected kind timeout after ~40 s (DIRECTOR_TIMEOUT_S=20 × 2 attempts, relay/director/claude.py:41); 50 s of "Sending…" before submit; director.input not stored. Result OK because tray tags carried subjects. job_01M7XHVJ02EP1F4HFX62HMFZGQ.
- **R2-4 S2 Storyboard continuity: frame 4 repeats frame 3 and adds a second Mia and puppy; frames 2-4 change Mia's hair blonde→dark.** Refs are only @anchor/@previous (subject object), no character; "Continue from @previous" makes the model copy the last frame. job_01M7XKR3HEB03P39HPG7WAC375, jobs/storyboard-mia.jpg.
- **R2-5 S2 A Brand board cannot be linked.** Link tool from the board (inside or label) is not taken as a source; the next click reads "A sketch area feeds nothing on the canvas." Board label stays "NEW BOARD" after choosing Brand. shots/171-174.
- **R2-6 S2 "Make the other views" spends $0.60 (3 jobs) on one click**, no tray, no price; every other paid action confirms. shots/025.
- **R2-7 S2 "New script from this text" makes an empty script**: the note is linked but the page is empty and Plan shots is disabled until you write or ask. shots/201-202.
- **R2-8 S3 Upscale 2× promised 3276×4096, landed 2458×3072** (1.5×). job_01M7XKXRAS8VJ6J9RGRKZHAVXG.
- **R2-9 S3 Crop 4:5 silently upscales 2.7×** (614×768 crop delivered 1638×2048, soft). job_01M7XJSR5CE1FFJ732A4H30ZY2.
- **R2-10 S3 Resize/Extend confirm shows no price** ("What each costs is in History"); two extends = $0.50.
- **R2-11 S3 "Rights?" chips and size captions stay screen-size at 10–28 % zoom**, covering thumbnails and the "Marco · 4 views" label. shots/220.
- **R2-12 S3 Picking 2 views inside a views group needs double-click then shift-click**; a plain click selects the group and Generate disappears. shots/030-032.
- **R2-13 S3 Product/scene shots paint real trademarks** (Fanta, Red Bull, Coca-Cola, JR, Le Monde, Brasserie Lipp); Dex adds no "no other brands" line. job_01M7XKBJJJ041ZRF9X9393PD9R, job_01M7XHF4703ZEW7XJW505ARBZF.
- **R2-14 S3 Tags cut to 16 chars**: @marco_three-quarter goes as `marco_three_quar` (visible in Decisions).
- **R2-15 S3 Fill words box shows a stale placeholder** ("add condensation drops") after a Fill. shots/121.

## Dex findings
- Got: words, ratio, refs with cards (director.input now stored, ~1–3 KB), input.answer after a question, linked notes in input.text, script+shot for frames. **Never got input.context** (R2-1); no brief in the project.
- Sent well: views as human with the name; two views → "one single character, never copies" (no duplicates in 4 scenes); product "keep its shape, label and colours"; sketch layout line; whole-frame "Change @current…"; brand-rule conflict → a good nudge question with a recommended option, then it wrote "One coral (#FF6F59) accent, navy and sand tones" itself.
- Should send: "no other brands or logos" on product/scene shots; for storyboards a character ref (frame 1 or a named Mia) and "a new moment, not the previous picture"; the 14-ref case needs a longer timeout or a smaller prompt (27 k input tokens even for words-only jobs).
- Latency: 3.5–9.5 s typical, 44 s on 14 refs (timeout).

## Quality (1-5)
Marco portrait 5 · views side/back/¾ 4/4/4 · **identity across 4 scenes 5/4/5/5** (Paris, Highlands, kitchen, Tokyo: same beanie, glasses, beard, coat) · 14 refs 4 · Dex-answer swap 5 · cottage sketch+note 5 · whole frame winter 5 · fill door 4 · crop 4:5 protect 4 · crop 1:1 4 · **extend 21:9 3, 9:16 4** · **brand picnic 3** (palette kept, drink still reads as alcohol, faces cropped) · AURORA packshot 5 · **product in 3 scenes 5/5/4** (label held every time; fridge ignored "turned left") · **storyboard 4/3/3/1** · upscale 5.

## Timings (s; relay queued→landed; Dex latency)
- generate words 28.0 (Dex 3.5) · views 23.8/30.4/28.6, all 3 in 54 · 2-ref scenes 30.4–33.8 (Dex 6–9; "Sending…" 8–16 s)
- 14 refs 79.5 (POST 50, Dex timeout 44) · Dex question 6.3, answer→landed 31 · sketch 32.8 · brand ask 13.8, answer→landed 25
- whole frame 29.1 · fill 28.6 · upscale 24.3 · crops 7.5/9.5 (synchronous) · extend 38.1/52.7 · frames 46/40/33/34 (sequential, 126 for 3) · shot_list ~7
- reload 7.7 · Apply 1.6 · media zip 99 MB

## UX proposals
1. Name… with role palette/typography/brand rule should ask inline for swatches (eyedropper on the picture), font and use, rule text (do/don't/tone); or let the Brand board read them.
2. Show the price on every confirm ("2 pictures · $0.50"); give Make the other views a tray ("3 views · $0.60").
3. When "Sending…" lasts > 3 s say what is happening ("Director reading 14 pictures…").
4. After storyboard frame 1 lands, offer "Keep Mia: make her a character from this frame" and send it to the later frames.
5. In a views group, a click on a view selects that view; the group is selected from its label.
6. Scale "Rights?" chips with zoom, or collapse them to a dot below 40 %.
7. "New script from this text" should put the note's words on the page (or start a draft).
8. Brand board: rename it "Brand" on purpose choice and accept it as a link source.

Spend total: **$5.03**.
