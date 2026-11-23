# Full flow on UAT, Ferncliff "Flat Out Good" (2026-11-23/24), develop 4cbf69b5

Account mock@napkin. Deck leg BLOCKED (S1). No PPTX/PDF produced, no deck-sheet.

## Stage by stage
| Stage | Result |
|---|---|
| 1 Brief Maker | Worked. 4 agents ~2.5 min, 7 open questions answered, Draft it again KEPT all 7 answers (fixed), Review rejected 2 parts, "Fix this with the agents" ran (fixed) and cleared both, locked v1. |
| 2 Research | Worked. 21 sources / 65 pins / 3 findings (Market, Brands, Consumer, Regulation; Brands lens only gave a gap), kept 3, locked. Link research, Rewrite with the research, 5 new questions, Fix with agents, lock v2. |
| 3 Production | Worked, with defects. KV, 17 sizes, script, shots, storyboard, 1 clip, edit, render, finals all done. |
| 4 Deck | BROKE. Deck Maker now opens on UAT and runs gates 1-3, then the Check stage fails every time. |

## Bugs
S1 Deck build can never finish: "Something failed: agent output rejected ... not valid under oneOf" (shots 'deck-failed', deck-failure-1/2.txt).
 - engine/deck/export_clean.py:28 `OPEN_MAX = 60` builds an appendix bullets list of up to 61 open items ("On "...": To confirm"), but app/templates/deck-maker/schema.json list block has `maxItems: 8`. Any brief with many "To confirm" tags hits it (third deck, brief only: 1226-char list of "On ..." items).
 - Second oversize list: engine/deck/assemble.py ~710 (and ~856) `qs[:10]` open-questions slide vs the same maxItems 8 (first two decks: 10 "Question - Answer" items).
 - Try again fails the same way. Trimming the brief's open questions to 7 and re-locking (v3) did not help: the Production project keeps its frozen brief copy (error still showed the old 10 answers), and the export_clean list failed anyway.
 - Production -> deck: no way to bring a Production project into a deck started from the brief.
S2
 - End card has no legal line: prefilled Headline/Line carry the planner's shot description verbatim ("The can centred on clean colour", "Flat out good. appears, the legal line small beneath."), no legal field, CTA empty. Render v1 had no legal. Typing the legal line in "Call to action" put it on the card (v2). Not fixed.
 - Storyboard frames ignore the named can (@ferncan existed): frames 4-5 show a silver unbranded can; frame 1 a crowded tram of realistic faces; the final ad shows the same. The can is not the hero in the film (Production > storyboard/film).
 - 15 s ad renders 17.4 s (studio "Napkin Studio" card appended) and the 15 s script reads 14.9 s.
 - Make-all-sizes tile "Final" / Mark Final button name collides with the undo/redo aria-label ("Undo: mark final size...") so a name-based click undoes it (UI only; real users fine).
S3
 - Brief node says "V1 - FROZEN COPY" for a v2/v3 brief; carries the spine only (8 fields), insight shows "To confirm:" prefix.
 - Territory text in deck shows internal ids (f_3338FDD6..., req:r5, brief:objectives).
 - Deck "You will get: An agency pitch for [Client]" although client is filled; "Built from" lists brief+research only, not production.
 - KV came out 16:9 although prompt said 4:5; first take cropped the can (regenerated once, whole can ok, small).
 - Answered open questions still land as "Question - Answer:" text in the brief; "To confirm:" tags remain after lock (14).
 - No logo on Brand board: sizes flagged "no size has one" (mandatory logo top right cannot be met).
 - Sizes grid: tile caption text overlaps ("Regenerate..." over "1440x1800 Crop").
 - Make film needs a confirm popover below the fold (button looks dead).
S4 Final pill is only visible in the tile toolbar ("Final" -> "Final check"); canvas tiles show no pill.

## Fixed bugs, confirmed
- Redraft keeps answers: YES (7 answers survived, 3 new questions added).
- "Fix this with the agents": YES (runs Strategy/Brief/Review, "Fixed 2 of 2 parts").
- Deck Maker on UAT / "New deck from this project": YES (opens, Start form prefilled client+project, brief/research/production brought in, 12 finals counted, gates 1-3 work).
- Resize jobs post at once (no 30 s wait): YES.
- Rights menu (Generated set by default) and Final pill in editor: YES.
- End card legal line: NO (see S2). PPTX/PDF download: NOT TESTED (no deck).
- Raw verdict error after lock: not seen.

