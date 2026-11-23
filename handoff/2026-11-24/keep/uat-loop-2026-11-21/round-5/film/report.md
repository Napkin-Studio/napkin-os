# UAT round 5: film (slug film, hello@napkin)

2026-11-21, 05:00 to 05:31 UTC. UAT at fix/pt-uat-loop f29fc482. Headless Chromium 1440x900 via `driver.mjs` (port 9561, stopped at the end). Claude in Chrome not used.
Project **UAT-R5 film** `prj_01M7Y7PDKR4TXF4V5SAYQZMQ7J`, made with Continue in, then Production Tool, from "Let Them Sleep (Quietboil launch film)". @maya = the same two pictures as rounds 2-4.
Script: drafted from the brief, then "Name her MAYA… Good boy…" (kept), then "Make it 10 seconds" (lines kept, but the flatmate line was cut, so I undid it and set the target to 10 s instead). Plan shots gave 7 shots: 1 enter, 2 fill, 3 switch, 4 kettle insert, 5 "Good boy.", 6 hall/flatmate snoring, 7 mug + NARRATOR VO.
Files: `jobs.jsonl` (20 jobs), `jobs/` (record + relay trace each), `shots/` (95), `media/` (7 frames + strip, box5-wan3.mp4 + spectrogram, box6-omni.mp4, ad-v1.mp4, cutdown6.mp4 + strips), `requests|responses|console|failed.jsonl`, `paid.log`, `ledger.txt`, `quality.json`.
Relay trace: every job has job_stage; every provider job has provider_submit + director; no director_rejected. The AWS session held for the whole run.

Summary: Part A 14 fixed, 2 partly, 3 not re-testable. New bugs: 1 S2 confirmed, 1 S2 suspected (needs someone to listen), 7 S3.

## Part A: round-4 ids retested
| id | result | evidence |
|---|---|---|
| R4-F1 WAN 3 pick made on Veo | **fixed**. Box 5 (shot 5, "Good boy.") with WAN 3 picked: POST `modelChoice {runway, wan3}`, provider_submit `model wan3`, 2 s, `audio:true`, **$0.20** | job_01M7Y8MDS007Z4EEE3QD63JQGX, shots/055-056 |
| R4-F2 "a flatmate" draws Maya | **fixed**. Shot 6 frame: no character refs (only @anchor/@previous). Dex: "A different person from Maya… door stays closed". The frame is an empty hallway. The storyboard ref row says @maya is in shots 1 2 3 5 7 | job_01M7Y8ENG70N9SRS00J21F18JF, media/frame6.png |
| R4-F3 script asks after Plan shots | **partly**. Fixed: a picked shot gets its real action; a true tie asks which shot ("Make Maya funnier" gives 5 choices); the length ask sends every real line (+ "Good boy." + VO) and shows "about 10 s → 8.4 s". New: a shot ask does not carry the shot's own spoken line (R5-F1) | job_01M7Y954W…, job_01M7Y972F…, job_01M7Y97NZ…, shots/080-086 |
| R4-F4 cut plan / 6 s cutdown | **fixed**. Dex planned in 4.9 s (cutter.v2, 3.6k in / 756 out, agentUsd $0.0149): keeps shots 5 (1.5 s) + 7 (2.0 s). File 1080x1920, **6.00 s** = 3.5 s picture + 2.5 s card. Tile "Film 9:16 · 6 s" | job_01M7Y9299…, job_01M7Y93HC…, media/cutdown6-strip.jpg |
| R4-F5 one picture twice | **fixed**. Frame 2 sends maya_front, maya_full, @anchor only. In every other job, all sha256s differ | job_01M7Y89YC… |
| R4-F6 end line nowhere | **fixed**. With no clip voicing the VO (Omni), the preview and the render show "Quietboil. Let them sleep." as a super over shot 7's last 2 s. Review: "is not voiced, so it shows as a super" | shots/064, 066, media/ad-v1-strip.jpg |
| R4-F7 joined-take window | **fixed**. Box 6: Dex "[0-1 s] / [1-3 s]", web windows Shot 6 0-1 s, Shot 7 1-3 s | shots/088 |
| R4-F8 wording | **fixed**. Name dialog "(a location, a font…)"; "from the Script"; Omni box "will not make the voice-over and the sounds asked for"; sizes sheet "Reframe · crop" (no free/paid). The UI sweep (canvas, Make, Edit, Script, Booth) found no free/paid/$ outside Decisions; Decisions shows $ (correct) | shots/034, 049, 075 |
| R4-F9 "Make shot 4 apart?" | **fixed**. A whole-take Camera ask on Box 6 says "makes a new take of shots 6 and 7. The shots' own words stay", with no apart offer (Make not pressed) | shots/088 |
| R4-F10 sound beats / clock | **clock fixed** (frame 1 "in the small hours", no text burned in). Sound line **not re-testable**: the only sound-on clip (Box 5) has no sound beat; Omni has no switch | job_01M7Y888Y… |
| R3-F1 insert forces person | **partly**. The insert (shot 4) sends no character refs and Dex says "no person appears", but Maya is drawn beside the kettle (R5-F3) | media/frame4.png |
| R3-F3 / R3-F7 | fixed with R4-F3 above (length ask keeps lines after Plan shots) | |
| R3-F12 6 s cutdown | fixed (see R4-F4) | |
| R3-F14 library / Booth | **fixed as decided**: the library stays open when a picture is selected and closes when the Script node is selected | shots/090-092 |
| F21 Claude cost recorded | **fixed**: every write, shot_list, frame, clip and the cut plan has agentUsd | ledger.txt |
| R3-F6 silence beat, F12 note Undo, R3-F15 Back | not re-testable (no silence beat; no note; chooser not shown) | |

