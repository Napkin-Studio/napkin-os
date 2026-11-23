# Territories UX audit (2026-11-24)

Run live on my own stack (feat/territories at d3064114, ports 9099/9095/20598, one real model pass: find insights 36 s, explore + develop + judge 173 s; no Runway, no pictures). Dark theme, 1280x800 unless said. Screenshots are in `shots/` (names in brackets). The coordinator's later note (fix/territories-pages, b8375bc7, the page now moves to Explore while the crew runs) is covered under "Explore while it works"; the screenshot for it is `shots/ref-explore-working-pages-fix.png`.

## PART 1. The house patterns, as rules

Read from Brief Maker (`app/templates/brief-maker/index.html`: `.pwrap/.ptop/.sstage/.rail/.score/.aglbox/.scap/.runbar` ~L1334-1430, markup ~L1528-1560, rails `rails()` ~L3228, `tellSphere()` ~L3197), Research (`app/templates/campaign-research`, same stage), Production (`production-tool/web`, shots below), the sphere/ring record (memory `sphere-ring-design-v1`: one morphing sphere, travelling-arc ring, honest steps, no percent the backend does not measure) and `features/*.clan`. References: `shots/ref-brief-agent-stage.png`, `ref-research-agent-stage.png`, `ref-brief-ready-to-lock.png`, `ref-brief-booth-lock.png`, `ref-production-script-booth.png`, `ref-production-storyboard-toolbar.png`.

1. **Stage versus Booth.** While agents work, the page IS the stage: one paper panel, a pill strip on top (`1. Knowledge (read) -> 2. Strategy (think) -> 3. Brief (write) -> 4. Review (check)`), a desk with a left and a right rail of slips, the active agent's sphere in the middle, and a run bar (Back, Stop) underneath. Nothing else is on screen (Brief: `.app.p-start:has(> .proc.on) > .foot{display:none}`). When the work is done the stage is replaced by the document, and the agents shrink into the Booth (right column: agent line, notes, tools). The Booth never carries the primary action while agents work, and never repeats the sheet.
2. **Agent size by state.** Working or asking: one big sphere (about 100 to 150 px in Brief, larger in Research), ring turning, caption under it: `AGENT NAME` (mono, accent), a 20 px headline ("Strategy agent asks"), one grey line ("Step 2 of 4 - I'm reading what you sent"). Done: 36 px sphere beside one line in the Booth, 22 px spheres for the rest.
3. **One primary action per step**, in the accent fill, visible without scrolling: Brief's `Lock the brief` is the first control in the Booth (`ref-brief-ready-to-lock.png`), Production's is the blue button on the toolbar (`Plan shots`, `Draw the rest`; `ref-production-storyboard-toolbar.png`). Everything else is outline.
4. **Honest control states.** Disabled keeps its place and says why beside it ("Lock the brief" greyed, "Settle 8 first" under it); enabled becomes the primary style the moment input is valid; busy shows a spinner and words; done and failed are said in words (memory `control-states-basics`).
5. **Progressive disclosure.** Secondary tools sit in `details` ("See each part as it is written"), in the Booth, or appear when relevant (Brief hides Lock until the review notes are settled). Controls that cannot act are not shown, or are shown disabled with the reason; never both a live and a dead copy of the same action.
6. **Step header.** App title top left with a mono kicker (`HARBOUR BAKES - NEW BRIEF`), a three-step ring top right (Ask / Agents / Brief), and one working chip in the OS bar (`WORKING - STEP 2/4`). One step count in the page.
7. **States.** Empty: a sentence plus the single way out. Working: the stage. Done: the document and the Booth. Failed: the stage stays, the orb stops, the line says what happened and "Nothing was lost", and Try again is the primary.
8. **Typography.** Territories' own rule (feature record): Newsreader for what is read, Geist ExtraBold (800) for what is pressed or labelled, labels small caps tracked. Brief uses Geist 600 and mono labels; both use 10.5 px tracked labels and 13 px buttons.
9. **Spacing.** 16 px stage padding, 8 px slip gaps, 12 px panel gaps, 20 px page gutter, content width about 1130 to 1240.
10. **Colour.** Agency accent (`--ag-act`; in dark it is the pale accent with dark text) for exactly one thing per screen: the primary. Teal (`--te`) is Territories' identity (rule under the header, the ring). Green only for done and ok, amber for derived or needs-you, red for failure. Documents stay on paper; a route's own palette is allowed inside its World only.

## PART 2. The audit, step by step

Legend of problem types: A no clear next action, B agents hidden while they work, C controls shown when not needed, D dense or unclear text, E inconsistent with Brief/Research/Production, F broken state, G dark-theme.

