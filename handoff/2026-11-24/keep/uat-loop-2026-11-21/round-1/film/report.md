# UAT round 1 — T2 film path (slug: film, hello@napkin)

Date: 2026-11-21 (20:16–21:15 UTC). UAT web + relay (fix/pt-uat-loop). Viewport 1440×900, headless Chromium.
Projects made: **UAT-R1 film Quietboil** (`prj_01M7X9VC534AYACA9JSX6TWFNP`, from the Brief Maker brief "Let Them Sleep (Quietboil launch film)", read only) and **UAT-R1 film words-only** (`prj_01M7XCGF8XFRXZBAKJJ20WEJGV`).
One earlier project (`prj_01M7X9QN298FCJSD4X65921JJQ`) was lost before it was saved (see B7). It was never on the server.

Files: `jobs.jsonl` (18 jobs), `notes.md` (running log), `shots/` (~110 screenshots), `media/` (every output, plus 1-fps strips of each video), `jobs/<jobId>.json|.log` (ledger record plus relay/stitch log lines), `requests.jsonl`/`responses.jsonl` (POST bodies), `console.jsonl`, `failed.jsonl`.

## Summary
| | count |
|---|---|
| Controls that work | 41 |
| Partly work | 11 |
| Broken | 4 (+ New box Make from words; storyboard-node Make clips…; cutdown Review flag; brief end line to the Script agent) |
| Console errors | none apart from the expected 401 on `/api/session` before sign-in. No pageerrors. |
| Paid spend (ledger, confirmed) | **$5.52**: 5 frames $1.00, 2 Veo clips $1.60, Omni take $0.62, WAN 3 take $0.50, Veo words clip $1.20, Omni words take $0.60. Claude calls (5 write/plan, 13 Dex) show $0.00 in the ledger. My estimate from the token counts is about $1.3. Stitch and cutdowns were $0. |

## What breaks when two shots are joined (the owner's report)
Joining itself works. Three takes of joined boxes all landed on the box as one video with per-shot windows: Omni (frames as guides), WAN 3 (frames), and Omni (words only). The film breaks after that:
1. **The joined take never reaches the cut (B2).** A take made in the rooms lands outside the cut by design. `jobs/wire.ts` sets `inCut: !deps.rooms?.()`, so `applyRunTake` skips `pickInCut`, and the box says "Your cut stays as it is". The Edit room keeps playing the old separate clips. To get the joined take in, you need two separate "Edit agent asks · New take ready for Box 1 · Use this take" cards, one per shot. Each opens its own dialog that needs a second "Use this take". The Make room after the join is misleading too. The 2-shot box shows the old shot-2-only clip as its current take ("v2 · 2.5 s · IN THE CUT"), and the Bin relabels the old per-shot clips as "Box 1 · v1/v2". "Add to edit" adds the take at the end of V1, and "Assemble first cut again" rebuilds the cut and silently drops manual trims. If you join, Make, then open Edit, it looks as if nothing happened. That is most likely what the owner hit.
2. **The default model silently changes.** For a joined box, Veo 3.1/Fast, Kling, Hailuo and Seedance 2.0 Fast are greyed ("Can't make several shots as one video"), and the default becomes Gemini Omni Flash 1.1, not WAN 3. Nothing on the box explains the switch.
3. **The shot windows ignore the cut the relay found (B5).** On the Omni take the relay found the cut at 3.0 s (`cuts.found_s 3.0`), but the web placed shot 2 at 3.5–6.0 s. The first 0.5 s of shot 2 is lost, and the rendered ad uses 3.5. On the words take `found_s` was null while a visible cut sits at about 4 s, so shot 1's window holds part of shot 2.
4. **Some gaps can never be joined, and the box does not show why.** The 4|5 gap is blocked with "A shot where someone speaks is its own video, with sound", but shot 5's Shot tab shows no line. I did not trace where the line beat lives.
5. **A joined or new box with no frame cannot be made from words in a storyboard film (B1, below).**

