# Round 5 tasks — lean round

UAT will run fix/pt-uat-loop with round-4 fixes merged: canvas + Dex (features/pt-canvas-r4.clan) and film (features/pt-film-r4.clan). Read build_log, decisions, open_questions, and the "paid checks" / "live checks still needed" notes of the record(s) for your area.

Rules:
- No prices/costs in the UI — EXCEPT the Decisions panel / History, where the owner's rule (2026-10-13) puts costs. $ in Decisions is correct, not a bug. Words like "free"/"paid" anywhere else are bugs.
- Report provider and Claude (cost.agentUsd) spend separately. Do NOT start sub-agents. Stop your browser/driver when done.
- The loop is at ≈ $44 of a $50 soft cap. Paid work ONLY for checks that cannot be proven without money (listed below). Everything else: free paths (canvas, script, cut, render, cutdowns, reading job records).

## Part A (both, for your area): retest every round-4 bug id and partly/not-fixed item. Free where possible; for paid ones use only the checks below.

## T1 — images (mock@napkin, paid budget $2.50)
Paid, only these:
1. Extend the round-4 sunset (or a similar wide sky picture): 21:9 (1 step) and 4:5 (multi-step). Look at the scratch canvas-N files (flat bands, no sun/legs/shoreline copies), each result (no repeated shapes, no seam, no smear at band edges), "step N of M" on the card, cost = steps × call price. Then pick 9:16 from 16:9 — it must offer Redraw and never reach Ideogram (free to check: don't send).
2. Thin fill: a ~2 % sky stroke — widened before sending; if unchanged, Try again sends a different mask/words (two distinct requests in the trace).
3. One 4-frame storyboard from a 4-beat note with a kept person: no collage frame, each frame its own beat and framing.
Free: Brand board → note link saves; a brief storyboard asks about brand and casts no characters from other tests; pen strokes undo before a paid Apply; Brief Maker menu after a character card; group label at low zoom; director.usage on job records.

## T2 — film (hello@napkin, paid budget $3)
Paid, only these:
1. Storyboard frames from the Quietboil brief: shot 4 ("a flatmate") has no Maya ref and says someone else; no job sends one picture twice (anchor/previous); frames carry their beat (no "1 a.m." text).
2. Box 3 (spoken line) on WAN 3: the request sends WAN 3 (not Veo), the box says the line won't be voiced. Use the cheapest model/length.
Free: cut plan + 6 s 9:16 cutdown (Dex planned or honest fallback; file length 6 s; ≥3.5 s picture); end line super when no clip voices it; script asks after Plan shots (lines present, tie → which shot, length ask keeps lines, real seconds); Camera ask "whole take" no "apart?" offer; Booth/library behaviour; cost words gone from sizes sheet. Small UX seen in a fix screenshot: after sending an ask that ties, the ask box clears so you can't see what you asked while choosing the shot — confirm.
