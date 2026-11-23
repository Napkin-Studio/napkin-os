# UAT round 4: film (slug film, hello@napkin)

2026-11-21, 02:55 to 03:36 UTC. UAT at fix/pt-uat-loop df0ca1a7. Headless Chromium 1440×900 via `driver.mjs` (port 9461, stopped at the end). Claude in Chrome not used.
Project **UAT-R4 film** `prj_01M7Y0H8YA99YJP9G774DPG1GY`, made with Continue in → Production Tool from "Let Them Sleep (Quietboil launch film)". @maya = the same two pictures as rounds 2–3 (@maya_full is narrow).
Files: `jobs.jsonl` (19 jobs), `jobs/` (record + relay trace per job; `*.api.json` from the relay API), `shots/` (98), `media/` (frames, clips, strips, wav, spectrogram), `exports/` (ad v1, ad v2, media zip), `requests|responses|console|failed.jsonl`, `paid.log`, `ledger.txt`, `quality.json`.
Audio: no transcriber. Speech judged from loudness envelopes and a spectrogram (`media/box3-veo-spec.png`).
**AWS SSO token expired at ~03:33Z** (refresh needs a browser login). The relay trace (provider_submit / job_stage / director) is saved for every job up to the cutdown; for the 2 post-plan writes, the ask remake and render v2 I have the job records from the relay API only.
Console: no errors; no failed requests; no save conflicts.

Summary: Part A 17 fixed, 4 partly, 2 not fixed, 3 not re-testable. New: 3 S2, 6 S3.

