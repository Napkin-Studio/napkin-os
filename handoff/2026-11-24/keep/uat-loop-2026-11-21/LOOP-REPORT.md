# Production Tool UAT loop — running report (from 2026-11-21)

Scope: Production Tool only (owner). UAT http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com/production/
Branch on UAT: fix/pt-uat-loop (develop + fixes). Shared relay Lambda napkin-hackathon-relay (staging uses it too).
Rollback points: relay live 19, stitch live 13 (before the loop). Round 1 deployed relay 20 / stitch 14, UAT web+middleware a02b6fa1.

## FINAL (2026-11-21, loop stopped by the owner after round 6 — report only, no further fixes)

**State:** UAT runs fix/pt-uat-loop a55d7ce7 (develop 9a5d64a8 + 10 fix branches). Relay live 25, stitch live 19 (shared with staging). Rollback points: before the loop relay 19 / stitch 13; previous round relay 24 / stitch 18. Nothing merged to develop or main; no PRs. Records pt-canvas-r1..r5, pt-film-r1..r5, pt-dex-context, pt-relay-trace are on the branch (status building/verifying).

**Round 6 result:** images — no S1/S2 (all round-5 S2s fixed live: Look line on frames, brand ask, 21:9 seam, Draw the rest single start). film — one S2 left (R6-F1); round-5 S2s fixed live (shot asks keep their line, spoken shots long enough, no-one insert has no Maya, WAN 3 window covers the voice).

