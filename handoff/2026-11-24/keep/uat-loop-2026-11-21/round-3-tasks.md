# Round 3 tasks

UAT now runs fix/pt-uat-loop b60b21ed: round-2 fixes merged — canvas + Dex (features/pt-canvas-r2.clan, director.v16) and film (features/pt-film-r2.clan). Read the build_log, decisions and open_questions of the record(s) for your area first. Fix screenshots: round-2/fixes-canvas/ and round-2/fixes-film/.

Owner rule (2026-10-13, still in force): **no prices or costs anywhere in the UI** (costs live in History/Decisions only). Any price you see in a tray, confirm, box or banner is a bug.

New this round: Claude (Dex/agents) cost is now recorded on each job as `cost.agentUsd`. Report provider spend and Claude spend separately from the ledger.

## Part A (both agents, for your area): RETEST every round-2 bug live
Your round-2 report is round-2/<slug>/report.md. For each bug id (and each "partly" from Part A of round 2): fixed / partly / not fixed / regressed, with evidence (screenshot, jobId). Then look for regressions around each fix.

## T1 — images (slug images, mock@napkin, paid budget $5)
After Part A:
1. Paid checks the build could not do: one Upscale 2× of a ~2048 px picture (R2-8: promise vs delivered size) and one Extend to 21:9 of a picture with open sky (IMG-9 seam).
2. Brand end to end from the UI only: make a palette ref, a typography ref and a brand rule (do/don't) through Name…, link them / a Brand board, generate a scene. Check director.input.context on the job record, then score palette/rule adherence.
3. Storyboard from words (no brief), 4 frames with a named character: does frame 2+ get a character ref (provider_submit), is each frame a new moment, does the character hold? Try "Keep a person from this frame…".
4. Dex: input token size on a words-only generate (compare to round 2's ~27k), latency on a 14-ref generate (no timeout now?), "no other brands" line in the prompt on scenes — any trademarks?
5. The owner's original paths: no-ref generate, max refs, a drawing/sketch with and without a linked note, straight from a brief.
Note anything slow or confusing; propose concrete UX improvements.

## T2 — film (slug film, hello@napkin, paid budget $8)
After Part A (especially F2 Use this take after re-cutting a join, F3 shown model = sent model, F4 real take length, F5 narrow ref on WAN 3, F7 one Make from words, F1 no false conflict, F8 sound view, F19 Download the ad, F21 Claude cost recorded):
1. Joining again on a real model: 2 shots join → Make → cut a gap → make separately → Use this take on each card; check the cut and footage per shot every step, Undo/Redo.
2. Sound: a speaking shot on Veo 3.1 — is the whole line inside the take window now (F4)? Is the box's sound wording right and without price?
3. Script writing: draft from a brief, then 3 asks including a length ask ("make it 10 seconds") — does it offer to set the target? Screenplay diff, seconds before→after, Booth part text after edits.
4. End to end clock again: brief in → rendered ad + one cutdown → Download the ad. Wall time, machine time, provider + Claude cost.
5. Edit room: captions stay in their clip, no stacking; Mute/Unmute wording.
Also note the small flaw seen in a fix screenshot: the script edit card header shows "SCRIPT AGENT · · THE TEXT CHANGED…" (double dot) — confirm or clear.
