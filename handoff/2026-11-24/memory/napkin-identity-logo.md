---
name: napkin-identity-logo
description: Napkin Studio identity/logo work started 2026-11-06; owner decisions so far and where the boards live
metadata:
  node_type: memory
  type: project
  originSessionId: 765e4f5e-8e83-4f4f-baa8-212e2fef7a34
  modified: 2026-11-06T15:13:37.051Z
---

Identity work, logo first; agency adaptability (colours/fonts) comes later. Boards are mocks in `~/Documents/napkin-design-mocks/identity-v1/` (index.html + RESEARCH.md), served by `python3 -m http.server 8642` from the mocks folder. Not repo code, no feature record yet.

Inputs the owner named: sphere + ring agents ([[sphere-ring-design-v1]]), the brief look = **brief-grid-v3** (B/W grid, shipped PR #140), the Deck look = **deck-simple-start-v1** ("almost" right, more changes to come).

Owner decisions 2026-11-06:
- "Napkin" has **no literal meaning**, so no napkin/fold imagery.
- House accent is still open: show **orange #FF4F2E and blue #515BFF** side by side and decide by eye.
- The mark **re-tints to the agency accent** when the OS is themed.
- The quartered four-colour disc (StudioMark.tsx, design/assets/pfp) gets **replaced**.
- **The logo must signify a portal, just like the agents.** This is the core idea: "Circles choose. Rectangles create. The O is the portal." (V0.4 docs in ~/Downloads/Napkin Design System-*/), with motion closed → opening → open. The pipeline passes through the portal. The two-concentric-rings specimen (v03) is only a starting point.
- **All existing designs are references, not locks** (sphere agents, brief, deck, V0.4 rules). Design the logo and the agents as one system. Change the references when that integrates better. The owner's example: a constant colour outside the agent sphere. Show such changes as labelled before/after proposals.
- Round 2 (2026-11-06, identity-v2): the critics led with a flat door cut in a disc (Lintel/Doorway) and leaned blue. Claude's read: it reads as a door or mouse hole, not a portal like the agents.
- **Round 3 (asked 2026-11-06): a 3D, expressive (not flat), living mark** that changes with sleeping, awake and agent work (handoff, done, needs-you, error). The static frames are derived from the 3D object. Board in identity-v3.
- **Round 3 first pass rejected (2026-11-06).** It was a ceramic wheel whose hole grew and shrank, with agents mashed into the hole. The owner found it sexually suggestive and bad in general, and said ceramic doesn't suit the portal vibe. He wants an expressive 3D ORB: the portal is depth, light or a space beyond seen in or through the orb, never a literal dilating hole. Liveliness when working or idle stays subtle. Run a "could this read as bodily?" check on every shape and motion.
- **Circles are the one language (2026-11-06):** the path, the pipeline and the portal are all circles. Work moves along or around circular arcs, never into openings and never along straight pipes.
- **Single entity, from A and B (2026-11-06).** The owner rejected the solar-system / orbiting-agents pass as not subtle and disjointed. The mark is ONE joined object. Closest to what he wants: round-1 "Travelling Arc" (a disc inside an open arc ring) and round-2 "Deep O" (a thick ring with an offset opening, giving depth). Both were too flat and lacked life, so add dimension, personality and subtle liveliness. Reference screenshots are in identity-v3/refs/.
- Round 3 result (2026-11-06, identity-v3): the critics lead with **Deep O**: one satin orb with a window onto a far horizon, and its state rules in concepts/deep-o-grammar.js. Living Arc is runner-up only if reworked, because it read as a comet orbiting and as sperm-and-egg. Held Light (A+B) was dropped as an eyeball. The critics lean blue. Awaiting the owner's reaction.
- **Owner on round 3 (2026-11-06): commit to Deep O ("the big O"). Blue is the house accent. The 16px cut is good.**
  - Satin is the right direction but still slightly too glossy; he likes the flatter feel.
  - Awake is too subtle. The horizon line is too shiny and harsh: give it colour, and in awake let it move slowly like waves. Soften the line and the lighting.
  - Needs-you is right; it needs tiny tweaks.
  - Agency colour should be subtler, e.g. only the horizon tinted, not the whole body.
  - Agents: merge back the sphere-ring v1 agents (the team liked them). Each keeps its own identity, with only a subtle hint that it belongs to the system.
  - The trademark check waits until the whole concept is ready.
- **Round 5 (asked 2026-11-07, identity-v5/):** remove the ring's internal reflection (the arc now sits only on the outer lip); the orb looks at the pointer, very slightly; the portal rests further up-right (face .24/.22) so the turn toward you reads. Brand playground: BASE colour = body, sky and sea; ACCENT = line, arc and inner light, muted or vivid. Shader in identity-v5/lib/mark-r5.js, built on the v4 libs.
- **Antigravity session (2026-11-08, Gemini): app look work.** The live source is ~/Documents/Code/Napkin, served on :8090. The napkin-design-mocks copies of topbar/studio/brief are stale. Owner decisions:
  - The name is "Napkin Studio" and is never dropped. No "OS" in the wordmark.
  - In an agency, the mark takes the agency's BASE and ACCENT colours.
  - Idle means the logo sleeps; it wakes on first interaction.
  - Agents morph from one to the next during a handoff, and the agents have no horizon (belonging level 4 in identity-v4/agents/lib/agent-view.js).
  - The mocks must show the app itself, including the OS level, not spec pages.
  - Top bar LOCKED: H1 (satin 3D medallion with a cast tunnel shadow, merged from C1 and C4) plus Option 3: the medallion is tucked into an ACCENT-coloured name pill, with the agency name as the main text and "● NAPKIN STUDIO" as mono subtext. On Napkin's own workspace, a single centred "Napkin Studio". The bar itself uses system colour, and selected buttons use the accent. The gaze follows the pointer only while hovered; needs-you is centred.
  - Refs for the app look: the Outdoor Maker editorial page, Splat circular gauges, and the Art Director bottom command dock.
  - Next phase: Antigravity's build_app.py produced studio-tools-v1.html at 18:12, unreviewed by the owner. build_app.py reads and overwrites brief-tool-v1.html, so re-running it is not safe.
- **App mock, napkin-app-v1.html (2026-11-08, Claude).** Built by app-build/build_app_v1.py plus app-build/phase2.py from studio-tools-v1.frozen-1812.html. Owner decisions:
  - Calm UIs with few buttons. No bottom dock, no top tabs, no "Ask Napkin" bar.
  - The desk shows clients as circles. Clicking one opens a dial IN PLACE: nothing else moves, and the dial's ring lists tools only (no document names).
  - The top bar shows only the client chip, which goes back to the client page.
  - The client page holds all of that client's docs: needs you, work grouped by campaign, Brand Clan, and the record.
  - Brief and Research open on a picker: choose an existing one or make a new one.
  - The brief page is just the brief, plus a small side tab. Hovering a part only tints it, never moves it. Clicking a part shows its why and its options.
  - Tool identities: Brief = a dog-eared sheet, a manila tab, serif type and a red "Write the brief". Research = an ink band, sans type, lens dots and the tree icon.
- **Brief look (owner, 2026-11-08, after research):**
  - Paper is the first and only look; there is no Coloured template.
  - Few red lines: ink hairlines throughout, with the accent only on section labels and the proposition underline.
  - Logos are boxes: the brand logo, the agency logo, both, several, or none. No Napkin branding on briefs.
  - "Apply <client> brand?" is a suggestion, never applied automatically.
  - Parts that need you must look like it.
  - Every part shows a reason in the side bar.
  - Audience and the doc line were tried and removed.
  - The app has dark mode; the brief stays light paper on the dark desk.
- **Research UI (owner picked the hybrid, 2026-11-08):** two variants were built and judged (A: a long drawer; B: a three-pane workspace). The owner chose a hybrid, built as app-build/phase20.py, which applies variant_b.py and variant_b.js:
  - The report sits in the centre with an evidence inspector on the right. The inspector has a breadcrumb and back.
  - The answer is selectable sentence by sentence, and an inference is flagged "no source says this".
  - The provenance graph appears only on request.
  - There is NO left panel.
  - Source is OS-level and part of the app: an inspector level in Research, and a stacked index card in Brief's side bar. Never a floating overlay.
  - The OS bar has an app slot, where the app publishes the document name, its state and its actions.
- **Research report shape (owner, 2026-11-09):**
  - The report follows the real campaign-research §17: headline, summary lines that cite, sections per lens × market (claim / pins / finding / contest / gap blocks), Confirm, and Not researched. There is no single "answer" and no "answer formed" card.
  - The provenance graph is an Evidence map view, opened from the OS bar app slot, never inside the report.
  - Each action has one home: Continue in and Lock in the OS bar; Ask in the side bar box.
- Round 1 critics: take forward Pour + Lead-in Loop merged (circle + pipeline). Drop Travelling Arc (looks like a frozen status ring), Arch n and Dial.

Flagged, not yet acted on: Napkin AI (napkin.ai) and USPTO NAPKIN 98562830 are a name/trademark risk a person should check.

**How to apply:** show choices on the board, not in the abstract. Never put the mark inside or as a live agent ring.
