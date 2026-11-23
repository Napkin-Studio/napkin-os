# UAT round 1 · T1 images & canvas (slug: images)

Account mock@napkin · project **UAT-R1 images A** (prj_01M7X9TBBM01VSFSSTQ11M0DNP / relay proj_01M7X9TCC0YMT76FYT1FGX79DR) · Playwright headless Chromium 1440x900 · 2026-11-20 20:18-21:02 UTC.
Files here: jobs.jsonl (one line per job: ask, web POST body, Dex output, provider_submit, stage timings, cost, quality), jobs/ (record JSON, relay trace, output PNGs, comparison crops), shots/ (135 screenshots), browser-log.jsonl (all non-GET API calls with bodies, console, failed requests), exports/ (media zip, .clan bundle), uploads/ (13 test pictures), config.json.

## Summary
- 17 relay jobs (15 paid, 1 free crop, 1 answered Dex question); spend $2.93 of $6.00 (Decisions drawer agrees: $2.86 before the last job).
- Controls: 58 tried: 44 work, 9 partly, 5 broken. Bugs: 3 S1, 7 S2, 12 S3.
- Relay trace lines present for every job (job_stage queued..landed, provider_submit with full prompt+refs, director on Dex ops). No director_rejected seen. director.input is NOT stored in the job record (only output + cards).
- Console: no page errors; only pre-sign-in 401 and headless WebGL warnings. S3 PUTs show net::ERR_ABORTED in Chromium but objects are in S3 (artifact).

## BUG list
- IMG-1 S1 Dex's question cannot be read/answered on the canvas. 14 refs -> Dex asks "This model takes at most 9 object pictures and you linked 11. Which two should I leave out?". The 814px ask card sits inside the 169px placeholder (.gennode overflow hidden): one or two words visible. Decisions->Open and the job dot's Show leave it clipped; no zoom fits it. Answered blind with a forced click. Evidence shots/48,50,53,54,57,59 (unclipped clone); job_01M7XAAS181J7PZ7PBS150M9X7. Code: gen node render in stages/Character.tsx (~L960) / ui/AskCard.
- IMG-2 S1 Unnamed drawings/results go to Runway as subject:human (audit item 9 confirmed). Loose ink bottle -> web role character kind drawing -> Dex kept it -> Runway in_1 subject human (job_01M7XBYMKK1GDAB7S6J7H87WJ8). 14-ref job: unnamed bottle packshot in_1 subject human. Dex corrected it only in job 3 (2 refs; Haiku card said object). Code: canvas/controller.ts:461 role = pic ? 'other' : 'character'.
- IMG-3 S1 Image editor Whole frame and Upscale are dead on a never-edited canvas picture (textarea/Change/Upscale disabled, no reason) until an Apply exists. shots/101,103. Code: model/selectors.ts currentPictureFrame undefined before first edit; ImageEditor.tsx:684/687/712 disabled={!current}.
- IMG-4 S2 Resize... Crop 4:5 cut the only subject out (centre crop of sea). No subject protect, no crop move; Make all sizes has subject boxes, Resize does not. jobs/crop45-small.png, job_01M7XBDH13A3E3H3SS4S37HR11.
- IMG-5 S2 Tray says linked note "not sent with a sketch yet" but it IS sent (POST input.text has it, Dex used it, puppy in result). shots/144, job_01M7XBPKPB0SFX2YCHXRVMNRAZ. Code: stages/trayScope.ts linkedRows vs jobs/linkedText.ts.
- IMG-6 S2 Character limit refusal only after 24 s of sequential uploads (~20 MB): "This provider takes at most 5 character pictures at once. Leave some out." No up-front warning; user cannot tell which unnamed results count as characters. shots/173-176. Code: controller.ts generate() limit check after assetRef uploads.
- IMG-7 S2 14-picture limit only on pressing Generate; tray lists 16 with no count. "Pick at most 14 pictures and drawings for one Generate." shots/43,44.
- IMG-8 S2 Canvas allows 14 refs but Runway takes <=9 object refs; Dex has to ask (leads into IMG-1). capabilities.ts generateMax vs runway.py.
- IMG-9 S2 Extend 21:9: hard vertical seams, flat blurred side bars. jobs/extend-small.png, job_01M7XBEY3SADZ2HDDNHVQHB0XR.
- IMG-10 S2 Apply as new version enabled after painting only a mask, while its title says "Make an edit first" and the pill "No edits yet". shots/94.
- IMG-11 S2 Make the other views sends @current as subject object; source is a crowd photo and the prompt says only "@current, the same character". job_01M7XBJ9F*.
- IMG-12 S3 Canvas view moved by itself (62%->52%) when a job landed; next clicks missed. shots/146.
- IMG-13 S3 Floating toolbar stays pinned at top when its selection is off-screen; Esc doesn't clear. shots/70,140.
- IMG-14 S3 13 uploads land in one 4400px row, mostly out of view. shots/40.
- IMG-15 S3 Canvas caption stale after upscale+apply ("1365x768 cropped to 16:9" for a 2730x1536 v3). shots/118.
- IMG-16 S3 No Download in the version menu; no download in a sketch-made result's bar. shots/116,90.
- IMG-17 S3 Resize remembers last shapes (duplicate risk); preview tags overlap ("4:5 16"). shots/125.
- IMG-18 S3 Linking a note to an unnamed picture = empty canvas -> unstyled "New script/storyboard/video from this text" menu, no explanation. shots/147.
- IMG-19 S3 Text box clips last characters ("beside he"). shots/143.
- IMG-20 S3 After Fill, the mask overlay stays over the result. shots/97.
- IMG-21 S3 Internal wording: Lineage shows "(features/brief-node.clan)"; picture jobs labelled "films"; views menu "Make the next version with". shots/156.
- IMG-22 S3 "saved hh:mm" lags up to ~5 min (Ctrl+S fixes); the Ruby views key group overlaps collage/park nodes. shots/118,132,152.
Not bugs: sequential uploads (11 pics = 14.6 s before POST), generated outputs re-uploaded to in/ before reuse.

