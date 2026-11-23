# Round 1 tasks

## T1 — images & canvas (slug: images; account mock@napkin; paid budget $6)
Cover, each with screenshots + backend trace:
1. Blank canvas entry: new project, what you see, what it asks.
2. Generate with NO refs (plain words). 2 different asks (a person scene, a product packshot).
3. Generate with 1 named character ref, and 1 unnamed product image (audit says unnamed images go as role character → Runway subject human: verify in provider_submit).
4. TOO MANY refs: put 12–16 images on the canvas linked to one generate (use images from /home/batunii/Documents/Code/napkin-wt-pt-uat/production-tool/relay/eval/fixtures/frames and your earlier outputs). What does the UI allow, what is refused, with what words, what reaches Runway.
5. Drawing: draw a rough sketch / layout with the canvas drawing tools, generate from it. Does the output follow the layout? What role does the sketch go as?
6. Image editor on a generated image: region edit (mask + words), remove, redraw/frame edit, upscale, resize to other formats, view (other angle). Every button in the editor.
7. Notes linked to a generate (linked text) — does the text reach Dex?
8. Save, reload, reopen; version history; export.
Quality: for each image, score vs ask.

## T2 — film path (slug: film; account hello@napkin; paid budget $12)
1. Straight from a brief: find how a brief gets into the Production Tool (Brief node; OS "Continue in → Production" from a Brief Maker document; or the Production Tool's own brief entry). If UAT's Brief Maker is needed, you may create one short brief for a fictional brand there (Brief runs are allowed). Record how long and what the Production Tool receives.
2. Script writing: the Script agent / Booth (op write) — draft from the brief, then ask for 2 rewrites (shorter; change the ending). Judge the experience: speed, clarity, control, what you'd want. Then the shot list (op shot_list).
3. Storyboard: make frames for 3–4 shots (character continuity across frames?).
4. Video: make 2 shots as SEPARATE clips (Veo default), then JOIN two shots (Join/Cut toggle in the Make room; "make as one video"), and check: does the joined take land, replace the clips in the cut, play in the Edit room? Owner says "joining two shots in video doesn't work" — find exactly what breaks.
5. Edit room: add to edit, reorder, trim, Assemble first cut, Render ad (stitch: should be free/ffmpeg), cutdowns. Every button.
6. Text-only shots with no frame → clip.
Quality: frames vs script, clips vs frame + words, identity across shots.

Both: timings for every job (click → landed), Dex in/out for every job, console errors, dead buttons.
