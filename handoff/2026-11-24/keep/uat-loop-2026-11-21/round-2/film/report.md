# UAT round 2 — T2 film (slug: film, hello@napkin)

Date 2026-11-20 22:24–23:30 UTC. UAT at fix/pt-uat-loop 80b20aa2. Headless Chromium 1440×900 (my own driver: `driver.mjs`).
Project: **UAT-R2 film Quietboil** `prj_01M7XH08SN70SWHZPRW15FT5B8`, from the Brief Maker brief "Let Them Sleep (Quietboil launch film)" via Continue in. Character **@maya** (2 views cropped from round-1 frames, uploaded).
Files: `jobs.jsonl` (25 jobs), `notes.md`, `shots/` (~125), `media/` (all outputs, strips, spectrograms, wavs), `jobs/<id>.json|.log`, `requests.jsonl`, `responses.jsonl`, `console.jsonl`, `failed.jsonl`, `ledger.txt`, `exports/` (media zip).
Audio: no transcriber is installed, and installing faster-whisper was refused by the permission system. Speech is judged from loudness envelopes, zero-crossing rates and spectrograms (`media/*-spec.png`).

## Part A: retest of round 1
| id | result | evidence |
|---|---|---|
| B1 + New box from words | **partly**. There is no error now, but the first Make draws a **frame** ($0.20) and stops. A second Make then makes the clip from that frame. No clip is made from the words alone, and the box gives no warning that a frame comes first. | job_01M7XKMXE18TQ6YB81BHQR4DGZ, job_01M7XKQM430Q7CDEZ734CDKRQC, shots/105-108 |
| B2 joined take into the cut | **fixed** for separate clips → join → Make. v5 replaced shots 1–2 in place in one step. The note says "Joined take of shots 1–2 is in the cut · Undo", the shot 5 trim and fade and both texts stayed, and no Use-this-take cards appeared. Regressions around it: F2, F12, F13. A new take of a box that is *already* joined in the cut still lands beside it with 2 per-shot cards (by design). | job_01M7XKE990FD2DTXZQ866FSJ1X, shots/099-100 |
| B3 end line to Script agent | **fixed**. The draft ends with NARRATOR "Quietboil. Let them sleep.", and the Plan/Draw previews list the mandatories and don'ts. | job_01M7XH3JFDCMQS6HERZQ6MP5BZ, shots/017, 024, 050 |
| B4 cutdown end card | **fixed**. Each version is picture, then the client's "Quietboil / Let them sleep." card (clientCard s=1.167), then the studio card. Only ~2.3 s of a 6 s spot is picture (the open question in the record). | media/cut6-a-4fps.jpg, cut6-b-4fps.jpg |
| B5 windows from found cuts | **fixed / not reproduced**. found_s was 2.5, 2.458 and 1.467 against plans of 2.5, 2.5 and 1.5, and the windows follow them. | jobs/*.json `cuts` |
| B6 sound | **partly**. Veo 3.1 is sent `audio:true` and priced $1.60 for 4 s (audioCredits 40). The line is in the prompt as speech, and the WAN 3 take has audio on. The whispered line is heard (voiced softly, not whispered) and so is the snore. Remaining problems: F4 cuts the line out of take 1, F8, F10. | job_01M7XJADENAH8MKCS3AXPMTMYG, job_01M7XK3DDK144KWSJHXJWVMP5Q, job_01M7XJG5KX6H4F17Y1Y7PCVM22 |
| B7 autosave | **fixed**, with a regression. The project was on the server 5 s after Continue in, every landing posts, and a reload keeps the cut and texts. **Regression F1:** the landing save races the 1-minute mirror, which raised a false "saved from another browser" conflict twice. | responses.jsonl 22:47:07, 23:00:08; shots/059, 082 |
| S3 parens / one Kept row / draft scroll / Continue in words / frozen copy / Draft from the brief / Script placement / Edit Esc / S at 0 / header length / toolbar at 1440 / sizes header + 1:1 / Review flag opens / @in numbering / evt=director on write and film_plan | **fixed** | shots/017-022, 005, 012, 100, 122 |
| S3 storyboard node "Make clips…" disabled | not fixed (canvas files) | shots/049 |
| S3 Claude ops $0.00 in the ledger | not fixed | ledger.txt |
| S3 mute button | not fixed. The toolbar button labelled **"Sound"** is the mute toggle, and the editor is "Open Sound". | shots/113 |
| S3 shot titles | partly. "At 1" is gone, but a title that starts with a mention loses it: "'s trembling finger…" | shots/049 |
| S3 Booth part text | not fixed. It still shows "¶1 A renter sock-skates…" after the line was edited to @maya. | shots/044 |

## BUGS (new or remaining)
**S1/S2**
- **F1 (S2) A false save conflict blocks saving.** Steps: make any clip and let it land near a minute tick. Expected: a silent save. Actual: two `POST /production/api/clan` 0.24–1 s apart (the landing save and the interval save). The second gets 409, and the banner reads "this project was saved from another browser or tab", with "Keep theirs as a copy / Save this as a new version". Seen twice in 35 min. Cause: `clan-store/src/store.ts` `postMirror` has no in-flight guard, and the new landing save in `web/src/projects/session.ts:149` overlaps the `setInterval` save. Serialising the posts would fix it.
- **F2 (S1) Cutting a joined box's gap and then using a new take puts the wrong footage in a shot.** Steps: Box 1 = shots 1+2 joined, in the cut → cut gap 1|2 → make shot 1 and shot 2 separately → Edit → "Use this take" on either card. Actual: **both** shot 1 and shot 2 clips switch to that one take, so shot 2 plays shot 1's footage (ad 3.5 s shows "Box 1 at 0:01.0"). The other card vanishes, and Box 2's dialog is titled "Box 1 v1" with a contradictory "0.5 s shorter". Swap take cannot repair it. The cut clips still `follow` the old boxId. Workaround: Undo, then Assemble again. Evidence: shots/090, notes.md 23:0x.
- **F3 (S2) The model on the box is not the model used.** After any Make, the last-picked model becomes "default" on every box: Box 2 (the spoken line) flipped from Veo to "Gemini Omni Flash 1.1 default · No sound made". Make on that box sent **no modelChoice**, and the relay chose Veo 3.1 with audio, an unplanned $1.60. Evidence: job_01M7XK3DDK144KWSJHXJWVMP5Q POST body; shots/058, 068.
- **F4 (S2) A take's length is the plan's, not the file's.** Veo rounds 3 s up to 4 s, but the web records the take as 3 s, because relay outputs carry no durationS and `web/src/jobs/handlers.ts:146` falls back to `shot.duration_s`. The Out window is capped at 3.0, and the "Out" field accepts 3.6 and silently ignores it. In take 1 the spoken line sits at 2.75–3.5 s, so the cut loses it. Evidence: shots/072-073, media/box2-veo-whisper-spec.png.
- **F5 (S2) WAN 3 refuses a narrow character picture.** Runway answered 400: ref aspect 0.534 < 0.55 (@maya_full). The relay does not pad or drop the picture, and the raw Runway text is shown to the person. job_01M7XJTZQTF9B0BBHM84P0F3H0 ($0).
- **F7 (S2)** B1 above: Make on a words-only box draws a frame and stops.
- **F8 (S2) The Sound editor does not reflect B6.** It says "No shot sound yet" and "No lines voiced yet. Write lines… in the Script editor" while 3 clips in the cut have sound and the script has a line. The NARRATOR VO Dex put on the end card is never voiced, and nothing tells the person.

**S3**
- **F6** The gap refusal names the wrong shot: "Shot 2 has a spoken line ("Good boy.")" (it is shot 3). `rooms/joinCut.ts:44` passes the 0-based `a.i` to `joinBlock`, whose other caller passes a 1-based number.
- **F9** Captions on: "Good boy." stays 3 s, into the hall shot, and is stacked over the "1:04 a.m." text on the track. media/ad-render-v1-strip.jpg
- **F10** Omni outputs carry an audible audio track (join take max −12 dB), but the box says Omni "makes no sound".
- **F11** The first Omni joined take burned in the text "1 a.m. 1 a.m." despite "No text…". media/box1-omni-join12-strip.jpg
- **F12** Undo on the joined-take note cannot be redone ("Nothing to redo"). The cut had to be rebuilt by Swap take twice.
- **F13** Swap take on shot 1 lists v4, which is shot 2's separate take.
- **F15** Bin box numbers shift after a cut or join: shot 3 goes Box 2 → Box 3 → Box 2, and shot 2's take is renamed "Box 1 v4". The media zip holds each joined file twice (once per shot).
- **F16** The cutdown plan defaults a 9:16 shot to paid Aleph "new edges" (the crop needs a select). The Review flag says "No supers or captions" on a version that has a caption.
- **F17** Plan shots is blocked until @maya has a front. The chooser's "Done" has aria-label "Close", and Escape does not close it. After choosing, the view was the canvas, not the script.
- **F18** After Plan shots, the Brief card sits on top of the Storyboard node on the canvas. shots/048
- **F19** There is no "Download the ad" control. Only "Download all media (zip)" (it works: 22 files, 39.8 MB) or the native video menu.
- **F21** The ledger shows $0 for all 22 Dex/Skye calls (498k input / 31k output tokens, about $2).
- **F22** "Cut it to 10 seconds" leaves the target at 15 s, so Plan shots plans 6 shots and 15 s for a ~12 s script. Dex adds sound beats ("night hum", "faint hush") to most shots, which turns on audio pricing (Veo doubles) for shots that need no sound.

## Dex findings
- **What Dex got.** write: the brief with its end line (B3 fixed), plus target and refs. shot_list: the full script, with the line as a `line` beat and speaker MAYA. Clips: the shot, the frame, refs, the brief, and for takes the cuts. director.v15 is used, and `evt=director` is logged for every op including write and film_plan.
- **What Dex sent.** Correct ref places ("follows image 3/4" after two character pictures: the dex-context fix works). Veo gets the frame alone, with Maya in plain words. Dex rounds 3 s up to 4 s. The relay appends "[1.5 s] MAYA, whispering…: "Good boy." Spoken aloud, no subtitles". Dex dropped maya_full on its own for WAN in one job, but not in the next (F5).
- **What it could get or should send.** The take's real file length (F4). The VO line made into sound, or a note that it will be silent. Sound beats only where the story needs them (F22). Tags are sent as plain words ("maya front"), which works but reads oddly. The sound beat text itself ("one soft snore") is in the action, but no sound line is added to the prompt for `sound` beats; the snore came through anyway.

## Sound (T2.1)
| clip | audio switch | heard |
|---|---|---|
| Veo 3.1 take 1 "Good boy." | `audio:true`, $1.60 | Kettle hum 0–2.4 s. Breath at 2.45 s, then voiced two-syllable speech 2.75–3.5 s with harmonics, so voiced softly rather than whispered. It comes 1.25 s later than asked and is cut by the 3.0 s window (F4). |
| Veo 3.1 take 2 | `audio:true`, $1.60 | Clicks at 0.4 and 0.8 s, speech 1.9–2.8 s while she leans to the kettle. Inside the window: **audible in the rendered ad at 6.4–7.3 s.** |
| WAN 3 join, snore + salute | `audio:true`, $0.50 (no surcharge) | A low harmonic rumble 0.2–1.6 s (snore-like) during shot 4, so it is heard. Then near silence and a pop at 4.8 s. |
| Omni (all) | no switch | Ambient track present (−12 dB peaks), not silent (F10). |

## Quality (1–5)
| job | what | score |
|---|---|---|
| write draft / tone / length / dialogue | Skye | 4 / 4 / 3 / 4 |
| shot_list | 6 shots follow the rewrites | 4 |
| frames 1–5 | @maya held | 4, 4, 4, 4, 3 (salute moved into the hall) |
| Omni join 1+2 v1 / v2 / v5 | joined | 3 (burned-in text) / 3 (kettle drift) / 4 |
| Veo whisper take 1 / 2 | separate, sound | 3 / 4 |
| WAN 4+5 join | snore | 3 |
| Omni shot 1 / shot 2 separate | from frame | 4 / 4 |
| words box clip | Omni | 3 (cartoon steam) |
| ad render v1 | 17.24 s | 4 |
| cutdowns 6 s 16:9 / 9:16 | ffmpeg | 3 / 3 (crop loses the finger; only 2.3 s of picture) |

**Characters (T2.3).** Separate clips started on frames held Maya at 4/5 (Omni ×2, Veo ×2). Joined takes held her clothes and hair at 3/5, with softer faces and small figures, and in one the setting drifted. A 3-shot join was not possible here: shot 3 speaks, so gaps 2|3 and 3|4 are locked. Every join was 2 shots.

## Joining (T2.2)
Join (default) → Make: the take first lands beside the cut, or in it once a cut exists (fixed). Cutting gap 1|2 leaves the cut unchanged. Making separate takes and using them hits **F2**. Undo is one step each and restores. "Assemble first cut again" asks first (fixed) and dropped only the trims it named. Re-joining leaves the cut unchanged, and Make puts the take in place, keeping the shot 5 trim and fade and both texts. The note's Undo works but cannot be redone (F12).

## Script writing (T2.4)
Draft 17 s, rewrites 7.6–10 s. Control is good (Keep/Discard/Why, cards scroll into view, one Kept row), and the plan followed every rewrite (line beat, snore beat, VO end card). Proposed improvements:
1. Show the edit diff in screenplay layout. Today the card flattens cues and parentheticals into one paragraph of struck-through words.
2. When an ask names a length ("10 seconds"), offer to set the target too.
3. Show seconds before and after on each card.
4. Link the character cue to @maya automatically when the cue name matches a character.
5. Refresh the Booth "THIS PART" text after edits.
6. Tell the person before Plan shots that @maya needs a front, not after the click.

## Timings
| op | click → landed (UI) | relay total |
|---|---|---|
| Continue in → canvas | 9.1 s | — |
| draft / rewrites | 17.2 / 9.6 / 7.6 / 10.1 s | 17.1 s |
| Plan shots | 15.7 s | 14.4 s |
| frame 1 / frames 2–5 | 39 s / 175 s (~44 s each) | 34–43 s |
| Omni take 5 s | ~75 s | 70–75 s |
| Veo 3.1 4 s with audio | 69 s, 57 s | 68.5, 56.7 s (provider 60 s) |
| WAN 3 5 s | 169 s | 161 s (provider 135 s) |
| Omni single 3 s | ~46 s | 45.6 s |
| render | ~20 s | 17.8 s |
| cut plan / 2 sizes | ~25 s / ~12 s | 21 s / 11.5 s |

**End to end (T2.5).** From Continue in (22:24:58Z) to two 6 s cutdowns ready (23:23:29Z) took 58.5 min of wall time, including all the test detours. Machine time on the critical path is about 9–10 min (draft, plan, 5 frames, parallel clips at ~1.2–2.8 min, render, cut plan, sizes). Cost: $7.55 confirmed, plus about $2 of Claude usage the ledger does not record.

## Edit room (T2.6)
- Captions works (adds "Good boy." but see F9).
- + Text works (lower third, From/To, fades).
- Sound editor: a placeholder that is out of step with the cut (F8). The "Sound" button mutes the preview.
- Render ad: works, with the review dialog "keeps each clip's own sound".
- Rendered tab: plays the 0:17 render with native controls.
- Download: zip only (F19).
- Console: only the 409s and the expected 401. No page errors.

**Spend: $7.55 of $12.** Frames $1.20, Veo 3.1 with audio $3.20 (one unplanned, F3), Omni $2.65 (one by misclick), WAN $0.50. Stitch and cutdowns $0.
