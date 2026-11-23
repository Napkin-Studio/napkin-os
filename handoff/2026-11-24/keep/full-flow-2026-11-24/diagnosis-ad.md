# Diagnosis: ad storyboard and end card (develop 4cbf69b5, read-only)
Paths are under production-tool/. Evidence: drv/requests.jsonl (the job bodies the web posted).

## A. Frames ignore @ferncan, and "no real faces"

Evidence from the posted jobs (09:03-09:20):
- shot_list at 09:13:18 had `refs: []`. @ferncan was only named at 09:14:44 ("button: Save", decision "name @ferncan_the-ferncliff-oat-flat-white-can"). The shots were planned before the name existed, so no shot text says @ferncan.
- All 6 frame jobs (09:15-09:18) have `shot.refs: []` and no `input.refs` at all, not even optional ones. Only anchorFrame (frame 1) and, for some, previousFrame went. The can in frames 4-5 is invented by the model.
- No frame job, no write job and no shot_list job has a `brief` key. The "no real faces" line only exists in the tester's typed instruction to the script agent, and in the brief's mandatories ("No real people's faces on posters").
- The clip job (take_refs) got only the 6 frames as `composition` refs, no named picture, so the film repeats the frame errors.

Cause:
1. A named picture reaches a frame only two ways. (a) The shot's own text contains @name (web/src/jobs/select.ts:112-118, shotRefSet, `from: words`, required). (b) It is linked into the storyboard, script or video scope (select.ts:128-132, `offered`, optional, and Dex may drop it). Here the can was named on the canvas but never linked to the script or storyboard, and the planner never wrote @ferncan, so neither path fired. Nothing re-tags shots when a name is added later.
2. frames.ts:108-141 (frameInput) takes refs only from refsFor, then castRefs (cast.ts:104-117). The "draw the rest" frames go through the same frameInput, so they carry exactly what a single frame carries: nothing extra.
3. Take_refs equivalent: clips.ts:140-170 puts frame pictures as composition refs and adds the shot-named and offered refs. Storyboard frames have no equivalent that brings in the product. Frames chain on picture continuity only (anchor = frame 1, previous = frame before), and frame 1 never had the can. So the can drifts or is invented. Frame 5 also drops previousFrame on purpose (cast.ts skipsPrevious).
4. Faces: the brief reaches a job only when a Brief node is linked into its scope (brief/model.ts:122 briefForJob, 190 withBrief). Here none was linked to the Script or Storyboard, so write, shot_list and frame jobs went without `brief`. The relay would send donts then mandatories to a frame (relay/brief.py:35, 360 chars) if it arrived. Separately, the only people rule on frames is shot-text driven: noOneShot (cast.ts:97) adds "no people" only when the text has no person word. Frame 1's text ("crowded tram. Hands grip the rails") has "hands", so it counts as a people shot, and nothing says "not real faces". Even with the brief linked, "No real people's faces" would sit in a 360-character budget at the end of the list, after donts.
5. The model was Gemini 3 Pro (report), with the picture refs it was given. It was not the cause.