## Bugs
**S1 — broken**
- **B1. "+ New box" (words only) cannot be made.** Steps: Make room → + New box → write the words, Close/Push in/Slow, 4 s (the box says "Separate video · its words") → Make. Expected: a clip from the words. Actual: "Making…" for over 35 s, then the alert "Shot 6: This shot has no frame yet." No `/api/jobs` POST is sent. The dogfood log says "plan shot 6 one at a time on Gemini Omni Flash 1.1" (the box showed Veo). Cause: `rooms/MakeRoom.tsx` `make()` with `videoJoin==='film'` calls `makeRuns(...)` without `fromWords`. `makeClip` then falls back to `shotFromWords()`, which is false for a storyboard film, and `jobs/clips.ts:93` throws. The non-film branch computes `fromWords` correctly but never runs while connectedVideo is on. Evidence: `shots/*words-make-state2*`, notes.md. (Words-only does work in a film started with "Make clips straight from the script": `job_01M7XCJ0FEAMVZTCWWKD57CGKG`.)

**S2 — wrong**
- **B2. A joined take is not used in the cut** (details in the section above). Evidence: `job_01M7XB1AJXDZKE1YBNAHQ1GS1W`, `shots/058-*`, `shots/060-*`, `shots/062-edit-after-join.png`, and the use-take shots.
- **B3. The brief's end line and don'ts never reach the Script agent.** The brief's mandatory "End line must be 'Quietboil. Let them sleep.'" was ignored by the draft. When I asked "End on the brief's end line", Skye wrote the proposition and said "The brief names no separate end line". Cause: in `relay/brief.py` `BUDGET['write']`, at 900 characters, proposition, audience, tone, feel and insight use about 868. The 46-character end-line mandatory no longer fits, the 29-character "Deliver in…" still does, and the don'ts are dropped. `shot_list` and `cutdown` do keep them. Jobs: `job_01M7XA00189K2629GHA5KSX256`, `job_01M7XA449ECJVWMQZAB3K5YMN3`.
- **B4. The cutdowns end on the Napkin Studio card, not the client's.** Each 6 s version is 3.5 s of picture with "Quietboil. Let them sleep." as a small caption, then 2.5 s of the dark "Made with Napkin Studio" roll-up. The Quietboil end card is missing, although Dex's plan said "The end card takes the last 2.5 s". `stitch/cutdown.py` uses `SIZE_CARD='roll-up-ink'`. The full ad render also adds about 2.5 s of the white studio card after the client's end card. Evidence: `media/cut6-16x9-4fps.jpg`, `media/cuts-strips.jpg`, `media/ad-render-v1-strip.jpg`.
- **B6. Clips never have sound.** Every Veo/Omni/WAN output is video-only (WAN is sent with `audio:false`). Dex moved the snore, the only story in the words-only film, into a sound beat that nothing plays. This confirms audit gap 3.
- **B7. A project started from "Continue in" is not saved until Ctrl+S.** The first Quietboil project showed "not saved yet". Closing the browser lost it (it was never in `/production/api/projects`), and I saw no autosave.

**S3 — rough**
- The Continue in item says "its Brief node and a new Script", but only the Brief node arrives. The Brief node says "V1 · LOCKED" while Brief Maker shows DRAFT, not locked.
- + Node › Script is placed on top of the Brief card. `scriptFromBrief()` (`jobs/prompt.ts:117`) has no UI caller, so there is no "draft from the brief" button.
- The parenthetical shows as "((whispering))", and the doubled parens are also sent to Dex in the `shot_list` script.
- The rewrite card lands below the fold without scrolling into view. The inline word diff is hard to read. "Kept · Undo" rows stack up.
- The Booth still shows "THIS PART ¶4 · Not planned yet" after Plan shots. The Director note says "about 6 shots" for a 3 s script.
- Shot 1 is titled "At 1" (cut at the colon of "1:04"). All planned shots are static.
- The Draw-frame ▾ preview lists every brief part, but the relay sends a frame only tone, feel and audience.
- The storyboard node's "Make clips…" is always disabled ("Make clips from the Storyboard for now (Open)"). The Film node's ⋯ menu has "Copy link — later" and "Duplicate — later".
- Shot 5's size chips show none selected (it was planned as "Two shot").
- Edit room: at 1440 px with the Booth open, the toolbar clips "Render ad" and redo. Escape leaves the Film editor for the canvas. The speaker icon ("Mute the preview") is easy to hit by mistake. "S" with the playhead at 0 logs a "split shot 1" step that changes nothing. The header says "19 s · target 15 s" while the cut is 12.5 s.
- Make all sizes says "from Film · 10.5 s" (the cut is 12.5 s). 1:1 is not preselected although the brief mandates 16:9, 9:16 and 1:1. The "⚑ Review agent · 1" flag on a cutdown tile opens nothing.
- The Decisions badge reads 0 while the drawer holds 91 decisions. The ledger shows $0.00 for every Claude op.
- In `provider_submit` the joined-take prompt reads "follows image 1 (in 1)": Dex's `@in_1` is mangled to plain words. The take refs are labelled per run ("Shot 1 frame" for story shot 3).
- Straight mode offered "About 2 clips" but planned 1.
- Trace gaps: `write` and the cutdown `film_plan` have no `evt=director` line (write usage appears only in a plain "model writer" line), and `stitch`/`cutdown` have no `provider_submit` (expected, since they use ffmpeg).

