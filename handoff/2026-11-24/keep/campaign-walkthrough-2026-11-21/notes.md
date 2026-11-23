# Quietboil walkthrough (UAT, hello@napkin)

File: quietboil-walkthrough.mp4 (H.264, 1440x900, 30 fps, AAC, 11 min 46 s). Contact sheet: contact-sheet.jpg. EDL: drv/edl.py, drv/chapters.json (per-segment timestamps and captions).

## Chapters
- 0:00 Title card
- 0:04 1 BRIEF: Brief Maker, call notes, Strategy questions, draft of 23 parts, open questions answered, thin insight flagged
- 1:02 2 RESEARCH: continued from the brief; Consumer + Moments lenses; 15 sources, 39 facts, 3 findings kept and locked
- 1:38 BRIEF again: Link research, Rewrite with the research, insight redrafted ("Your 11pm is their 3am"), Show what changed, lock v1
- 2:26 3 PRODUCTION: canvas (mood, Maya + 3 views, kettle packshot, Brand board, hero with refs, sketch + note key visual), image editor (Fill, Change whole frame, Upscale 2x, apply as new version), Resize (Crop 4:5, Extend 21:9, Redraw 9:16), Decisions
- 6:10 Script (draft from brief, tone ask, diff, Make it 20 s), Plan shots (8 shots + end card)
- 7:12 Storyboard (frame 1, Keep a person, Make them)
- 7:47 Film room (boxes, WAN 3 x3, Veo 3.1 with sound x1, Camera agent retake of shot 3)
- 9:18 Edit room (Assemble, swap take, trim, captions, lower third, end card, sound view, mute, Render ad)
- 10:21 Rendered tab, download ad, Make all sizes (6 s 16:9 and 1:1), Download all media (37 files)
- 11:14 Final 20 s ad full length with sound; closing card

## What broke on camera
1. Storyboard "Draw the rest" greyed out with no reason: plan has 9 shots incl. end card, MAX_SHOTS is 8. Workaround "Make them".
2. "Make clips" opened the Film room, reopening showed "No film here yet" (empty Film node). Workaround: Make clips... on the storyboard node.
3. Film "Make" sent a paid job with no confirm tray (P13, logged after the click).
4. Make all sizes: Dex could not plan the cut (relay error "more than 20 images in one call"), fell back to opening + payoff cuts.
5. Known open bug: the 1:1 cutdown has no caption/end line (9:16 drops them too); stated in the caption. The 9:16 cutdown was not made.
6. Keep-a-person name 'maya' was taken (renamed).

## Spend
Ledger (napkin-hackathon-jobs, since 07:30Z): 35 jobs, all state=completed, none left unfinished. Provider confirmed total $7.14 (cap $15.00). Claude (Dex/agents, claudeUsd from jobs.jsonl, PT jobs only): $0.81. Brief Maker and Research agent costs are not exposed in the ledger. Spend by item is in paid.log (P1-P17).

---
# v2 (re-shoot of the fixed parts, 2026-11-21)

Files: quietboil-walkthrough-v2.mp4 (12 min 46 s, H.264 1440x900 30 fps AAC, 39.6 MB), quietboil-walkthrough-v2-small.mp4 (22.6 MB), contact-sheet-v2.jpg. v1 kept. EDL: drv/edl_v2.py, drv/render_v2.py, drv/chapters-v2.json. New raw clip: raw/13-v2-storyboard (UAT d9805a81, same project, no new project). New media: media/v2-cut-6s-1x1.mp4, media/v2-cut-6s-9x16.mp4.

## Chapters (v2)
- 0:00 Title card (v2)
- 0:04 BRIEF, 1:02 RESEARCH, 1:38 BRIEF again, 2:26 PRODUCTION canvas, 6:09 Script: unchanged from v1
- 7:12 Storyboard frame 1, Keep a person (unchanged)
- 7:26 NEW Draw the rest (replaces the BUG + workaround rows), 8:05 old seven-frame draw + Make clips (caption reworded)
- 8:17 NEW Film room via Make clips, 8:23 NEW film reopens from the canvas Film node (replaces "No film here yet" + workaround)
- 8:29 Make room, boxes, WAN 3, Veo with sound, Camera agent retake (unchanged except captions of the first Make row)
- 9:40 NEW Make tray (what / model / how many, no price), Not now, Make for real, take v3 lands
- 10:04 Edit room, 11:06 Rendered tab (unchanged)
- 11:24 NEW Make all sizes (6 s, 9:16 + 1:1), Dex's plan, Make 2 versions, Beats swap to shot 4, 1:1 and 9:16 cutdowns with captions (replaces BUG rows)
- 12:09 Download all media (old segment kept), 12:15 final 20 s ad, closing card (updated, no bug list)

## What each fix showed live
1. Draw the rest: with all 9 frames drawn the button is hidden, so I added an empty shot 9 (ahead of the end card). At 23 s on a 20 s ad the button was disabled with the reason "Cut 3 s to reach 20 s." (shown in the caption; native tooltips do not appear in the recording). Set ad to 30 s and the shot to 10 s: pill "Lengths fit the ad", button enabled; it drew the frame (24.7 s, P18, $0.20). Then deleted the shot and set 20 s again (project back to 9 shots, 20 s). Note: with the shot placed AFTER the end card it said "Draw shot 9 first" (end card is a graphic with no frame), a possible oddity.
2. Film reopen: Make clips opened the Film room with all boxes; back on the canvas, Film node, Open: reopened with every box and 5 takes. Bug 2 did NOT reproduce. The older empty Film node (0 of 0 ready, "No ad yet") from the v1 run is still on the canvas, hidden behind the poster sketch; I did not open it, so console-bug2.jsonl was not needed.
3. Make tray: Make new take on shot 3 (WAN 3, 2 s) showed "The Camera agent will make: Box 3 · 1 shot, 2 s; Model WAN 3; 1 new take; your other takes stay", no price. Not now sent nothing (no job posted). Make again + confirm posted one clip job (P19, $0.20, 82.7 s provider time, take v3). Old v1 rows that make Box 1/3/4/5 still show the pre-fix instant Make (caption says so).
4. Make all sizes: 6 s, 9:16 + 1:1. Dex's plan completed with the real model (eu.anthropic.claude-sonnet-5-5, cutter.v2, 9.2 s, $0.026): keeps shots 5 and 6 with a reason for each dropped shot; all crops. Make 2 versions: 2 ffmpeg stitch jobs, free, done in about 11 s.
5. Captions: the first cut (shots 5+6) has no spoken line, so I used Beats to swap the opening for shot 4 (Maya's whisper) on both tiles (free ffmpeg re-renders). Both cutdowns show the caption "Wait. Is it even on?" over shot 4, and the end line once, on the end card only. Small thing: in the 1:1 the caption is still on screen for part of the following shot 6 (it is timed to the take, not the shot).

## Still open / not redone
- "Download all media" (v1 segment, 37 files) was not re-recorded; the zip in media/ is the v1 zip and has the v1 cutdowns, not the v2 ones.
- Length 12:46 (target 11-12 min): the tray and sizes parts need their captions read.
- 16:9 cutdown not remade this time (the v1 16:9 and 1:1 still sit on the first Campaign board; v2 added a second Campaign board with 9:16 and 1:1).
- Spend: provider $0.40 (total $7.54 of $15). Ledger since 10:30Z: 9 jobs, all completed. Claude agent cost on those jobs about $0.08.