**Open bugs at stop (not fixed, by the owner's instruction):**
- S2 R6-F1: the 9:16 cutdown drops the spoken-line caption and the end line (web/src/campaign/filmJobs.ts linesApart ends the caption before it starts; cutdownInput → withoutCardWords drops the line). The 16:9 ad is right.
- S3 images: "Draft a script from the brief" still plans shots (scriptFirst.ts SCRIPT_ROUTE doesn't match Dex's draft_script_from_brief); faint ~50 px soft band beside 21:9 extend edges (contrast-boost only); Undo label stale after pen strokes; "Used in" wraps.
- S3 film: "Make Maya funnier" with nothing picked goes to shot 1 (askedItems ignores speakers/"Shows @maya"); "On your selection" with nothing selected and the "Shows @maya." line rewritten as script; the kettle from an insert's @previous leaks into Maya's hands; end card Line defaults to "Your brand" instead of the brief's end line; "Reframe · crop" for a fitted shot; an edit + reload within ~0.4 s is lost silently; raw id in an Undo tooltip, "1 versions", stale "Drawing the frame… first"; 9:16 cutdown 5.52 s not 6.00; Continue in → canvas 15 s once (was 4.7 s).
- Carried: kettle drawn stovetop vs electric (needs a product field in the brief, Q18); first cold load ~16 s (7 MB .clan engine, Q23).

**Quality at the end (1–5):** storyboard with a kept person 5/5/4.5/5; character identity 4–5 across frames and clips; product label held 5/5/4; brand palette as accents 5, rule 5; extend 21:9 4.5, 4:5 4.5, 9:16 → Redraw 5; no-ref 5; 14 refs 4; sketch + note 5.
**Dex at the end:** words-only ~9k tokens in / 2 s (round 1–2: ~27k, up to 44 s with a timeout); frames ~10k / 2–5 s (was 16k / up to 35 s); cut plan 2.6k / 2.5 s (was a 41 s timeout). director.v17 + effort low on image ops; skye.v8.
**End to end (Quietboil brief → rendered ad downloaded):** ~7.5–10 min machine time, ~$3.5 provider + ~$0.4–0.6 Claude per ad.

**Spend:** provider $42.50 (r1 8.45, r2 12.58, r3 7.71, r4 7.39, r5 4.22, r6 2.15). Claude ≈ $8–9 (recorded per job from round 3: r3 1.52, r4 0.89, r5 0.73, r6 0.48; rounds 1–2 estimated ≈ $3.8 before cost.agentUsd existed). Total ≈ $51 against the $50 soft cap; past $50 only named verification checks ran.

**Process notes:** round-3 film build used 2 helper agents (over the 2-build-agent limit) — briefs forbade it from then on. Two round-4 fixes caused round-5 S2s (schema-invalid ask ids; frames losing the look) — round-5 added a contract-validation test for every ask the web writes. AWS SSO expired once (~03:33Z, round 4); owner re-authenticated. Leftover round-1 test browser was killed.

## Setup notes
- spike/acne-stena-demo push refused by the licence gate (licences/fonts.toml from deck work → needs Shrey's NAPKIN_LICENCE_APPROVED). PT code there ≈ develop, so the loop branch is cut from develop. Spike got 3 local push fixes (golden re-record, projects example, soffice test path).
- LibreOffice installed per-user (Flathub) + ~/.local/bin/soffice wrapper, so local deck checks run honestly.

## Round 1 (tests: images = mock@napkin, film = hello@napkin)
Spend: provider $8.45 (images $2.93, film $5.52) + Claude ≈ $1.3. 35 jobs.
- images: 58 controls → 44 work / 9 partly / 5 broken. 3 S1, 7 S2, 12 S3. round-1/images/report.md
- film: whole path; 1 S1, 5 S2, ~17 S3. round-1/film/report.md
- Owner's "joining doesn't work": the join makes one video fine; the joined take never enters the cut (lands outside by design, needs two "Use this take" cards), shot windows ignore the relay's detected cut, model switches silently.
- Quality: images mostly 4–5; crop 1 (subject cut out), extend 2 (seams). Frame continuity across 5 chained frames good. No sound on any clip (audio forced off).
- Timings: generate 22–37 s + Dex 3–20 s + browser uploads up to 24 s; Veo clip 55–65 s; region fill ~24 s; upscale ~41 s; render ad 10.7 s (free); cutdown ~11 s (free).

## Fix branches (round 1 → round 2)
- fix/pt-relay-trace → in fix/pt-uat-loop (deployed): per-job JSON trace (provider_submit, job_stage, director, director_rejected), passthrough prompt fit, 9-object ref limit in sheet.
- fix/pt-dex-context: take image numbering by real ref place; unnamed pictures → object; input.context filled (brand rules, linked docs) and cut per op; brief to generate/region_edit; director.v15 (rollback: promptVersion director.v14).
- fix/pt-canvas-r1: IMG-1..22 fixed except IMG-9 extend (partly, needs a paid check) and IMG-12 (partly); director.input stored on job record; resize crop protects subject; ref limits counted in tray before upload.
- fix/pt-film-r1: B2 joined take replaces the shots' clips in the cut (one undo, note), windows from detected cut, durations per model minimum; B1 words box; B3 brief by priority; B4 sizes end on client card then studio card (owner's studio-card decision kept); B6 audio on for line/sound shots where the model has a switch (Veo cost ×2); B7 autosave at first change + 10 s after each landing; many S3s.
- Merged into fix/pt-uat-loop 80b20aa2 (2 trivial conflicts, both sides kept; relay pytest + 2000 web tests pass).

## Round 2 (relay live 21, UAT web+middleware 80b20aa2)
- images (mock@napkin, $5.03, 27 jobs): round-1 bugs 17 fixed / 4 partly (IMG-9 sky seam, IMG-16, IMG-21, IMG-22) / 0 regressed. New: 1 S1 (R2-1 brand refs can't be made → input.context never reaches Dex from the UI), 6 S2, 8 S3. round-2/images/report.md
  - Quality: character identity across 4 scenes 5/4/5/5; product label held 5/5/4; storyboard 4/3/3/1 (frame copies previous, character drifts); extend 3 (21:9) / 4 (9:16).
  - Dex: 3.5–9.5 s typical; timed out at 44 s on 14 refs (passthrough); ~27k input tokens even on words-only; paints real trademarks.
  - Build: fix/pt-canvas-r2 (all R2 image bugs + partly items + 8 UX proposals) started.
- film (hello@napkin, $7.55 + ~$2 Claude unrecorded): B2 join→cut fixed on real models, B3/B4/B5/B7 fixed, B1 + B6 partly. New: 1 S1 (F2 "Use this take" after re-cutting a join puts shot 1's footage in shot 2), S2: F1 false save conflict (two saves race → 409 banner), F3 box shows one model but job uses another (unplanned $1.60 Veo+audio), F4 take length taken from the plan not the file (cut the spoken line), F5 WAN 3 refuses narrow ref with raw 400, F8 sound editor out of step / VO never voiced; ~14 S3. round-2/film/report.md
  - Sound: Veo whispered line heard (soft, not whispered), snore heard. Identity 4/5 separate clips, 3/5 joined. 3-shot join impossible when a shot speaks.
  - Script writing: draft 17 s, rewrites 8–10 s, plan follows every rewrite; 6 UX proposals (screenplay diff, length→target, seconds on cards, cue→@character, Booth refresh, front-view warning).
  - End to end: ~9–10 min machine time on the critical path; 58 min wall with test detours.
  - Build: fix/pt-film-r2 started.
- Round-2 spend: $12.58 providers. Loop total ≈ $21.0 providers + ≈ $4–5 Claude.

## Fix branches (round 2 → round 3)
- fix/pt-canvas-r2 (2f08b170): R2-1..R2-15 + IMG-4/9/16/21/22. Brand refs collect swatches/font/rule; Dex sheet cut per op (~8k fewer tokens), timeout scales 20→40 s with refs, director.input kept on failure; storyboard frames send a character ref + "new moment" line; director.v16 adds "No other brands, logos or readable trademarks" (rollback: promptVersion director.v15). Prices it first added to confirms were REMOVED (owner rule 2026-10-13: no prices in UI); the confirm on "Make the other views" stays without price.
- fix/pt-film-r2 (236df1c7): F1–F22 except script UX 4 (cue→@character needs a design). Saves serialised (no false 409 banner); box model = sent model; real take length from MP4 header; refs padded to model aspect range (WAN 3 ≥0.55); one Make from words; sound view reads the cut; Download the ad; Claude cost recorded per job (cost.agentUsd, list price $2/$10 per Mtok unless config director.prices sets Bedrock's) — the global spend stop now counts Claude too; unasked sound beats dropped by the relay; clock times out of clip prompts.
- Merged into fix/pt-uat-loop b60b21ed (1 conflict in director.py: sheet_for(op, _sheet_for_dex(sheet), payload)). Relay pytest, web tsc + 2028 vitest, contracts all pass; pre-push passed.
- Deploy: relay/stitch from b60b21ed (rollback: relay 21, stitch 15), then UAT.

## Open questions added in round 2
6. Keep frame 1 going as the person automatically when a shot names nobody, or only after "Keep a person"?
7. Should text notes on a Brand board count as brand rules? (now only named brand refs)
8. Bedrock's real Sonnet 5.5 price for config director.prices (ledger uses list price now).
9. Spoken shots can't be joined (join trims to storyboard length and could cut a line) — allow on audio models after a paid test?
10. Caption with no free time: left out (now) or moved above the super?
11. Strip Omni's background sound when the script asks for none?
12. Script cue "MAYA" → @maya link (script UX 4) needs a small design.

## Round 3 (relay live 22, stitch 16, UAT web+middleware b60b21ed)
- film (hello@napkin, $4.93 provider + $0.84 Claude, 23 jobs): round-2 bugs mostly fixed — F1 no false conflicts (45 saves), F2 Use this take only switches its own shot, F7 one Make frame→clip (108 s), F19 Download the ad, F21 Claude cost on every job; B1/B6 fixed (Veo line inside the window, heard in the ad). Partly: F3 (boxes without takes still inherit the last model), F15 (version numbers differ Bin/note/zip), F22 ("Silence" beat turns sound on). F5 padding not verifiable live (Dex drops @maya_full for WAN). New S2: R3-F1 storyboard forces a person into shots with no one (my round-2 decision 3 — reversed), R3-F2 Assemble plays whole padded takes (regression of F4), R3-F3 script asks after planning see an empty script, R3-F4 first takes of boxes outside the cut never reach it, R3-F5 "Tell the Camera agent" overwrites the shot's words. 10 S3. No price seen anywhere in the UI.
  - Dex input 13.6–17k tokens (was ~27k), 6.6k for script writes; latency 4.8–15.3 s.
  - End to end: brief → ad downloaded 35 min wall, ~7.5 min machine; the ad cost $3.62 provider + ~$0.60 Claude.
  - Build: fix/pt-film-r3 started.
- images (mock@napkin, $2.78 provider + $0.68 Claude, 16 jobs): 20 round-2 ids → 14 fixed, 5 partly, 1 not fixed (IMG-9 extend seam, third round), 0 regressed. Fixed highlights: brand refs from the UI reach Dex on every op; storyboard Mia 5/5/5/5 with "Keep a person"; upscale promise met exactly; no trademarks; no price in the UI. New S2: R3-1 "New storyboard from this text" overwrites the project's existing script; R3-2 a palette ref makes every picture a flat 3-colour poster ("use only these colours" on every op); R3-3 an unchanged Fill is charged with no retry. 9 S3.
  - Dex: words-only 15.1k tokens (was 27k, goal lower), 14 refs 20.2k, no timeout (24.9 s), one frame 34.8 s.
  - Build: fix/pt-canvas-r3 started (incl. stepped outpainting for Extend, director.v17 for palette-as-accents).
- Round-3 spend: $7.71 provider + $1.52 Claude. Loop total ≈ $28.7 provider + ≈ $6–7 Claude.

## Fix branches (round 3 → round 4)
- fix/pt-film-r3 (593ad32b): R3-F1..F15 + F3/F4/F5/F12/F15/F22 leftovers. Character refs only for shots that name/imply a person (round-2 decision reversed); Assemble at planned lengths, Out clamps visibly; script asks read the whole script and aim at the shot they're about; a box's first take goes into the cut at its place with an Undo note; "Tell the Camera agent" is a remake ask, shot words untouched; boxes default by need, never the last model used; silence beats never turn sound on; F5 root cause — @maya_full was optional so Dex dropped it, now required; skye.v7 keeps spoken lines on length asks (rollback skye.v6); short sizes keep ≥3.5 s picture by shortening studio card (≥1.2 s) then client card (≥1 s); one version number everywhere; cutdowns in the media zip. Partly: R3-F13 (end-card numbering wording), R3-F14 half (Booth stays on Assets). Director prompt unchanged.
  - Process slip: the film build agent started 2 helper agents (fix/pt-film-r3-a, -b), breaking the max-2-build-agents rule for part of round 3. Briefs now forbid sub-agents.
- fix/pt-canvas-r3 (d8cfabb4): R3-1..R3-12 + leftovers. New storyboard/film from a note makes its own script; brand rules on look ops, palette/typography only on brand work, palette as "Accents:" by default (Strict toggle, ticks in the Generate tray); unchanged Fill → "came back unchanged" + Try again/Discard (no refund); Extend = stepped outpainting on Ideogram 4.5 via Runway (1–3 calls, cost × steps); ask cut 36→21 KB (schema per op, no descriptions); Dex effort low on generate/frame/view/region_edit (rollback: EFFORT per op); frames carry their own beat + shot 1's; Draw the rest 2 at a time; short readable tags (ruby_back_3q). director.v17 (rollback director.v16). Partly: R3-6 (slowness is the OS document read, crates/napkin-web), R3-7 (originals not kept).
- Merged into fix/pt-uat-loop df0ca1a7 (no conflicts; canvas branch pre-merged the film work). Pre-push checks passed. Deploy: relay/stitch then UAT (rollback relay 22, stitch 16).

## Open questions added in round 3
13. Short sizes: drop the studio card entirely? (now shortened to 1.2 s)
14. Should the end card stop taking a shot number at all?
15. When should the Booth leave Assets?
16. Should sound beats alone (no spoken line) pick a model with sound?
17. One ask that should rewrite several shots needs a multi-target write — build it?

## Round 4 (relay live 23, stitch 17, UAT web+middleware df0ca1a7)
- film (hello@napkin, $3.98 provider + $0.51 Claude, 19 jobs): round-3 bugs 17 fixed, 4 partly, 2 not fixed, 1 regressed path, 3 not retestable. Live now: F5 narrow ref padded and accepted on WAN 3; Assemble at planned lengths; first takes into the cut; Camera ask remake (take followed the ask, 5/5); Out clamp; one version number. New S2: R4-F1 picked WAN 3 but made on Veo 3.1 (+$1.40 unplanned — 3rd time for the model-choice class), R4-F2 "a flatmate" pulls @maya in as the flatmate, R4-F3 script asks after Plan shots still blind (2nd time), R4-F4 6 s cutdown is a 4.5 s file with 2 s picture — cut plan Dex ModelError at 41 s → passthrough. S3: frame 1 sent twice as @anchor and @previous (3rd time a duplicate picture), mandatory end line missing from the ad, "free"/"paid" cost words in the sizes sheet, wording.
  - Dex at effort low: frames 10.6–11k in / 0.4–0.6k out / 3.3–6.6 s (was 16–17k in). Identity 4 across frames/clips except the flatmate frame (2).
  - End to end: brief → ad downloaded 27 min wall, ~10 min machine (Runway queue 141–157 s on two jobs); ad $3.54 + $0.41 Claude.
  - AWS SSO expired ~03:33Z: the tester lost relay traces for its last jobs; I can't verify deploys or read the ledger until the owner runs `aws sso login --profile napkin`.
  - Build: fix/pt-film-r4 started (repeat bugs: root cause + a test for the exact live repro).
- images (mock@napkin, $3.41 provider + $0.38 Claude, 17 jobs): round-3 ids 12 fixed, 3 partly, 2 not fixed, 0 regressed. Dex at effort low: words-only 9.0k tokens / 2.0 s (was 15.1k / 7.6–10 s), frames 2.5–3.1 s (was up to 35 s), quality held on single jobs (Paris 5, brand poster 4.5, sketch+note 5); palette as accents works (palette 5, rule 5, natural 4); new storyboard keeps the old script; brief Link ~1 s. New: S1 Extend 9:16 in 3 steps stacks 4 suns / ghost legs (mirrored seed re-mirrored each step) — 4th round on Extend; 21:9 now 3.5 (was 2). S2: frames still get the whole note → a 2×2 collage frame (R3-12 again); Brand board → note refused by the store (contract has no rule; 3rd time); Try again on an unchanged fill resends the same request (charged again); Brief Maker menu item dead after a character card; Dex cast @ruby/@mia from other tests into the Quietboil storyboard and the project's only palette went onto it.
  - The tester flagged $ in the Decisions panel as a bug — NOT a bug: the owner's rule allows costs in the decision tree/History only. My round-4 task text overstated the rule; corrected for round 5.
  - Build: fix/pt-canvas-r4 started (Extend: no mirrored content, "Redraw at 9:16" when growth is too large, step progress; one test running every canvas-allowed link through the store check).
- Round-4 spend: $7.39 provider + $0.89 Claude. Loop total ≈ $36.1 provider + ≈ $8 Claude ≈ $44 of the $50 soft cap. From round 5: paid checks only where a fix can't be proven otherwise.

## Fix branches (round 4 → round 5)
- fix/pt-canvas-r4 (c0aedf4e): Extend seeds bands with a flat field from the edge strip (no mirrored content), ≤3 steps of 35 %, beyond that Redraw (Gemini via Runway) offered and the relay refuses before spend; "step N of M" progress; frames read only texts linked into their shot (no whole-note collage); Brand board → note is an additive contract rule + a test running all 72 canvas-allowed links through the store check; thin fill masks widened, Try again changes mask + words; Brief Maker always opens From Napkin; brief storyboards cast only linked/named characters and ask "Use a brand?"; cost words removed outside Decisions; pen options off the canvas; Ctrl+Z order fixed; director.usage stored on jobs; frame framing from the shot list.
- fix/pt-film-r4 (0730025e): the person's model pick always wins on every make path (invariant test shown === sent across 4 models and all paths); character refs only when the shot names the character, an unnamed person is told to be someone else; script asks after Plan shots carry the real lines and ask "which shot?" on a tie; cut plan gets its own 45 s timeout (CloudWatch confirmed APITimeoutError at ~41 s), effort low, honest fallback that fills the size length, Claude cost recorded; any repeated picture dropped at submit (sha256); end line added as a super when nothing voices it; joined-box windows from Dex's timing; sound beats in clip prompts for models with sound.
- Merge: canvas-r4 merged; film agent merged canvas-r4 into film-r4 to resolve 11 wording/test conflicts (2e791b56); loop branch f29fc482, pre-push checks passed. Deployed: relay 24, stitch 18 (rollback 23/17), UAT web+middleware f29fc482 — verified in AWS. Round 5 (lean: $2.50 images, $3 film, paid checks only) started.

## Open questions added in round 4
18. Should briefs carry a product field so frames/clips get product facts (the "electric kettle" drawn as a stovetop one)? Contract change.
19. Should clips also read only their shot's words (frames now do)?
20. Should the brand question block planning? (now: no brand until picked)
21. A real person-crop for "Keep a person"? (now: whole frame, said plainly)

## Round 5 (lean; relay 24, stitch 18, UAT f29fc482)
- images (mock@napkin, $2.28 provider + $0.22 Claude, 11 jobs): round-4 ids 14 fixed, 5 partly, 0 regressed. Extend finally right on multi-step (4:5: flat bands, 3 steps of ~1.3×, "step N of 3", 4.5/5 each, no seams) and 16:9→9:16 goes to Redraw (5/5); no collage frames; Brand board → note saves; thin fill widened and works (4); $ only in Decisions; pen undo order right. New S2 (no S1): S2-A frames lose the person's look from the note (side effect of round-4's frames-read-only-their-shot fix); S2-B the brief storyboard's "Use a brand?" ask can't be answered (ids fail the schema — round-4 feature); S2-C Extend 21:9 sky seam at the original's edges (seed greyer than the edge); S2-D Draw the rest starts the last frame twice (+$0.20). 6 S3 incl. pen options back on the canvas after navigation (round-4 fix regressed) and a "PAIN QUOTIDIEN" sign. Unplanned spend $0.40 (one Redraw the web resent after a blocked check, one duplicate frame = S2-D).
  - Pattern: 2 of 4 new S2s were caused by round-4 fixes. Round-5 build brief asks for a test that validates every ask the web builds against the contract schema, and repro tests for each.
  - Build: fix/pt-canvas-r5 started.
- film (hello@napkin, $1.94 provider + $0.51 Claude, 20 jobs): round-4 ids 14 fixed, 2 partly, 3 not retestable. Live now: picked WAN 3 sends WAN 3; flatmate frame has no Maya and Dex says someone else; Dex cut plan in 4.9 s, 6.00 s file with 3.5 s picture; no duplicate pictures; end-line super in preview/render/Review; joined-box windows match Dex; no cost words outside Decisions. New S2: R5-F1 a shot ask after Plan shots loses the shot's own spoken line (agent wrote a second line, shot grew 1→4 s) — script asks, 3rd round; R5-F2 suspected: "Good boy." may be cut by a 1.0 s window (needs a person to listen — clips sent to the owner). S3: insert frame still draws Maya via @previous; tie panel doesn't show the ask; super over caption in 9:16; a same-tab 409 hidden; "maya front" in prompts.
  - Build: fix/pt-film-r5 started (asks built from the shot model, spoken shots get the line's length).
- Round-5 spend: $4.22 provider + $0.73 Claude. Loop total ≈ $40.3 provider + ≈ $9.5 Claude ≈ $50 — at the soft cap. Further paid work only where a fix can't be proven otherwise.

## Fix branches (round 5 → round 6)
- fix/pt-canvas-r5 (cfc926ff): S2-A a "Look:" line per named person on frames, read from the person's introduction (not the whole note); S2-B brand ask options brand_1..5/no_brand + a test validating every ask the web writes against the contract (failed on the old code); S2-C extend seed starts from the picture's edge line and the band's tone is matched row by row on landing (edge step ≤3 levels, was ≤8; screenshot shows the seam gone); S2-D Draw the rest claims a shot before awaiting; pen options follow the rebuilt top bar; "write a script" plan option drafts a script instead of planning; Used in counts; "Shop signs show no real business's name" on frames/generates; "Opening Napkin Studio…" on first paint (lazy-loading the 7 MB .clan engine not done). Merged into fix/pt-uat-loop (no conflicts). Fill's 17k tokens = one schema-failed Dex answer retried, not growth.
- fix/pt-film-r5 (9117900f, canvas-r5 merged in): script asks built from whole shots (target keeps its own line; unasked dialogue → one redo then stripped; skye.v8, rollback v7); spoken shots ≥ the line's estimated length (2.5 words/s, whispered 2/s; "Good boy." 1.0 → 2.0 s) and voiced takes play to the line's end (voice span not measured); no-one shots get no @previous after a person shot + "No people in this shot."; tie panel shows "You asked"; end-line super never with a caption; crop-cut shots go whole on a blurred copy (free) instead of Aleph — owner can still pick New edges; same-tab reload save race resolved; "Maya" not "maya front"; cut text says who speaks and whether it's voiced.
- Merged into fix/pt-uat-loop a55d7ce7 (no conflicts), pre-push passed. Deployed: relay 25, stitch 19 (rollback 24/18), UAT web+middleware a55d7ce7 — verified in AWS. Round 6 (verification, $1.50 per side, paid only where named) started.

## Open questions added in round 5
22. Should Dex return each character's look in the shot list (director.v18 + contract field)? Today the look survives via linked notes/plan text only.
23. Lazy-load the 7 MB .clan engine and large JS chunks to cut the ~12 s blank first load?
24. "Write a script" on a storyboard with no brief opens an empty script — ask for a line instead?
25. Listen check: is "Good boy." cut in the round-5 ad (clips sent to the owner)?

## Decisions taken while the owner is away (review)
- Dex brand context limits per op (see pt-dex-context record). Canvas Generate reads the project's brief only when the project has exactly one.
- capabilities.schema.json gains optional refs.maxObject (Runway: 9 objects).

## Open questions for the owner (from round 1 builds)
1. Size lengths: the studio card counts inside a 6 s size, leaving 2.3 s of picture. Count only the film (studio card after), or drop the studio card on 6 s sizes?
2. Server save every minute when changed (was 5 min) — OK?
3. Should an unnamed picture whose description says "a person" be pre-marked as a person? (today: thing until the words or the person say so)
4. Canvas Generate uses the project's brief only when the project has exactly one brief.
5. Crop subject is marked by the person (no auto subject detection yet).
