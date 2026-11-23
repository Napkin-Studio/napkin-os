# UAT round 6: film (slug film, hello@napkin)

2026-11-21, 06:25 to 06:53 UTC. UAT at fix/pt-uat-loop a55d7ce7. Headless Chromium 1440x900 via driver.mjs (port 9661, stopped at the end). I did not use Claude in Chrome.
Project UAT-R6 film `prj_01M7YCJ3ZM6B25C7Q0VH5JGJ8J`. I made it with Continue in, then Production Tool, from the Quietboil brief, and touched no other project. @maya = maya_front + maya_full (same pictures as round 5).
Script: target 10 s, then "Draft from the brief", then "Name her MAYA… Good boy…" (kept). Plan shots gave 5 shots: 1 enter (1.5 s), 2 switch (1.5), 3 kettle insert (1.5), 4 grin + MAYA "Good boy." at 1.0 s (2.5), 5 hall snore + NARRATOR VO (3.0). Round 5's "shot 5" (Good boy.) is **shot 4** here.
Files: jobs.jsonl (15), jobs/ (record + relay trace), shots/, media/ (frame1-4, box4-wan3 + wav/spec/strip, ad-v1 + strip, cutdown6 + strip), requests/responses/console.jsonl, paid.log, ledger.txt, quality.json. There is no failed.jsonl: 0 HTTP errors and no 409.
Relay trace: every job has job_stage; provider jobs have provider_submit + director; Claude jobs have director; no director_rejected.

**S1/S2 found: R6-F1 (S2).**

## Part A: round-5 ids
| id | result | evidence |
|---|---|---|
| R5-F1 | **fixed**. Shot 4 "Make Maya funnier": neighbours are whole shots with beats; the target is labelled "(this shot: … its beats below are its own and stay)" with `line MAYA … Good boy.`; skye.v8 adds no quoted line, sends no duration_s, and keeps 2.5 s | job_01M7YD41T93N9A2421A1J2KZ7Q |
| R5-F2 | **fixed**. Shot 4 whisper 2.5 s (= 1.0+1.0+0.5); VO shot 2.5 → 3.0 s (relay log); total 10.0. WAN take: voiced 1.35-2.1 s (an "oy"-like F2 glide at 1.7-2.05 s), window 0-2.5 s. No transcriber: envelope and spectrogram only | job_01M7YCZQS7975Z7CYA1MXK55EX, job_01M7YDFV6ACCQDXBTS22DKW8RP, media/box4-spec.png |
| R5-F3 | **fixed**. Kettle insert after a Maya frame: no refs, no previousFrame, Cast no-one line, prompt "No one is seen; draw no people."; the image is a kettle only | job_01M7YDB1FZ51RQEGR898PAD8Q4, media/frame3.png |
| R5-F4 | **fixed**. "You asked: …" + "Both of these fit it" | shots/044 |
| R5-F5 | **fixed (tie path)**: "Shot 4, from". The caret path says "On your selection" (R6-F3) | shots/045, 039 |
| R5-F6 | **partly**. Fit on blur fixed (subject box 1140x1080 on a blurred fill). The caption is lost (R6-F1). 5.52 s, flagged "0.5 s short", tile "5.5 s" | job_01M7YDQTYJNN7DJ5HHC0AAMV7Y |
| R5-F7 | **fixed** (no 409, no banner over 5 edit+reload races). Edge case R6-F7 | shots/080-086 |
| R5-F8 | cut-plan speaker **fixed** ("MAYA (whispering…): Good boy."). Omni "Maya": **not re-testable for free** (no Omni take; WAN prompt names nobody) | job_01M7YDQANV13V932FNHR4MTDFZ |
| R5-F9 | **fixed** "Campaign · 1 format". A Decisions row still says "1 versions" | shots/087 |