## BUGS (new)
**S2**
- **R5-F1 A shot ask after Plan shots drops that shot's spoken line and files it under the previous shot.** Steps: script with shots planned, Ask "Make Maya funnier", pick "Shot 5". Sent: target shot 5, `lines:[{action:"@maya whispers to the kettle."}]`, with no `MAYA: Good boy.`. In `context.neighbours` the line appears under "Shot 4: …" (`line MAYA: Good boy.`). The Script agent wrote a new spoken line into the action ("…whispers like a hostage negotiator: \"Easy now. Nobody wakes up.\"", 1 s → 4 s) while "Good boy." stays as the beat. Keeping it would give shot 5 two lines. The same misfiling happened for "Make the snoring line funnier" (shot 6's sound beat listed under Shot 5; the neighbours start with shot 4's header-less "sound: Click as it switches off"). Code: `web/src/script/skye.ts` `neighbours()` lines 57-71. It slices ±3 *rows*, so beats lose their shot header and the target shot's own beats stay in, attached to the shot above. `writeInput` builds a shot target's `lines` from its prose only, not its line/VO/sound beats. Expected: a shot target's lines = its action + its beats (as cue + dialogue), and neighbours = whole shots with their beats. Evidence: job_01M7Y972F9693P4G9BGP1F30YK, job_01M7Y954W301G1NHAK2YM055JR, shots/084-085.
- **R5-F2 (suspected; needs someone to listen) The spoken line is cut by its 1 s window.** Plan shots gave shot 5 ("Good boy.", whispered) 1.0 s. WAN 3 made 2.0 s (its minimum) with voiced bursts at 0.4-0.8 s and 1.0-1.7 s (the second is the louder one, -22 dBFS, with a pitch sweep). The ad plays 0-1.0 s, so only the first burst is heard (ad-v1 envelope: -31 dB at 0.4-0.5 s, then the hall). The 6 s cutdown keeps 1.5 s. No transcriber here, so I can't tell if the second burst is "boy". Expected: a shot that speaks keeps its take until the line ends (or Plan shots gives a line at least its spoken length). Code: the take window in `jobs/takeTiming.ts` / the lone-take planned length (R3-F2 fix), and the shot_list timing of line shots. Evidence: media/box5-wan3.mp4, box5-spec.png, ad-v1.mp4.

**S3**
- **R5-F3** Insert frame draws the character: shot 4 "The kettle glows…" (insert, no refs, Dex: "no person appears") shows Maya beside the kettle, and as a medium shot rather than an insert. @previous (frame 3, Maya) is sent "for continuity" and the prompt never says "no people". Fix: for a shot with no character, drop a @previous that shows one, or add "no people in frame" (director frame prompt / `jobs/frames.ts` continuity). job_01M7Y8CHAN88XA3FVKHZA0PPK8.
- **R5-F4** Tie UX (confirmed): after an ask that ties, the ask box clears and the choice panel shows only "These fit what you asked. Which one is it about?", without the words asked. `SkyeBooth.tsx`: `which.words` is kept but not rendered. shots/081.
- **R5-F5** A shot-scoped draft card says "The whole script, from: …" under "REPLACES SHOT 6'S WORDS". shots/083.
- **R5-F6** 9:16 cutdown: the "words on every version" end line runs over the whole picture from 0.5 s and sits over the "Good boy." caption on shot 5. Shot 5 is cropped although the plan says "the crop would cut the subject" (Crop is the right no-spend default, but the kettle is cut off). media/cutdown6-strip.jpg.
- **R5-F7** Save refused without a word: after URL reloads in one tab (canvas, /video, /script, /video within ~30 s), POST /production/api/clan → 409 "This project was saved from somewhere else at 05:28:52Z since you opened it". No banner appeared, and the header kept "saved 10:58". failed.jsonl, responses.jsonl, shots/095.
- **R5-F8** Dex facts: the cut-plan reason says Maya "says the end line" (it is an unvoiced NARRATOR VO); the Omni prompt names "The woman is maya front… maya front grins" (underscore name in plain words, as in round 4).
- **R5-F9** Small: Decisions filter "Campaign · 1 formats"; the Booth part card kept "1:04 a.m. MAYA…" after the @maya mention; kettle continuity: stovetop in frame 2, electric in 4-5 (open product-spine question).

