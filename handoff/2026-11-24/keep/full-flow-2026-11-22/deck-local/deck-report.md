# Deck leg, local: Hollow Oak "Still" (2026-11-22)

Stack: napkin-web 18090, relay 18788, deck engine 18793 (LIVE, cap 3.00), middleware 18795, model-local 18797. All stopped at the end.
Claude reached through model-local (`claude -p`), so spend is the engine's computed USD: 0.8069 for one full build. Later rebuilds were cache hits (0 model cost).

## Steps
1. Stack up: OK after two fixes on my side (not repo code). (a) production-tool/web/dist was built with base `/`, so `/production/` 404ed its assets; I built a copy with VITE_BASE=/production/ into stack/pt-dist. (b) The `uv --with` list in the template up.sh has no `anthropic`; the live engine needs it. Downloading it timed out, so I put server/.venv site-packages on PYTHONPATH.
2. Import of the UAT export zip ("Open..."): OK, opened with script, storyboard, film card, brief card.
3. Continue in > New deck from this project: OK. The deck card says Brief brought in (11 of 11), Research brought in, Production "10 finals brought in, 2 rights to supply" (expected 9 finals, 1 unstated: the import changed the count).
4. Build: prompt + Agency pitch + Presented on a screen + 16:9. Brief reached the engine via the Production upstream (not pasted).
5. Gate 1 storyline: shown (5 beats, each tagged From brief or Our proposal). "Edit beats" and "Ask the Deck agent to try again" only record a request ("need the engine server"); they change nothing. Approve worked, but see S1-a.
6. Gate 2 territories: 3 territories, blind judge's first pick marked. I picked the 3rd (Orchard, Not the Apple). Edit a territory = recorded only. Approve worked after a page reload (S2-c).
7. Gate 3 idea: "Still. On purpose." plus 4 execution groups (key visual, size crops, packshot, storyboard frames). Approved.
8. Copy, Check, Deck: engine built it (21 pitch slides + 10 appendix), but the document never received it (S1-b).
9. Review/pictures/changes: after I landed the payload by hand: slide list, evidence, checks, confirm list, picture picker with candidates and "Rights to supply" label on the unstated upload (works), swap recorded, Shorter / Say it another way recorded only, Move to appendix refused ("needs the engine server"), Approve the deck works.
10. Size: A4 rebuild works (PDF is A4, 21 pages). Type picker and "Change" present; Look: no control found on Start/Review/Present.
11. Export: Present > Download PPTX/PDF only toast "Open from the document export" (S2-f); doc menu Export gives a browser PDF. The real files are the engine's out/deck.pptx and deck.pdf, copied here.

## Bugs
S1-a. Live build cannot pass gate 1, 2 or 3 on a fresh deck. After approve the engine run is refused: "changing to agency_pitch needs new writing: stages c, d have not run ... (--confirm-stages)". run_deck treats continuing past a gate as a type change (stages a0/a/b recorded, c/d not yet). Suspect: engine/deck/run_deck.py `_type_change` (raises when `a.live and not a.confirm_stages`) together with server.py `check_type_change` (only sets `--confirm-stages` when the marker type differs). Replay never hits it. Workaround used: set `<engine>/.types/<doc>.json` to another type and set inputs.deck_type.confirmed_stages [c,d] through window.clan.patchData, then Build deck.
S1-b. A finished, paid deck never lands in the document ("No deck yet" on Review, run stuck at "check"). The host rejects the engine payload: (1) the requirement-trace slide (s30) and the sources slide (s31) have tables of 15 and 14 rows but schema.json caps `table.rows` at 8 (maxItems 8, 5 columns); (2) qa issue check `q_no_hole` is not in the schema's rule enum. Suspect: engine/deck/assemble.py `_trace_slide` and `_sources_slide` (no chunking), engine/deck/qa_render.py (q_no_hole), vs app/templates/deck-maker/schema.json. Seen as `change.applied=false` in job_status. Workaround: cut rows to 8, rename q_no_hole, patchData by hand.
S1-c. Pictures are not in the deck after importing the Export zip into a different relay. serverAssets.ts `reachable()` treats any https location as "relay can reach it", so import uploaded only 3 of 23 images; the generated finals are 404 on the new relay and the deck says "1 picked, 1 not reachable". Suspect: production-tool/web/src/projects/serverAssets.ts (sendAssets) and the import path in openFile.ts. Workaround: POST /uploads then PUT each png (note: a file pre-placed in relay in/ skips the hold, so POST must come first).
S1-d. Only 2 pictures end up in the deck (cover and idea slide, the same key visual). Size crops, packshot, storyboard frames and territory slides show grey "Role: ..." boxes, although 10 finals exist. The picker offers only key-visual candidates (the crops are labelled "Key visual"). Suspect: engine/deck/prod_picker.py role mapping; the stage-d execution slots are not bound to crop/packshot/storyboard finals.
S2-a. Review preview draws no pictures (slide 1 and 12 show text only) and the picker shows "PICK"/"ALT" letters instead of thumbnails, while the PDF has the pictures. Suspect: app/templates/deck-maker/index.html slide and picker render.
S2-b. Review says "Built from: the brief ... No research brought in" and the evidence pane says "This brief field is empty: nothing given states it", though Start showed brief and research brought in and the storyline cites brief fields. Intake says "Built from: prompt" and 4 brief fields empty (objectives, competitor context, reasons to believe, budget scope) although the brief has them. Suspect: engine/deck/intake and the production_upstream to brief mapping (engine/deck/server.py), index.html chips.
S2-c. After "Edit ..." or "Ask to try again" at a gate, the next Approve/Pick click silently does nothing until the page is reloaded (once a pageerror "Cannot read properties of undefined (reading 'map')"). Suspect: gate_requests handling in app/templates/deck-maker/index.html (click handler around line 3018).
S2-d. Engine stage e (copy) timed out once at 120 s ("NoClaudeAvailable ... no usable reply"). model-local default timeout; MOCK_TIMEOUT_MODEL (mock-backend/common.py) is 180 s. The retry paid the stage again.
S2-e. Deck is 21 pitch slides for an "about 10, at most 12" agency pitch; an empty bullet on slides 4 and 12.
S2-f. Present Download buttons do nothing but toast; Animated deck "Get project" not tried (film, out of scope).
S3. Gate edit/retry, ask-a-change, move-to-appendix are placeholders everywhere ("when the engine is connected" while it is).
S3. "Try again now" after a failed first run says "engine server, which is not connected"; Start > Build deck is the only way to retry.

## Judgement
Would a client accept it: no. Strategy slides are on brief and well argued (storyline, territories, idea line "Still. On purpose." are good), but the deck is 21 slides, text-heavy, has empty bullets, "To confirm" scattered in titles, and only two slides carry a picture; the executions slides (the point of a visuals deck) are grey boxes. The pipeline needed a hand-landing step, a relay re-seed and three workarounds to get here.

## Files
hollow-oak-still-deck.pptx, hollow-oak-still-deck.pdf (16:9, 21 pages), hollow-oak-still-deck-A4-extra.pdf, slides-final/slide-NN.png, deck-sheet.png, shots/, paid.log.
