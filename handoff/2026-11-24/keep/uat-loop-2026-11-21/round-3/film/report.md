# UAT round 3: T2 film (slug film, hello@napkin)

Date 2026-11-21, 00:43 to 01:38 UTC. UAT at fix/pt-uat-loop b60b21ed. Headless Chromium at 1440×900, driven by `driver.mjs` (port 9343; stopped at the end). Claude in Chrome was not used.
Project: **UAT-R3 film Quietboil** `prj_01M7XRYZ6T8DGMT8HFFZAT1G8C`, made with Continue in → Production Tool from the brief "Let Them Sleep (Quietboil launch film)". Character **@maya** uses the same 2 pictures as round 2. @maya_full is narrow (0.534).
Files: `jobs.jsonl` (23 jobs), `jobs/<id>.json|.log`, `shots/` (139), `media/` (outputs, strips, wavs, spectrograms), `exports/` (the ad mp4 and the media zip), `requests|responses|console|failed.jsonl`, `paid.log`, `ledger.txt`, `notes.md`.
Audio: no transcriber is installed. Speech is judged from loudness envelopes, zero-crossing rates and spectrograms (`media/*-spec.png`), as in round 2.

Summary: Part A has 20 rows fixed, 5 partly (F3, F15, F22, shot titles, F4 has a regression), 1 not verifiable live (F5) and 1 not seen (double dot). There are 5 new S2 bugs and 10 new S3 bugs.