## BUGS
**S2 R6-F1: the 9:16 cutdown drops the spoken caption and the line.** One-shot cut ("Good boy." at 1.0 s of a 3.0 s take) + end card Line "Quietboil. Let them sleep.", then Make all sizes 6 s 9:16. The sheet promises captions for sound off. The render input has **no layers**, and the file has no caption (the 16:9 ad has one). Cause (campaign/filmJobs.ts): `filmLayers` puts the line at 0.52-3.02 s and the caption at 1.0-3.02 s; `linesApart` falls to `else c.toS = lf`, so the caption ends before it starts and is filtered out. `cutdownInput` → `withoutCardWords` then drops the line because the card says it. Fix: drop card words before linesApart, and/or keep the caption when the line only repeats the card. Evidence: requests.jsonl 06:47:13 cutdown render body, media/cutdown6-strip.jpg vs ad-v1-strip.jpg.

**S3**
- R6-F2 "Make Maya funnier" with nothing picked goes straight to Shot 1, the only *action* saying @maya. Her line (speaker MAYA, shot 4) and "Shows @maya." directions aren't scored (skye.ts askedItems). job_01M7YD12E0D6DWEMMWVEQD102B.
- R6-F3 Caret-in-shot ask: the card says "REPLACES YOUR SELECTION · On your selection" with no selection; the part sends the Cast direction "Shows @maya." and Skye rewrote it ("…, smug and triumphant."). shots/038-039.
- R6-F4 Frame 4 "mug held close" → Maya hugs the kettle (the @previous insert's object leaks in); the WAN take keeps it. media/frame4.png.
- R6-F5 End card Line defaults to the literal "Your brand" (Inspector.tsx:148) despite the brief's mandated end line.
- R6-F6 Sizes step 2 says "Reframe · crop" for a shot the plan fits whole on a fill.
- R6-F7 An edit reloaded within ~0.3-0.4 s of its commit is lost silently (2/2; ≥0.6 s survives). The header keeps "saved 12:20" while newer edits are only local.
- R6-F8 Words: Undo "discard suggestions[sug_01M7YD5ZWS…]"; Decisions "1 versions"; the Make room still shows "Drawing the frame of your character first…" after the take landed.
- R6-F9 Continue in → canvas 15.2 s (round 5: 4.7 s), measured once.

## Dex
Got: shot_list 8.2k/1.75k 12 s; frames ~10.6k/430 3-4 s; WAN clip 11.3k/643 5.4 s; cutter.v2 2.6k/354 2.5 s; skye.v8 writes 5-12 s.
Sent, good: no-person insert; "in the small hours"; WAN `[1 s] MAYA, whispering…: "Good boy." Spoken aloud`, rounded 2.5 → 3 s; the cut reason names Maya.
Could be better: steam in frames 3-4 and the take, against the brief's "fresh against … steam close-ups"; @previous of an object insert going into a person shot (R6-F4).
Look line: none sent, correctly. The script never describes Maya's look (looksIn finds nothing). Identity held through the @maya pictures.

## T2
1. Paid frames: spoken shots ≥ their line ✓; kettle insert has no Maya and no @previous ✓; Maya frames identity ✓ (no Look line, explained above).
2. Paid WAN 3: wan3 ✓, audio ✓, 3 s $0.30; the window covers the voice ✓ (spectrogram).
3. Free: shot 4 funnier: no quote, length kept ✓, but card wording (R6-F3) and the unpicked ask goes to shot 1 (R6-F2). Tie "You asked" ✓. 9:16 fit ✓, caption lost ✗ (R6-F1). Omni "Maya": n/a. Cut reasons ✓. Reload race ✓ (R6-F7 edge).

## Quality
Frames 1=4, 2=4, 3=4, 4=3; WAN take 4; ad 4; 9:16 cutdown 2.

## Timings
Continue in 15.2 s; draft 10.6 s; MAYA ask 12.2 s; Plan shots ~13 s; shot asks 6.6-9.7 s; frames relay 28.5-43.1 s (click → POST 0.5-4.6 s); WAN 3 relay 99.7 s (provider 91 s); render 7.6 s; plan the cuts 2.9 s; cutdown 11.8 s.

## Spend
Provider **$1.10** of $1.50 (4 frames × $0.20 + WAN 3 3 s $0.30). Claude **$0.32** (agentUsd, 13 jobs).