## Part A: round-3 bugs retested
| id | result | evidence |
|---|---|---|
| R3-F1 storyboard forces the shot-1 person | **partly**. The kettle insert (shot 2, names no one) sent no character ref to the provider, and Dex left the optional Maya refs out; the kettle is the same steel kettle in frames 1–3. But (a) shot 2 sent frame 1 twice, as @anchor and @previous (new R4-F5), and (b) "a flatmate keeps snoring" is a person word, so @maya was promoted to required and Maya was drawn as the flatmate (new R4-F2). | job_01M7Y1A44…, job_01M7Y1CFG…, media/frames-strip.jpg |
| R3-F2 Assemble plays whole padded takes | **fixed**. Lone takes went in at planned lengths: Box 3 (4.0 s Veo) plays 0–1.5; the cut "Fits 10 s". | shots/059, Inspector "Plays 0:00.0-0:01.5" |
| R3-F2 Out clamp | **fixed**. Out 4.5 on a 4.0 s take → 4.0 with "Set to 4.0 s: the take ends there." Undo steps back 4.0 → 1.5. | shots/060-061 |
| R3-F3 script asks after Plan shots | **partly**. Neighbours are now the whole script (531 chars, every shot + beats). But `lines` is still `[{action:""}]` and the target stays the scene: "Make the snoring line funnier" → "This scene has no words of its own… The scene's own text is empty" + a question. Its answer would land as 5.2 s of unplanned text above the shots, not on shot 4. Cause: askedItem ties ("snoring" is in shot 4's action, its sound beat AND shot 5's action) → falls back to the scene. | job_01M7Y2C62…, shots/083-084 |
| R3-F4 first take into the cut | **fixed**. After a cut with Box 1 only, Box 3's and Box 4's first takes went into their slots: "Put shot 3's first take into the cut." / "Joined take of shots 4–5 is in the cut. Undo". | shots/053, 057-059 |
| R3-F5 Tell the Camera agent | **fixed**. The Change drawer says "Asked of the Camera agent: … Every shot's words stay"; the web sent `remake.delta=[{field:"ask"}]`; Dex put the ask first; shot words unchanged. The take followed it (empty room for shot 4, Maya in shot 5). S3: it still offered "Make shot 4 apart?" for an ask about both shots. | job_01M7Y2HAK…, media/box4-ask-strip.jpg, shots/087-090 |
| R3-F6 silence sound beat | **not re-testable**: no silence beat this plan ("no roar" kept as a real sound, correct). | |
| R3-F7 length ask keeps lines / diff | **fixed before Plan shots** ("Good boy." and the VO kept word for word, line diff readable). **Not fixed after Plan shots**: "Make it 8 seconds" dropped "Good boy." and the mandatory end line (R4-F3). | shots/016-017, 085, job_01M7Y2FYS… |
| R3-F8 target offer | **fixed**: "Keep 15 s / Set target to 10 s", no red border. | shots/017 |
| R3-F9 mention space | **fixed**: "1 a.m. @maya, hoodied". | shots/033 |
| R3-F10 preview wording / count | **fixed**: "5 frames … Make clips opens the Film room. Nothing goes until you press Make on a box there." (S3 leftover: "from Script · Script"). | shots/046 |
| R3-F11 Use-this-take sentence | **fixed**: "The clip plays 1.5 s now · the new take would play 1.5 s of it, 0:00.0-0:01.5 of its 4.0 s." | shots/092 |
| R3-F12 sizes sheet / 6 s cutdown / zip | **partly**. "1 version"/"Make 1 version" fixed; the line is burned in once, not repeated; the cutdown is in Download all media. But the "6 s" cutdown is a **4.52 s** file with **2.0 s** of picture and a **2.5 s** studio card (not shortened) — see R4-F4. "free" still in the tray. | media/cutdown6-strip.jpg, exports/*.zip |
| R3-F13 new box number | **fixed** (no end card here): "+ New box" → "Box 6 · shot 6". Undone. | shots/096-097 |
| R3-F14 zoom bar over Name dialog | **fixed**. Booth stays on Assets: **not fixed** (open question, not built). | shots/024, 078 |
| R3-F15 Back from front chooser | **not re-testable**: the chooser did not appear (the front was named in the Name dialog). | |
| F3 shown model = sent model | **regressed (new path)**: R4-F1. Boxes without takes keep their own default (Box 3 Veo 3.1 for the line, Box 4 Omni) after a WAN 3 Make elsewhere: that part is fixed. | |
| F4 / Out 4.5 | **fixed** (see Out clamp). | |
| F5 narrow ref on WAN 3 | **fixed live**. Box 1 (shots 1+2) on WAN 3 sent @maya_full required; provider_submit shows it as `data:image/jpeg` (padded) beside the URL refs, accepted (200), completed 5.04 s. | job_01M7Y1M4X… |
| F12 note Undo | **not re-testable cleanly** (the cut had really changed before I could press it). | |
| F15 one version number | **fixed**: Bin, booth, sheet, zip all v1/v2. | |
| F21 Claude cost recorded | **partly**: every write/shot_list/frame/clip has agentUsd; the cut plan has none because Dex failed (R4-F4). | ledger.txt |
| F22 sound beats | fixed for this script (no silence beat). | |
| shot titles "1 a.m" dot | **fixed** ("1 a.m."). | shots/037 |
| double dot | **not seen**. | |

## BUGS (new)
**S2**
- **R4-F1 A spoken-line box made on Veo 3.1 although WAN 3 was picked and shown.** Steps: Film room, Box 3 (shot 3, "Good boy."), pick WAN 3 (booth highlights it, box says "Sound on: WAN 3 makes the spoken line"), Make. Web sent `modelChoice veo3.1`; provider veo3.1 audio, **$1.60 instead of ≈$0.20**. After it landed the box still says "Sound on: WAN 3". Code: `web/src/jobs/runs.ts` `makeRuns` → `planRuns(..., speaker: speakerModel(model))`; `speakerModel` returns Veo 3.1 for any non-Veo model, so `pick` = the run's model, not `opts.modelChoice`. A person's pick of a model with a sound switch (WAN 3, Kling) should win. Evidence: job_01M7Y1VE0FCPXZS9NMZRQPRWEJ, shots/049, 054, 058, requests.jsonl.
- **R4-F2 A person word that is not the character draws the character.** "Behind the thin wall, a flatmate keeps snoring" → `namesPerson` matches "flatmate" → the only offered character (@maya) is promoted to required → Maya drawn as the snoring flatmate, in a bedroom; frame 5 and Box 4 inherit the bedroom. The storyboard's own ref row says @maya is in shots 1 3 5 only. Code: `web/src/jobs/cast.ts` `castRefs` (promote only when the shot names the character, or the person word is unqualified "she/her"; "a flatmate"/"a neighbour" is someone else). Evidence: job_01M7Y1CFG37J8M2E07QDM9CHKY, media/frame4.png.
- **R4-F3 After Plan shots, script asks are blind and a length ask drops spoken lines.** `writeInput` still sends `lines:[{type:"action",text:""}]` with target scene. "Make it 8 seconds" returned 4 action lines with no "Good boy." and no "NARRATOR (V.O.) Quietboil. Let them sleep." (a brief mandatory), shown as "about 0 s → 8 s"; "Make the snoring line funnier" asked a question and its answer would land as unplanned text. Code: `web/src/script/skye.ts` (`askedItem` ties → scene; scene `lines` should be built from its shots and beats as done_when says). Evidence: job_01M7Y2C62…, job_01M7Y2FYS…, shots/083-085.
- **R4-F4 The 6 s cutdown is 4.5 s with 2 s of picture; a failed cut plan is shown as the agent's plan.** Plan the cuts took 56 s; the job record says `director.model: passthrough`, "Dex could not plan this (ModelError), so the plan keeps the opening and the payoff" — but it kept only shot 5 (2 s), not the opening. The sheet still says "Director agent: how I would cut it … comes out 1.5 s short". Output 1080×1920, 4.52 s: 2.0 s picture + 2.5 s studio card (the short-size card shortening did not apply). No agentUsd on the job. Code: relay cut planner fallback (`relay/cutdowns.py` / `service.py` film_plan passthrough) and `_run_cutdown_render` card lengths; web FilmSizesSheet should say the agent could not plan. Evidence: job_01M7Y26FBKRN9H4QQWNWME7FMH (`jobs/*.api.json`), job_01M7Y280XCF92GXRY2948KYF7E, media/cutdown6-strip.jpg.

**S3**
- **R4-F5** Shot 2's frame job sends frame 1 twice (@anchor and @previous are the same sha). `jobs/frames.ts` `continuity` (index 1: first === prev) — the R3-F1 dedupe only compares refs to anchor/previous.
- **R4-F6** The brief's mandatory end line is nowhere in the ad: the plan put it on shot 5 as an unvoiced VO, no end card, no super; Review only warns "Not heard". The film ends on the studio card. (Plan shots/director.v17 should give the end line a card or super when no model voices the VO.)
- **R4-F7** Box 4 (Omni, 4 s for 3.5 s planned): Dex times shot 5 at 1.5–4 s, the web window takes 2.0–4.0 s (the first 0.5 s of shot 5 is cut).
- **R4-F8** Wording: "so the voice-over, the sound will not be voiced"; Name dialog "For another role (a font, a character…)" next to "@maya is a character"; "from Script · Script" in the Make clips preview; "Crop · free" / "(free)" in the sizes sheet (owner rule: no cost words); campaign tile says "Film 9:16 · 6 s" for a 4.5 s file.
- **R4-F9** The Camera-agent ask scoped to "Shot 4 · Box 4" offers "Make shot 4 apart?" although the ask is about both shots.
- **R4-F10** Clip prompts still drop sound beats (Box 1: audio on, "A soft click… no roar" not in the WAN prompt); frame 1's prompt carries "1 a.m." (no text burned in this time).

## Dex findings
- **Got.** Frames at effort low: **10.6–11.0k in / 409–591 out, 3.3–6.6 s** (round 3: 16–17k in). Clips (effort default): 12.1–17.2k in, 0.8–1.7k out, 6.3–13.5 s. shot_list 8.6 s. Every traced job has provider_submit, job_stage and director lines; no director_rejected.
- **Sent, good.** Insert frame: "An insert on the kettle needs no person, so the optional Maya refs are left out." WAN join: "Shot 1 [0-3 s] … follows image 3 / Shot 2 [3-5 s] … follows image 4", "in the small hours" for "1 a.m.". Veo line: "[0.5 s] MAYA, whispering to the kettle: “Good boy.” Spoken aloud". Ask remake: the ask goes first in the prompt and shot 4 is read "for the room only so nobody is shown".
- **Sent, bad.** Accepts the web's promoted character on "a flatmate" (R4-F2). Notes "Anchor and previous are the same picture, so it is sent once" but the provider still gets both (R4-F5). Names Maya in plain words on joins ("maya front and maya full are the same woman"). Sound beats not written into clip prompts.
- **Should get / send.** The scene's real lines after Plan shots (R4-F3). A cut-plan fallback that keeps ≥3.5 s of picture and says it failed (R4-F4). A card or super for the mandatory end line when the VO is unvoiced (R4-F6).

## T2 results
1. **Character refs per shot** (frames): shot 1 maya ×2 required; shot 2 none (insert) ✔; shot 3 maya ×2 ✔; shot 4 maya ×2 ✘ (flatmate); shot 5 maya ×2 ✔. Frames carry only their own beats (sound beats on 2 and 4; the line and VO are not sent to frames); shot 1 has none. Kettle: same steel stovetop kettle in frames 1–3 and in every clip (but a stovetop kettle for an electric-kettle brand whose script says "switch").
2. **Assemble / first take / Out clamp**: assembled at planned lengths, first takes into their slots with notes and Undo, Out clamped with the reason, Use this take v2 for both clips of Box 4 kept 1.5/2.0 s. All fixed.
3. **Script asks**: before Plan shots perfect (lines word for word); after Plan shots broken (R4-F3).
4. **Camera ask**: works and the take follows it (5/5).
5. **WAN padding**: live and accepted (F5 fixed).
6. **Short cutdown 6 s**: 4.52 s, 2.0 s picture, studio card 2.5 s, line once, in the zip. Not met (R4-F4).
7. **End to end**: Continue in 02:56:23Z → ad downloaded 03:23:31Z = **27.1 min**; 6 s 9:16 cutdown ready 03:26:31Z = **30.1 min** (incl. code reading). Machine time on the critical path ≈ 10.2 min (frame 1 waited 141 s in Runway's queue; WAN 157 s). The ad as first rendered cost **$3.54 provider** (5 frames $1.00, WAN $0.50, Veo $1.60 by R4-F1, Omni $0.44) **+ $0.41 Claude**.

## Identity (1–5)
Frames: 1 = 4, 2 = n/a (hand only), 3 = 4, 4 = 2 (Maya as flatmate), 5 = 4. WAN join = 4 (grey hoodie vs gingham). Veo shot 3 = 4. Omni Box 4 = 4 / ask remake = 4. Speech (Veo, shot 3): whispered bursts with formant sweeps at 0.8–1.4 s (inside the 0–1.5 s window) and a repeat at 2.9–3.4 s (trimmed out).

## Timings
| op | click → landed | relay total |
|---|---|---|
| Continue in → canvas | 14.9 s | — |
| draft / ask1 / ask2 | 11.1 / 14.7 / 13.7 s | — |
| Plan shots | 10.5 s | Dex 8.6 s |
| frame 1 | ~150 s | 148 s (provider 141 s) |
| frames 2–5 (chained) | 158 s | 29–38 s each |
| Box 1 WAN 3 5 s join | ~184 s | 180 s (provider 157 s) |
| Box 3 Veo 4 s + Box 4 Omni 4 s (parallel) | ~65 s | 57 / 64 s |
| render | ~12 s | ~7 s |
| plan the cuts | 56 s | Dex failed at 41 s |
| cutdown | ~10 s | 6.7 s |
| ask remake Omni | ~113 s | ~113 s |
| post-plan asks | 9–10 s | — |

## UX proposals
1. A person's model pick wins; if a model cannot voice a line, say so on the box before Make (R4-F1).
2. Gate the character on the character, not any person word: "a flatmate" → an unnamed extra, or ask "Is this @maya?".
3. After Plan shots, an ask about a line goes to the line; a tie asks "Shot 4 or shot 5?" rather than going blind.
4. When the cut planner fails, say so ("I couldn't plan this one; here is a simple cut") and keep ≥3.5 s of picture; name the tile by its real length.
5. Put the brief's end line on a card or super automatically when no clip voices it.

## Spend
Provider **$3.98** of $5 (cost.confirmed): frames 5 × $0.20 = $1.00; WAN 3 $0.50; Veo 3.1 audio $1.60 (unintended, R4-F1); Omni $0.44 × 2 = $0.88; stitch/cutdowns $0.
Claude **$0.51** (cost.agentUsd, 19 jobs; the failed cut plan has none).
