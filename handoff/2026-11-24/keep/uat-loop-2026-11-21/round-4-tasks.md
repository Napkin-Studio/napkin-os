# Round 4 tasks

UAT now runs fix/pt-uat-loop df0ca1a7: round-3 fixes merged — canvas + Dex (features/pt-canvas-r3.clan, director.v17: palette as accents, schema cut per op, Dex effort low on generate/frame/view/region_edit, stepped Extend) and film (features/pt-film-r3.clan, skye.v7). Read build_log, decisions, open_questions of the record(s) for your area first. Fix screenshots: round-3/fixes-canvas/ and round-3/fixes-film/.

Rules unchanged: no prices/costs anywhere in the UI (any price = bug). Report provider spend and Claude spend (cost.agentUsd) separately. Do NOT start sub-agents of your own. Stop your browser/driver when done.

Loop spend so far ≈ $28.7 provider + ≈ $7 Claude against a $50 soft cap — spend only where the test needs money.

## Part A (both agents, for your area): RETEST every round-3 bug live
Your round-3 report is round-3/<slug>/report.md. For each bug id and each "partly"/"not fixed": fixed / partly / not fixed / regressed, with evidence. Then look for regressions around each fix.

## T1 — images (slug images, mock@napkin, paid budget $4)
1. Extend (stepped, 4th try at IMG-9): one 21:9 from a sky picture (1 step) and one 9:16 or 32:9 (3 steps). Look for a seam at each step's overlap and mirrored shapes from the seed. Check reserved/confirmed cost = steps × the call price on the job, and the per-step scratch files if visible in the trace.
2. Dex at effort low: words-only generate input tokens (~9k expected, was 15.1k), output tokens (< 1k expected), latency; a 4-frame storyboard with a kept person — does quality hold vs round 3's 5/5/5/5?
3. Brand: palette + rule + typography; a brand generate should carry "Accents:" and never "only these colours"; a plain photo generate and a sky Fill should carry no palette. Generate tray ticks + Accents/Strict toggle work? Score adherence and naturalness.
4. "New storyboard from this text" from a second note — the first script stays untouched.
5. Fill that comes back unchanged: the message, Try again, Discard.
6. A quick pass of the owner's base paths: no-ref, max refs, sketch ± note, straight from a brief.

## T2 — film (slug film, hello@napkin, paid budget $5)
1. Storyboard from the Quietboil brief: shots naming no one get no character ref (provider_submit), the kettle stays the same kettle; frames carry only their own beat (+ shot 1's).
2. Assemble at planned lengths; a first take landing into an existing cut (its slot, Undo note); Out clamp.
3. Script asks after Plan shots: "make the snoring line funnier" goes to that shot; "make it 10 seconds" keeps spoken lines word for word.
4. "Tell the Camera agent": an ask remake (input.text) — shot words untouched; does the new take follow the ask?
5. A WAN 3 take with @maya_full required — is the narrow picture padded and accepted (F5 live)?
6. Short cutdown 6 s: ≥3.5 s picture, studio card shortened, no repeated line, in Download all media.
7. End-to-end clock again (brief → ad downloaded → one cutdown), provider + Claude cost.
