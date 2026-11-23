# Final four-tool run, UAT, Tidewell (2026-11-23), develop 603b736b
Account mock@napkin. Provider spend $4.61 of $25 (29 jobs: 3 images Flash $0.21, sizes ~$1.9, 5 frames $1.0, 1 WAN3 clip ~$1.3, rest $0). Claude spend not exposed (brief x3, research, script, shots, 3 deck builds). paid.log lists actions (timestamps before 13:50Z are approximate).

## Per tool
- Brief Maker: worked. 4 agents ~3 min, 7 questions answered, redraft KEPT all 7 answers, Review rejected 3 parts in draft 1 but none after redraft (so "Fix with agents" not needed/not run), rewrite with research, locked v2.
- Research: worked (50 sources, 178 pins, 3 findings kept, locked). A transient "host did not apply the last change: upstream_refs unexpected / fact_ids required" appeared once and recovered.
- Production: worked with defects (below). Library, conflict, links, KV, 17 sizes, script, 6 shots, storyboard, 1 WAN3 clip, edit, render, finals.
- Deck: first deck failed twice in Slide copy ("TypeError: can only concatenate str (not float) to str", retry and rebuild identical). A fresh deck from the same project passed (intermittent). Exported PPTX (8 media) and PDF (42 pages, 10 images).

## PASS/FAIL
| Check | Result |
|---|---|
| Brief: answers kept on redraft | PASS |
| Brief: lock; research link, rewrite, lock | PASS |
| Project appears in library with client | PASS after refresh (shell dial said "Nothing yet" for Production; card in /production/ shows no client) |
| Rename + edit survive reload <1s | PASS |
| Two tabs: second save gets conflict box, nothing overwritten | PARTIAL: 409 returned, both edits kept, no box seen at once; box did appear on next reopen of the doc (also on a plain reopen) |
| Delete -> Trash -> restore | PARTIAL: delete works (see S3: click blocked); no Trash UI, restore only via API; restored project came back named "Untitled project" |
| /production/ without doc shows list | PASS |
| Link can + Brief into Script / Storyboard / Video | PASS (shots 118, 122, 133, 137) |
| KV: can hero, text only TIDEWELL SEA MINERAL SPARKLING, no faces, no alcohol | PARTIAL: text right, but can cropped at bottom, came 16:9 not 4:5, after one regeneration |
| All sizes (9:16, 4:5, 48/96/6-sheet, digital) | PASS (17 made, 6 "needs a look") |
| Storyboard frames show THE named can | PASS |
| People unrecognisable | FAIL: frame 5 and the final shot of the ad show clear laughing faces |
| End card headline = the line | PASS ("Tide's in.") |
| End card carries legal line | FAIL by default (CTA prefilled "Cornish", Line duplicates headline); fixed by hand, then PASS |
| Ad is 15 s, no studio card | PASS (ffprobe 15.00 s, 1280x720) |
| Finals with rights Generated | PASS (12 finals: KV, 6 sizes, 5 frames) |
| Deck pictures in Review and Present | PASS (slides 1, 9-12 in Review; Present shows them) |
| Deck pictures in PPTX / PDF | PASS (8 media / 10 images; deck doc not_reachable not found) |
| KV, OOH in billboard frames, storyboard strip with right count | PARTIAL: strip shows 4 frames, title says "5 stills" ("4 of 5 shots") |
| No Flagged / red outlines | PASS in exports |
| No clipped/overlapping labels, titles not into body | FAIL: title overlaps the picture on cover in Present; slide 11 title touches picture; stray empty bullets on slides 10-12 |
| Headline not covering can on cover/idea | PASS (words beside the picture) |
| No film slide | PASS |
| No DRAFT/CHECK FAILED/[Agency]/To confirm in titles | PARTIAL: PDF has no [Agency]; app Review/Present footer still shows "[Agency]"; 9 "To confirm" in body text |
| Questions slide <= 8 | PARTIAL: lists answered questions with answers as things to settle |
| "Built from" lists production | FAIL in Start and Review ("the brief, the research"); the checked list says brief+research+production |
| Evidence panel knows brief and research | PASS |
| Start form prefilled | PARTIAL: client, project yes; prompt no; "You will get: An agency pitch for [Client]" |
| No $ in UI outside Decisions | PASS (none seen) |

## Bugs
S1 Deck copy stage TypeError (first deck, deterministic on retry; fresh deck fine). Shots deck-typeerror, deck-after-retry. File not found (engine/deck, copy stage; no traceback in UI).
S2 End card legal line: CTA prefilled "Cornish" (from the mandatory "Use 'Cornish' only once legal has cleared it"), legal field empty (production-tool end-card prefill). Shot 152.
S2 Faces: storyboard frame 5 and last ad shot show realistic faces despite "no recognisable faces".
S2 KV: ratio 16:9 for a 4:5 prompt; can cropped; "Make all sizes" says no logo on Brand board.
S3 Delete button in library card is covered by a card placeholder strip (pp-ph) - click does nothing, keyboard works. Rename done just before leaving the page did not reach the server (restored as "Untitled project").
S3 Brief node says "V1 - FROZEN COPY" and inputs "Brief v1" although v2 brief; proposition still "To confirm:".
S3 Deck: ids ([brief:insight, f_...]) in territory text and slide bullets (15 in the PDF); "Maya, 31" persona invented; mandatory "Use 'Cornish' ..." printed on a slide; investment slide quotes "(agreed since the client's email...)"; title slide uses the project name "Tidewell Tides In launch"; 5 vs 4 frames; "[Agency]" footer in app; first Production open takes ~15 s ("Opening Napkin Studio...").
S4 Size tile captions overlap in the grid; floating "1 out of date" banner covers frame 5's editor button; library cards say "Canvas - empty" for non-empty projects.
Suspected files (read-only look at develop, no source read in depth): app/ production-tool/web/src/projects/*, engine/deck/{assemble,images,stages}.py.

## Brief before/after
Before: two lines, three audiences, Christmas + April + May, no budget. After (brief-final.txt): lead 25-40 after-work professionals, one line "Tide's in.", GBP150k incl VAT media outside, 250k cans sampled / 800 listings, no Christmas, still range out, Cornish held back, legal line kept. 11 "To confirm" tags remain.

## Verdict
Ad: a client would likely accept the film structure (15.0 s, the named can in every shot, line and exact legal line on the end card) but not the faces in the last shot and the warm bar scene is close to alcohol territory. Deck: better than before (pictures present everywhere, no film slide, clean exports) but not client-ready: raw ids, "To confirm" text, invented persona, cropped key visual can, 4-of-5 storyboard, overlapping title on the cover. Territories should not go to UAT sign-off on this run.
Not done: media zip download.
