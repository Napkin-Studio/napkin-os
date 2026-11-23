# Round 2 tasks

UAT now runs fix/pt-uat-loop with three fix sets merged: Dex context (features/pt-dex-context.clan, director.v15), canvas/image fixes (features/pt-canvas-r1.clan), film-path fixes (features/pt-film-r1.clan). Read the "build_log" and "open_questions" of the record(s) for your area first.

## Part A (both agents, for your area): RETEST every round-1 bug live
Your round-1 report is round-1/<slug>/report.md. For each bug id: fixed / partly / not fixed / regressed, with evidence (screenshot, jobId). Then look for regressions around each fix.

## T1 — images (slug images, mock@napkin, paid budget $6)
After Part A:
1. IMG-9 Extend: one paid extend to 21:9 and one to 9:16 — seams?
2. Ref limits in the tray: 16 pictures with mixed people/things; switch an unnamed picture to "person"; check what reaches Runway (subject human/object) in provider_submit.
3. Brand context: put a brand/look node (swatches, font, a do/don't rule) in the project, link it, generate — does input.context reach Dex (job record director.input) and does the output respect the palette/rule? Score it.
4. Character identity across 4 generates with the same named character (2 views) in different scenes — score identity.
5. Product consistency: a packshot (named product) placed in 3 scenes — label/shape held?
6. Script → storyboard straight from words (no brief), 4 frames, judge continuity.
Note anything that feels slow or confusing; propose concrete UX improvements (not just bugs).

## T2 — film (slug film, hello@napkin, paid budget $12)
After Part A (especially B2 join → cut on a REAL model, B6 sound, B7 autosave, B1 words box, B4 cutdown end card):
1. Sound: a shot with a whispered line on Veo 3.1 (audio on) — is the line heard, is it right? A shot with a sound beat (snore) — heard? Check provider_submit has audio on and the cost reflects it.
2. Joining: join 3 shots with frames on the default join model; then cut one gap again; then re-join; check the cut each time, undo, and that manual trims elsewhere survive.
3. Characters across shots: a named character with 2 views across 3 clips (separate) vs joined — identity score each.
4. Script writing experience: from a brief, draft; then 3 rewrites with different asks (tone, length, add a line of dialogue); judge speed, control, whether the shot plan follows the rewritten script; propose concrete improvements.
5. End to end clock: brief in → rendered ad + one cutdown, wall time and cost.
6. The Edit room: captions, text overlays, sound editor, Render ad, Rendered tab playback, download.