## Deck judgement
No deck was produced, so no client could accept anything. What did appear: the storyline beats cited research and brief (evidence panel knew both), territories were sensible, the idea line "Flat out good." and executions listed KV, 48/96-sheet, 6-sheet, D48/D6 and storyboard frames, i.e. finals were used. But territory prose leaked ids and the Check stage fails.

## Brief before/after
Before: 18-45 or 25-55, two lines, Christmas and March, "barista quality", no budget. After (brief-final.txt): lead 25-40 commuters, one line "Flat out good.", proposition "Cafe-style oat coffee, as quick to grab from the fridge as an energy drink", 8% share in 12 months, 250k excl VAT, never knock cafes, no barista quality / no added sugar / no B-Corp; research adds UK RTD coffee USD 490.97m, Costa RTD sampling. Still 14 "To confirm" tags. Files: brief-v1-first-draft.txt, brief-v1-redraft.txt, brief-v1-fixed.txt, brief-v2-rewritten.txt, brief-final.txt, research-report.txt.

## Spend
Provider (ledger since 08:36Z): $3.59 of $25 (30 jobs): 2 KV $0.14 (Gemini 3.1 Flash), 17 sizes ~$0.95 (Gemini 3 Pro 9:16 $0.2, Ideogram 96-sheet $0.75), 6 storyboard frames $1.2 (Gemini 3 Pro), 1 clip WAN 3 $1.3, 2 renders $0. Claude: agentUsd $0.30 on Production jobs; Brief Maker, Research and the deck engine (3 builds) cost not exposed.
paid.log has each paid action.

## Files
downloads/Flat-Out-Good-ad.mp4 (v1, no legal), Flat-Out-Good-ad-v2-legal.mp4 (17.4 s, legal via CTA), Flat-Out-Good-media.zip (45 files, 72 MB), ad-contact-sheet.png, ad-endcard-legal.png. shots/ (~200). deck-failure-1.txt, deck-failure-2.txt.

## Deck, round 2 (after fix/deck-list-cap, middleware rev 41, deck container ffd91330)
Fresh deck from "New deck from this project" (doc-ie-napkin-deck-maker-1dd43633, same Production project, 12 finals brought in; prompt typed by me, client/project prefilled, agency blank). Claude spend only; no picture/video jobs (ledger unchanged at $3.59 provider).

Result: WORKED to a finished deck (gates 1-3, Check done, approved, both files downloaded through the Present "Download" buttons, Playwright download events): downloads/Flat-Out-Good.pptx (167 KB, 18 pitch slides, appendix hidden) and downloads/Flat-Out-Good.pdf (410 KB, 43 pages). Renders: deck-slides/pdf-NN.png (43), deck-slides/pptx-NN.png (18), deck-sheet.png (PDF), deck-sheet-pptx.png. S1 (list cap) FIXED: Check passed, no oneOf rejection; open-items appendix runs on over four "continued" slides; questions slide shows 8, rest in notes.

Checklist
- Finals used: NO in the files and in the app. The PPTX has 0 media files, the PDF has 0 images, and the deck doc view has 0 <img>. Key visual, "Out of home" and "Storyboard frames" slides show a dark text panel or an empty box beside the copy. The text names the 48/96/6-sheet/D6/D48 and "six storyboard frames" (I made 4 storyboard finals), but no picture is shown. (New S1/S2 below.)
- No film slide: yes. No DRAFT / CHECK FAILED / "[Agency]" / "To confirm" in titles: titles clean, but "[Agency] · Ferncliff Coffee Co." is in the footer of every slide (viewer and presenter), and "To confirm" / bracket placeholders run through appendix text and some pitch body text.
- Evidence panel knows brief and research: yes (brief:insight, brief:reasons_to_believe, research pins/findings, req ids; "Built from: brief+research"; production is not listed).
- Start form prefilled: client and project yes, prompt and agency no.