## Part A: round-2 bugs retested
| id | result | evidence |
|---|---|---|
| F1 false save conflict | **fixed**. 45 POST /api/clan, all 200, none closer than 1.5 s apart, no conflict banner. | requests/responses.jsonl |
| F2 Use this take after cutting a join | **fixed**. Join 1+2 (WAN 3) → cut 1\|2 → shot 1 on Omni and shot 2 on WAN 3 → Use this take on the Box 1 card switched only shot 1, and the Box 2 card stayed. Then Box 2 switched only shot 2. Undo brought back the joined take and the card, and Redo (Ctrl+Shift+Z) applied it again. | shots/079-084, job_01M7XT6D…, job_01M7XT7M… |
| F3 shown model = sent model | **partly**. Make always sends an explicit `modelChoice` that matches the box (wan3, gemini_omni_flash_1.1, veo3.1), and a box with takes keeps its own model (Box 1 kept WAN 3). But a box *without* takes still drifts to the last model used. After the WAN 3 join, shot 4 (the spoken line, Veo 3.1 at first) and shots 3 and 5 all showed "WAN 3 default". | shots/059 vs 070, 083 |
| F4 real take length | **fixed**, with a regression (R3-F2). Outputs carry `durationS` (4.011, 3.029, 2.02). The Bin shows the real lengths, and Out accepts up to 4.0. Out = 4.5 shows "4.5" in the field but plays to 4.0 (the round-2 silent ignore is still there, S3). | shots/066-068 |
| F5 narrow ref on WAN 3 | **not verifiable live**. Dex dropped @maya_full on its own in both WAN 3 joins, and separate WAN 3 takes send the frame without refs. Padding is unit-tested only. My try to force it through "Tell the Camera agent" hit R3-F5. | job_01M7XSXS…, job_01M7XVCV… |
| F6 gap refusal names the wrong shot | **fixed**: "Shot 4 has a spoken line (“Good boy.”)". | gap aria-labels |
| F7 one Make from words | **fixed**. The box says "Make draws the frame first, then the clip from it." One click made the frame (42 s), then the Omni clip started by itself at +50 s and landed at 108 s. | job_01M7XV85…, job_01M7XV9M… |
| F8 Sound view | **fixed**. It lists each shot's sound (background, silent, clip sound), says Shot 4's MAYA line is "spoken in the clip", and says the NARRATOR VO is "not voiced… heard nowhere". | shots/100 |
| F9 captions | **fixed**. "Good boy." runs 6.0–7.5 s inside shot 4. With text already on screen there, the line is left out and the editor says so. | shots/097-099, media/ad-render-v1-strip.jpg |
| F10 Omni sound claim | **fixed**: "Gemini Omni Flash 1.1 makes its own background sound and has no sound switch". | shots/058 |
| F11 burned-in "1 a.m." | **fixed**. Prompts say "in the small hours", and no burned-in text appears in any take. | provider_submit promptText |
| F12 Redo of the joined-take Undo | **fixed in the bar** (Undo then Redo restored v2). The note's own Undo turned into "The cut has changed since: use Undo in the bar" when nothing had changed (S3). | shots/126-131 |
| F13 Swap take lists another shot's take | **fixed**. Shot 1 lists only the joined v1. | shots/085 |
| F15 box names / zip duplicates | **partly**. Boxes are named by shot (Box 4 = shot 4) and the zip holds each take once (17 files). But version numbers disagree in three places: the Bin says "Box 1 · v1 · New take", the agent note says "Made take v2 for shot 1", and the zip says `shot1-clip-v2`. The Use-this-take sheet says "Now: v1 · First take / New: v1 · New take". | shots/080, exports/*.zip |
| F16 9:16 defaults to paid Aleph | **fixed** (Crop · free is the default). The reason line still argues for New edges (S3). | shots/111 |
| F17 fronts before Plan shots | **fixed**. A banner appears before the click, Escape closes the chooser, and "Done · back to the script" returns to the script. | shots/037-044 |
| F18 Brief card on the Storyboard node | **fixed / not reproduced** | shots/107 |
| F19 Download the ad | **fixed**. The Rendered tab has ↓ Download, which gives `UAT-R3-film-Quietboil-ad.mp4`, byte-identical to the render. | exports/ |
| F21 Claude cost recorded | **fixed**. `cost.agentUsd` is on every Claude op (write 0.025–0.032, shot_list 0.046, frame and clip 0.038–0.053, cut plan 0.024). | ledger.txt |
| F22 length ask / sound beats | **partly**. "Make it 10 seconds" offers "Set the film's target to 10 s too?" (fixed). But Dex still adds a sound beat for silence ("Silence: the kettle boils with no noise at all"), which turned shot 3 into "Sound on: Veo 3.1" by default (that would have cost $1.60). | job_01M7XSH3… |
| B1 (F7) | fixed, as F7 | |
| B6 sound | **fixed for the line**. The Veo 3.1 take has a voiced burst at 0.55–0.95 s, inside the 0–1.5 s window and audible in the ad at 6.1–6.4 s. WAN 3's snore is a low rumble. | media/shot4-veo-spec.png |
| S3 Mute | **fixed**: Mute/Unmute, aria "Mute the preview" | |
| S3 storyboard node "Make clips…" | **fixed** (enabled) | |
| S3 Booth part text | **fixed**. It shows the edited ¶2 "@maya, in a dressing gown…" | shots/037 |
| S3 shot titles | **partly**. A title that starts with a mention now falls back to the camera size ("Medium"). "1 a.m" loses its dot. | shots/050 |
| Script UX 1-3 | **fixed**. The diff uses screenplay layout, shows "about 14.9 s → 9.6 s", and offers the target. | shots/017, 021 |
| "SCRIPT AGENT · · THE TEXT CHANGED" double dot | **not seen**. Every card read "SCRIPT AGENT · EDIT · REPLACES THE PAGE". The stale-card test was blocked by R3-F3. | |

## BUGS (new this round)
**S2**
- **R3-F1 The storyboard forces "the person from shot 1" into shots that name no one.** Steps: plan with shot 3 = kettle insert and shot 5 = wall close, then Draw the rest. The web sends frame 1 as a *required* character ref (label "the person from shot 1"), and Dex writes "The character is @in_1". Result: the insert is drawn as a medium shot with Maya, and the kettle changes from white to glass. Frame 5 also sends the same image twice (in_1 and anchor). Location: `web/src/jobs/cast.ts` `castRef`. It should fire only when the shot's action names a person, and the project's @maya (sent as optional) should win over frame 1. Evidence: job_01M7XSNSG82FZA2AE361HZXK63, media/frame3.png.
- **R3-F2 (regression from F4) Assemble plays whole padded takes.** Assemble first cut again took each take at its real length: shot 1 3.0 s (planned 1.5), shot 4 4.0 s (planned 1.5). The result was 15.6 s on a 10 s target ("Over by 5.6 s"), and it dropped the 1.5 s window from Use this take. Location: `rooms/timeline.ts` `assemble` → `rooms/model.ts` `shotWindow` falls back to `{0, durationS}` for single-shot takes. It should use the shot's planned length (or the found line window), while Out may extend to the real length. Evidence: shots/094-095.
- **R3-F3 Script asks after Plan shots see an empty script.** "Whole script: Make the snoring line funnier" sent `target: scene`, `lines: []`, and neighbours = shots 1–3 only. The agent answered "This scene has no snoring line yet… the scene's text is empty". Location: `web/src/script/skye.ts` `writeInput` (scene prose is empty once shots exist) and `neighbours` (only the 3 rows after the scene). Evidence: job_01M7XVNBR33Y6DE8SHQFF38MFH, shots/132.
- **R3-F4 First takes of boxes not in the cut never reach it.** After a cut exists, the first takes of shots 3–5 landed only in the Bin, with no "New take ready" card. The only way in is Assemble again, which drops trims (and then hits R3-F2). Evidence: shots/093.
- **R3-F5 "Tell the Camera agent" pastes the instruction over the shot's words.** With Box 1 (shots 1+2) selected, I asked "Send both of Maya's pictures, the front and the full-length one…". No agent ran. The Change card proposed `Shot 1 words: "1 a.m. A dark kitchen…" → "Send both of Maya's pictures…"` and asked "Make shot 1 apart?". Making it would have replaced the action with my sentence. Not made. Evidence: shots/136-138.

**S3**
- **R3-F6** A sound beat for "Silence" switches the box to sound pricing and wording ("the sound will not be voiced"). Dex shot_list should not emit `sound` beats for silence.
- **R3-F7** The length ask removed the dialogue I had just asked for ("Good boy." and the toast). The interleaved word diff ("socks anda dressing gown creepsflips…") is hard to read.
- **R3-F8** The target offer's buttons are "Keep / Set target to 10 s". "Keep" is ambiguous next to the card's own Keep; "Keep 15 s" would be clearer. The offer has a red error-style border.
- **R3-F9** A mention adds a space: "@maya , in a dressing gown" and "@maya  pours".
- **R3-F10** The storyboard preview says "Nothing goes until you press Make clips", but Make clips only opens the Film room. It also says "6 frames" when there are 5 frames plus a type end card.
- **R3-F11** The Use-this-take sheet says "the new take has 1.5 s for this shot (0:00.0-0:03.0 of it)", which contradicts itself.
- **R3-F12** The sizes sheet says "1 versions" and "Make 1 versions". The 6 s 9:16 cutdown is 2.25 s of picture, then the line burned in as a super and repeated on the end card, then about 2.3 s of studio card. The cutdown is not in "Download all media".
- **R3-F13** A new box from words takes the number of the end card ("Box 6 · shot 6"; the end card becomes shot 7). The booth says "Made on its own from its words and @maya's pictures" next to "Make draws the frame first".
- **R3-F14** The zoom bar sits over the Name dialog's inputs on the canvas. The Booth stays on "Assets" after other actions.
- **R3-F15** The browser Back from the canvas chooser does not return to the script.

## Dex findings
- **What Dex got.** write (skye.v6): the brief with the end line, about 6.6–7k tokens in. shot_list (director.v16): 13.6k in / 1.9k out. Frame, clip and join: 16–17k in, 0.6–1.9k out, latency 4.8–15.3 s. Input is well under the ~27k of round 2. Every job has `provider_submit`, `job_stage` and `director` lines (21 director events, 87 stages). There was no `director_rejected`.
- **What Dex sent, the good.** Real takes: "Shot 2 [1.5-4 s] … follows image 3" with WAN rounding 3.5 → 4 s. The line goes in as "[0.5 s] MAYA, whispering to the kettle: “Good boy.” Spoken aloud, no subtitles". Veo's 1.5 s rounds up to 4 s and Omni's to 3 s, with the reason given. "in the small hours" replaces "1 a.m.". "No other brands" is on frames.
- **What Dex sent, the bad.** It accepts the web's "person from shot 1" as THE character on shots with no person (R3-F1), and sends in_1 and anchor as the same picture. It drops @maya_full for WAN 3 joins (so F5 is never exercised). It names Maya in plain words ("maya front is the woman seen").
- **Should get or send.** Make shot_list emit no `sound` beat for silence (R3-F6). Give Skye the planned shots' words after Plan shots (R3-F3). For a `sound` beat ("Steady snoring through the wall"), add an explicit sound line to the WAN prompt (only the action is sent today).

## T2 results
**1. Joining on a real model.** Join 1+2 on WAN 3 made one 4.0 s take with the cut at 1.5 s, and both frames were followed (4/5). The first cut placed it as 2 clips. Cutting gap 1\|2 left the cut unchanged. Shot 1 (Omni) and shot 2 (WAN 3) made separately each came with their own card. Use this take changed only the right clip at every step, and Undo/Redo was correct (F2/F13 fixed). Re-joining and making a new take on WAN 3 put "Box 1–2 v2" into the cut in place, keeping the texts and the other trims. Bar Undo/Redo is fine; the note's own Undo is not (F12 note).
**2. Sound (Veo 3.1 with audio).** `audio:true`, $1.60, real length 4.011 s. The line is a voiced burst at 0.55–0.95 s (formant sweep at 1–3 kHz), all inside the window, and audible in the ad at 6.1–6.4 s. It sounds softly voiced, not whispered. The box wording "Sound on: Veo 3.1 makes the spoken line in the clip." is right, and **no price appeared anywhere** (model list, boxes, confirms, sizes sheet). The only cost-like word is "free/paid" in the sizes sheet.
**3. Script writing.** Draft 12.2 s, then asks of 9.1, about 8.5 and 12.2 s. The length ask offered the target at once (set to 10 s; Plan shots then planned 10 s). The diff is in screenplay layout with "14.9 s → 9.6 s". But the 10 s rewrite cut the asked line (R3-F7), and asks after Plan shots are blind (R3-F3). The Booth part text updates.
**4. End to end.** Continue in at about 00:44:25Z. Ad downloaded at 01:19Z (**35 min** wall). 6 s 9:16 cutdown ready at 01:21:37Z (**37 min**). This includes the Part A detours. Machine time on the critical path is about 7.5 min: draft 12 s + 3 asks 30 s + plan 13 s + 5 frames 211 s + clips in parallel (longest WAN 156 s) + render 14 s + cut plan 24 s + cutdown 12 s. The ad as rendered cost $3.62 provider (5 frames $1.00, clips $2.62) plus about $0.60 Claude.
**5. Edit room.** Captions stay in their clip and the editor refuses to stack them. Mute/Unmute wording is right. + Text works, with From/To and fades. Render review flags 11 s over 10 s and the unvoiced VO. The Rendered tab plays the render, and Download works.

## Identity (1–5)
Frames 2/4 with @maya: 4, 4. Frame 3 (forced person): 2. WAN join v1/v2: 4/4. Omni shot 1: 4 (backlit). WAN shot 2 (i2v): 4. Veo shot 4: 4. Omni words clip: 4 (face) / 3 (action). The kettle prop drifts white → glass between frames 2 and 3, a side effect of R3-F1.

## Timings
| op | click → landed (UI) | relay total |
|---|---|---|
| Continue in → canvas | 8.6 s | — |
| draft / asks | 12.2 / 9.1 / ~8.5 / 12.2 s | 11.7 s (draft) |
| Plan shots | 9–10.6 s | 13.1 s |
| frame 1 / frames 2–5 | 28 s / 185 s | 26.5 s / 37–43 s each |
| WAN 3 join 4 s | 158 s | 156 s (provider 130 s) |
| Omni 3 s + WAN 2 s separate | 85 s (both) | 47 s / 83 s |
| Veo 3.1 4 s audio | ~56 s | 55.6 s |
| render | ~20 s | 14.3 s |
| cut plan / 1 version | 24 s / 12 s | — / 11.7 s |
| words box frame → clip | 108 s | 42 s + 57 s |

## UX proposals
1. Assemble at the planned lengths and let Out stretch to the take. Show "+2.5 s spare" on the clip.
2. When a box's first take lands after a cut exists, put it in its slot (like the joined take) with an Undo note.
3. "Tell the Camera agent" should go to the agent (refs, model, framing), not replace the shot's words. Show the parsed change before it is applied.
4. Draw the storyboard character only for shots that name a person. Offer "Keep a person from this frame…" instead of assuming it.
5. Use one version number per take everywhere (Bin, notes, sheet, zip).
6. The 6 s cutdown should give the picture at least 3.5 s and drop the studio card (or keep it under 1 s) for bumpers. Include cutdowns in Download all media.

## Spend
Provider **$4.93** of $8, from the ledger (`cost.confirmed`): frames 6 × $0.20 = $1.20, WAN 3 $1.40, Omni $0.93, Veo 3.1 with audio $1.60. Stitch and cutdowns $0.
Claude **$0.84** (`cost.agentUsd`, 21 ops).
Paid work stopped at $4.93 after R3-F5, because F5 could not be forced through the UI.
