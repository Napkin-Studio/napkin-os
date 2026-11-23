# Round 3 full flow, UAT, Harrowgate (2026-11-23/24), develop ed98deac
Account mock@napkin. Provider spend $8.99 of $25 (34 jobs; jobs.py from 17:07Z). Claude spend not exposed. Not tested: Trash screen (restore via API only), Production Stage 2/3, Brief node version fix (#285).
Files: shots/, downloads/ (ad mp4, PPTX, PDF, deck-document.clan, production-project.clan, two-tab logs), deck-slides/, deck-sheet.png, deck-sheet-pptx.png, deck-review-sheet.png, ad-contact-sheet.png, ad-endcard.png, paid.log, brief-*.txt.

## Per tool
- Brief Maker: worked. Questions answered, redraft kept answers; Review rejected nothing needing "Fix with agents" (not run). Proposition came back "baked sourdough crisp can be properly crunchy: Proper crunch." after a Redraft; fixed by hand to exactly "Proper crunch." Locked, research linked, rewritten, locked v2. Review still rates budget and plain language "too vague".
- Research: worked (24 sources, 70 pins). Transient "agent output rejected: upstream_refs unexpected / fact_ids required" shown once, recovered.
- Production: worked with defects (below). Deck: built, 3 gates, exports OK, but not client-ready.

## Round 3 checklist
| Check | Result |
|---|---|
| Project in library with client; opens from there | PASS (shell dial still said Production "Nothing yet" for the client after reload: FAIL for dial count) |
| Client's Production dial counts the project | FAIL (Harrowgate dial: Production "Nothing yet" while project open) |
| Rename + edit survive reload | PASS (reload to content 2.3 s; fast open 2.3 s, first open from brief ~12 s) |
| Two-tab conflict box | PASS: box "Not saved: this project was saved from another browser or tab... Keep theirs as a copy / Save this as a new version" appeared in 1.3 s, nothing overwritten. Logs in downloads/two-tab-conflict-logs.json |
| Library Delete clickable; Trash; restore | PASS delete (real click); Trash via API restore OK (no UI) |
| Cards don't say "Canvas - empty" | FAIL: empty throwaway card said "Canvas · empty" (it was empty; the non-empty card showed activity text) so PASS for non-empty |
| /production/ no doc shows list | PASS |
| Link notice before Plan shots (unlinked @bag, Brief) | PASS ("@bag, @keyvisual and The Brief are not linked... Run without it / Link it"), shot 213 |
| Links bag + Brief into Script, Storyboard, Film by hand | PASS |
| KV 4:5, bag whole, text HARROWGATE OVEN CRISPS only, no faces/alcohol | PASS after the 4:5 sketch area route (922x1152); the plain picture node ignored "4:5" and came 16:9 (words ratio fix not live on that path) |
| Make all sizes: social + OOH + digital | PASS (17 made, 6 "need a look") |
| Storyboard frames show THE bag | PASS |
| Faces unrecognisable every frame and clip | PARTIAL: shots 2 and 5 and the clip show backs of heads / hair; shot 2 men visibly smile in profile (frame 2 and clip 2 contact sheet): faces partly seen. No clear frontal faces |
| End card own Legal field filled from linked brief; CTA only CTA; rendered ad shows legal | PASS (Legal prefilled "Contains wheat. See pack for allergens.", rendered end card shows it; headline had to be typed, empty by default) |
| Ad 15 s, no Napkin card | PASS ffprobe 15.000 s 1280x720 |
| Finals with rights Generated | PASS (KV, 9:16, 4:5, 48/96/6-sheet, digital 6-sheet, 6 frames = 13) |
| "1 out of date" bar never covers a button | PASS (seen, covers nothing) |
| Size captions don't overlap | PASS in Sizes screen; canvas caption clipping at 34% not judged |
| Deck: pictures in Review and Present | PARTIAL: slides 10, 11, 13 only (2/6/8 and 1/3/4 imgs); cover and storyboard slide 12 none |
| PPTX media / PDF images | PPTX 8 media, 42 slides (23 hidden); PDF 42 pages, 8 images |
| KV, OOH in billboard frames, storyboard strip | PASS pictures; strip shows 4 of 6 frames, slide title says "six stills"; slide 12 has no pictures and bullets run off the bottom |
| No Flagged / red outlines | PASS |
| Clipped/overlapping, headline over bag | FAIL: bullets overflow bottom on slides 11 and 12 (Review); cover has no picture |
| No film slide; no DRAFT / CHECK FAILED / [Agency] in titles | PASS |
| "To confirm" absent from clean export | FAIL: 7 in PPTX appendix slides, plus in the PDF |
| Evidence ids absent in slides, notes, Present | FAIL: f_/fi_/brief:/req: ids in 3 PPTX speaker notes and in Present's evidence list; none on slide faces |
| Invented persona | PASS (none seen) |
| Questions slide lists only open questions | FAIL: "Questions we would settle in the first fortnight" slide is empty |
| Mandatory printed as copy | PASS mostly; "Never show the product with alcohol"/"No bread or pub" appear in requirements appendix only |
| Title "Client: line" | PARTIAL: "Harrowgate Bakery Co.: Proper Crunch" (project, not the line) |
| "(agreed ...)" provenance | PASS; "The client agreed to narrow" in appendix text |
| Built from lists production; evidence panel knows brief and research | PASS |
| Storyboard title counts frames shown | FAIL (six vs 4) |
| No empty bullets | PASS |
| Cover title clear of picture in Present | N/A (no picture) |
| Start form prefilled incl prompt | PASS (prompt "A pitch deck for ...: Crisps A second."; project name was my renamed test name, I changed it to Proper Crunch) |

## Bugs
S2 Deck has 19 pitch slides with duplicate titles (The real question x2, Insight x2, The work x4, How it runs x2, Timeline and investment x2); 16 errors/56 warnings; idea line became "Proper crunch. Not sorry." contradicting the one line "Proper crunch." (engine/deck stages).
S2 Speaker note "Scope check: the tender lists paid social, search, programmatic, broadcast radio..." on an agency pitch (tender content leaking; engine/deck).
S2 Evidence ids still in PPTX notes and Present lists; "To confirm" in clean export; empty Questions slide.
S3 Storyboard slide 12 no pictures, says six stills, shows none; slide 13 shows 4 of 6; bullets overflow slides 11/12 in Review; cover has no picture.
S3 Plain picture node ignores "4:5" (came 16:9) on UAT; sketch-area 4:5 works. Suspected production-tool/web/src/ui/prompt/PromptStart.tsx / jobs/prompt.ts pictureFromWords path.
S3 Client dial shows Production "Nothing yet" for a client whose Production project exists.
S3 Production-in-library: project name "Crisps A/B second" propagated to shell/deck after two-tab test (rename from other tab became the saved name; expected, both edits kept by design).
S4 Storyboard "Draw the rest" created an extra empty shot 7 (frame drawn $0.14, undone); Gemini Omni clip box 4-5 needed because Veo cannot join shots.
S4 Brief Maker: Review "too vague" persists; Redraft needed twice-click arming timing; proposition rewritten off the founder's exact line.

## Spend
Providers $8.99 (images ~$1.2, sizes ~$2.1, frames ~$1.5, clips: Omni $0.53 + Veo 3 x ~$0.8-1.0 ~$3.1). Claude agents (brief x3, research, script, plan, deck) not exposed.

## Brief before/after
Before: bad-brief-harrowgate.md (two lines, 3 audiences, budget TBC). After: brief-v2-research.txt: one line "Proper crunch.", 18-35 core, GBP180k ex VAT incl media, legal line exact, no compostable/pub/bread; 10 "To confirm" tags remain.

## Verdict
Ad: a client would likely accept the structure and look: the named bag in every shot, 15.0 s, "Proper crunch." end card with the exact legal line and no studio card. Concern: the two office workers in frame 2 and its clip show partly visible smiling faces, against "no recognisable faces". Deck: not client-ready. Pictures now reach PPTX/PDF but the cover has none, storyboard slide is empty, 19 slides with repeated titles, ids in notes, "To confirm" and an empty questions slide. Territories should not go to UAT sign-off on this deck result.
