# UAT round 3 · T1 images (slug: images)

Account mock@napkin · project **UAT-R3 images A** (prj_01M7XRYB3JE10TTC85F8M0XSH4 / relay proj_01M7XRYD0C9X20XQJMH4JQ5NGS) · code fix/pt-uat-loop @ b60b21ed (director.v16) · Playwright headless Chromium 1440x900 · 2026-11-21 00:43–01:40 UTC.
Files: jobs.jsonl (16 jobs: ask, web POST, director.input/output, Dex events, provider_submit, stages, cost, quality), jobs/ (records, relay traces, outputs, crops, storyboard-mia.jpg), shots/ (159), paid.log, requests/responses.jsonl (all non-GET calls), browser-log.jsonl.

## Summary
- Part A (20 round-2 ids): **14 fixed, 5 partly, 1 not fixed (IMG-9), 0 regressed** (details below).
- Controls touched ~55: 44 work, 7 partly, 4 broken. New bugs: 0 S1, 3 S2, 9 S3.
- Relay trace lines (job_stage, provider_submit, director) present for every job. director.input stored on every Dex job, input.context now filled from the UI.
- Console: clean (only WebGL ReadPixels perf warnings); no failed network calls; no pageerror.
- No price seen anywhere in the UI (trays, confirms, Make the other views, Resize). Costs only in Decisions. Owner rule holds.