New bugs
S1 Deck exports carry no pictures even though 12 finals were brought in: PPTX 0 media, PDF 0 images, web deck 0 imgs; the "pictures stay in Production and are fetched when you build" step did not place them. Steps: Present > Download PPTX/PDF, unzip; shots r2-export / r2-present2. Suspected: the final-image fetch/embed in engine/deck (production.py / assemble images step and the pptx/pdf export) on UAT, probably the deck container cannot reach the relay media or the fetch fails silently; needs a log look.
S2 Slide quality: PPTX slide 3, 5, 7, 8, 15 titles overflow into body text (rendered in LibreOffice); duplicate titles in the nav ("The real question" x2, "Insight" x2, "The work" x3, "Timeline and investment" x2); Check reports "11 errors, 76 warnings" while the deck is approvable; ids and "[f_...]" evidence lines appear in speaker notes and the Evidence tab text (not slides).
S2 "[Agency]" placeholder in every slide footer when agency is left blank (memory rule: Napkin or no agency named once, no placeholder).
S3 Territory ids/"Maya" persona: the idea slides invent a persona ("Maya, I don't need a ceremony...") not in the brief; the Questions slide lists answered questions with their answers as "questions we would settle".
S3 Storyboard slide says six frames and "Frame 5/6" copy, but only 4 finals existed.

Frank judgement: a client would not accept this deck. It reads sensibly (one idea, "Flat out good.", honest open items), but a campaign deck with no key visual, no poster mock-ups and no storyboard images is a script, not a pitch; footers say "[Agency]", titles repeat, and text overflows on several slides. The fix of the list cap works; the missing finals is now the blocker.

## Deck, round 3 (after IPv4-first fix; middleware rev 42, deck container a01d2fc6)
Fresh deck from "New deck from this project": doc-ie-napkin-deck-maker-eaa6d934, same Production project (12 finals brought in). Gates 1-3 passed, Check done, approved, both files downloaded through the Present Download buttons (Playwright download events). Claude only; no picture/video jobs (provider spend still $3.59).

Pictures: YES.
- PPTX downloads/r3-Flat-Out-Good.pptx (1.4 MB): 8 files in ppt/media (jpg, 100-236 KB). 18 pitch slides, appendix hidden.
- PDF downloads/r3-Flat-Out-Good.pdf (1.7 MB, 43 pages): 10 images on pages 1, 9, 10, 11, 12 (pdfimages).
- App deck view: 0 <img> elements in Review and Present (pictures are not shown in the in-app editor view; only the exports show them) - noted as S3.
- Deck document (downloads/r3-deck-document.clan, 200): data.production.not_reachable is [] (empty); all picks reach "relay".
Slides (deck-slides/r3-pdf-NN.png 43, r3-pptx-NN.png 18, deck-sheet-r3.png, deck-sheet-r3-pptx.png):
- Key visual (slide 10): the master key visual fills the left third, the whole can in frame, not stretched. Good.
- Out of home (11): 96-sheet, 48-sheet and digital 6-sheet drawn in billboard/poster frames with the can whole, "Flat out good." and the legal line on the 96-sheet; no stretching or can cropping. Frames sit slightly tight under the copy.
- Storyboard (12): a 4-frame strip, images fit. Frames are the weak silver-can/tram-crowd frames from Production.
- Cover (1) and idea slide (9): the 16:9 key visual is cropped to a full-bleed so the can sits under/behind the title text (can half hidden by the headline) - the can is not clear of the text on those two slides.
Checklist: no film slide yes; no DRAFT / CHECK FAILED / To confirm in titles yes; "[Agency]" count in text 0 (footer placeholder gone); questions slide 8 items; open-items appendix runs on over "continued" slides yes; evidence panel knows brief and research (not production).
New bugs
S3 Slide 1 and 9: full-bleed picture sits behind title text; can partly hidden (engine/deck layout for cover/idea with a picture).
S3 Slide 11/12 badge labels clipped ("Production : Flagged", "Mock-up" cut off); storyboard slide still says "Six stills / Frame 5, Frame 6" though the strip shows 4 frames; slide titles still overflow into body on slides 3, 5, 7 in the PPTX render, and the pitch still reads some "Priya"/persona invention.
S3 The in-app deck view shows no pictures (0 img).
Client verdict: much closer. It now shows the key visual, the posters in billboard frames and a storyboard strip, and the story is coherent. I would still not send it as is: the cover and idea slides hide the can behind the headline, the storyboard images show a silver unbranded can and a crowd of faces, labels are clipped and text overflows on a few slides, and the "To confirm" placeholders remain on the appendix. With those fixed it is an acceptable first draft for an internal review, not a client-ready pitch.