## Dex findings
- Plain words: got words+ratio, sent words unchanged, ~2 s. Fine.
- Named char + unnamed product (job 3): got both as role character + Haiku cards; sent ruby human, bottle object, added keep-identity lines; 11.6 s. Good but depends on cards.
- 14 refs: asked a good question (3 options + free text); after answer sent 12 refs, bottle as human. Should re-role unnamed results from cards.
- Sketch area: got role layout + a card (audit item 8 now outdated); sent role object + "Follow the layout of @in_1: where things sit, not how they look". Works.
- Loose drawing: got character, kept it -> human. Should be object.
- Linked note: words arrive in input.text and are kept. Works; only the tray label is wrong.
- Fill/remove/whole: ok (whole = "Change @current as follows..."). Upscale/resize/extend passthrough by design.
- Views: subject object for a person; should be human and say which person.
- All: store director.input (or hash + cards) in the job record.

## Quality (1-5)
1 cafe woman 5 · 2 packshot 5 · 3 @ruby+bottle bench 5 · 4 14-ref collage 4 (gibberish handwriting) · 5 sketch->beach 5 (layout followed) · 6 fill red flask 3 (hand no longer grips) · 7 remove sun 5 · 8 whole-frame winter 4 (flask frosted/translucent) · 9 upscale 2x 5 · 10 resize 9:16 redraw 5 · 11 crop 4:5 1 (subject cut out) · 12 extend 21:9 2 (seams) · 13 views side/back/3-4 4/3/4 · 14 sketch+linked note 4 · 15 loose ink bottle (Flash) 4 (invented "OCEANUS" label).

## Timings (s; UI click->landed / relay queued->landed / Dex / provider)
- generate words: 28.6/27.5/2.1/21.8 and 21.7/21.7/~2/16.4
- generate 2 refs: 45.8/36.9/11.6/21.9 (+8 s uploads before POST)
- 14 refs: ask at 17 s; 61 s after the answer; Dex 11.6+19.1; provider 38.4; +14.6 s uploads
- sketch 37.3/34.3/~9/22 · fill 30.2/23.8 · remove 32.1/24.5 · whole 37.2/31.3 · upscale 47.3/40.6/-/38.3
- resize redraw 50.8/40.9 · crop 9 (synchronous inside POST /jobs, 9.3 s) · extend 35.3/34.4
- views x3: 47 for all, 22-30 each (3rd queued by inFlightPerParticipant=2)
- linked note 35.3/33.7 · ink (Flash) 30.2/26.6
- Apply 0.6-1.7 · reload 1.8 · reopen 0.5 · first /production/ load: blank page ~5-9 s

## Controls
Works: Rename; Text tool (+size/colour); Select; Hand; Pen (+highlighter, colours, widths); Ctrl+Z/Ctrl+Shift+Z; Sketch area; Add a picture (multi-file); Name... (key, variant, role pills); Set as front / Make the other views; Generate tray (expand, untick, model pick, words, Cancel); sketch ask; Zoom +/-/Fit; Delete key + Undo chip; Link note->sketch; Editor zoom/Fit, tool keys V L T C H B, [ ], sliders, Add/Subtract, Brush, Lasso, New/Clear mask, Fill, Remove, Before/After, layer eyes, Text, Crop + Reset crop, undo edit, Hide/Show Booth, Apply, versions menu, Close; Resize Redraw; Download all media; Project as .clan; Ctrl+S; reload; All projects->reopen; Decisions tabs; thumbs + "What is right?"; Make all sizes (opened only).
Partly: X swap (ignored while a slider has focus); Apply-enabled state; Resize Crop/Extend; Place... (error only after uploads); 16/14-ref limits; Decisions Open on a question; Ctrl+wheel zoom (nothing in headless); Resize remembering shapes; media zip (menu says 34 files, zip has 29).
Broken: answering the Dex ask on canvas; Whole frame and Upscale before first Apply (2); linked-note label; version-menu Download.

Spend total: $2.93.