## Dex findings
- **Got.** Frames (director.v17, effort low): **10.3-11.0k in / 405-602 out, 3.8-6.4 s**. WAN clip 11.2k / 700, 5.5 s; Omni take 12.1k / 1521, 12.8 s; shot_list $0.066; cut plan (cutter.v2) 3.6k / 756, 4.9 s, so no timeout this time.
- **Sent, good.** Frame 6: "A different person from Maya… door stays closed", no character refs. Frame 2 dedupe ("anchor" only). Clock rule ("in the small hours"). WAN line: `[0 s] MAYA, whispering, to the kettle: "Good boy." Spoken aloud`, 1 s raised to the 2 s minimum. The cut plan kept the hook + payoff to exactly 3.5 s of picture.
- **Sent, bad.** The insert frame with no "no people" line (R5-F3); "maya front" in plain words; the cut reason's "says the end line".
- **Should get / send.** A shot's own beats in a shot write (R5-F1); the spoken length of a line when it times a shot (R5-F2).

## T2 results
1. **Storyboard frames**: shot 6 flatmate: no Maya ref, "someone else" ✔. No job sends one picture twice ✔. Frames carry their beat, no "1 a.m." text ✔. Insert 4 still shows Maya (R5-F3).
2. **Box 5 on WAN 3**: sends WAN 3, not Veo ✔ ($0.20). The box says "Sound on: WAN 3 makes the spoken line in the clip", which matches the sheet (wan3 audioControl true); it does not say "won't be voiced", and the clip does contain speech. Whether the whole line survives the 1 s window: R5-F2.
3. **Cut plan + 6 s 9:16**: Dex planned (not a fallback), 6.00 s file, 3.5 s picture ✔.
4. **End-line super**: preview, render and Review ✔.
5. **Script asks after Plan shots**: lines present ✔ (scene), tie gives "which shot" ✔, length ask keeps lines and shows real seconds ✔. Shot ask loses its own line ✘ (R5-F1).
6. **Camera ask "whole take"**: no apart offer ✔. **Booth/library** ✔. **Cost words** gone from the sizes sheet ✔. **Ask box clears on a tie**: confirmed (R5-F4).

## Quality (1-5)
Frames: 1 = 4, 2 = 4, 3 = 3 (wall switch, not the kettle's), 4 = 2 (Maya in an insert), 5 = 4, 6 = 5, 7 = 4. Box 5 WAN 3 = 4 (identity held, mouth moves). Box 6 Omni = 4 (smeary mug steam). Cutdown 6 s 9:16 = 3 (R5-F6).

## Timings
| op | click → landed | relay |
|---|---|---|
| Continue in → canvas | 4.7 s | |
| draft / ask1 / ask2 | 15.2 / 12.2 / 11.2 s | |
| Plan shots | ~17 s | |
| frame 1 | 35 s | 28.9 s (provider 21.8 s) |
| frames 2-7 (chained) | 222 s | 29.8-37.7 s each |
| Box 5 WAN 3 2 s | 98 s | 93.9 s (provider 79.6 s) |
| Box 6 Omni 3 s | 72 s | 65.5 s |
| render ad | 9.8 s | |
| plan the cuts | 20.5 s (incl. sheet) | 5.6 s |
| cutdown 6 s 9:16 | 16.3 s | 11.4 s |
| post-plan asks | 9-11 s | |

## Spend
Provider **$1.94** of $3 (cost.confirmed): 7 frames × $0.20 = $1.40; WAN 3 2 s $0.20; Omni 3 s $0.34; stitch/cutdowns $0.
Claude **$0.51** (cost.agentUsd, 20 jobs).