## Dex findings
- **What Dex got.** write: instruction, scene, and a brief cut to 900 characters (end line and don'ts lost, B3). shot_list: the whole script (with "((whispering))") and the full brief, so the end card was correct. frame: the shot's words and camera, @anchor/@previous as subject "object", and tone/feel/audience only. Clip from a frame: the frame, the shot's words and beats (no refs, no script, no neighbours). Joined take: the frames as `in_1`/`in_2` with Haiku cards, plus the cuts.
- **What Dex could get.** The brief's mandatories on write. The script/scene on clips. Sound (it plans sound beats that never play). The take's found cut, to place the windows.
- **What Dex sent.** Clean, short provider prompts with timed beats ([0:00.5] …), correct Veo duration rounding (3→4 s, 2.5→4 s), and "No text…" left out where the clock shows text. The joined prompts use per-shot [a–b s] lines. One mismatch: "dim cool light" against warm frames.
- **What Dex should send.** The `@in_k` tags intact. Audio for spoken or sound beats when the model supports it. "Product/brand" detail: the kettle is generic in every output.

## Quality (1–5)
| job | what | score | note |
|---|---|---|---|
| write …KSX256 | draft | 3 | on-brief gag; misses the end line |
| write …218D1Q | shorter | 3 | cut the snoring payoff |
| write …K3YMN3 | new ending | 2 | proposition instead of the end line |
| shot_list …7CPCGZ | 5 shots + end card | 4 | faithful; all static |
| frames 1–5 | storyboard | 4,4,3,4,4 | strong continuity without character refs; kettle generic; flatmate not in the doorway |
| Veo shot 1 / shot 2 | separate clips | 4 / 4 | identity held, 4 s each |
| Omni join 1+2 | joined take | 4 | real cut at 3.0 s, identity held |
| WAN join 3+4 | joined take | 3 | cut at 2.47 s; flatmate sets the mug down |
| stitch ad v1 | render | 4 | correct order; studio card appended |
| cutdowns ×3 | 6 s sizes | 3 | crops fine; no client end card |
| Veo words door | text-only clip | 3 | literal, silent |
| Omni words join | words take | 3 | cut about 1 s late |

## Timings (click → landed in UI; relay totals in jobs.jsonl)
| op | time |
|---|---|
| Continue in → Brief node | 3.0 s (11.3 s cold) |
| write draft / rewrite 1 / rewrite 2 | 14.9 / 9.1 / 12.7 s |
| Plan shots | 20.8 s (relay 12.6) |
| frame 1 | 54.6 s (6 s queue, provider 38 s) |
| frames 2–5 chained | about 33 s each, 152 s wall |
| Veo clips | about 61 s and 68 s (relay 74.7 s and 62.5 s) |
| Omni joined take | relay 71.7 s |
| WAN 3 joined take | relay 168.7 s (provider 146 s) |
| stitch render | 10.7 s |
| cutdown plan / 3 sizes | 30 s UI (relay 16.9 s) / about 11 s each |
| Veo words clip / Omni words take | 45.1 s / 52.5 s |

**Spend: $5.52 confirmed by the provider ledger (budget $12), plus about $1.3 of unrecorded Claude usage.**