Correction to the counts above: **16 jobs** (13 paid, 1 free crop, 2 shot_list). **Provider spend $2.78** (13 confirmed, ledger), **Claude spend $0.68** (sum of cost.agentUsd; shot_list asks counted once at the job's final value).

## Part A: round-2 retest
| Id | Result | Evidence |
|---|---|---|
| R2-1 brand refs | **fixed**. Name… › palette auto-picks swatches from the picture (editable, × to drop), typography's Save stays disabled until a font ("Say which font."), brand rule has Do/Don't/Tone plus words. All three saved, no .clan refusal, and **input.context reached Dex** on every op after that (generate, region_edit, frame, shot_list) | shots/010, 015-018; job_01M7XS7JJJ75E8S0NZWJCRFVKH director.input.context |
| R2-2 sketch + linked note asks | **fixed**. The tray says "note (linked) · goes as words", no ask, the note goes as input.text. Without a note it still asks (expected) | shots/134-135; job_01M7XTXMWPF5TYDVH0G5YS5JG8 vs job_01M7XTSA6SBT9K5YHFNXSY17N6 |
| R2-3 14-ref timeout | **partly**. No timeout: Dex took 24.9 s on 14 refs, director.input was stored, and "Uploading 14 pictures, then the Director agent reads them… up to a minute" showed at 3.1 s. But Sending… still lasts 34 s, and a words-only generate is still **15.1k input tokens** (was ~27k, the target was a ~5 KB sheet) | shots/084-088; job_01M7XT1FQV36R9JZ9KRGQP5TMF, job_01M7XT6CYX0BC8BWWVYRB1WCC7 |
| R2-4 storyboard continuity | **fixed**. Frame 2 sent frame 1 as `in_1` with subject human, plus @previous and the line "not a copy of it, show each person once". After "Keep a person from this frame… › mia › Keep", frames 3-4 sent `mia_front` human + anchor + previous. Mia held in 4/4 frames, each frame a new moment, one Mia and one puppy | jobs/storyboard-mia.jpg; job_01M7XTG6XD9W8T2D0VETG78E3Q, …K3145B9…, …MQ0Y7R8… |
| R2-5 Brand board | **partly**. Picking Brand titles the board BRAND. As a link source it offers New script/storyboard/video, but linking it into a note says "Not a target for a brand board" and into a picture says "Nothing links into a reference". The brand still reaches jobs, because context is project-wide | shots/022-023, 035-038 |
| R2-6 views without a confirm | **fixed**. Assets › @ruby › Make the other views asks "2 views of @ruby: 3/4, back · Not now · Make 2", with no price. (S3: it offers "back" although @ruby_back-three-quarter exists) | shots/077 |
| R2-7 empty script from a note | **fixed**. The note's words are on the script page | shots/040 |
| R2-8 upscale promise | **fixed**. 2× of the 2048×878 extend promised 3072×1318 and delivered exactly 3072×1318 (Magnific read the 1536 px copy) | job_01M7XSJC8EAQNJXJGA93A49BV3, shots/058 |
| R2-9 crop enlarges | **fixed**. 1:1 crop delivered 864×864 from the 1536×864 master | job_01M7XSD1F3C6CV7KE9XG3VXQ96 |
| R2-10 confirm price | **fixed as the owner rule asks**. No price on any tray or confirm ("Extend · Ideogram 4.5 … What each costs is in History"); costs only in Decisions | shots/052, 058, 029 |
| R2-11 chips at low zoom | **partly**. Rights? chips collapse to dots at 25 %, but the 21:9/1:1 size captions and @name labels stay screen size and overlap the next picture | shots/053b, 089 |
| R2-12 click a view selects the group | **fixed**. A click on a view selects that view (bar "@ruby_side"); shift-click adds a second | shots/072-073 |
| R2-13 trademarks | **fixed**. "No other brands, logos or readable trademarks." ends every generate and frame prompt. A Paris street with shop signs, newspapers, scooters and a van came out with generic signs only | jobs/paris.png, job_01M7XT6CYX0BC8BWWVYRB1WCC7 |
| R2-14 tags cut to 16 | **partly**. The tag is unique but mangled: `ruby_back-three-quarter` goes as `rby_bck_thr_qrtr` (the name loses its vowels too) | provider_submit refs of job_01M7XT1FQV36R9JZ9KRGQP5TMF |
| R2-15 stale Fill placeholder | **fixed** ("What goes in the blue area, like: a red door", empty after the Fill) | shots/066 |
| IMG-4 crop drag / protect remembered | **fixed**. A drag before marking survived (crop x=0), and the protect box was reused on the next Resize | POST of job_01M7XSD1F3C6CV7KE9XG3VXQ96, shots/050 |
| IMG-9 extend seam | **not fixed**. 21:9 extend of an open sunset sky: a hard vertical seam the full sky height at the master edge, with the seed speckle left unpainted along it and a colour step. Sea and sand are fine. A Fill over the seam "came back the same" | jobs/extend-219-leftseam.png, job_01M7XSF31BETPK7HQRC78GR649 |
| IMG-16 download on a sketch v1 | **fixed** (↓ in the bar) | shots/128 |
| IMG-21 wording | **fixed** ("Every project you can open") | shots/002 |
| IMG-22 group overlap | **partly**. The Ruby views group dropped flush on the beach row; its @labels sit on the 21:9/1:1 captions and thumbnails | shots/071, 089 |

## BUG list (new in round 3)
- **R3-1 S2 A storyboard made from one note overwrites the project's existing Script.** Steps: a Script made from note A (harbour picnic); write note B (Mia); link B › New storyboard from this text › Plan shots. Dex asks "The script is a harbour picnic … which film?" Answer "Mia and the puppy". Result: the Script node's picnic words are gone and it now holds Mia's 4 shots. Expected: the storyboard gets its own script (or writes nothing into an unrelated one). Evidence: shots/117, 137; job_01M7XT9N09AN0QGR2JDABT3SDJ (input.script = the picnic). Suspect: the "New storyboard from this text" path binds the new storyboard to the project's first script, and the shot_list landing writes into it.
- **R3-2 S2 The project's palette turns every picture into a 3-colour poster.** Once a palette ref exists, Dex writes "Use only these colours: #E8DCC4, #0A1F44, #FF6F59" or "Keep to the palette" into every generate and frame, including photos that have nothing to do with the brand. Results: the brand picnic became a flat illustration; a "midday sun … Photo" cottage became a navy night with a coral roof and a flat coral pentagon sun; a pine tree turned navy; the Paris street is tinted navy and coral. Expected: the palette is accents or grading for brand work only, and the tray shows that it goes. Evidence: jobs/brand-scene.png, sketch-note.png, sketch-ask.png, paris.png. Code: jobs/context.ts brandItems sends every brand ref on every CONTEXT_OP; prompts/director.v16.md brand section.
- **R3-3 S2 A Fill that "came back the same" is charged in full.** A masked Fill over the extend seam: the UI says "came back the same" (RMSE 0.45 % in the strip), and $0.08 + $0.036 Claude are spent anyway, with no retry or suggestion. The old mask is still listed as "Mask 1 · painting" the next time the editor opens. job_01M7XSNQNRFS8V0DFT2PX85D7S, jobs/fill-compare.png, shots/157.
- **R3-4 S3 Upscale 2× on an already-upscaled v2 promises no growth.** v2 is 3072×1318 and the panel promises "→ 3072 × 1318" (it reads 1536 px), but it is still paid. It should say "already full size" or be disabled. shots/158. Code: stages/imageEditor/edits.ts UPSCALE_READS_PX.
- **R3-5 S3 The storyboard card says "planning the shots" while Dex waits on a question** (60-90 s, twice). The only sign is the Decisions badge, and no ask card appears by the node. shots/098, 148.
- **R3-6 S3 Booth › From Napkin › Link: the first click did nothing.** The second showed "Linking…" for over a minute, then opened the brief. The brief card landed on top of the Mia note. shots/140-143.
- **R3-7 S3 Uploads are stored at 1536 px without saying so** (2048×1152 → master 1536×864). The crop POST shows masterSize 1536×864.
- **R3-8 S3 Name… with an existing key silently takes that key's role.** The 2nd "harbour" picture became a palette with swatches picked from the type card, and no role pills showed. Nothing tells you to use a new name. shots/013.
- **R3-9 S3 Shift-click on canvas pictures selects page text** (blue highlight over the tray and chrome). shots/080.
- **R3-10 S3 Make the other views offers "back" when a back-three-quarter view exists.** shots/077.
- **R3-11 S3 Dex is slow on small frames**: 34.8 s (2,091 output tokens) for a 1-ref frame, so 38 s of "waiting to start". job_01M7XTG6XD9W8T2D0VETG78E3Q.
- **R3-12 S3 Every frame prompt repeats the whole 4-beat note**, and frame 4 says "Keep the setting of @anchor" (the rainy street) for the café shot. The model coped, but the prompt is wrong. job_01M7XTMQ0Y7R8BJS8PVHVJWMX3.

## Dex findings
- **Got:** words, refs with roles and names, ratio, **input.context (brand rule, palette, typography) on every director op**, input.brief on shot_list and frame (brief storyboard), script + shot + anchor/previous on frames, answer after a question. Sizes: director.input 0.5-3.4 KB.
- **Sent well:** the no-alcohol rule turned into "soft drinks only"; the font is left out of scenes with no text; "No other brands…" on every scene; the 14-ref case had "views of one single character … never copies" with exactly one Ruby; the storyboard continuity lines; it cast @ruby/@mia from project characters when planning from the brief; it asked when the script and the words disagreed, and when the script was empty.
- **Should send / not send:** the palette as accents, not "use only these colours" (R3-2); no brand context on a sky Fill or unrelated scenes unless asked; for frames only this shot's beat, not the whole note (R3-12); the anchor's setting only when the shot is in the same place; it never sees sketch pixels, so a drawn hexagon sun became a literal pentagon (give Dex the sketch or a card for it).
- **Tokens:** words-only generate 15,129 in / 1,026 out (round 2 ~27k); brand generate 15,130 / 870; 14-ref 20,184 / 2,851; frames 15.4-16.6k in / 1.5-2.3k out; shot_list 14.1-14.6k; region_edit 14.5k. Latency 4.6-37 s: 14 refs 24.9 s (no timeout, one try), frame 2 34.8 s, typical 6-12 s.

## Quality (1-5)
| Job | Score | Notes |
|---|---|---|
| brand picnic | 3 | palette 5, rule 3 (amber glass reads as beer), poster look not asked |
| crop 1:1 | 4 | own size, subject kept |
| extend 21:9 | 2 | hard sky seam + speckle |
| upscale 2× | 4 | exact promised size, sharp |
| fill seam | 1 | unchanged, charged |
| 14 refs café | 4 | Ruby held, one Ruby, dog + bottle right |
| Paris street | 4 | no trademarks; brand tint |
| storyboard Mia | 5/5/5/5 | identity and new moment every frame |
| sketch (answered ask) | 3 | layout right; pentagon sun, navy pine |
| sketch + linked note | 2 | navy night collage for a "midday photo" |
| brief frame 1 | 4 | Ruby held, gag right; wine-like bottle in the fridge |

## Timings (s)
| Step | Time |
|---|---|
| words generate (Dex) | click→POST 9-11 · relay 30-32 · Dex 7.6-10.2 |
| 14 refs | Sending 34 · Dex 24.9 · relay 69.7 |
| crop | 2.2 |
| extend 21:9 | 47.6 (provider 38) |
| upscale 2× | 19.6 |
| fill | 25.5 |
| plan shots (ask) | 4.6, answer → plan 8.7 · brief: 5.1 + 18.6 |
| frames | f1 39 · f2 71 (Dex 35) · Draw the rest (2 frames, sequential) 108 · brief f1 47 |
| sketch | ask answer → landed 40 · with note 34 |

## UX proposals
1. Show brand context in the Generate tray ("Brand: no alcohol · palette · font", each with a tick). Default the palette to "accents", with "strict" as an option.
2. When a storyboard or script job asks a question, put the ask card beside that node and change its line to "The Director agent has a question".
3. "New storyboard/script from this text" makes its own script and never reuses another one.
4. Upscale: disable 2× when it cannot grow the picture, and say "already full size (3072 px)".
5. A Fill that comes back the same: offer one free retry, or a hint ("paint wider, say what to keep").
6. Extend: stepped outpainting, or a wider feather on the sky band.
7. Name… on an existing key: say "harbour is a palette · pick a new name for a font".
8. Brief Link: show "Linking…" at once and a toast "Linked into Script · Every agent now reads it". Place the brief clear of other nodes.
9. Say on the size caption that an upload is stored at 1536 px for the models.
10. Draw the rest: run the frames after frame 1 in parallel, now that each one carries the kept character (108 s for 2 frames).

## Spend
Provider **$2.78** of $5.00 (13 confirmed jobs; paid.log names each). Claude **$0.68** (cost.agentUsd).
