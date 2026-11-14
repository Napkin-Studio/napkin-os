# Brief 2: owner edits of 2026-10-13 (read with BRIEF.md)

## A. Agents look like the house agents (same design language, our own crew)
The figures drawn so far were simplified shapes and look nothing like the agents in the other Napkin tools. Replace EVERY agent figure, avatar and mark on the artboards with the REAL house figures, rendered from the tool's own component (production-tool/web/src/ui/agents/AgentFigure.tsx): flat bold body, thin ink legs with feet, a ground shadow, two pill eyes, one mark; states idle / working (leans in, motion lines) / needs-you (speech bubble with "!").
- The exact SVG markup for every crew member in every state is in `crew-figures.json` in this folder: `figs.<key>.<state>` with keys dex, skye, wren, rhea, edie, ellis, jude and states idle, working, needs-you. Paste that markup verbatim (you may change only the `width`/`height` attributes to resize; keep the viewBox). Do not redraw figures by hand.
- The figure CSS is `css` in the same JSON. Copy it into the artboard's `<helmet><style>` once (it is allowed there), plus these variable definitions on the root or in that style: `--ink:#14161B; --plan:#14161B; --plan-eye:#FFFFFF; --soft:#F2F3F6`.
- Sizes: 20-24px tall inline next to a signature ("Wren · renders"), 28-36px in job cards and ask cards, 64-96px on the crew sheet. Signed speech lines follow the house pattern: a small speech bubble, signature in mono ("Skye · scripts"), first person, short.
- Crew: Dex · directs (cobalt hex, viewfinder), Skye · scripts (coral column, page), Wren · renders (marigold star, spark), Rhea · retouches (mint dome, dots), Edie · edits (iris stack, bars), Ellis · reads (house, ink triangle, page), Jude · checks (house, ink card, tick).

## B. The loader is the Napkin logo itself
The Napkin mark: a disc of four quadrants turned -45 degrees: plan #14161B (ink), create #FF4F2E, learn #DADDE3, produce #8B919E (production-tool/web/src/ui/Mark.tsx). Owner's motion, one loop:
1. The full logo shows for about 1 s.
2. It collapses (the four quadrants draw in to the centre and vanish).
3. It forms again quadrant by quadrant; the LEADING quadrant (the one being drawn, at the front of the motion) is in the colour of the work that is happening; the others take their brand colours.
4. It spins (one turn) with the leading quadrant still in the work colour.
5. It collapses again; repeat from 1.
Work colours: reading/checking ink #14161B (Ellis, Jude), planning cobalt #2F64F5 (Dex), writing/researching coral #FF6A55 (Skye), rendering marigold #FFC023 (Wren), retouching mint #6CD3A2 (Rhea), cutting iris #7D52F4 (Edie). When a job finishes it settles into the full brand logo for 0.6 s. Reduced motion: the static full logo with only the leading quadrant tinted, and a slow opacity pulse. The SAME loader rides on the mouse pointer (14px badge at the arrow's lower right) while the viewer's own job runs. Build it as CSS @keyframes in the helmet style (transform scale/rotate on the quadrant paths; use transform-box: fill-box and transform-origin at the disc centre).

## C. No chatbot in the Script editor
Remove the Skye chat panel and any chat box. Agents work the way they do in the other Napkin tools (Brief Maker's per-field drafts, "why" from the decision chain, floating options, asks):
- Skye drafts IN PLACE: a draft or rewrite appears inline on the scene/shot it touches as a suggestion (struck old words, new words underlined in coral), with a small signed bubble "Skye · scripts: tightened to fit 3 s" and buttons Keep / Keep mine / Why (Why opens that decision in the decision tree).
- Floating options on a text selection: Tighten, Make it 10 s, Add a beat, Write the VO, Say it another way (each runs Skye on just that text, shows the cost if any).
- Per-scene/per-shot status marks (who last wrote it: "you" or a crew figure), like Brief Maker's per-field marks.
- Ambiguity becomes an ask card anchored to the text (shared asks), never a chat.
- The length meter stays ("15 s target · 14.2 s estimated").

## D. The decision tree (this is a CLAN project)
Every project is a .clan document whose decision chain records every decision: who (a person, or an agent, with the agent named), what changed (fields, items), why (rationale), when, and verdicts (Jude's checks), asks and their answers, picks between versions. The tool needs a DECISION TREE view: a tree, not just a list, because versions branch (frame 3 v1 -> v2 -> v3 patched; "Keep both"; a re-plan from a changed script). It opens as a right-side panel over the canvas or editor ("History" in the top bar), and per item ("Why does this look like this?" on any node, frame, take, line). Look at production-tool/web/src/ui/History.tsx, historyItems.ts and HistoryList.tsx (today's flat History panel) and app/templates/brief-maker/index.html (search "decision chain" and "why") for the house pattern of showing decisions with the crew figures and "you".