Smallest fix that would hold:
- (a) At frame time, if the project has exactly one product-role named ref (or the storyboard's scope is missing it), send it as a required ref for any shot whose words say "can" (or that the shot list marked as product), the same way castRefs promotes a lone offered character. Cleaner and safer: when a name is created or a Production starts, link the key visual/named product into the Script so it comes in as `offered`, and make `offered` product refs required when the brief mandates "the can is the hero".
- (b) Give frames the brief when none is linked: use `onlyBrief(d)` as withBrief already does for `generate` (brief/model.ts:195). Extend that fallback to write, shot_list, frame, clip. This is the same one-line idea the end card already uses.
- (c) Put the brief's "no real people/faces" into frame prompts as its own line: parse it from mandatories/donts into a flag, and add it in director.py `_no_people` area (director/director.py:332-342) even when the shot shows people ("anonymous, unrecognisable people, no close faces").

Test that proves it: a frames.test.ts case with a doc that has one product ref named `ferncan` (not linked), a shot "A hand lifts the can out", and a brief with the faces mandate. Expect frameInput to return refs containing ferncan (not optional) and `brief` with the mandate. A relay director test: a frame job with a "no real faces" brief gets the line in the prompt even when shot text says "crowded tram". Final check is one live frame run for the paid proof, only with the owner's say.

Owner questions: (1) Should a lone product ref always go to every frame that mentions the product, even when not linked? (2) Should the single Brief node in a project always feed every Production job, as it does for Generate now? (3) What does "no real faces" mean in practice: no faces at all, or only generic and unrecognisable ones?

## B. End card has no legal line

What the earlier fix did (commit 0c7aa4f8, "apps: fixes from the UAT full-flow runs", web/src/rooms/timeline.ts:175-181, withLegal; used by endCardFrom and newEndCard). It copies the brief's legal line into the card's `cta` when the card has none. It reads the line with `legalOf` (brief/model.ts:173-181).

Why it did not show:
1. `legalOf` only picks a mandatory that matches a keyword list: legal, disclaimer, small print, drink responsibly, 18+, T&Cs, terms apply, age gate. This brief's line is "Include 'Contains caffeine. Not recommended for children or pregnant women.' To confirm: ...". It has none of those words, so legalOf returns undefined and withLegal does nothing. This is the cause.
2. The legal line is stored in `cta` and shown under the label "Call to action", max 80 chars (Inspector.tsx:149). There is no "Legal" field in the end-card editor, so a person cannot tell where it goes. The renderer draws `cta` as the small legal text (relay/timeline_layers.py:103-105), so it only worked because of the tester's guess. (Make all sizes does have a Legal field, FilmSizesSheet.tsx:199; the master editor does not.)
3. The headline and line are the shot description: endCardOf (timeline.ts:184-200) takes the END CARD shot's text "the can centred on clean colour. Flat out good. appears, the legal line small beneath." and splits it into headline and line. The label stripper only handles "end card with the super:" style prefixes, so the planner's directions ("appears, the legal line small beneath") become card words. The shot list (script text at 09:13:18) wrote "END CARD: the can centred on clean colour. Flat out good. appears, the legal line small beneath."
4. withLegal also returns early if cta already has text, and the card was probably made before the fix was relevant; readCut keeps an existing card (timeline.ts:143).

Smallest fix:
- Take the legal line from the brief more robustly: also match a mandatory that says "Include '...'" / "must carry" with a quoted sentence, or a "caffeine"/"not recommended" style phrase. Better: add an explicit `legal` field to the brief spine (or tag it when the mandatory is created) so no keyword guess is needed.
- Add a "Legal" field to the end-card editor (its own `legal` key, max 200), render it from that key, and keep `cta` for the call to action. Prefill from the brief.
- Strip direction words from the card: drop clauses like "appears", "small beneath", "centred on clean colour", and ask the planner to put the words in quotes. Fall back to the project name plus the brief's end line (endLineOf) when the shot text has no quoted words.

Test: timeline.test / brief model test with the real mandatory string above: legalOf returns "Contains caffeine. Not recommended for children or pregnant women." Then an endCardFrom test for the shot text above giving headline "Flat out good." and legal filled, line not "appears, the legal line...". A relay test that a card with `legal` draws it (test_campaign.py).

## 17.4 s for a 15 s ad
Every master render appends the studio "Napkin Studio" card: CARD_S = 2.5 s (stitch/stitch.py:58; stitch/timeline.py:229 concat of film + card, plus 2.5 s silent audio). Film was 14.9 s plus the client's end card, so about 14.9 + 2.5 = 17.4. It does not count against the ad length for the master: the web says so itself (film.ts:14, FilmSizesSheet.tsx:166 "film + end card"). It is inconsistent with the sizes: for cutdowns and sizes the studio card is taken out of the requested length (relay/cutdowns.py:90-128, fit_windows target = length - studio - client card), so a 15 s size is 15 s with the studio card inside. So the master can be 17.4 s while its 15 s cutdown is 15.0 s.
The client's own end card is inside the 14.9 s (the script was 4 shots with the card as shot 4).
Open question for the owner: should an ad for a client carry the studio card at all (the end card of a client ad is theirs), and if it stays, should the master length count it like sizes do, or should a client export be able to switch it off? Today a 15 s broadcast slot gets 17.4 s.