### Header and OS bar (every step)
- E: the hero title is 50 px (`.hero-title`) and takes 185 px of an 800 px screen; Brief's is about 30 px. The step ring ("PICK / EXPLORE / GREENLIGHT") is fine, but the sub-line "Step 1 of 3. This is what arrived. Find the insights, then tick…" repeats the sheet heading below it. (`01-arrived-1280.png`)
- E (c): two step counts. The OS bar says `WORKING - STEP 1/5` (the job's stages) while the page says "Step 2 of 3" (`ref-explore-working-pages-fix.png`, `02-find-working-03.png`: "STEP 5/5" while the page still shows Pick). The chip must not carry a count the page contradicts.
- D: the sub-line stays stale in World ("Step 3 of 3. Every route comes back developed. Greenlight as many…") while the sheet is a single route's world. (`10-world-1280.png`)

### What arrived
- A: the only action, `Find the insights`, sits mid-page under a sentence, below the heading, as a pale pill, and is visually weaker than the Booth's input. (`01-arrived-1280.png`)
- B: pressing it changes nothing on the stage: the button greys, the same sheet stays, a one-line note says the crew is reading. The Knowledge agent is a 40 px icon in the Booth. 36 s with no stage. (`02-find-working-01.png`, `-03.png`)
- D: Booth note reads "Read no brief and the research (18 pins, 5 findings)" for a research-only document (copy bug: "no brief and the research"). "Made from research. Read in full, in the words the brief and the research use" names a brief that is not there.
- C: the look-up box is shown (empty, disabled) before anything is read. "Look-ups open once the crew has read what arrived" text is clipped at the bottom of the Booth. (`01-arrived-1280.png`)
- F: no empty state worth the name: "Nothing came in" is a text page with "arrive in the next release" copy.
- G: the primary is the pale accent in dark and reads as a disabled pill next to the beige source card.

### Pick
- A (the worst one): `Explore 5 insights ->` is at the very bottom of 14 tall cards, 1760 px down; at 1280x800 it is not visible and not reachable without scrolling past the add-your-own box. (`03-pick-explore-button-1280.png`, `03-pick-full-1280.png`)
- C: three big source cards, the add-own box (a 2 px outline, heavier than any other control), an "Everything the crew may quote" fold and the Booth look-up box all compete with the one decision.
- D: cards are 300 px wide in two columns with 17 px serif text and evidence chips; 14 insights take 1500 px.
- E: Brief puts its primary at the top of its Booth.
- After pressing Explore: the button turns into `Approved ✓` and a note says "The crew is setting off." The page stays on Pick, with the cards still tickable-looking (`04-explore-working-01.png` to `-11.png`, 3 minutes with no change; top bar `WORKING - STEP 5/5`). (The pages fix moves the page to Explore, but see next section.)

### Explore while it works (coordinator's list, checked on the old build and on `ref-explore-working-pages-fix.png`)
- (a) B: while the crew works the agents are two tiny icons in the Booth and the main stage is an empty dashed box saying "The crew is out: 5 agents exploring". The five agents, which are the product here, are invisible.
- (b) F: the stats line says "0 agents - not set off yet - 0 routes found" next to "5 agents exploring". They contradict each other: the stats read the document (empty until the end), the line reads the job.
- (c) E: "WORKING - STEP 1/5" in the OS bar against "Step 2 of 3" on the page.
- (d) D: the disabled `Exploring…` pill repeats the line beside it, and the Booth line says the same a third time ("The crew is out: 5 agents exploring").
- (e) engine: the document gets `crew`, `expeditions`, `territories` only at the end of the run (`engine/territory/runner.py`, `server/napkin/territories/job.py`), so the page cannot draw a per-agent trail mid-run. Measured: one 173 s job, `explore` 69 s and `develop` 103 s, 15 model calls, nothing written until the end. The job status already carries `progress {done,total}` and `stage` (`job.py` L306) and `runner.py` already notes each segment as started/finished (`note_segment`), so the facts exist; they are not shown.
- Missing: any "how long" honesty. Time is not shown.

### Explore (back)
- A: no next action. A finished crew leaves the person on a page whose only controls are steer buttons that open a panel; the way to Greenlight is the ring. In the live run the page jumped straight to Greenlight after the run (the gate), so the person never sees the crew come back. (`05-explore-view-1280.png`, `06-greenlight-landing-1280.png`)
- C/D: crew cards in the sheet repeat as a list in the Booth ("THE CREW - 5", 5 cards) with identical content; the compass, the crew, a second route list and "Steer" instructions all show at once; 2,000 px tall. The route cards are repeated again in Greenlight. (`05-explore-full-1280.png`)
- B: agents appear only as 40 px icons in cards.
- D: "Click a trail or a card to steer that agent, if you want to. Click a dot to open its route." is a manual in a status line.

### Greenlight
- A: `Send 1 ->` is the last item in the Booth, 700 px below the fold at 1280x800, and is a beige "dark" button (not the primary style). (`07-greenlit-one-1280.png`, `08-send-button-1280.png`)
- F: the floating dock (Present / Compare / Re-rank / Export) overlaps the cards at 1280x800 and covers the name of the second route; Export is disabled with no reason. (`06-greenlight-landing-1280.png`)
- E: the route gallery is two columns inside a 780 px sheet, so a group of three routes shows 2 + 1 with a hole; each card is 600 px tall with a poster, line, three check lines, evidence chips, and the greenlight toggle at the bottom, so it is below the fold on the first card. (`06-greenlight-full-1280.png`)
- D: three "not checked" lines per card ("PROPOSITION - NOT CHECKED", "MANDATORY - NOT CHECKED") repeat on every route because the research-only seed has no brief; that is information about the document, not about each route.
- C: Present, Compare, Re-rank, Export all show at once with the same weight, before any route is chosen.

### World
- A: the header has no action except a Greenlight toggle ("take it off the list" when on); to continue the person must find `Send` in the Booth, which is out of sight. (`10-world-1280.png`)
- C: Present and Animatic exist twice (Booth and dock); `Play animatic`, `Read it aloud`, `Wall` and `Make pictures` are four more buttons; the Booth stacks "Route LIVE", Feel/Lines/Why/Test tabs, four dials, look, sound and references. (`10-world-full-1280.png`)
- D: eight near-identical sketches ("TV 1 sketch", "Story sketch", all Mock-up) come first and push the journey (the actual idea) to 950 px.
- F: the header text is stale (Step 3 of 3 / "Greenlight as many…").
- G: the dial sliders are bright blue on dark; the dock floats over the journey.

### Export
- C/E: a modal with six actions and no primary; each row is a button of equal weight; the busy and saved states are said nowhere. (`09-export-1280.png`)

### Send to Production / Deck
- D: "Still a Cider Night go with their worlds…" (grammar, singular route); the dialog offers two options with only Cancel as a button: choosing one sends at once, with no "sending…" or "sent" word, and no way to see where it went. (`08-send-dialog-1280.png`)
- E: the approved Territories node in Production is not mentioned in the dialog.

### Look-ups (Booth)
- F (control states, owner 2026-11-24): `Look it up` is the same beige fill disabled and enabled, only opacity changes: typed text does not make it the primary style. Measured: empty `disabled=true`, rgb(239,233,222); typed `disabled=false`, rgb(239,233,222). (`12-lookup-empty-1280.png`, `12-lookup-typed-1280.png`)
- C: the box is open on every step from the moment the page opens; the Booth is clipped at the viewport so the box's hint is cut. The pages fix adds a spinner and "Looking it up…" and disabled reasons; the colour issue stays.

### Make pictures
- Not testable live (images off). Already approved in `frames-v2`: button in the pictures header, confirm card, held and made states. It stays as is in the redesign (World toolbar), with its confirm card unchanged.

## Cross-cutting findings
1. No screen has a primary in the same place. Pick: bottom of the sheet. Explore: none. Greenlight: end of the Booth. World: the Booth. The owner's "no button to proceed" is literal.
2. The agents are only ever 22 to 40 px. Brief's agent stage is the visual centre of that tool; Territories has none.
3. The Booth repeats the sheet (crew list, greenlit list, notes) and then adds tools, so it is the longest column on the page.
4. Auto-advance is half done: Pick -> Explore moves only by the gate; Explore -> Greenlight happens by the engine's gate with no "the crew is back" moment.
5. Dark theme: periwinkle pill primary on dark paper is readable but is the same weight as the beige secondary buttons; disabled and enabled look alike.

## Engine changes the working-state mock needs (behaviour, with cost)
The mock's Explore stage shows five agent lanes, each with state (Setting off / Exploring / Back with N routes) and a bar. The engine writes that only at the end today.
- **Option A (recommended): put it in the job status, not the document.** `runner.py` already calls `note_segment` per stage and the job (`job.py` `progress()`, L161) already reports `progress {done,total}`. Add `crew: [{id, state, routes}]` to the job status for the explore stage as each crew member finishes (5 model calls run in parallel). Cost: small, about half a day plus tests; no document-schema change; no new writes, so it cannot disturb the "the document is the only state" rule; lost on reload while the job is running unless the job store is read on open (it is). Page work: render the lanes from `job.crew`.
- **Option B: write crew and expeditions into the document as each agent returns.** Cost: about 2 days, a schema and contract change (`docs/contracts/territories.md`), more patch traffic, risk of a half-written exploration being greenlit; benefit: reload-proof and the compass can grow live.
- **Without either:** the mock falls back to honest placeholders (setting off for all, "usually 2 to 3 minutes"), which is what the pill strip and run bar already give. The lanes in the mock then show only "Setting off" until the run ends, and the elapsed time is the only live fact.
