# Production Tool UI: behaviour spec

What every screen in the overhauled Production Tool does. The owner approves this file together with the mockups in `project/*.dc.html`. Feature records (`features/<slug>.clan`) build to it and cite its section numbers.

- **Baseline.** `docs/production-tool/overhaul-plan.md`, approved 2026-10-13. Its "Owner decisions" section wins wherever this spec and the plan differ. This spec adds the interaction detail the plan leaves open.
- **Mockups.** 1 Main · 2 CanvasLinking · 3 CanvasReferences · 4 SketchInk · 4b Scope · 4c Asks · 4d Assets · 4e Formats · 5 TabletCanvas · 6 ScriptScreenplay · 7 ScriptAV · 8 Storyboard · 9 ImageEditor · 10 VideoEditor · 10b SoundEditor · 11 PhoneReview · 12 States · 13 Crew · 13b Voices · 14 Loader · 15 DecisionTree. In this spec, "artboard N" means the board with that number in `canvas.json`.
- **Owner decisions folded in on 2026-10-13:** inputs and scope, the send tray, asks (shared), assets and the team library by client, brand rules, spin-in, scamp sheets, and Make all sizes with video cut-downs. Also decided that day: model names always read "<model> on Runway", the reference roles are one open set (3.6), and a node with a running job is never dimmed during a link drag (3.4).
- **Owner answers of 2026-10-13 (second round):** the contrast tokens (9, 10), the loader's 0.6 s finish (6.4), the spend confirm threshold and where the cap defaults come from (5.4; both since superseded by the fourth round), and format packs from industry standards (3.19). The remaining recommendations were adopted because the owner did not object: the warn underline for unknown names (3.6), ⌥M for a moment (3.10), one note-window rule everywhere (3.13, 3.14), no Sketches board in the Ad template (3.2), editable board name prefixes (3.6), the selection bar hidden during a port drag (3.4), tap outside closes the iPad board sheet (3.2), and per-role lines in contract-v3 (3.6). Section 12 now lists only facts still to check.
- **Owner edits of 2026-10-13 (third round):** the loader is the Napkin logo in its own four colours, and the department of the work picks the leading card (section 6; this replaces the crew-tone loader); the crew are the house figures, named for their work (5.1); no chat anywhere in the tool, agents act in place (principle 10, 3.10); and every project has a decision tree (3.20, artboard 15).
- **Owner decision of 2026-10-13 (fourth round, supersedes every earlier spend rule):** no prices or costs anywhere in the UI; costs are recorded per job and shown only in the decision tree (3.20); the send tray stays, without prices, collapsed by default (3.16); spend caps and per-person quotas are built but off, and each agency will choose its own cap later (5.4); failed or refused attempts that Runway bills are charged and recorded with no wording in the UI (5.3); the relay's global spend stop stays as an invisible backstop; 0BSD is an approved licence. Recorded in features/runway-sheet-sync.clan and features/tenant-limits.clan.
- **Sound, added 2026-10-14 for the owner's review** (owner request: "integrate these changes into the product"). It folds in the model and audio research: `docs/production-tool/model-research-2026-10-13.md`, `pathway-tests-2026-10-13.md`, `hackathon-remakes-2026-10-13.md` and `audio-and-models-plan.md`. It adds a path per shot, sound in layers with takes, character voices, Jude's coherence checks R1–R6, loudness targets and a radio cut (3.21, 3.22, artboards 10b and 13b). It keeps every earlier owner rule: no costs anywhere, no chat, and the crew drawn as the house figures. Sound adds one provider beside Runway: ElevenLabs, named "<model> on ElevenLabs"; Runway stays the floor every sound job falls back to (5.5). The audio crew member in 5.1 is only an open question.
- **When a mockup and this spec disagree,** this spec wins. Section 12.1 lists the redraws made to match it; all are done.
- **Words.** "You" is the person at the screen. "Someone else" is another person in the same project. "Agent" is a crew member (section 5).

---

## 1 Principles

1. **The canvas is the project.** All of an ad lives on one canvas: script, pictures, storyboard, video, sketches, notes. Editors open over the canvas and close back onto it. The canvas stays mounted underneath, so results keep landing while an editor is open. No feature adds a separate page of project content.
2. **Meaning lives in the `.clan`; the canvas holds only where things are.** Boards, shots, references, links, jobs, notes and versions are document entities, and each is written by one server as a validated patch. Excalidraw holds geometry and ids only. If the screen and the document ever disagree, the document is right and the screen redraws.
3. **Nothing is silent.** Every running job is visible, along with who started it. Every fallback, passthrough, splice, condensation, crop and failure is said in words where it happened. A tool never quietly drops an `@name`, truncates text, changes a ratio or switches model.
4. **Costs live in the decision tree, and you see what is sent.** No price, cost or credit count appears anywhere in the UI: not on buttons, menus, model picks, the send tray, toasts, job cards, asks or admin views. Every job records what it cost, and the decision tree (History, 3.20) is the one place that shows it. Every paid generation, on Runway or on ElevenLabs (sound, 3.21), opens the send tray, "What Dex will send" (3.16), which lists each input and the model. Nothing goes to a provider until you press the tray's **Generate**. Batches open the tray expanded (section 5.4). Work that runs on your device says "on your device".
5. **Nothing changes until you choose.** Agent proposals arrive as previews with a diff: Skye's rewrites, Dex's camera changes, Ellis's reading of your ink, fuzzy `@` matches, Rhea's crops of a character sheet, a spin-in from Brief Maker. The canvas or the document changes only on Apply, Keep, Link it, Confirm or Bring in, and one undo reverses that step.
6. **Each tool works on its own; agents ask when the input is thin.** This is an owner decision from 2026-10-13. The flow (references → script → storyboard → video) gives the best results, but any node can run alone. When an input is ambiguous or missing, the agent asks a question with options instead of guessing (section 3.17, artboard 4c). The job waits in `needs_input`. An ask blocks only when no option can proceed; otherwise at least one option proceeds. Asks never time out into a guess. Asks are shared: anyone in the project can answer, and History records who did.
7. **Scope is what you link.** A generating node uses only what is linked to it: boards, groups, single references, notes and documents (3.16). Nothing nearby is used because it is nearby.
8. **Plain words.** Use short sentences from your side of the screen ("Make video", "Insert a shot here"). Name the agent doing the work. Name a model as "<model> on Runway". No jargon, no percentages for certainty. Rationale text stays off the working surfaces; it lives in the decision tree, one **Why** away (3.20). Section 10 has the rules.
9. **One look.** Use the house tokens and vocabulary of artboard 1 (Main), with the contrast tokens of section 9. The primary button (#D63B1F) marks the single main action of a surface. Brand orange #FF4F2E stays for the mark and loader (its create card), the needs-you bubble, ask borders and accents that carry no text. Tool blue marks identity and selection only.
10. **No chat anywhere in the tool** (owner decision 2026-10-13). There is no chat panel, chat box or chatbot on any surface. Agents act in place, the way they do in Brief Maker: drafts and rewrites appear inline as suggestions on the thing they change, options float on a selection, marks say who last wrote each part, ambiguity becomes an ask card (3.17), and **Why** opens the decision in the decision tree (3.20). There is never a conversation: you press a named option, answer an ask, or type into a field that belongs to an item (a shot's direction, a frame's change, an ask's text box).

---

## 2 Surfaces and navigation

### 2.1 Surfaces

| Surface | Route | Devices | Artboards |
|---|---|---|---|
| Canvas | `/production/p/:project` | desktop, iPad | 1, 2, 3, 4, 4b, 4c, 5 |
| Assets drawer and Export menu | over the canvas (`?assets=<tab>`) | desktop, iPad | 4d |
| Format sheets and Format set | on the canvas | desktop, iPad | 4e |
| Script editor | `/production/p/:project/script/:scriptId` | desktop, iPad | 6, 7 |
| Storyboard editor | `/production/p/:project/storyboard/:storyboardId` | desktop, iPad | 8 |
| Image editor | `/production/p/:project/frame/:frameId` | desktop, iPad | 9 |
| Video editor (Picture and Sound views) | `/production/p/:project/video/:videoId` (`?view=sound` for the Sound view) | desktop, iPad | 10, 10b |
| Character card (Views, Voice, Wardrobe, Used in) | over the canvas, from the Assets drawer (`?assets=<tab>&ref=<refId>&card=voice`) | desktop, iPad | 13b |
| Phone review | the same video route, below 600px wide | phone | 11 |
| Decision tree (History panel) | a right-side panel over the canvas or any editor | desktop, iPad | 15 |
| Signed out | `/production` without a session | all | 12 |

- **Query parameters** carry focus, never content:
  - `?shot=<shotId>` scrolls the Script or Storyboard editor to a shot and selects it.
  - `?t=<seconds>` seeks the Video editor or Phone review.
  - `?note=<reviewId>` selects a note.
  - `?board=<boardId>` or `?node=<id>` fits the canvas to that board or node.
  - `?ask=<askId>` fits the canvas to the node that asks and opens its ask card.
  - `?assets=project|library|upload|napkin` opens the Assets drawer on that tab.
  - `?view=picture|sound` opens the Video editor in that view (3.21). `?line=<lineId>` or `?cue=<cueId>` selects a voice line or a sound cue in the Sound view.
  - `?ref=<refId>&card=views|voice|wardrobe|used` opens a character's card on that tab (3.22).
- **Ids in URLs are document ids.** Shot numbers are never used, because they change when shots move.
- **The plan writes routes as `/p/:project/...`.** They live under `/production` because of owner decision D5 (same origin as Napkin OS).

### 2.2 Opening an editor

| Trigger | Result |
|---|---|
| Double-click a Script, Storyboard or Video node (mouse) | Pushes the node's editor route. The editor mounts full screen over the canvas. |
| Select a node, press **Enter** | Same as double-click. |
| Press the node's **Open** button (all devices) | Same. On touch this is the only way in (section 8). |
| Click a frame on a Storyboard card, or in the Storyboard editor | Opens the Image editor for that frame. |
| Double-click a frame image on the canvas | Opens the Image editor for that frame. |
| Double-click a text, a frame title or an image's crop | Excalidraw keeps these. The capture-phase listener stops propagation only on tool nodes (plan 2.5, the `arrowHit` pattern). |

- **The editor opens on the content you were looking at.** A shot selected on the canvas preview opens with `?shot=`.
- **Opening has no loading page.** The editor draws from the live document straight away. Media that is still loading shows the pending stripes in place (section 3.13).

### 2.3 Back

- **Every editor's top bar starts with a back button** naming where it returns to: "← Canvas", or "← Storyboard" in the Image editor when it was opened from the Storyboard editor.
- **Back, browser Back and the system back gesture do the same thing.** They pop one route. The canvas comes back at the viewport you left, with the node you opened selected.
- **On a deep link with no history,** back goes to the surface that owns the item: a frame returns to its Storyboard editor, and everything else returns to the canvas fitted to its node.
- **Leaving never asks "save?"** Edits are live (plan 2.5). Work that is not applied is kept per person across back and forward for the session:
  - an Image editor op list that has not been applied;
  - a Skye suggestion still open;
  - a note window still being dragged.

  The top bar counts it ("3 edits not applied"). Coming back restores it.
- **Esc never leaves an editor.** It closes the innermost popover, menu or preview. Leaving takes the back button, browser Back, or **⌘[ / Ctrl+[** (section 7).

### 2.4 Deep links and sharing

- **Share (canvas top bar)** copies the canvas link. Each editor's More menu has **Copy link to this**, which copies the current route with its focus parameters.
- **A link opens only for people in the project's tenant who can see the project.** Anyone else sees the signed-out or "You don't have access to this project" page. That page shows no title or thumbnail.
- **A link to something deleted** opens the canvas with a toast: "That shot was deleted. Undo is with the person who deleted it." No blank editor is shown.

### 2.5 Devices

- **Desktop** (Chrome, Safari, Edge): every surface, mouse and keyboard.
- **iPad with Pencil:** every surface, touch layouts (section 8, artboard 5). Editors use the same routes. Their panels collapse into sheets at widths below 1180px.
- **Phone:** view and review only (section 3.14). Every route resolves to a phone view:
  - a video route shows Phone review;
  - a storyboard route shows its latest ad, or its frames as a read-only strip;
  - the canvas route shows the project's videos as a list.

  There are no editing controls, hidden or disabled. One banner says: "You can watch and leave notes here. Open on a laptop or iPad to edit."
  - Asks are not answered on the phone. When some are waiting, the banner adds "2 questions waiting · answer on a laptop or iPad".

---

## 3 Surfaces in detail

Each table uses four columns: trigger, result, states, and how undo treats it. The states named are empty, loading, partial, error, offline and conflict. When a row has no entry for a state, the general rule in section 4 or 5 applies.

### 3.1 The top bar (canvas)

The bar is 48px tall. From left to right:
- the Home mark ("Home: your projects", which goes to the Napkin OS project list);
- "Napkin Studio" and "Production" in blue;
- the project name ("Lumen Water · First Light");
- the questions pill, only while asks are open ("2 questions waiting", with ‹ › and its position "1 of 2"; section 3.17);
- presence avatars, with "Sai and Maya are here";
- **History** (opens the decision tree panel, 3.20), **Assets** (opens the Assets drawer, 3.18), **Export** (a menu, 3.18), **Share** and the account button.

Every editor's top bar also carries **History**, before its primary button.

- **No spend pill.** The top bar shows no spend, cost or limit (principle 4). What each job cost is in the decision tree (3.20).
- **Presence avatars:** click one to follow that person's viewport. Section 4.2 covers following.

### 3.2 Boards and jump navigation (review item 1)

**Boards.** A board is an Excalidraw frame, written as `boards[id]{title, purpose, rank}`.
- **Ad template.** A new project starts from it with seven empty, dashed boards: Script, Characters, Locations, References, Products, Storyboard, Video. A Skye card on the Script board reads "Start with the script", with **Write the script** (primary) and **Add pictures** (artboard 12).
- **No Sketches board in the template** (decided 2026-10-13). Sketch areas live on any board. Anyone can add a board with the `sketches` purpose. Scamp sheets (3.19) are their own `formats` boards.

- **Brand board.** Not in the template. Dropping a brand book creates one (3.18). Its purpose is `brand`.
- **Sheets.** A format sheet (3.19) lands as a board with the purpose `formats`.

**Board rail** (left, frosted panel). It lists boards by `rank`. Each row has the title, a count ("Characters · 3") and its shortcut (⌥1…⌥9). The current board is blue with `aria-current`, followed by "+ New board". The footer reads "⌥1–9 jump to a board · ⌥0 fit everything".
- **While the Assets drawer is open** it takes the rail's place (3.18). ⌥1…⌥9 keep jumping to boards. The drawer's **Boards** button, or ⌥0, closes the drawer and brings the rail back; ⌥0 also fits everything.
- **"View · Show all links"** sits at the rail's foot, off by default (3.16). Off: you see the links of what you select.

| Trigger | Result | Undo |
|---|---|---|
| Click a rail row | `scrollToContent(frame, {fitToViewport, animate})`. The row becomes current. With reduced motion the jump has no animation. | Not an undo step (viewport only). |
| ⌥1…⌥9 / Alt+1…Alt+9 | Jumps to the board at that rank. The handler reads `event.code` (`Digit1`…), because ⌥+digit types a symbol on a Mac. It does nothing while a text field has focus. | None. |
| ⌥0 / Alt+0 | Fits the whole canvas. | None. |
| Boards beyond the ninth | Listed in the rail without a shortcut. Drag the rows to change rank. | Reordering is one undo step (a rank write). |
| "+ New board", or the Board tool (B) and a drag | Creates a board. Its title field opens in place, and you pick a purpose (character, location, reference, product, storyboard, video, sketches, brand, formats, or none). | One step. |
| Drag a rail row | Changes rank. The ⌥ numbers follow the new order. | One step. |
| Rename (double-click the board title) | Excalidraw's own frame rename, written to `boards[id].title`. | One step. |
| Delete a board | Asks "Delete the board and the 3 things on it?" with **Delete board only** (contents stay, unboarded) and **Delete all**. | One step. |

- **iPad.** The rail is a "Boards · <current>" pill. Tapping it opens a sheet of 48px rows (thumbnail, name, count), then "+ New board". The ⌥ labels are hidden. The sheet closes from its own close button, on the pill, on a board pick, or on a tap on the canvas outside it (decided 2026-10-13).
- **Empty board:** a dashed frame with a drop hint that names its purpose ("Drop pictures here. They become locations.").

**Board sizing** (owner decision, Shrey 2026-10-15; features/art-boards.clan). A board is a space (a container), not a group.
- **Dropping something on a board puts it inside**, in the next free slot: contact-sheet rows from the top left, 16 in from the sides, 22 under the title, 34 at the foot (room for a name chip), 40 between things, never over what is already there. A thing dragged onto a board and let go where it is free and inside stays exactly there; dropped onto something, or sticking out, it goes to the next free slot instead.
- **A board grows to fit what is placed in it**, toward free canvas: down first, then right. It never moves, pushes or covers another board, or loose things on the canvas; it keeps 24 clear of them. A thing moved within its board so that it sticks out makes the board grow to hold it, in whichever direction, under the same rule.
- **Blocked both ways:** the board does not grow. The thing lands at the nearest free spot just outside it (below, else right, left, above, further out until clear) and is not on the board. The board shows "Board is full · Resize" at its top-right corner for 7 seconds; **Resize** selects the board, so its handles show. (Chosen as the least surprising variant: nothing already placed moves, nothing is hidden under a neighbour, and the new thing is still in view next to the board it was meant for.)
- **It never shrinks by itself.** **Fit to contents**, on a selected board's bar, shrinks or grows it to its members and the padding, as one undo step (off, with "Nothing on this board yet", on an empty board).
- **Manual resize:** a selected board has square handles on its corners and the middles of its edges; its sides and foot can be taken anywhere along them (the top is its title, which moves it). A resize is one undo step. An edge never cuts through a member: it stops at the members whose centre is still inside, with the padding (a key's views or an ink group count as one). The members whose centre the edge passed leave the board (on no board) when the drag ends, said as "2 things left Characters · Undo". Never smaller than 160 × 120. A size set by hand holds until something does not fit.
- **New things land in the right board**, through the same placement and growth: a generated picture beside its source on the source's board (the board growing toward it when that is free, else its next free slot), a key's new view next to its group, and + Node into the board in view whose purpose matches. A picture that lands taller than its placeholder, or a stack laid out again, grows its board to hold it when it can.

### 3.3 Nodes

A node is a typed Excalidraw element plus an image-element preview plus React overlay chrome (plan 2.1).

| Kind | Card shows | Primary actions |
|---|---|---|
| Script | Title, target length, excerpt with blue `@refs`, "4 scenes · 6 shots · edited by Maya 2 min ago", Skye's last change ("Skye tightened scene 3 · see change"), inputs strip | Open |
| Storyboard | Title, ratio, shot count, length, frame strip, "2 behind the script" when stale, inputs strip | Open |
| Video | Poster, length, "Clips 3 of 6 ready", last ad render, estimate to finish, inputs strip | Open |
| Reference | Picture, `@name`, role pill, library version when it came from the team library ("v4") | Role chip, Name |
| Frame (made from a sketch) | Picture, version, ratio badge, the model that made it ("Gemini 3 Pro on Runway") | Open, Use in shot N, Make all sizes |
| Sketch area | White, ratio-locked rectangle, "16:9 locked", "drawn by Shrey", inputs strip | Generate |
| Ink group | Strokes inside a dashed group box | Convert to text |
| Document | File name, pages, an excerpt Ellis read ("client_notes.docx · 2 pages") | Link to use as context |
| Format set | The master's thumbnail, then one tile per size labelled with format and size, Jude's flags | Open, Export zip |

**Generating nodes** are the nodes that send work to an agent: Script, Storyboard, Video, Sketch area and Format set. Each has an **inputs strip** and a send tray (3.16).

**Creating nodes.** Use **+ Node** on the toolbar: a menu of Script, Storyboard and Video, plus a picture, document, board or sketch area. **Sheets** on the toolbar drops a format sheet (3.19). You can also drop a file, paste an image, drag from the Assets drawer (3.18), use **Make video** (section 3.5) or **Plan shots**.

- A new node appears at the centre of the viewport, or inside the current board when the board's purpose fits.
- It carries a "New" pill and a soft blue halo for 4 s.

**States on a node:**
- **Empty:** "No script yet · link one to plan shots".
- **Running:** the loader and the agent line ("Dex is planning the clips"), with "started by" when it was not you.
- **Partial:** "Clips 3 of 6 ready".
- **Stale:** a warn pill ("2 behind the script").
- **Error:** a danger strip with the job's error copy and **Retry** (section 5.3).
- **Needs you:** the agent figure in its needs-you state (an orange speech bubble with "!"), "Waiting for you" on the node, and the ask card anchored to it (3.17).

**Delete.** The Delete or Backspace key on a selected node:
- If nothing is running, it deletes at once with an undo toast.
- If a job is still running on it, it first asks "Wren is still making clip 4. Stop it and delete?". This is today's Character stage behaviour (`stages/Character.tsx:157`).

### 3.4 Ports and the linking rules

**Ports** sit on node edges. An output port is on the right, an input port on the left. A port is coloured by what it carries: script coral, storyboard blue, video ink, reference by role (grey).

- An output port can hold many links, so one script can drive two storyboards.
- An input port holds one link per role, unless the table says otherwise.

| From → To | Role (link label) | Allowed | Effect |
|---|---|---|---|
| Script → Storyboard | `drives` | One script per storyboard | Plan shots reads this script. Re-planning merges by shotId and never wipes. |
| Storyboard → Video | `renders` | One storyboard per video; a storyboard can render many videos (cutdowns) | One clip per shot, from each shot's selected frame. |
| Script → Video | `drives` | One script per video | Allowed without a storyboard (owner, 2026-10-13). On Make video Dex asks "Plan a storyboard first?": **Plan the storyboard first** (recommended) or **Make clips straight from the script**, which feeds the script. |
| Reference → any generating node, or a Shot | its role (`character`, `location`, `lighting`, …) | Many | The reference joins that node's `@` vocabulary and gets its own link with a "<name> · <role>" chip in the inputs strip. Dex words its role ("lighting reference: match its light only"). |
| Board or group → any generating node | `input` | One link per board or group | Everything on the board or in the group joins the node's scope. The strip shows "Loc1 · Coast · 3". |
| Note, ink group or Document → any generating node | `note` or `context` | Many | The text joins the node's instructions (a note) or its background (a document). A document is used only once linked. |
| Brand board → any generating node | `brand` | One | Dex writes the brand rules into every prompt; Jude checks results against them (3.18). |
| Frame, key visual or Video → Format set | `master` | One master per set | Make all sizes adapts the master (3.19). Created by Make all sizes. |
| Image, frame or generated picture → Shot | `frame` or `layout` (asks which on drop) | One `frame`, one `layout` per shot | Used as the shot's frame, or as a layout guide. |
| Sketch area → Frame | `made from` | Created by the system only | Records where a frame came from. |
| Ink group → Shot | `note on shot N` | Many | Attaches the ink as a note on that shot (artboard 5). |
| Anything → Reference, Product, Document or Brand board | none | Refused | These are inputs only. |
| Video → anything but a Format set | none | Refused | Video is an output; it can only be the master of a cut-down set. |
| A link that would form a loop | none | Refused | "That would make a loop." |

**How a link is drawn** (owner, 2026-10-15):
- **From the edge nearest the target.** A link leaves its source's edge that faces the target and arrives on the target's facing edge. A group, or a stack of pictures, attaches at its outer bounds (a stack's turned corners included).
- **Under content.** Links run over boards but under pictures, cards, sketch areas and ink, never over their content.
- **A gentle curve, round what is in the way.** Where the curve would cross a picture, a card or a sketch area, the link goes round them instead (an elbow above or below them, rounded). The same scene always routes the same way.
- **One link per group and target.** A key group shows one link, the key link. When views form a key group, the links its views had into a target merge into it as one undo step ("Linked as @samurai · 3 views"); a view-only link stays only when made with ⌥ after grouping. Two arrows are never drawn between the same group and target.
- **Generation arrows follow their ends.** The arrow from a sketch, picture or text to what was made from it is attached to both, follows them when they move, stack or spread, goes with either end, and follows the same routing rules. A link or arrow with an end missing is not drawn.
- **Tags first, link to use** (owner, 2026-10-15). A script may say @samurai before any picture has that name. Naming pictures samurai_front, side and back never links them: the mentions stay underlined as not linked until the person links the group into the script, which resolves every @samurai at once. Unlinking underlines them again. Skye never offers to tag plain words.

**Dragging a link** (Link tool L, or drag from an output port):
- **Pointer:** a dashed blue line follows it, and the Link tool shows as pressed (`aria-pressed`).
- **Compatible input ports glow blue.** Over one, a tooltip at the pointer reads "Drop to link · drives".
- **Incompatible nodes dim to 40%** and refuse the drop. Only the nearest dimmed node shows its reason, for example "A script cannot feed a product" or "Not a target for a script".
- **A node with a running job is never dimmed during a link drag** (decided 2026-10-13), so its status stays readable. It still refuses the drop while the job runs ("Wren is still making clip 4. Link it when that's done."). Other people's selections, cursors and name tags are never dimmed.
- **The selection bar hides during the drag** and comes back on drop (decided 2026-10-13; artboard 2 keeps it up only to fit one frame).

**Dropping a link:**
- On a compatible port, the link is made. One undo step.
- On empty canvas, a picker opens listing only the node kinds that can take this link ("New storyboard from this script"). Picking one creates the node and the link as one step.
- **Esc** cancels the drag.

**Keyboard linking.** Select the source, press **L**, then Tab through compatible targets, which are announced by name and role. Enter links them.

**Stale links.** A link is stale when its source changed after its target was made from it. Stale marks come from today's `jobs/stale.ts`:
- a script edit marks its storyboard;
- a frame change marks its clip;
- a clip change marks the ad.

How a stale link shows:
- The line and label turn dashed amber.
- A badge on the link reads "Script changed · 2 shots out of date", with **Update shots**.
- The affected shots get an amber outline and an "out of date" pill.

A new `drives` link to a storyboard planned from an older script is stale at once. **Update shots** runs FollowScope and UpdateBox: the affected shots are re-planned as a merge, and any Runway step that follows goes through the send tray first (3.16).

### 3.5 Make video

1. Select a Script and a Storyboard (two clicks, or a lasso). The selection bar reads "Script + Storyboard" with **Make video** (primary), **Plan shots**, **Group** and More.
2. **Make video** creates, as **one undo step**:
   - the Video node, to the right of the storyboard;
   - a `drives` link, only if it is missing;
   - a `renders` link.

   No paid job starts. The node shows "6 clips to make · 15 s · waits for 2 shots".
3. A toast reads "Video made from Script and Storyboard · 2 links", with **Undo ⌘Z**. Undo removes the node, both links and the toast. Redo, or Make video again, brings them back.

Other selections:
- **A Storyboard alone:** Make video makes the node and the `renders` link.
- **A Script alone:** Make video makes the Video node with a `drives` link from the script, and Dex asks on it before anything is spent (3.17, artboard 4c): "Plan a storyboard first? Clips come out better from frames you've checked." The options are **Plan the storyboard first** (marked Recommended, "6 shots, with frames you check first") and **Make clips straight from the script** ("6 clips"), with "You can always switch later." and **Later**.
- **Nothing linked** (a Video made from + Node): Dex asks "What should this video be?" This is the one hard block: the options are **Describe it**, **Link a script** and **Link a storyboard**, and nothing runs until one is done.
- **Two scripts, or anything ambiguous:** Dex asks which one drives, with no default.

Clips are made only from the Video or Storyboard editor's **Make clips**, through the send tray (3.16, 5.4).

### 3.6 References, roles and naming (review items 2 and 9)

**Dropping a picture on a board** takes the board's purpose as its role. No dialog opens.
- The picture shows "Just added".
- Under it an inline chip appears:
  - a role button ("Location ▾");
  - an editable `@` name field, pre-filled;
  - a tick to keep the name.
- Enter or a click elsewhere keeps the name.

**The pre-filled name** is built as key `_` view. These rules come from `KEY_RE` and `VARIANT_RE` in `contracts/types.ts`, and Runway's `^[a-z][a-z0-9_]{2,15}$`:
- **Key:** the board's name prefix. Each board has one, editable in board settings (decided 2026-10-13). Locations defaults to `loc`; Characters takes the first character's key. Keys have no underscore. `ext` and `int` stay a user choice: type them as the prefix or the key.
- **View:** the file name, lowercased and slugged ("Cliffs.JPG" becomes `cliffs`).
- **Names are unique across the project,** because they become Runway tags. A clash anywhere in the project adds `2`, `3` and so on.

**Dropping a picture outside every board** opens the **Name this picture** dialog. It says: "It isn't on a board, so say what it is. Your script uses the name."
- **Name parts:** "Who or what" (key) `_` "This view" (view). The header shows the result live (`@shirt_linen`).
- **What it's for:** one open role set (decided 2026-10-13, contract-v3): `character`, `location`, `lighting`, `composition`, `product`, `style`, `wardrobe`, `pose`, `prop`, `texture`, `colour`, `layout`, `logo`, `palette`, `typography`, `brand_rule`, `document`, `other`, plus the free label below. The picker shows ten pills (Character, Location, Lighting, Composition, Product, Style, Wardrobe, Pose, Prop, Other) and **More…** for the rest (Texture, Colour, Layout, Logo, Palette, Typography, Brand rule, Document). The picker is a radio group. Today's `shape` and `feel` are not carried over (no importer, owner decision).
- **Role line:** each role shows one line saying what Dex takes from the picture:
  - lighting: "Dex matches its light only";
  - wardrobe: "Dex matches the clothes only";
  - layout: "Dex follows where things sit, not how they look".

  The prompt builder uses the same per-role rules, from one table in contract-v3 (decided 2026-10-13). The table has a line for every role, including logo, palette, typography, brand rule and document. The UI line and the prompt never differ.
- **Label (your words, optional):** free text, for example "Maya's beach outfit".
- **On:** where the picture goes. The default is the board whose purpose matches the role, otherwise References. The other choices are another board, "A new board for it", and "Leave it where it is".
- **Buttons:** Cancel, Save (primary). Save is disabled until the name is valid, with an inline reason ("Use 3–16 letters, numbers or _").

**Changing a role later:** use the role chip on the picture. It is one undo step. If links already use the old role, it asks first: "2 shots use this as a location. Change it to lighting for them too?"

**`@` autocomplete** (canvas notes, Script editor, Storyboard fields, Video notes, Image editor prompts: one shared `MentionInput`):

| Trigger | Result |
|---|---|
| Type `@` | A popover opens below the caret. It lists references grouped by role in a fixed order: Characters, Locations, Products, References (lighting, composition, style), then the other roles A–Z. Each row has a thumbnail, the `@name` (matched part bold), the label and the board it sits on. References linked to this node come first, under "Linked to this storyboard"; the rest follow under "Not linked to this storyboard". |
| Keep typing | Filters by name and by free label. "@ma" finds `@shirt_linen` through "Maya's beach outfit". |
| ↑ ↓ | Move the selection. |
| Enter or Tab | Insert. The text stores `{refId}`, not the name, so a rename updates every mention. |
| Insert a reference that isn't linked | The whole board or group it sits on is linked to this node (3.16), and a toast says "Linked Loc2 · City to the Storyboard so @loc2_rooftop can be used", with **Undo**. Undo removes the link; the mention stays and becomes an underlined unknown name. A single reference outside any board or group gets its own link. |
| Esc, or a click outside | Close. The typed text stays plain. |
| Type `#` | Lists shots ("#4 Close · Maya smiles"). Inserting links to the shot. |
| "New ref" in the popover footer | Opens Name this picture with the typed text as the name. |

- **Preselection.** In the Script editor the popover may preselect the reference that fits the sentence best, for example `@product_bottle` after "pulls out a cold". Everywhere else it preselects the first match.
- **Footer:** "↑↓ move · ↵ or tab insert · esc close · # shots".
- **Size:** the popover is at most 320px tall and scrolls. Groups that don't fit fold into "Locations · 2 more below".

**Unknown names.** An `@word` that matches no reference:
- **Look:** it stays in the text with a wavy warn underline. Use one colour on every surface: warn #b45309, not artboard 3's red (decided 2026-10-13).
- **Hover or focus:** shows "No reference called @maya_runing. Did you mean @maya_laughing?", with **Use @maya_laughing** and **Name a new picture**.
- **"Closest":** the reference with the smallest Damerau–Levenshtein distance (at most 2) on the whole name, then the best prefix match on the key, then the closest label. If nothing is that close, only **Name a new picture** is offered. At most one suggestion is shown.
- **In the Script editor,** Skye asks about an unknown name with an ask card on the line ("Who is the jogger?", with **A character**, **An extra**, **Cut him**; 3.10).
- **Generation never drops an unknown name silently.** The send tray shows "1 name isn't a reference: @jogger", with **Fix it** (3.16). Plan shots, which is free and has no tray, asks the same with **Fix it** and **Plan anyway**.

### 3.7 Sketch areas and ratio (review item 10)

**Tool:** Sketch area (S). Its toolbar button shows the current ratio ("16:9"). Pressing it again, or a long press on touch, opens "Sketch area shape" with 16:9, 9:16, 1:1 and 4:5, as a radio group. The default is the project's storyboard ratio.

**Drawing:** drag on the canvas.
- A dashed ghost rectangle stays locked to the ratio, with a size label ("16:9 · 1920×1080").
- A hint sits under the ghost, not beside the pointer: "Drag to draw · keeps 16:9".
- Releasing creates `sketches[id]{ratio}`, a white, ratio-locked rectangle labelled "16:9 locked" and "drawn by <name>".

**Rules:**
- **The picker sets the ratio of the next area only.** An existing area's ratio never changes. Its resize handles keep the ratio.
- **A sketch area is not an Excalidraw frame**, because frames don't nest. Strokes that intersect it belong to it for export (plan 2.2).
- **On today's canvas** (until canvas-nodes brings the tool): a person's own frame used in Generate becomes a sketch area in one undo step, keeping its exact bounds and shape (its ratio when it is one of the four), with its strokes left where they are. Frames never used in Generate stay frames. Deleting an area keeps the frames made from it; the confirm says "The 2 frames made from it stay".
- **Generate** (the area's button, as on artboards 4b and 4c) opens the send tray (3.16) with the sketch, its linked inputs and any handwriting Ellis read. The tray's **Generate** sends a ratio-true export to Runway and returns a frame at that ratio:
  - Wren renders. No price is shown (owner decision 2026-10-13: costs are recorded per job and shown only in History).
  - A sketch with no words and no linked references gets Wren's ask, "What is this sketch of?", with **Use it as a layout only** (proceeds) and **Describe it** (3.17).
  - When the model's output size isn't exactly the ratio, it is centre-cropped.
  - The frame says so: "1344×756 · cropped to 16:9".
- **The new frame:** it appears to the right of the area with a `made from` link, and offers **Use in shot N**, which sets it as that shot's frame (one step). "Make another frame" makes a new version beside it.
- **The model name** always reads "<model> on Runway" ("Gemini 3 Pro on Runway"), built from a `display_name` field in the capability sheet (decided 2026-10-13). This holds on every surface: buttons, tray rows, cards, takes, toasts. Sound models made directly on ElevenLabs read "<model> on ElevenLabs" ("Eleven v3 on ElevenLabs"), from the same field in `capabilities/elevenlabs.json` (3.21).
- **A sketch area on a format sheet** (3.19) keeps its format and size label, and its frame comes back at that format's ratio.

### 3.8 Ink, grouping and Convert to text (review item 11)

**Grouping.** Pen strokes are clustered by time and distance into one ink group: "Ink · 9 strokes · one group".
- **Moving:** the group moves, scales and deletes as one, and shows a dashed group box with corner handles.
- **Splitting:** Ungroup splits it.
- **Re-grouping:** a lasso around strokes groups them again.
- **Holding the pen** at the end of a stroke snaps it to a shape ($Q).

**Selection bar for an ink group:** **Convert to text**, **Ungroup**, **Move to board**, Delete (icon). On iPad it adds **Send to shot N** when the group is inside a sketch area tied to a shot.

**Idle suggestion** (decision D13): 2 s after you stop writing, Ellis may show a quiet chip, "Ellis can read this", that opens the same preview. Nothing converts on its own.

**Ink inside a sketch area or linked as a note** is read by Ellis when you press Generate. The tray lists the reading ticked but marked **confirm**, with **Edit** (3.16). Untick it to leave it out, or Edit to correct it. The ink itself is never changed by this.

**Convert to text:**
1. A preview card opens: "Ellis read: 'more golden light, she should laugh'".
   - The reading is in an editable text field.
   - Certainty is said in words ("sure of it", "not sure about one word"), never as a percentage.
   - Fuzzy `@` matches come as chips ("laugh → @maya_laughing?") with **Link it** and **No**. An unmatched word gets the wavy warn underline.
2. **Keep** (primary) replaces the ink with a text element in one undo step. The text shows "Text from your ink · the ink is kept", with **Back to ink**. The strokes are kept in `customData`. Accepted links carry into the text as mentions.
3. **Undo** (secondary, in the card) closes the preview. The ink was never touched.
4. **States while Ellis reads:**
   - **Working:** the loader with the learn card leading, and Ellis working, with "Ellis is reading your note".
   - **Error:** "Ellis couldn't read this. Try again, or type it." The ink is unchanged.
   - **Offline:** Convert is disabled with "Needs a connection".

### 3.9 The selection bar

A floating frosted bar sits above the current selection. Its contents depend on what is selected, with the most likely action first. At most one primary button (#D63B1F) is shown, and only when the action creates something.

| Selection | Bar |
|---|---|
| Script + Storyboard | **Make video** · Plan shots · Group · More |
| Script | Open · Plan shots · More |
| Storyboard | Open · Make clips… · More |
| Video | Open · Render ad… · Make all sizes… · More |
| Reference picture | Role chip · Rename · Use in shot… · More (adds Publish to team library) |
| Frame or key visual | Open · Use in shot N · Make all sizes… · Make another · More |
| Sketch area | Generate · More |
| Ink group | Convert to text · Ungroup · Move to board · Delete |
| Document | Link to… · More |
| Format set | Open · Export zip · More |
| Several mixed things | Group · Move to board · Delete |

- **More** always holds Copy link to this, Duplicate, Lock and Delete.
- **Selecting a generating node** also focuses its scope (3.16): its inputs glow and everything unlinked dims.
- **The bar never covers the selection.** It flips below when there is no room above.
- **It hides** during a drag, a port drag or a pen stroke.

### 3.10 Script editor (artboards 6 and 7; review items 3, 6, 7, 9)

**One shot model, two views.** Both views edit the same document. Owner decision: both views from the start. This supersedes D14's "AV later".
- A **Screenplay | Video · Audio** switch sits in the top bar.
- Switching keeps the caret's shot and the scroll position.
- The choice is remembered per person and per script (local preference).

**Who owns each field.** A Shot block in the script references the shot entity by `shotId`; it is never a copy.
- **Shared live text:** action, direction, beat text and dialogue are shared live text. They are the same Y.Text the Storyboard card edits, so typing in either place shows in the other immediately.
- **Single-value fields:** camera fields, duration and rank are single-value fields written as patches.

**Top bar:**
- "← Canvas", "Script · First Light", then "Saved" ("Saving…", or "Offline, saved on this device"). Until canvas-nodes gives the canvas its Script node, the editor opens from **Open script** on the Storyboard stage's Script card (or a deep link), and its back button reads "← Storyboard" (features/script-editor.clan).
- The view switch.
- Presence ("Sai is in shot 2 · Maya is reading").
- Undo and Redo.
- **History** (3.20).
- **Plan shots**, or **Update storyboard** when a storyboard exists and is behind (primary).

**No chat** (principle 10). The Script editor has no Skye panel, no chat box and no "Ask Skye". Skye works in the text itself, as agents do in Brief Maker.
- The account button.

**Screenplay view:**
- **Element-type bar:** Scene, Action, Character, Dialogue, Shot, Moment, with a hint for the next element ("Tab for Character").
  - Tab and Enter cycle element types (the Trelby pattern): Scene → Action → Character → Dialogue → Action.
  - Typing `INT.` or `EXT.` at the start of a line makes a Scene.
- **Shot block:** "SHOT 2", with a camera chip ("Medium · handheld") that links to that shot in the Storyboard editor, and its length.
  - Collapsed shots show one line. The current shot expands, showing its action, inline moments, dialogue and a **Direction** row with its counter.
- **Moment:** an inline pill, "at 0:02", followed by its action. Dialogue right after it belongs to that moment's beat.
  - Insert one with **⌥M / Alt+M** (read from `event.code`; ⌘M minimises the window on macOS), or from the element bar.
  - Time is shot time, in whole or half seconds, and must lie inside the shot ("0:05 is past the end of this 2.6 s shot").
- **Direction:** per shot, up to 4,000 characters, with the counter "318 / 4,000". The limit comes from the contract (document.schema.json, through clan-store's LIMITS), never hard-coded in the UI; the per-model limit a job sends is the capability sheet's (shot-direction). It counts what the document keeps: a mention counts as its full name, @key_variant. At 4,000, typing stops and the counter turns warn. Pasting past the limit keeps the first 4,000 characters and says "Kept the first 4,000 characters".

**Outline rail (left):**
- Scenes and shots in order, with drag handles, thumbnails and lengths. The current item is blue.
- Each shot row carries its who-wrote-it mark (below). A scene with a pending Skye suggestion shows Skye's 20px figure.
- A warn-coloured length marks the longest shot, or one Skye flagged.
- The keys list sits at the foot: Tab, @, ⌥M. (`#` shot links come with the Storyboard editor's shotLink node.)

**Reordering shots** (outline or AV table):
- Drag a row. The row lifts, its old place stays as a dashed slot, and a blue drop line opens where it will land.
- Numbers and start times stay as they are until the drop. Then shots renumber and start times are recalculated.
- A move keeps the shot's frames and clips (shot identity is `shotId`), and is one rank write.
- Moving into another scene changes the shot's scene, not its id.
- The clips on both sides of the new place get drift marks ("to check").
- Keyboard: focus a row's handle, press Space, use ↑↓, press Space to drop, or Esc to cancel (dnd-kit's keyboard sensor).

**Video · Audio view:**
- A three-column table: Shot | Video | Audio.
- **Header:** a running-time strip with shots in proportion ("15.0 of 15 s"). The moving shot is dashed; the strip does not preview the new order.
- **Gutter:** each row has a handle, the number, the timecode and length, and a camera chip.
- **Open shot:**
  - The gutter shows camera fields (Size, Angle, Move, Lens) and **Edit camera**.
  - The Video column shows the action with reference chips (thumbnail and role), then **Performance direction**.
    - Counter: "1,240 / 4,000 · Veo 3.1 on Runway uses the first 1,000, Dex condenses". A tick on the meter marks 1,000.
    - **See Dex's 1,000** opens Dex's condensed version, read-only. The text you wrote is never truncated.
  - **Moments in this shot:** a track from 0 to the shot's length, with markers and beat pills ("0:02 eyes open", "0:03 line: 'It's perfect!'"), and **+ Moment**.
- **Audio rows:** four kinds, VO, Line, Music and Sound, each with a time relative to the shot. Add them with "+ VO / + Line / + Music / + Sound".
  - A Line can be tied to a moment ("tied to moment 0:03"). Moving either one moves both.
  - **Every VO and Line names its speaker:** a character (`@maya`) or the Narrator. A Line also says whether it is **on screen** (the speaker is seen saying it) or off screen. An on-screen line is what makes Dex give the shot Path 1 (3.21).
  - These rows are the script side of the sound. Dex's audio plan reads them, and the Video editor's Sound view (3.21) shows the same lines with their takes. Editing a line's words here marks its takes out of date ("Words changed · redo this line").
- **Insert between rows:** hover a gap (or focus it with Tab) to show **+ Insert shot here** and **Bridge 1 → 2** (section 3.11).
- **Unknown `@names`** are underlined as in 3.6.

**Agents in place** (both views):
- **Inline suggestions.** A draft or rewrite appears on the scene, shot or audio row it touches, as a suggestion: the old words struck through, the new words underlined in coral. A small signed bubble sits on it, with Skye's figure: "Skye · scripts: I tightened it to fit 1.6 s." Three buttons:
  - **Keep** applies the new words in one undo step. The line becomes "Kept Skye's draft. Shot 3 now runs 1.6 s.", with **Undo**.
  - **Keep mine** drops the draft. The line becomes "Kept yours. Skye will leave this shot alone.", with **Undo**.
  - **Why** opens that decision in the decision tree (3.20), filtered to the shot.
  - Nothing changes until Keep (principle 5). An open suggestion is kept per person across back and forward (2.3).
- **Floating options on a selection.** Selecting a phrase shows a small bar signed with Skye's figure: **Tighten**, **Make it 10 s**, **Add a beat**, **Write the VO**, **Say it another way**. Each runs Skye on just the selected text and comes back as an inline suggestion. The bar shows no price (owner decision 2026-10-13: costs live only in the decision tree). When the day's writing allowance is used up, it says so in words.
- **Who-wrote-it marks.** Every scene and shot shows who last wrote it: "You", a person's avatar (Sai), or a crew figure (Skye), with **why?** beside it. The mark changes on each write. **why?** opens the decision tree filtered to that item (3.20).
- **Asks, not chat.** Ambiguity becomes an ask card anchored to the text (3.17), shared with everyone in the project:
  - Screenplay: "Skye · scripts: Who is the jogger? There's no ref called @jogger, so I can't tell Dex how to show him.", quoting the line ("Shot 2 · 'A @jogger runs past far behind @maya…'"), with **A character**, **An extra**, **Cut him**.
  - Video · Audio: "Dex · directs: Maya has three looks. Which one walks the waterline in shot 2?", with **Front**, **Side**, **Laughing**.
  - Both say "Sai and Maya see this too. First answer settles it." The answer shows in place, with **Undo**. Until live-sync, an ask no job raised (an unknown name) is seen only in the browser that raised it, and that line is hidden.
- **Unknown names:** Skye raises each one as an ask of this kind, never as a chat line.

**The right-hand area (Screenplay view)**, where the chat panel used to be, holds only facts about the script:
- **This script:** "6 shots · 16:9".
- **Length meter:** "15 s target · 14.2 s estimated".
  - The estimate is the sum of shot durations, with segments in proportion.
  - The current shot is blue. The longest or flagged shot is labelled ("shot 5 · 3.9 s").
  - A target mark is drawn, with a pill for time to spare ("0.8 s to spare", ok) or time over (warn).
- **Skye at work:** the loader with the plan card leading (scripting), Skye's figure working, and her signed line ("Skye · scripts: I'm timing the end card.").
- **Open asks** on this script, as anchored cards (the jogger ask above).
- **References · 6:** each `@name`, its role and the shots that use it ("@maya · character · 1 2 4 5"). A name with no reference shows "no ref yet" ("@jogger · 2"). **+ Link a reference** at the foot.

In the **Video · Audio view** the table takes the full width. The length strip sits in the header ("15 s target · 15.0 s estimated", one segment per shot), and asks and suggestions sit on their rows.

**Plan shots / Update storyboard:**
- Dex plans the shots from the script. A free planning step runs at once. When a Runway step follows, it goes through the send tray first (3.16). The Storyboard stage and the editor start the same job on the same storyboard: pressing either while one runs joins it. No price is shown (costs live in the decision tree).
- Re-planning is a merge keyed by `shotId`:
  - shots you edited keep your edits;
  - new shots are added;
  - removed scenes are asked about ("Shot 6 no longer has a scene. Keep it or remove it?").

**States:**
- **Empty script:** a placeholder in the page, "Paste a script, or write the idea in a line." Skye drafts from that line in place, as an inline suggestion.
- **Import:** a Fountain file dropped on the page imports, with Fountain's `@` character syntax remapped.
- **Offline:** typing continues and is queued.
- **Two people typing in one shot:** both carets show, and the text merges live.

### 3.11 Storyboard editor (artboard 8; review items 3, 5, 6)

**Top bar:**
- "← Canvas", "Storyboard · First Light", the ratio pill and the project.
- Presence.
- What is left to make ("5 clips to make").
- **Make clips** (primary).
- The account button.

**Sub bar:**
- "6 shots · 15.0 s of 15 s", with a length chip. It is ok when the total matches the ad length, and warn otherwise ("0.6 s over · Rebalance").
- Crew status lines, each with the loader, a mono tag (PLANNING, RENDERING), the line, and "started by" ("Wren is rendering clip 1 · about 0:40 left · started by Shrey").
- A stale count chip ("1 clip out of date"), then **+ Add shot**.

**Shot cards:**
- A grid in rank order, four across at 1440px.
- Each card has:
  - a handle, the number, a title, the length and More;
  - the frame, with its version tag at top left and a clip badge at top right;
  - four camera chips (size, angle, movement, lens);
  - two lines of action with blue `@refs`;
  - Direction.
- **Clip badges:** "Clip ready" (ok), "Clip out of date · frame changed" (warn) with **Remake clip**, "Rendering clip" (loader), "No clip yet" (grey).
- **Hovering a frame** dims it and shows "Open in image editor". A click opens the Image editor (review item 4). Badges stay readable above the dimming.

**Insert between shots** (review item 3):
- A "+" sits at the midpoint of every gap. Hover or focus shows a dashed blue guide and a menu headed "Insert between 1 and 2":
  - **Empty shot:** "A blank card you fill in". Free, one undo step.
  - **Bridge:** "Dex draws a shot that links 1 and 2 · starts on the last frame of 1, ends on the first of 2".
- **How Bridge is made:** veo3.1 runs with first = the last frame of shot N and last = the first frame of shot N+1, at a minimum of 4 s.
  - Its cost is recorded on the job, from the capability sheet (contracts/pricing.py), and shows in History.
  - The menu opens on the side away from the left card's Direction field.
  - Bridge needs both neighbours to have frames. Otherwise the option is disabled: "Shot 2 needs a frame first".
- **+ Add a shot at the end** is a tile after the last card.

**Drag reorder** (dnd-kit):
- The card lifts with a slight tilt, a blue outline and a shadow. Its old spot stays dashed ("Sai is moving this shot" for others).
- A 4px blue drop line carries "Shot 5 moves here".
- While dragging, Dex's toast names the neighbours that will need checking ("If shot 5 lands between 2 and 3, the cuts on both sides change. I will mark clips 2 and 5 to check.").
- On drop, drift marks are set. The move is one undo step.
- Keyboard works as in 3.10.

**Change this frame** (review item 5), in the card's More menu or the Image editor:
1. Type the change ("Make this an overhead aerial shot"). **Redo** lets you reword it after reading Dex's answer.
2. Dex classifies the words as a **camera change** or a **local change**. The answer always names which: "Dex read this as a camera change".
   - **When the words could be either** ("make the bottle bigger"), Dex asks "Bigger how?" on the card, with a camera option and an edit option (artboard 4c). This is an ambiguity ask, so no option is preselected or marked Recommended (3.17).
3. **Camera change:**
   - The card's affected chips keep their current values with dashed amber outlines.
   - The result shows a field-by-field diff ("angle: eye level → overhead", "size: close → wide"), "Movement and lens stay", and a "v2 new" thumbnail.
   - **Apply** writes the camera fields and makes the new frame version current, as one step, and marks the clip stale ("Apply puts clip 4 out of date").
   - **Keep both** keeps the new frame as an extra version without touching the fields.
   - **Discard** drops it. The card says nothing about cost; the render it took is recorded, with its cost, in the decision tree (3.20).
4. **Local change:** Dex sends you to the Image editor with the words in Fill area, or applies the change as an instruction edit. Either way the result returns as a new version with Apply, Keep both and Discard.
5. **When Dex used the words as given** without restructuring them (passthrough), the result says so: "Dex sent your words as they are."

**Direction** (review item 6):
- Collapsed to one line ("Direction · first words · 1,186 / 4,000"). Empty: "Add direction · 0 / 4,000".
- Expanded: a scrolling textarea and "Clips read up to 1,000 characters. Dex condenses the rest for each clip."
- The same field as in the Script editor.

**Make clips:**
- Opens the send tray (3.16), expanded, for every shot without a ready, current clip. The tray lists each clip with its inputs, and you can untick any (5.4).
- Remaking one stale clip from its badge opens the tray for that clip, collapsed to one line if you collapsed it before.

### 3.12 Image editor (artboard 9; review items 4, 5 local, 10)

**Top bar:**
- Back, "Frame 3 · Insert" and "16:9 locked · 1920 × 1080".
- Zoom (−, 100%, +, Fit).
- Presence.
- "3 edits not applied".
- The versions menu ("v3 of 3 ▾").
- **Apply as new version**, the only primary button.
- The account button.

**The stage:**
- Locked to the frame's ratio. Zoom and pan; the crop keeps the ratio (review item 10).
- Prev and next frame links sit below ("← Frame 2 · Medium", "Frame 4 · Close →"). If edits are not applied, moving between frames asks first: "Keep the 3 edits for later, or discard them?"

**Tools (left):**

| Tool | Key |
|---|---|
| Select | V |
| Click-select, AI finds the object | A |
| Brush mask | B |
| Lasso | L |
| Eraser | E |
| Text | T |
| Crop | C |
| Hand | H, or Space-drag |

- Brackets `[ ]` change the brush size.
- **The brush strip** holds: mask name, Size, Soft, Add/Subtract, **Snap to cut-out** (fits the mask to Rhea's cut-out edge) and **Clear mask**.
- **Mask paint** is translucent tool blue with marching ants: "Mask: blue paint marks what changes".

**Edits are a non-destructive list:**
- The panel is titled "Edits · not applied yet" and says "Nothing is sent until you run an action. v3 is never changed."
- Each edit is numbered and has its own undo. "Next: Fill Mask 1" names the next Runway step.

**Layers (front first):** Text, masks, cut-outs and Frame (the locked input version).
- Each layer can be hidden.
- A cut-out offers **Save as reference**, which opens Name this picture with the role preselected.
- Upstream inputs arrive as locked layers.

**Actions** (none shows a price; owner, 2026-10-13):

| Action | Who | Runs | Notes |
|---|---|---|---|
| Remove background | Rhea | free, on your device | Uses the relay automatically when WebGPU is missing or memory is low, and then says "ran on our server". |
| Fill area | Rhea (Runway generates) | `ideogram_4_5` with a mask on Runway | Runs on the selected mask only: "Only the blue area changes". Runway edits the mask's black and keeps its white (`png_black_edit`, providers.md fact 2). "Keep the label exactly as it is" keeps the label by leaving it white in the mask; it is not `preciseEdit`, which keeps the whole composition (fact 3; the image editor feature settles the copy). The run button is dark, not primary. |
| Change whole frame | Rhea | `ideogram_4_5` `preciseEdit` on Runway (recommended; the image editor feature decides) | A prompt redraws the whole frame, keeping its composition and size. |
| Upscale | Rhea | `magnific_precision_upscaler_v2` on Runway | 2× or 4×, showing the output size ("→ 2688 × 1536" at 2×, "→ 5376 × 3072" at 4×, from our 1344 × 768 frames; providers.md fact 7). |

- Paid actions go through the send tray (3.16), which lists the frame, the mask and the words, and names the model ("<model> on Runway").
- A result lands as a new layer in the op list. Nothing changes the stored version until Apply.
- **Arriving from Jude's brand flag** ("Fix in image editor", 3.18), the editor opens on that frame with the rule shown at the top of the Edits panel ("Logo clear space: one bottle-cap height"). Nothing runs until you choose an action.

**Apply as new version:**
- Saves v(n+1) as `kind: edited`, leaves v(n) as it was, and makes v(n+1) the shot's current frame on the storyboard (one undo step).
- It marks that shot's clip stale.
- The versions menu says beforehand what Apply will make: "Apply saves your 3 edits as v4. v3 stays."

**Before / After** toggles the view. Before hides masks, cut-out outlines and text, and labels the frame "Before · v3 as saved".

**Pointer during a running action:** the busy pointer (section 6), with the create card leading (retouching). The masked area shows the pending stripes.

### 3.13 Video editor (artboards 10 and 10b; review items 7, 8)

**Two views, one editor.** A **Picture | Sound** switch sits in the top bar, after the title (artboard 10b). Picture is this section; Sound is 3.21. Both views share the playhead, the selected shot, notes and the top bar. Switching keeps the playhead and the selection. The choice is remembered per person and per video (local preference), and `?view=` opens either one.

**Top bar:**
- "← Canvas", "Video · First Light" and "16:9 · 15 s".
- The **Picture | Sound** switch.
- The running-job pill ("Wren · renders: shot 5, take 2 · about 0:40 left · started by Sai"; in the Sound view while the mix rebuilds, "Edie · edits: mixing your changes into mix v4 · started by you").
- Presence.
- Ad versions (v1, v2), with **Compare**.
- **History** (3.20).
- **Export** (a menu: the film and its sound deliverables, 3.21).
- **Render ad** (primary; a render that remakes clips or sound opens the send tray).

**Preview:**
- A 16:9 player on the current shot, with the shot caption and take ("Shot 4 · Close · take v3 patched").
- Below the player:
  - frame back and forward, play, and the timecode ("0:07.2 / 0:15.0");
  - **Loop the note window**;
  - **+ Note at 0:07.2**;
  - mute and full screen.
- When a note is ahead, a cue reads "Note at 0:03 in 1.8 s". It counts to the note's moment, not to the window start.

**Time rule (decided 2026-10-13, applies on every surface):**
- Whole-ad positions use **ad time**: the ruler, the playhead, the player timecode, and the phone scrubber and notes list.
- Anything inside a shot uses **shot time** and always names the shot: moments, beats, note windows, patch ranges, take segments. For example: "shot 4 at 0:03".
- Where both help, show both: "shot 4 at 0:03 · ad 0:09".

**Preview sound.** The player always plays the current mix (3.21), never the clips' raw sound. Its mute button mutes your speakers only, not the mix.

**Timeline rows:** Notes, Shots (the magnetic main track), Beats, Voice, Music.
- In the Picture view, **Voice** and **Music** are summary rows: one block per line and per music section, read-only, with "Edit in Sound" on hover. Every layer, take, level and check lives in the Sound view (3.21).
- Each shot on the main track carries its path tag ("P1" or "P2", 3.21).
- **Toolbar:** Magnetic, Split at playhead, + Beat, "Fits 15 s exactly" (or warn), "2 open notes", and zoom.
- **Main track:** drag a clip to reorder, and the track closes gaps itself. Same rank write and drift marks as the storyboard.
  - A clip shows its take ("4 · Close · v3").
  - A spliced range is marked with a crossfade edge and a label ("patched 0:02-0:04").
  - A clip being rendered shows the loader ("take 2 rendering").
- **Beats:** diamonds at exact times, with labels. Beats move with their shot.
- **End card:** the last clip, edited like any shot. A shot that is mostly text (an end card, a tagline card) is never sent to a video model, because the words would garble: it is a still with sound layers, "end card + layers" (3.21).

**Notes to windows** (review item 8):
1. **+ Note at <playhead>**, or N, adds a note at the playhead on the shot under it, written as `reviews[id]{range}`.
2. **The window** defaults to `[floor(t) − 1, ceil(t) + 1]` in shot time. This one rule holds everywhere, the phone included (decided 2026-10-13).
   - It is clamped to the shot, and is never less than 2 s wide. Near a cut it shifts inward rather than shrinking.
   - It never crosses a cut.
   - Whole seconds only, because Aleph 2 on Runway takes whole-second ranges. The panel says so: "Whole seconds only. The rest of the shot stays as it is."
3. **Adjusting the window:**
   - Selecting a note widens it on the timeline into a shaded window with blue handles. The shading runs down through every row.
   - Drag the handles (they snap to seconds), or use the From/To fields (m:ss) and the mini strip in the right panel. All of them move the same window.
4. **Still at the moment:** the panel shows "Still at 0:03. The fix aims for this frame." **Edit still** opens it in the Image editor before the fix runs.
5. **Fix this moment** (primary in the panel) shows "Edie · edits: regenerates only 0:02-0:04 on Aleph 2 on Runway and splices it back".
   - The result is a **new take** (v3, parent v2) that replaces its parent in the cut.
   - The seams get short crossfades.
   - Jude checks both seams ("v3's seams at 0:02 and 0:04 match the take around them").
6. **The note stays open** after a fix. Running Fix again makes v4. **Resolve** closes the note.
   - **Sound on a patched take.** Aleph 2 keeps the clip's own sound, so a Path 1 line inside the window still plays as it was. When the change alters what should be heard (heavier rain, a door that now slams), Jude flags the layers in that window: "Jude · checks: the picture changed at shot 4, 0:02–0:04. The rain effect may not match now", with **Redo this cue** and **It's fine**.
   - **A note about the sound** ("the music is too loud here") is the same note. In the Sound view its window shades every lane, and the fixes are the sound ones (redo a line, cue or section, or a level; 3.21). Fix this moment stays the picture fix.
7. **Fallback** when Aleph 2 isn't available: Veo 3.1 first/last frame over the window, generated at 4 s and trimmed. The panel says so before you run it ("Aleph 2 on Runway isn't available. Veo 3.1 on Runway will make 4 s and we'll keep the 2 s you need"). On a Path 1 shot the fallback makes new sound for the window, so the panel adds "Her line in this window will be said again. Check it after." An extend (Gemini Omni Flash on Runway) remakes the sound of the whole clip, and says the same for the whole shot.

**Make all sizes** (in the top bar's More, and on the Video node) makes the cut-downs of the film: 9:16, 1:1 and 4:5 from the 16:9 film, reframed with subject tracking. They are part of the first release. Section 3.19 has the flow.

**Takes for a shot:** a list of v1, v2 and v3, each with the model ("Veo 3.1 on Runway"), length, who made it and when. **Use** puts a take in the cut (one undo step). **Another take** opens the send tray and makes a new take. On a Path 1 shot a take brings its own sound; using another take swaps the shot's sound with it, and the lines it carries come in as new line takes (3.21).

**Render ad:** a render from ready clips runs at once ("Render the ad · 15 s"). A render that remakes clips or sound opens the send tray (5.4).
- Edie edits. The result is a new ad version: the picture and the current mix, at the loudness target picked in the Sound view (Online −14 LUFS unless you picked another).
- A render with stale clips asks first: "2 clips are out of date. Render anyway, or remake them first?" Stale sound (a line whose words changed, a voice that changed) is counted in the same question.
- Open sound checks (3.21) never block a render. The render's done line says "2 sound checks still open", with **Show**.

### 3.14 Phone review (artboard 11; review item 8 on phone)

From top to bottom:
- **Top bar:** Home, "Production" over the project name, a presence pill ("Maya is editing"), the account button. The project name truncates first.
- **Banner:** "You can watch and leave notes here. Open on a laptop or iPad to edit."
- **Player:** "The ad · v2 · rendered by Edie 12 min ago", a 56px play/pause button, the shot caption (it follows the playhead), and the timecode.
- **Scrubber:**
  - played progress and the playhead;
  - note markers in each author's colour, with 44px targets;
  - a dashed orange box showing the window a new note would change.
- **Shot strip:** thumbnails labelled with the shot number and ad start time. The current shot follows the playhead.
- **Notes list:** 56px rows, each with the time, avatar, text, "who · when" and Open/Done.
  - Rows show ad time and the shot: "0:09 · shot 4".
  - A done note shows what fixed it: "fixed in v2, 0:02 to 0:04 only".
- **Composer** (pinned): "Leave a note at 0:07 · changes only 0:06 to 0:08", a text box, and **Leave note at 0:07** (52px, primary).

**Rules:**
- **Seeking:** tapping a marker, a shot or a note row seeks there and pauses. The playhead, window, timecode, composer label and button label all update together.
- **The phone window** uses the same rule as 3.13: `[floor(t) − 1, ceil(t) + 1]` in shot time, clamped to the shot (not the ad), at least 2 s, never crossing a cut. Artboard 11's "clamped to 0..15" no longer applies.
- **The phone plays the mix.** The player plays the render version's own mix, with every layer, at the Online target (−14 LUFS), because that is how the ad is heard on a phone. There are no lanes, levels, takes or checks on the phone; its only sound control is mute. A note about the sound ("music too loud at 0:09") is an ordinary note, and is fixed in the Sound view on a laptop or iPad (3.21).
- **A radio cut** of the version, when one exists, sits under the player as "Radio cut · 30 s", audio only, with its own play button and the same composer.
- **Notes belong to a render version.** A note turns Done when a later version patches it.
- **Presence** shows who is editing. There are no cursors.
- **When the ad is rendering,** the player shows the loader with the produce card leading, with "Edie is cutting v3 · about 1 min".

### 3.15 Signed out and access

- **No session:** `/production` shows the Napkin Studio / Production bar and a card, "Sign in to Napkin Studio to use Production", with **Sign in** (primary). Sign in goes to the Napkin OS sign-in and returns to the same URL.
- **Signed in, no access:** "You don't have access to this project. Ask its owner to add you."

### 3.16 Inputs and scope, and the send tray (artboard 4b)

**Scope comes from links.** A generating node (3.3) uses only what is linked to it. Nothing is used because it sits nearby.
- **What can be linked:** a board, a group, a single reference, a note (text or an ink group), a document, and the Brand board (link rules in 3.4).
- **One link per board or group.** Everything on that board or in that group is in scope, including things added later.
- **A single reference gets its own link** and a "<name> · <role>" chip ("golden hour · lighting").
- **Picking an unlinked reference in `@`** links its whole board or group, with a toast and **Undo** (3.6).

**The inputs strip** sits on every generating node, under its title: "Inputs", then one chip per link ("Loc1 · Coast · 3", "@maya", "golden hour · lighting"), then **+ Link input**.

| Trigger | Result | Undo |
|---|---|---|
| Click a chip | Fits the canvas to that input and keeps the node's focus. | None (viewport). |
| × on a chip (on hover or focus) | Removes the link. If shots use it, asks first: "Shots 1 and 2 use @loc1_beach. Unlink anyway?" | One step. |
| **+ Link input** | Opens a picker of boards, groups and references, with search. Picking one links it. | One step. |
| Drag a link onto the node | As in 3.4. | One step. |

**Focus on select.** Selecting a generating node shows its scope:
- Its inputs glow blue.
- References that shots actually use carry a tag naming those shots ("shots 1, 2"). Only used references get a tag.
- Unlinked boards and references dim to about 35%. This is deliberately below contrast: they are context, not something to act on, and they take no hover while dimmed. A click on one ends the focus and selects it.
- **Never dimmed:** a node with its own open flow (a sketch area generating, an open ask card, a running job, an open send tray), and other people's cursors, selections and name tags.
- Esc or a click on empty canvas ends the focus.
- **Reduced motion:** the glow and dim switch without fading.

**"Used by"** is the reverse view. Hovering or focusing a reference shows a card, "Used by: Storyboard (shots 1, 2), Video". Each row fits the canvas to that node.

**Show all links** (View, at the foot of the board rail) draws every link at once. It is off by default, and the choice is remembered per person (local preference). Off, you see only the links of what you select.

**The send tray, "What Dex will send".** Every paid generation opens it: Generate on a sketch area, Make clips, Remake clip, Bridge, Change this frame, Fill area, Change whole frame, Upscale, Fix this moment, Make all sizes, a Render ad that remakes clips, and every sound generation (Redo this line, Re-voice, Redo this cue, Redo this section, Rewrite music to the cut, Make 3 previews, a voice change and a radio cut; 3.21, 3.22). Free and on-device work has no tray; rebuilding the mix is free.
- **Sound rows** name the words, the speaker and the voice ("Line · 'It's perfect!' · @maya · Aoife v2"), the timing kept ("Keeps shot 4's timing, so her lips still match"), any direction you typed ("softer"), and the brand names it will say from the pronunciation list ("Lumen · LOO-men"). The footer names the model ("Eleven v3 on ElevenLabs").
- **Where:** anchored to the button that opened it, signed "Dex · directs". It is not modal; the canvas stays live behind it.
- **Rows,** each with a checkbox and what it is used as:
  - "Sketch · 16:9 layout";
  - "Text · instruction: she runs toward the sea";
  - "@maya_side · character, placed as drawn";
  - "@loc1_beach with your marks · markup (clean + marked copy)";
  - "Handwriting read by Ellis: 'brighter sky' · instruction", ticked but marked **confirm**, with **Edit**;
  - "@ref_golden_hour · lighting (linked)";
  - "Brand rules · Lumen Water" when the Brand board is linked (3.18);
  - a document, as "context".
- **Unticking** a row leaves it out of this send only. The link stays.
- **Nearby notes that aren't linked** are listed last, unticked: "2 notes nearby aren't included", with **Include**. Include links the note to the node (one undo step) and ticks it, so the scope stays what you linked.
- **Unknown names** show as a row: "1 name isn't a reference: @jogger", with **Fix it**. Generate still works; the name goes as plain text.
- **Footer:** the model and ratio ("Gemini 3 Pro on Runway · 16:9"), **Cancel** and **Generate** (primary). No price.
- **Collapsed by default.** It opens as one line: "Sketch, 4 inputs, 1 note", with **Generate** and an expand control. ("Note" counts handwriting or notes Ellis read.) Expanding shows the rows above, where you can untick any input. If you expand it, that choice is remembered per person. Batches always open expanded (5.4).
- **Nothing is sent until the tray's Generate.** Cancel or Esc closes it; nothing is sent and nothing on the canvas changes. Generate starts a job, which Stop ends (undo never cancels a job, 4.5).
- **States:** offline, Generate is disabled with "Needs a connection". While the inputs are still loading, rows show the pending stripes and Generate waits.

### 3.17 Asks (artboard 4c)

An ask is how an agent gets an answer instead of guessing (principle 6).

**Shape.** The same as the Research tool's clan Ask: `question{id, text, options[{id, label, value?}], allow_text, address}`. The job waits in `needs_input`. Two fields are new and go into contract-v3: `recommended` (an option id, or none) and, per option, `detail` ("6 shots, with frames you check first"). Options carry no cost; what the chosen option's jobs cost is recorded and shown in the decision tree (3.20). The answer is the person's confirmed choice, written as `by: human:<id>` to the node it settles and appended to History.

**Three kinds:**
- **Hard block,** only when no option can proceed. Example: a Video with nothing linked or described. "What should this video be? Nothing is linked to it yet, so I have nothing to direct from." Options: **Describe it** (a text box: "Describe it in a line or two. Type @ to pull in a character, place or product."), **Link a script**, **Link a storyboard**. The primary button reads "15 s · Make it".
- **Nudge.** At least one option proceeds, and one may be marked **Recommended**. Examples: "Plan a storyboard first?" (3.5); a sketch with nothing to go on, "What is this sketch of?", with **Use it as a layout only** and **Describe it** (3.7).
- **Ambiguity.** The words could mean two things ("Bigger how?" in Change this frame, 3.11). No option is preselected or recommended.

**The ask card:**
- Anchored to its node, not modal. The node shows "Waiting for you · Make video".
- Orange needs-you border, the Research tool's rule.
- Signed by the agent who owns the step, with its figure in the needs-you state: Dex for planning and direction, Skye for the script, Wren for renders.
- The question, one line of why, the options as buttons with their detail, and the text box when `allow_text` is true. `@` works in the text box.
- **Later** hides the card. The job keeps waiting and the node keeps "Waiting for you". Asks never time out into a guess.

| Trigger | Result | Undo |
|---|---|---|
| Pick an option, or type and confirm | The job resumes. The card collapses to "You chose: plan the storyboard first · in History", with **Change**. | Not an undo step. Use Change. |
| **Change** | Reopens the ask with the earlier choice shown. It does not undo work already started; Stop does that. | None. |
| **Later** | Hides the card; the ask stays open and counted. | None. |
| The questions pill ("2 questions waiting") | Its label, or ›, fits the canvas to the next open ask and opens its card; ‹ goes back. Order is canvas order: by board rank, then top to bottom, left to right. It shows the position ("1 of 2"). Hidden asks are included. | None. |

**Asks are shared** (owner confirmed 2026-10-13). Anyone in the project can answer, and History records who: "Sai chose: plan the storyboard first".
- While someone is typing an answer, others see "Sai is answering" on the card.
- If two answers cross, the first one wins. The other person's card turns into "Sai chose: … · in History", with Change. Their pick is not applied.
- The questions pill counts every open ask in the project, not only the ones you caused. An ask raised by someone else's job still belongs to that job's starter (4.3).

### 3.18 Assets, the team library and brand (artboard 4d)

**The Assets drawer** opens from **Assets** in the top bar. It takes the board rail's place. ⌥1…⌥9 keep working. **Boards** (⌥0), or ×, swaps the rail back. Four tabs:
- **This project:** everything in the project, by role.
- **Team library:** shelves per client, within the agency (below).
- **Upload:** pick or drop files. Each kind lands as in "Dropped files" below.
- **From Napkin:** spin-ins waiting from Brief Maker and Research.

**Team library.**
- One shelf per client ("Client shelf · Napkin Studio": Lumen Water, Harbour Bank, Kettle & Co). Everyone in the agency shares it: "Shared with everyone at Napkin Studio". **Manage shelves** adds, renames and archives client shelves.
- A shelf holds a **Brand kit** ("v2 · published by Maya": Logo · 3, Palette · 5, Fonts · 2, Tone · 6), then Characters, Locations, Products and the rest by role.
- **Voices** (artboard 13b). Each character row names its voice ("@maya · Aoife · designed"). Below the characters the shelf lists its **Voices**, each with a play button and how it was made (library, designed, cloned). A cloned voice carries a "Consent on file" pill. The brand names the voices say are listed as chips (Lumen, Velto, Vorr). Opening a character opens its card; its Voice tab is 3.22.
- Every item shows its version and who published it ("@maya · character · 3 views · v4 · published by Sai").
- **Dragging an item onto a board** lands it with its role and views ("Drag onto a board · arrives with its role and views"). One undo step. The project now holds its own copy.
- **Publishing.** **Publish to team library** (a reference's More menu, or Export) opens "Publish to team library · Lumen Water / Locations · v5 · replaces v4 for everyone; projects keep their copy until they update", with **Cancel** and **Publish v5**.
  - A new version replaces the old one in the library for everyone.
  - Projects keep their copy. Their chip shows "v5 in the library", with **Update**. Update is one undo step and marks what the reference fed as out of date.
  - Publishing is not an undo step. A published version can be replaced by publishing again.

**Dropped files:**
- **Images** become references, by the rules of 3.6.
- **A brand book (PDF)** creates a **Brand board** at once ("Brand board · Rules here guide every frame"), which fills in as Ellis reads: "Ellis · reads: page 14 of 32", with a page strip and "Pages 15 to 32 still to read".
  - It holds Logo variants, Palette, Fonts, Tone of voice, and Do / Don't. Each item is a reference with the role `logo`, `palette`, `typography` or `brand_rule`, and can be edited.
  - **Font files are never taken from a PDF.** Fonts show their name and use with "no file", and the line "Font files are not taken from the PDF. Upload the fonts you are licensed to use.", with **Upload fonts**.
- **A character sheet** (one image with several views, such as `maya_sheet.png`): Rhea proposes view crops ("@maya_front, @maya_side, @maya_back") and asks "Are these crops right?", with **Adjust** (move the crop boxes) and **Confirm**. The references are created only on Confirm, as one undo step.
- **A DOCX** becomes a Document node ("client_notes.docx · 2 pages"). Ellis reads the text. It is used as context only once linked ("Link to use as context").
- **Fonts** go to the linked Brand board's Fonts.

**Brand rules.**
- When the Brand board is linked to a generating node, Dex writes its rules into the prompts. The send tray lists them (3.16).
- Jude checks each result against them and flags a break on the result, naming the rule: "Jude · checks: the logo sits too close to the edge (clear space rule, Brand board)", with **Fix in image editor** (3.12) and **Ignore**.
- Brand rules never block. Ignore is recorded on the result, with who ignored it.

**Spin-in from Brief Maker or Research.** A card arrives on the canvas: "From Brief Maker: Lumen 'First Light' brief", listing what it will create ("Script: Skye drafts from the proposition and tone", "References: 4 from the research").
- Nothing happens until **Bring in**. Bring in creates the nodes and links as one undo step; Skye's draft then runs as her job.
- **Not now** closes the card and leaves the spin-in under the From Napkin tab.

**Export** (top bar menu):
- Download all media (zip) · "46 files";
- Project as .clan + assets · "412 MB";
- Script as PDF; Script as Fountain;
- Storyboard as PDF · "6 frames";
- Publish selected to team library.

The film's own deliverables (online film, TV master, stems, cue sheet, radio cut) are in the Video editor's **Export** menu (3.21).

Exports are free. A large export shows its progress in a toast and lands as a download.

### 3.19 Formats: scamp sheets and Make all sizes (artboard 4e)

**Format packs follow industry standards** (owner decision 2026-10-13). They are data, not code: `production-tool/contracts/format-packs.json`, with a readable copy in `docs/production-tool/format-packs.md`. Both are a draft built from published platform and media-owner specs, and the owner reviews them before the build relies on them. Each client can edit its packs; a client's edited or custom packs live on its library shelf.
- **Each format records** its name and id, its real size (px for screen, mm for print and out of home), ratio, delivery size in px, safe area (insets from each edge or a centred live box), bleed in mm, notes, source links, and a `verified` flag. A format whose value is derived or not confirmed on a primary page is marked unverified, with the reason.
- **Social** (from the draft): Meta feed image 4:5 (1440 × 1800) and 1:1 (1440 × 1440, unverified); Meta feed video 4:5; Meta Stories and Reels 9:16 (1440 × 2560, safe area top 14%, bottom 35%, 6% each side); TikTok In-Feed 9:16 (1080 × 1920, unverified); YouTube 16:9 (1920 × 1080), Shorts 9:16 and 1:1; LinkedIn images (1.91:1, 1:1, 4:5) and videos (16:9, 4:5, 9:16); X video. Where a platform publishes only a template, not numbers (TikTok, YouTube Shorts), the format has no safe area and the sheet says so.
- **Print and out of home** are sized in mm. Their delivery px is the artwork at the scale the media owner asks for, at 300 dpi (a 48-sheet at 1/10 scale is 7200 × 3600 px). ISO paper is the trim at 300 dpi; 3 mm bleed adds about 35 px a side. Bleed on scaled artwork applies to the scaled artwork.
- **Out of home output always says "Confirm with the media owner."** UK media owners publish specs per site and per network; the pack holds the common national spec.
- `docs/production-tool/format-packs.md` has every pack in full (Social, Out of home, Print, Digital display, Film storyboard frames), with sources and the list of unverified rows.

**Scamp sheets.** **Sheets** on the toolbar opens the pack picker: Social, Out of home, Print, Digital display, Film storyboard frames, and the client's own packs. Each pack lists its formats with their sizes. An unverified format shows "Size not confirmed" on hover, and the reason.
- Picking a pack drops a sheet: a board with the purpose `formats`, holding one ratio-locked sketch area per format, each labelled with format and size ("Instagram story · 1080 × 1920"). One undo step.
- The areas behave as in 3.7. Each Generate returns a frame at that format's ratio.

**Make all sizes** works on a selected key visual (a frame or picture) or on the film (a Video). It is one button in the selection bar (3.9).
1. You pick a pack, or keep the last one used for this client.
2. Wren adapts the master to every format in the pack:
   - crops where the picture has room;
   - extends on Runway where it doesn't;
   - for extreme ratios, generates at the nearest ratio Runway supports, then crops or extends;
   - keeps the logo and copy inside each format's safe area, by the Brand board's rules when it is linked.
3. When the subject is unclear, Wren asks first: "What must stay in every size?" (3.17).
4. The send tray lists every size with its method (crop, extend or generate; a plain crop runs on your device). You can untick sizes. No prices and no total.
5. The results land as a **Format set** node linked to the master (`master`), one tile per size. Jude flags brand-rule breaks per size, with Fix in image editor and Ignore.
6. **Export zip** downloads one zip with every file named by format and size.

- **Video cut-downs** are part of the first release: 9:16, 1:1 and 4:5 from the 16:9 film, reframed with subject tracking. Wren makes them the same way, and they land as a Format set of the film.
- **When the master changes,** the set goes out of date ("Master changed · 3 sizes out of date"), with **Update sizes**.
- **Undo:** Make all sizes is a job, so undo never cancels it (4.5); Stop does. Deleting the set is one undo step, as for any node.


### 3.20 The decision tree: History (artboard 15)

**Every project is a `.clan` document.** Its decision chain records every decision made in the project, by people and by the crew:
- **who:** a person, or an agent, named ("Dex", never "the AI");
- **what** changed: the items and fields;
- **why:** the rationale (what was decided, because of what, and what was rejected);
- **when;**
- Jude's checks and their verdicts, asks and their answers (3.17), and picks between versions.

The decision tree is how you read that chain. It replaces today's flat History panel (`ui/History.tsx`, `historyItems.ts`, `HistoryList.tsx`) and follows Brief Maker's pattern of showing decisions with the crew figures and "you".

**Opening it:**
- **History** in the top bar of the canvas and of every editor (3.1) opens it as a right-side panel over the canvas or editor, unfiltered. The surface underneath stays live.
- **"Why does this look like this?"** on any node, frame, take or script line, and the small **why?** beside every who-wrote-it mark (3.10), open the same panel filtered to that item. The panel says so: "opened from 'Why does this look like this?'".
- **Why** on an inline suggestion (3.10) opens the panel at that decision.
- × or Esc closes it.

**The panel** is titled "History · the project's decision chain", with a **List | Tree** switch. Tree is the default when opened from an item. List shows the same entries flat, oldest first.

**Filters** (top of the panel), combined:
- **Item:** Everything, or one item and what it came from: "Script", "Shot 3 · plan", "Frame 3 · Bottle opens", "Clip 3", "@product_bottle", "The ad".
- **Who:** Everyone, You, each person (avatar), each crew member (figure).
- **Kind:** Decisions, Checks, Asks, Picks, each with its count ("Decisions 7 · Checks 2 · Asks 1 · Picks 1").
- **Pinned only.**

**Each node shows:**
- the actor: a person's avatar ("You", "Maya") or the agent's figure (5.1);
- what happened, in one line ("Dex planned shot 3 from the line"; "Skye drafted line 2.1, Maya kept it");
- the time ("10:04") and the kind (decision, check, ask, pick);
- the fields it changed, in mono ("shots[3]: size, angle, lens, prompt"; "shots[3].size: insert → extreme close");
- for a job, the model and what it cost ("Gen-4 Image on Runway · 1920×1080 · $0.08"). This is the one place in the tool a cost appears (principle 4). Every job's cost is recorded, including a failed or refused attempt that Runway billed, which is its own node with its cost;
- for a check, the verdict ("failed · logo_clear_space");
- **Why**, which expands the rationale in place:
  - **Decided:** "An insert on the bottle: high angle, 100 mm macro, static, 2 s".
  - **Because:** "The line names @product_bottle; the fizz is the product moment".
  - **Rejected:** "Medium on Maya · the label would read too small".

**The tree branches with versions.** Each version is a node with its tag (v1, v2, v3). A **Keep both** pick forks the tree: the kept versions sit side by side, one marked "In the cut" and the other "alternate" ("You picked Keep both: v3 goes in the cut", with `frames[3].current: v3` and `frames[3].alternates: [v2]`). A re-plan from a changed script forks the same way.

Artboard 15's example is frame 3, oldest first: Skye drafts the line and Maya keeps it → Dex plans shot 3 (Why expanded) → Wren renders v1 → Jude's check fails it (logo clear space) → you answer Dex's ask "Bigger how?" with Camera → Wren renders v2, camera moved in → Rhea retouches v2 (cuts out the bottle, clears the logo) → v3 patched, Jude passes it → you pick Keep both, v3 in the cut (pinned). On the Storyboard card, frame 3 shows "v3 + v2 kept", Rhea's mark and **why?**.

**Restore this version** sits on every version node.
- Restoring makes that version current again. It is **itself a new decision**, added at the end of the chain with you as the actor. History is never rewritten or deleted.
- It is one undo step, and it marks what the item fed as out of date, as any version change does.

**Pinned decisions.** Any node can be pinned. Pinned nodes carry a "pinned" label, and **Pinned only** shows just them.

**Footer:** "Oldest first · 11 of 214", **Download .clan**, and "Open it with `clan read chain`".

**States:**
- **Empty** (a new project): "Nothing decided yet. Every choice you and the crew make lands here."
- **Loading:** the 64px loader with the learn card leading.
- **Live:** new decisions arrive at the end while the panel is open. A filtered panel shows only those that match.
- **Offline:** the panel shows what was loaded, with "Reconnecting…". Restore is disabled with "Needs a connection".

### 3.21 Sound: the Video editor's Sound view (artboard 10b)

Added 2026-10-14 from the research (`docs/production-tool/audio-and-models-plan.md` and the three documents it draws on). **Sound is chosen per shot, on one shared sound system.** Every shot takes a path; every path feeds the same layers, the same mix and the same checks.
- **No costs anywhere in sound** (principle 4). No path, model pick, take, Redo button, voice, preview, send-tray row, loudness card or export shows a price, credit count or estimate, and choosing a path never mentions what it costs. Every sound job's cost is recorded and shown only in the decision tree (3.20), with the path picks, takes used, voice changes and Jude's checks.
- **No chat** (principle 10). Agents act on the items: Dex's signed line on the shot list, Wren's and Edie's lines on the items they work, Jude's checks with fix buttons, Skye's asks and inline suggestions. The only text boxes belong to an item (a line's words, how to say a take, a cue's description, a voice description).

**The paths:**

| Path | Shown as | Used when | How the sound is made |
|---|---|---|---|
| **Path 1** | "Path 1 · speaks on camera · Veo 3.1 Fast on Runway" | A character speaks on camera in the shot | The clip model speaks the line itself, so the lips match. The clip's own sound becomes the shot's **Native** layer, and its line becomes a line in **Voice**. It can be re-voiced into the character's voice, keeping the timing. |
| **Path 2** | "Path 2 · silent · Gen-4.5 on Runway + layers" | Nobody speaks on camera: action, product, b-roll, voice-over | A silent clip. All its sound comes from layers made on their own, so each can be redone alone. |
| **Path 2 for text shots** | "silent · end card + layers" | The shot is mostly text (end card, tagline card) | No clip is made: a still, with layers. Text never goes to a video model. |
| **Radio** (the research's Path 3) | the **Radio cut** export, not a shot path | You want the ad as a radio spot | The same voices and stems, cut to a booked length, at the radio target (below). |

**How a path is chosen.**
- **Dex picks it per shot,** when he plans the audio from the script's VO and Line rows (3.10). The rule: a shot with an on-screen line gets Path 1; every other shot gets Path 2; a text shot is a still. He signs it under the shot list: "Dex · directs: Maya speaks in shots 4 and 5, so they make their own sound."
- **Dex also picks the model by shot,** from the capability sheet. A product close-up with a readable label prefers Path 2 (the label stays crisp); a robot or a designed character who must stay the same prefers Path 1. He writes which and why into the decision (3.20); the screen shows only the result.
- **You can change it.** Each shot row has a path button. It opens a menu: **Path 1 · speaks on camera** and **Path 2 · silent + layers**, each with its model, and **Why** (3.20). Changing the path:
  - writes the shot's path (one undo step) and marks its clip out of date ("Path changed · new clip needed");
  - remakes nothing on its own. **Remake clip** goes through the send tray as any clip does;
  - **Path 2 on a shot with an on-screen line** says first: "Maya speaks on camera here. A silent clip needs a lip-sync step, or her line becomes a voice-over." with **Lip-sync it** (the tray adds the step), **Make it a voice-over** (the line goes off screen) and **Cancel**.
- **A refused clip falls back per shot,** inside the path (5.5): Veo 3.1 Fast refused, H3 Max on Runway takes it, and Path 1 stays Path 1. A refusal never silently moves a shot to Path 2.

**Where it shows.**
- **Shot list** (left, "Shots and their sound · 2 speak on camera · 4 silent"): one row per shot with its thumbnail, name, length and path button. The selected shot is blue.
- **Picture row of the timeline:** each shot block carries "P1" or "P2" and a motion curve under it (the picture motion that times hits, R5).
- Everywhere else a path is a tag on the shot ("P1"), never a colour alone.

**The layers.** The Sound view's timeline (55px a second at the default zoom, the ad-time ruler shared with Picture) has one lane per layer, top to bottom:

| Lane | Holds | Notes |
|---|---|---|
| Picture | the shots, their path tags and the motion curve | Not a sound lane; it is there to time against. A shot growing shows a dashed extension ("+0.6 s"). |
| Native | each Path 1 shot's own sound, as one block per shot ("Shot 4 · room and Maya") | Silent shots have none ("Silent shots have no shot sound"). Words in it that nobody wrote are muted (R6). |
| Voice | every line, in two sub-rows: on-screen lines (camera icon and `@maya`) and voice-over (`@maya`, or Narrator) | On-screen lines also live inside Native; the Voice item is that line, so it can be redone or re-voiced alone. |
| Effects | hits ("Cap twist", "Glass clink") and beds ("Gulls, far", "Footsteps in sand", "Fizz") | Hits snap to the shot's biggest motion (R5), with dashed snap guides to the peak. |
| Ambience | room tone and loops ("Dawn surf · loop 4 s") | |
| Music | one section per scene, plus the end-card sting | A line on the lane shows where the music dips under speech. |

- **Lane controls,** at the head of every lane: **Mute**, **Solo**, a level slider and its value in dB ("−4 dB").
  - **Level and Mute are part of the mix:** shared, single-value fields (4.4), one undo step each. The mix rebuilds.
  - **Solo is for listening only:** per person, not saved, not part of the mix, and nobody else hears it.
  - A muted lane says "muted" in words, and its blocks fade (artboard 10b shows Ambience muted).
- **Moving things.** Drag a cue, a voice-over line or a music section along its lane (one undo step). An on-screen line can't be dragged off its shot's lips: it moves only with its shot ("On-screen lines move with their shot"). A hit dragged near a motion peak snaps to it; hold ⌥ to place it freely, and the hit is then marked "placed by hand", which R5 leaves alone.
- **Toolbar:** **+ Line**, **+ Effect**, **Snap hits to motion**, **Rewrite music to the cut**, the open-checks count ("2 checks to look at") and zoom.
  - **+ Line** adds a line at the playhead; you pick the speaker and on or off screen, and type the words. It is the same line as in the script's AV rows (3.10).
  - **+ Effect** adds a cue at the playhead; you describe it ("glass clink") and pick hit or bed.
  - **Snap hits to motion** moves every hit that isn't placed by hand onto its shot's biggest motion (one undo step).
  - **Rewrite music to the cut** has the music written again from the finished picture ("music from the cut"), section by section. It goes through the send tray.

**Takes.** Every line, cue and music section has its own takes (v1…vN), as a shot has. The mix is always rebuilt from whichever take is **In the mix**; it is never edited by hand.
- **Selecting an item** opens its panel (right column): what it is ("Line · shot 4 at 0:03.1 · On screen · @maya says, lips synced, from the shot's own sound"), the player looping it (**Loop this line**), and its takes.
- **Each take** shows how it was made and its timing: "v1 · as shot, Veo's voice · 1.25 s · with the clip"; "v2 · redone, brighter · 1.25 s · same timing"; "v3 · redone, softer · In the mix". **Use** puts a take in the mix (one undo step; the mix rebuilds). Older takes are never deleted.
- **A line that came with a Path 1 clip** has v1 "as shot". Using another clip take (3.13) brings that take's line in as a new line take.

**Redoing one line, cue or section.** Only the selected item is remade. Nothing else in the mix changes.
- **Redo this line** (the panel's primary button) makes a new take of the line in the same voice. A short text box beside it takes how to say it ("brighter", "slower, a smile in it"); it belongs to the line, not a conversation (principle 10). On-screen lines keep their timing exactly, so the lips still match; voice-over lines may come back a little longer or shorter, and the checks below run on the result.
- **Re-voice to Maya's voice** (on-screen lines from a Path 1 shot) turns the clip model's voice into the character's own voice, speech to speech. It keeps the timing to the hundredth of a second: "Both keep the timing, so her lips still match."
- **Redo this cue** remakes an effect or ambience from its description, which you can edit first. A hit keeps its place on the motion.
- **Redo this section** remakes one music section and blends it into the sections on either side. The rest of the music stays.
- Each goes through the send tray (3.16), collapsed to one line by default. **Wren · renders** makes the take (her figure and the create loader on the item); then **Edie · edits** rebuilds the mix (produce loader, top-bar pill "Edie · edits: mixing your changes into mix v4").
- **Words changed in the script** mark the line out of date ("Words changed · redo this line"). It keeps playing the old take until you redo it.

**Character voices.** Every character has one voice, used for every line it says, in every shot and in the radio cut (3.22). A voice-over by nobody on screen uses the project's **Narrator** voice. A line's speaker is set in the script (3.10) or in the line's panel. Changing who says a line marks it out of date.

**Jude's checks: the coherence rules R1–R6.** They come from the hackathon remakes, where they took lines heard from 0.06–0.43 to 0.73–1.00 with no voice overlap. Edie builds every mix by them. Jude checks the mix after each change and lists what breaks in the **Jude · checks** card ("2 to look at"). Each check is a quiet line with the fix as a button, plus **Show** (seeks and selects). When everything passes, the card says so in one line: "Hits on the motion. No stray words."

| Rule | Jude checks | Says when it breaks | Fix (one undo step, then the mix rebuilds) |
|---|---|---|---|
| **R1 Dialogue sets the shot length** | A shot with a line runs at least to the end of the speech plus 0.25 s. The last spoken shot also leaves room for the tagline. | "Line runs past the shot: shot 4 grows 0.6 s" | **Grow it, shot 1 gives 0.6 s**: the dialogue shot grows and the time comes from a neighbouring action shot, so the ad keeps its length. It never shortens the line. If the clip has no spare frames, the fix says "Shot 4 needs a longer take" and goes through the send tray. |
| **R2 Every on-screen line is lip-synced** | Each on-screen line is on a Path 1 shot, or has a lip-sync step. | "Maya speaks in shot 2, but nobody's lips move" | **Make it Path 1**, **Lip-sync it**, or **Make it a voice-over**. |
| **R3 One voice at a time** | No two voices overlap. The tagline goes after the last line and may be sped up by at most 15% to fit. | "Two voices overlap at 0:12" | **Start the tagline after her line**. If it can't fit even sped up: "The tagline doesn't fit after her line. Shorten a line or grow the end card." |
| **R4 Speech comes first** | No vocal effects (sighs, laughs) on a line; under speech, effects dip 8 dB and music 12 dB, and shot sound dips under any voice-over; every word of every line can be heard. | "2 words of the tagline are hard to hear under the music" | **Dip the music more**, or **Show**. |
| **R5 Hits land on the picture** | Each hit's loudest moment sits on the frame with the most motion in its shot. | "Cap twist is 0.4 s off the motion" | **Snap it to the motion**. Hits placed by hand are left alone. |
| **R6 No stray words** | Words in a shot's own sound that nobody wrote are muted, and that shot gets our effects instead. | (said, not asked) "Shot 3's own sound had words nobody wrote. I muted them and used our effects." | **Hear them**, and **Keep them** if they were wanted (recorded with who kept them). |

- **Checks never block.** You can render and export with checks open; the Export menu and the render's done line say how many ("2 checks to look at"). Keeping something a check flagged is recorded on it, with who, as brand flags are (3.18).
- **What is applied without asking:** the dips under speech (R4) and the muting of stray words (R6) are how Edie builds every mix, and R6 is always said where it happened (principle 3). Fixes that change a shot's length, path or timing (R1, R2, R3, R5) are buttons; nothing moves until you press one (principle 5).
- **Words heard** are said in words, never as a score: "Every word of 'It's perfect!' is heard", "2 words are hard to hear".
- **Jude can't judge lips on a drawn face.** The lip-sync check reads real faces only. On a stylised or cartoon character it says "I can't judge lips on a drawn face. Watch shot 4 yourself.", with **Looks right**.
- **Picture changes reach the sound.** A patched take (3.13), a new clip take or a grown shot re-runs the checks for that shot.

**Loudness.** The **Mix** card (right column) holds Edie's working figure and line, the **Loudness target** picker and the meter.
- **Targets** (a radio group): **Online −14 LUFS** (the default), **TV −23 LUFS** (true peak −1 dB, EBU R128), **Radio −18 LUFS** (or the station's own figure, below). The target sets the preview mix and Render ad; each export item has its own fixed target.
- **The meter** shows the whole ad's loudness ("−14.2 LUFS, whole ad"), its true peak ("−1.4 dB true peak"), a short-term bar with the target marked, and a pill: "On target" (ok) or "1.2 dB too loud" (warn).
- **Under speech** lists the dips as levels per layer: "Effects −8 dB · Ambience −6 dB · Music −12 dB". Each can be changed (a single-value field, one undo step).
- Edie normalises every export to its target and measures it. If a file misses its target after that, it is not delivered as on target: its report says "Measured −14.9 LUFS, target −18", in warn.

**Export menu** (Video editor top bar). No item shows a price or a size estimate.
- **Film for online** · "MP4 · −14 LUFS".
- **TV master** · "−23 LUFS · true peak −1 dB".
- **Stems** · "One file per layer".
- **Cue sheet** · "Every line, cue and section, with times". Its shape is Napkin Radio's manifest (`assets`, `clips{track, startSec, durationSec}`) plus a native track, so it opens in Radio as it is.
- A divider, then **Radio cut (Napkin Radio)** · "30 s, same voices and stems · −18 LUFS".
- Each export lands as a download with a loudness report beside it (target, measured loudness, true peak, length). The report says plainly when a check failed ("Length: 31.2 s, booked 30 s").

**Radio cut.** One brief gives a film and a radio spot with the same voices.
- **Radio cut** opens a sheet: booked length (**20 s** or **30 s**), the station profile (a list; "Confirm with the station" under it, as out of home says for media owners), and **Make radio cut** (primary).
- It is built from the same voices and stems, edited to the booked length. Layers are cut to the length before mixing, so the file is never longer than booked.
- **Lines that only work with the picture** ("It's perfect!" with no smile to see) are raised by Skye as an ask on the radio cut (3.17): "Shot 4's line needs the picture. Keep it, cut it, or let me write a line for radio?". When the booked length is longer than the ad, Skye drafts the extra words in place as an inline suggestion (3.10), with Keep, Keep mine and Why.
- The voice lines go through the send tray; the mix and the loudness pass are Edie's (produce loader). The result lands on the Video node as "Radio cut · 30 s · v1", plays on the phone (3.14), and is listed in Export.

**States:**
- **No sound yet** (clips made, no audio plan): the lanes show "Dex hasn't planned the sound yet", with **Plan the sound** (primary). Planning is free; the takes it needs go through the send tray as one batch, expanded.
- **Partial:** items not made yet show the pending stripes in their lane ("Music · section 2 coming"). The mix plays what exists.
- **Mixing:** the top-bar pill and Edie's working figure in the Mix card. The player keeps playing the last mix until the new one lands.
- **ElevenLabs unavailable:** see 5.5. Lanes still edit and the mix still rebuilds from existing takes.
- **Offline:** levels, mutes and moves queue as edits (4.6); Redo buttons are disabled with "Needs a connection".
- **iPad:** the right column becomes a sheet below 1180px; lane controls are 44px; drag with finger or Pencil.

### 3.22 Character voices (artboard 13b)

**A voice belongs to a character.** It lives on the character's card, in the **Voice** tab, beside Views, Wardrobe and "Used in · 6". The card opens from the Assets drawer (3.18) or from any `@maya` (More → **Open card**). **Why this voice?** opens the decision in the decision tree (3.20).

**Current voice strip:** play, "Aoife v2 · designed from a description", a waveform, and "Hear her say 'To the first light.'" (a line from this project) with **Play**.

**Three ways to change the voice,** side by side. Whichever made the current voice is marked "Maya's voice came from here".
- **Pick from the library:** a search box, filter pills (accent, gender, age, use: "Irish", "Woman", "30s", "Narration", "Conversational"), and voices, each with **Play** and **Use**.
- **Design one from a description:**
  - a description box ("A warm Irish woman, mid thirties…"), 20 to 1,000 characters, with its counter ("146 / 1,000");
  - an audition text box, 100 to 400 characters ("158 · 100 to 400"), pre-filled with the character's own lines;
  - **Make 3 previews**, the screen's only primary button. It goes through the send tray. Rounds are numbered ("round 2"), and earlier rounds stay listed;
  - three previews, each with Play and **Use**; the one in use says "In use";
  - Jude listens to each round and says which previews say the brand names right: "Jude · checks: I listened to all three. Only 2 keeps the accent on 'Lumen'."
- **Clone from a sample:**
  - a sample file ("maya_read_take3.wav · 1:24 · 1 to 2 minutes works best");
  - **Whose voice is this?**, the speaker's name, required;
  - a consent checkbox, unticked by default and in warn until ticked: "I have this person's written agreement to clone their voice for this work";
  - **Attach the signed form** (optional);
  - **Clone voice**, disabled until a name is given and the box is ticked: "Tick the agreement first."
  - A cloned voice shows "Consent on file" wherever it is listed, and the decision records who ticked it and when.

**Everywhere Maya speaks.** The card lists every line the character says, with its shot and whether it is on camera: "Shot 1 · voice-over", "Shot 4 · 'It's perfect!' · on camera", "Shot 5 · 'To the first light.' · on camera", "Radio cut · 30 s".
- **Changing the voice remakes every one of those lines** in the new voice, the radio cut included. The pictures stay.
- **Re-voice her on-camera lines into Aoife** (ticked by default): on-camera lines are turned into the new voice speech to speech, so the timing and the lip sync hold. Untick it to keep the clip model's own voice on screen.
- Use opens the send tray expanded, as a batch (5.4): one row per line, each can be unticked. Nothing changes until Generate. The voice field itself is one undo step; the new takes stay in each line's takes if you undo.

**Say brand names right** (the pronunciation list). One list for the whole agency, used by every voice.
- Each entry has the word, how to say it (a respelling, "LOO-men", or IPA, "/vɔːr/"), a note of how it was misheard before ("was said 'Veltor'"), and **Test**, which plays it in this character's voice.
- **+ Add a word** takes the word and a spelling or IPA.
- **Changing an entry** marks every line that says the word out of date ("Lumen changed · 3 lines to redo"), with **Redo them** (send tray, batch).

**Who it belongs to** (a radio group): **This project only**, **Lumen Water shelf** (the default), or **All of Napkin Studio**. Below: "Designed by Shrey · 13 Oct · v2". A voice on a shelf is shared like any library item (3.18, 4.8): a new version replaces the old one for everyone, and projects keep their copy until Update.

**States:** making previews shows Wren working on the previews column (create loader); a voice that can't be made says why in plain words ("ElevenLabs couldn't make a voice from this description. Say more about the voice."); offline, Use, Make 3 previews and Clone voice are disabled with "Needs a connection".

---

## 4 Collaboration

### 4.1 Presence

- **Top bar:** avatars and a line ("Sai and Maya are here", or "Sai is in shot 2 · Maya is reading" in an editor). Each person has a fixed colour for the project. Initials always show, so colour is never the only cue.
- **Canvas:** live cursors with name tags, and selection outlines in the person's colour ("Maya · selecting"). These layers are never dimmed or hidden by tool states.
- **Text:** in editors, a collaborator's caret and name label show where they type.
- **Phone:** only "who is editing". There are no cursors.

### 4.2 Following

- Clicking an avatar follows that person: your viewport tracks theirs, or your editor opens where they are. A pill reads "Following Sai · Esc to stop".
- Any pan, zoom or edit of your own stops following.

### 4.3 Who started a job

- Every job records `started_by` and shows it to everyone else: "started by Sai". Your own jobs say "started by you" only in the busy pointer's label.
- **A job belongs to its starter.**
  - Its cost is recorded against the starter in the decision tree (3.20). No budget line shows on the job.
  - Anyone can stop it, but stopping someone else's job asks first: "Stop…" opens "Maya started this. Stop it anyway?"
- **Pressing a button whose job is already running** (same node, operation and inputs) starts nothing. The button shows "Running, started by Maya" (in-flight dedupe).
  - **Another take** is never deduped, because it sends a client nonce.

### 4.4 Conflicts

- **Shared live text never conflicts.** Script body, shot action, direction, beat text, dialogue and note text are shared live text: both people type at once and see each other's carets.
- **Single-value fields** (camera fields, duration, names, roles, ratio, window edges, the selected take or version, a shot's path, a lane's level and mute, the take in the mix, the loudness target, a character's voice):
  - Concurrent changes to different fields both apply.
  - When two changes to the same field cross, the field shows a conflict notice to the person whose change lost: "Sai changed this field while you were typing", with both values side by side.
  - **Keep yours** (ink, the default) re-applies your value. **Take Sai's** accepts theirs. Nothing is overwritten until you choose.
  - Artboard 12 draws this on shot action, which is shared live text. The example moved to a single-value field (redraw R3, done).

### 4.5 Undo is per person

- **⌘Z / Ctrl+Z undoes your own last step**, never someone else's. ⇧⌘Z or Ctrl+Y redoes.
- **One user action is one step,** even when it writes several things. Examples:
  - Make video;
  - Apply in any editor;
  - Convert ink (Keep);
  - a reorder;
  - accepting a Skye suggestion.
- **If someone changed the same thing after you,** your undo of that step is skipped with a notice: "Sai changed this after you, so undo skipped it." Undo then moves to your next step.
- **Not undo steps:** answering an ask (use Change, 3.17), sending from the tray (use Stop), publishing to the team library (publish again).
- **Undo never cancels a running job** (that is Stop) and never refunds money. Undoing the step that used a paid result puts the previous version back as current. The paid version stays in Versions or Takes, and the toast says "v2 is back. v3 stays in Versions."
- **Inside a text field,** ⌘Z belongs to the field's own history first (today's `ui/undoKeys.ts` rule).
- **The canvas's own Excalidraw undo is bypassed.** Its buttons are hidden, and the house Undo and Redo replace them (plan 2.6).

### 4.6 Offline

- **Banner:** a warn pill with a still loader reads "Reconnecting… your changes are kept", with **Try now**.
- **Edits** are queued locally and replayed on reconnect.
- **Paid buttons** are disabled while offline, with "Needs a connection".
- **Jobs that were already running** continue on the server and land when you reconnect.
- **On reconnect,** queued edits that conflict get the 4.4 notice.
- **Asks** can't be answered offline; their options are disabled with "Needs a connection".

### 4.7 Shared asks

- **Any collaborator in the project can answer any ask** (owner confirmed 2026-10-13). History records who answered and what they chose.
- Someone typing an answer shows as "Sai is answering" on the card. The first answer wins; the rest is in 3.17.
- The person whose job raised the ask is still its starter: its cost is recorded against them.

### 4.8 The team library is shared across the agency

- Library shelves are per client and shared by everyone in the agency (3.18). Publishing a new version replaces the old one in the library for everyone at once.
- Projects never change under you: each keeps its copy until someone in it presses Update.
- Two people publishing the same item at once: the second gets "Maya published v5 a moment ago. Publish yours as v6?"

---

## 5 Jobs and the crew

### 5.1 The crew, and who appears for which work

Five make the ad; two house agents, who work in every Napkin tool, read and check. **Names echo the work**, as the house agents' names do (Ellis reads, Jude checks). The renames of 2026-10-13: Wren · renders was Kai, Skye · scripts was Wren, Rhea · retouches was Tess, and Edie's sign-off is "edits" (was "cuts"). Older artboards or notes that use the old names are wrong.

| Agent | Sign-off | Figure | Appears for | Where |
|---|---|---|---|---|
| Dex | Dex · directs | cobalt hex, viewfinder mark | planning shots, writing prompts (with brand rules), the send tray, camera changes, Bridge, condensing direction, asks about planning and direction; each shot's sound path and the sound plan | Storyboard node and editor, camera fields, the insert menu, the send tray, the Sound view's shot list |
| Skye | Skye · scripts | coral column, page mark | script drafts (including from a spin-in), rewrites, length fixes, asks about unknown names; looking up looks and references; lines and voice-over, the radio cut's words | Script node and editor (drafts in place, the VO column), References board, the radio cut |
| Wren | Wren · renders | marigold star, spark mark | Runway making a frame or clip, Make all sizes, video cut-downs, asks about renders; voicing lines and making every sound take and voice preview | empty frames and clips, Video board, Format sets, jobs, the Sound view's lanes, the Voice tab |
| Rhea | Rhea · retouches | mint dome, dots mark | cut-out, fill, change whole frame, upscale, character-sheet crops | Image editor, character sheets |
| Edie | Edie · edits | iris stack, bars mark | splicing moments, rendering the ad; **mixing**: building the mix from the takes in it, the dips under speech, hits snapped to motion, muting stray words, loudness to target, stems, cue sheet and the radio cut | Video editor timeline, patch windows, the Sound view's Mix card and job pill, phone player |
| Ellis (house) | Ellis · reads | ink triangle, page mark | reading notes and handwriting, extracting text from files, briefs, brand books and documents; **writing down what a shot's own sound says**, which Jude's word checks use | ink, notes, Convert to text, Brand board, Document nodes, the send tray's "confirm" rows |
| Jude (house) | Jude · checks | ink card, tick mark | checking each result, seams, retries, brand-rule breaks (per size in a Format set); **the sound checks R1–R6**, lips on dialogue shots, brand names said right in voice previews | check marks and brand flags on frames, clips and sizes; the Sound view's checks card; voice previews |

**Who does the sound** (3.21, 3.22). No new crew member is added; the sound work is spread over the crew by what each already does:
- **Dex · directs** picks each shot's path and model and plans the sound: the lines with their speakers, the cues, a music brief per scene.
- **Skye · scripts** writes the lines and the voice-over, and the radio cut's extra or replacement words, in place.
- **Wren · renders voices the lines** and makes every sound take: lines, re-voicing, effects, ambience, music sections, voice previews. In the Sound view her signed line names the line ("Wren · renders: saying 'It's perfect!' softer").
- **Edie · edits mixes.** She never makes a take; she builds and measures the mix.
- **Ellis · reads** writes down the words in a shot's own sound; **Jude · checks** runs R1–R6 on them and on the mix.

**Open question for the owner:** should sound get its own crew member, for example a "voices" agent who voices the lines, designs the character voices and keeps the pronunciation list, in place of Wren for sound? It would need a name that echoes the work, a shape and colour that fit the crew, and a loader department (sound would most likely lead with create). Until the owner decides, Wren voices and Edie mixes.

**The figures are the house figures** (artboard 13), the same design language as the agents in every other Napkin tool:
- A flat, bold body in the agent's shape and colour, thin ink legs with feet, a ground shadow, two pill eyes and one mark.
- **Rendered from the shared `AgentFigure` component** (`production-tool/web/src/ui/agents/AgentFigure.tsx`, with the house figure CSS). Never redrawn by hand and never simplified into shapes, dots or initials.
- **Three states:**
  - **Idle:** a slow bob, the odd blink.
  - **Working:** leans in, steps, motion lines.
  - **Needs you:** a speech bubble with "!", in brand orange, the one colour that means a person is needed.
- **Sizes:** 20–24px inline next to a signature; 28–36px in job cards and ask cards; 64–96px on the crew sheet.
- **Signed lines** follow the house pattern: a small speech bubble, the signature in mono ("Skye · scripts"), first person, short ("I tightened scene 3 so the ad fits 15 s.").
- **The crew's colours belong to the figures only.** The loader never uses them (section 6).
- **The figure says who. The loader says which department of work is running.** The two are separate signals.
- **This crew replaces today's three-member `ui/agents/cast.ts`.** Today Dex is shown for every make. In the new crew, Wren is shown while Runway renders.

### 5.2 Asking (needs_input)

- **When an agent needs an answer,** its job enters `needs_input`. Its node and the jobs list show the agent figure in its needs-you state (the "!" bubble), and the ask card opens on the node (3.17).
- **Answering** resumes the job and is recorded as a human write (`by: human:<id>`), appended to History. Anyone in the project can answer (4.7).
- **A job waiting for an answer is not working:** no loader shows for it, and the busy pointer does not show for it.
- **It never times out into a guess.** It waits until someone answers or stops it.
- Section 3.17 has the shape, the three kinds of ask, the card and the questions pill.

### 5.3 Job states and their copy

Job states extend `JOB_STATES` in `contracts/types.ts` with `needs_input`. "Refused" is `failed` with a moderation code.

| State | Card pill | Line (exact copy, values vary) | Actions | Charged (recorded in the decision tree, never said on the card) |
|---|---|---|---|---|
| queued | In the queue | "In the queue, 2 ahead · about 1:30" | Cancel | no |
| submitting | Sending | "Sending to Runway…" | Cancel | no |
| submitted / fetching | Rendering | "Wren · renders · about 0:40 left" (progress bar when Runway reports it) | Stop | yes, when it completes |
| validating | Checking | "Jude · checks @maya matches" | — | — |
| needs_input | Waiting for you | the agent's question | the options · Later | no |
| completed | Done | "Checked by Jude · 1 min ago" | Download · Open | Runway's cost.credits, recorded |
| failed | Failed | "Runway is busy. Try again." (the reason in plain words) | Retry | what Runway bills, recorded silently (no wording) |
| failed (moderation) | Refused | "Runway refused this picture. Change the words or the picture." | Change the picture · Edit the words | what Runway bills, recorded silently (no wording) |
| uncertain | Unsure | "Checking with Runway…" | — | never paid twice: reconciled by task id, never resent blindly |
| cancelled | Stopped | "Stopped by Maya." | Make again | what Runway bills, recorded silently (live check b, 12.2) |
| (take) patched | Patched | "Edie · edits · 2 s replaced" | Compare | yes |
- **Shared jobs** add "Started by Maya" with her avatar.
- **No cost and no charge wording on any card.** A failed or refused attempt that Runway bills is charged and recorded, with its cost, in the decision tree (3.20). The card says only what happened and what to do.
- **Errors** say what happened and what to do, never a code alone. The code is in smaller mono under the message, as today's `.errnode .code`.

### 5.4 Spend: recorded per job, shown only in the decision tree; caps built but off

Owner decision 2026-10-13 (fourth round). It supersedes the earlier prices on buttons, the $2.00 confirm and the cap warnings.

- **No prices in the UI.** No button, menu, model pick, send tray, toast, job card, ask, format size, warning, or admin or tenant view shows a price, an estimate, a credit count or a cost line. A button names its action only: "Make 6 clips", "Bridge", "Fill area".
- **Every job records what it cost,** from the relay's report, against the job and its starter. The decision tree (3.20) is the only place that shows it: each job node there may show its cost.
- **Where the cost comes from.** The relay prices each job from the capability sheet (`capabilities/runway.json`, computed by `contracts/pricing.py` at the job's own settings), reserves that, and records what Runway confirms on the job.
- **Failed or refused attempts that Runway bills** are charged and recorded in the decision tree like any other job. The UI says nothing about charges: no "Not charged", no "may still be charged".
- **The send tray is the confirm before anything goes to Runway** (3.16), without prices. It opens collapsed to one line by default. It opens expanded for any batch (more than one Runway job at once: Make clips, Make all sizes, Render ad with remakes, Update shots with frames), so each item can be seen and unticked. Expanded for a batch it reads "Make 6 clips", with the line "6 clips × 3 s · Veo 3.1 Fast on Runway". The buttons are **Cancel** and **Generate** (primary). Nothing forces it open because of cost.
- **Caps are built but off.**
  - The monthly per-tenant cap exists and is switched off. Each agency chooses its own cap later, at its own request; Napkin staff set it with a script for now (features/tenant-limits.clan builds the machinery; this replaces D16's "Napkin sets, admins only lower").
  - While it is off there is no cap line, no 80% warning, no confirm above an amount, no "left this month" and no "Monthly limit reached". When an agency switches its cap on, its copy is designed then, under the no-prices rule.
  - Until then, an agency at a cap it chose gets one plain line on the job that was refused, with no amount: "Your agency's monthly limit is reached, so nothing new can be made this month." (`limit_reached`; no other model, no Report). A job already running settles at what Runway charged.
- **Per-person daily quotas:** the mechanism is kept and switched off. The relay keeps counting each person's day, and enforces config.json's quotas only for an agency that asks for them. No quota shows anywhere.
- **The global spend stop** stays on as an invisible safety backstop. It has no UI of its own; if it ever trips, a job fails with a plain reason and no amount (5.3).
- **The per-ad cost model** behind any cap an agency picks is `production-tool/contracts/cost-model.json` (typical first pass $10.89, with 3 takes $27.69, with audio $18.09, audio and takes $49.29, heavy $88.63 at 2026-10-13 list prices; `docs/production-tool/provider-reference.md`). It is reference data, never shown in the UI.
- **Admin and tenant views** show no spend, cost or cap figures. Costs are read per project in its decision tree.
- **Free and on-device work** never asks.

### 5.4a Data sharing and the agency's allowlist (features/tenant-limits.clan)

- **Where material goes is the agency's to choose.** Each agency has an allowlist: Claude (the director and the character cards) on or off, and the makers whose models may run. By default Claude, Runway and Google are on; every other maker is off until the agency asks. Napkin staff change it on the agency's request; there is no admin control in the tool yet.
- **Models that are off are not offered.** The model menus list only allowed models. A step with no allowed model left loses its controls. When an op's default model is off, its first allowed alternate runs instead, without a word (it is the agency's own setting).
- **Claude off:** Dex directs without Claude (the words go as written), no character cards are made, and Plan shots is refused with "Dex plans shots with Claude, which your agency has turned off."
- **A refusal** a stale page could still send reads "<Model> is made by <Company>, which your agency has turned off. Pick another model." or "Your agency has turned off every model that can make this step." (`not_allowed`; no other model, no Report).
- **The Data sharing sheet** opens from Home's ⋯ menu. One row per company in `contracts/subprocessors.json`: its name, what it does, what it receives, what carries the material to it ("Through Runway"), where it processes it ("not yet confirmed" until a source confirms it), and an On or Off pill for this agency. The foot reads "To change what your agency shares, ask Napkin. Turning a company off also turns off the steps only its models can make." It shows no prices, costs or limits. `subprocessors.md` is the same list for a contract.

### 5.5 Fallbacks

- **Fallback for pictures stays inside Runway's models.** Runway makes every frame and clip in this overhaul. Sound adds ElevenLabs (3.21), and Runway is its floor: a sound job never fails because ElevenLabs is down.
- **When ElevenLabs can't make a sound take,** Wren makes it on Runway's ElevenLabs models and says so:
  - Lines: "ElevenLabs didn't answer, so I voiced shot 1's line on Eleven v4 on Runway in a stand-in voice. Redo it when ElevenLabs is back." The take is marked "stand-in voice", because a character's designed or cloned voice lives on ElevenLabs.
  - Effects and music: made on Runway's sound models, with the same kind of line and a "Made on <model> on Runway" chip.
- **When the chosen model can't make something,** the relay makes it on another Runway model and says so:
  - A toast reads "Veo 3.1 on Runway couldn't make clip 4, so we made it on Gen-4 Turbo on Runway. Napkin's got you." It closes after 9 s, as today's `FallbackNotices.tsx` does.
  - The card keeps a "Made on Gen-4 Turbo on Runway" chip whose hover gives the reason.
- **A passthrough, a crop or a condensation** is said where it happened (sections 3.7, 3.11, 3.10).

---

## 6 The loader and the busy pointer

This replaces today's `.spinner` (a grey ring with an orange top, `styles.css:231`) everywhere. **The loader is the Napkin logo itself, at work** (owner decision 2026-10-13, artboard 14). It replaces every earlier loader in this spec: the sector sweep, the crew-tone colours and the collapse-and-reform loop are all gone.

### 6.1 The logo, and only its colours

- **The logo** (`ui/Mark.tsx` StudioMark): a disc of four quadrant cards, turned −45°. Each card sits at its own place in the logo: **create** #FF4F2E (top), **produce** #8B919E (right), **learn** #DADDE3 (bottom), **plan** #14161B ink (left).
- **The loader only ever uses these four colours,** from the same `--create`, `--produce`, `--learn` and `--plan` tokens the logo uses, so it follows the theme exactly as the logo does. It never uses an agent's colour (5.1).
- **A centre pin** (an ink dot with a white ring) is the axis everything turns on. It is always visible while the loader runs.
- The cards are painted back to front, so the leading card is always on top and each card behind lies under the one ahead of it.

### 6.2 The loop (4 s, all clockwise)

| Time | What moves |
|---|---|
| 0–0.2 s | Only the pin and the leading card show. |
| 0.2–1.7 s | The leader revolves 270° clockwise round the pin. The other three cards fan out behind it, one after another, each sliding out from under the one ahead, until the circle closes into the logo. |
| 1.7–2.7 s | The whole logo spins one turn clockwise round the pin. |
| 2.7–4.0 s | The cards fold back, each sliding under the one ahead, until only the leader is left. Then the loop repeats. |

- The trailing cards follow the leader in the logo's fixed order, counter-clockwise from it, and each lands at its own place in the logo.
- The CSS is the `napkin-loader` block in artboard 14, copied as is; only width, height, `data-work` and `data-state` change.

### 6.3 Which card leads: the department of the work

The leading card says what kind of work is running. The trailing cards are always the logo's other three.

| Leading card | Department | Kinds of work | Usually |
|---|---|---|---|
| Orange #FF4F2E | create | generating, rendering frames and clips, retouching, voicing lines and making sound takes and voice previews | Wren · renders, Rhea · retouches |
| Ink #14161B | plan | planning, directing, scripting, planning the sound and paths | Dex · directs, Skye · scripts |
| Light grey #DADDE3 | learn | reading, researching, checking, writing down a shot's own sound, the sound checks | Ellis · reads, Jude · checks, Skye when she looks things up |
| Grey #8B919E | produce | editing, rendering the ad, mixing, loudness, the radio cut, all sizes, exporting | Edie · edits; Make all sizes and cut-downs; exports |

- **The department follows the work, not the agent.** Skye scripting leads with plan; Skye researching leads with learn. Make all sizes leads with produce even though Wren makes the sizes.
- **Colour is never the only signal.**
  - From 32px up, the agent's figure and line or a title always sit next to the loader.
  - At 14px and 20px, the words come from the hover or focus label, a toast, or the nearby status line.
  - The light grey learn card is faint on white, and ink is faint on the dark theme. The words beside the loader carry the meaning; the pin keeps the shape readable.
- **The loader is the brand mark, not a button.** Its create card stays brand orange #FF4F2E. Primary buttons use #D63B1F (section 9).

### 6.4 States

| State | The loader |
|---|---|
| Running (submitting through validating) | The 4 s loop, with the department's card leading. |
| Uncertain ("Checking with Runway…") | The loop with the learn card leading. |
| Queued | The full logo, still. No card leads, because no work has started. |
| Finish | The full logo, still, for **0.6 s**. It snaps to the full logo from wherever the loop was, with no glide. Then the node or card shows its done state. |
| Needs you (`needs_input`) | No loader. The agent's figure shows its needs-you bubble (5.2). |
| Offline banner | The full logo, still, inside the warn pill (4.6). |

### 6.5 Sizes and places

| Size | Where | Next to it |
|---|---|---|
| 14px | busy pointer badge; presence cursors | hover-hold label |
| 20px | status pills, toasts, crew status lines, frame and clip badges, inline lines ("Making frame 3") | the line |
| 32px | job cards, node status, the masked area in the Image editor | the agent's figure and sign-off, time left, Stop |
| 64px | a page or panel loading for the first time | a title |

- **Accessibility.** Loader SVGs are `aria-hidden`. The words beside them live in a `role="status"` `aria-live="polite"` region ("Wren is making frame 3"). On iPad, a loader on a node has `role="img"` and a label such as "Wren is making frame 3".

### 6.6 Reduced motion

There are two triggers:
- the system's `prefers-reduced-motion`;
- the app's own **Reduce motion** setting, in the account menu (per person, stored locally). It sets `data-motion="still"` on the app root.

Either one switches every loader to the full logo, still, with only the leading card pulsing in opacity (1 → 0.45 → 1 over **2.4 s**). The finish is the still logo with no pulse. Reduced motion also stops the pending stripes and the board-jump animation. Legend and swatch loaders are always flat (`nl-flat`: the full logo, still, no pulse).

### 6.7 The busy pointer

- **When it shows:** while at least one job **you started** is running (submitting through validating, or uncertain), and through its 0.6 s finish, on the canvas and in every editor.
  - It does not show for `needs_input`; the figure's needs-you bubble shows instead.
  - It does not show for other people's jobs.
- **What it is:**
  - The system arrow stays exactly as it is, so precision and every pointer type are kept.
  - **The same loader,** 14px, on an 18px white disc, at the arrow's lower right, offset (+11, +15) px.
  - It is a DOM element with `pointer-events: none`, positioned with `transform` on `pointermove` (CSS cursors can't animate).
  - `cursor: progress` is the fallback when the element can't render.
- **Several jobs at once:** the badge leads with the department of your most recently started job, with a small count when more than one is running ("2").
- **Label:** after the pointer is still for 0.6 s, or on keyboard focus of the badge's status, a dark pill appears: "Wren is making frame 3 · started by you". It hides on the next move.
- **It hides:**
  - during a pen stroke, a drag, a port drag or brush painting, and reappears on release;
  - when the pointer leaves the window;
  - on touch devices, which have no cursor. On iPad the loader shows on the node or frame being worked on.
- **Presence cursors** carry a 14px badge led by the department of that person's own running job, with "Sai is planning" in its label.
- **Phone:** no pointer. The loader appears in the player and the notes list only.

### 6.8 Embedding

One SVG pattern, `<svg class="napkin-loader">`, copied verbatim from artboard 14. Only `width`, `height`, `data-work` and `data-state` change.

- **`data-work`** picks the leading card:
  - `create` (the default): also `generating`, `rendering`, `retouching`, `voicing`;
  - `plan`: also `planning`, `writing`, `directing` (Skye's scripting uses `writing`);
  - `learn`: also `reading`, `researching`, `checking`;
  - `produce`: also `cutting`, `producing`, `exporting`, `sizes`, `mixing`.
- **`data-state`:** `run` (the default, the loop), `finish` (the full logo, still; hold it 0.6 s, then show the done state), `queued` (the full logo, still).
- **`data-motion="still"`** on any ancestor gives the reduced-motion form (6.6).
- **`nl-flat`** class: the full logo, still, no pulse, for legends and swatches.
- **`nl-at`** class with `style="--nl-at:-1.2s"`: a paused poster frame at that point of the loop, for artboards and docs.

## 7 Keyboard map

⌘ on macOS, Ctrl elsewhere. ⌥ is Alt. Letter tools work only when no text field has focus. ⌥+digit is read from `event.code`.

| Where | Keys | Does |
|---|---|---|
| Everywhere | ⌘Z / ⇧⌘Z (Ctrl+Y) | Your undo / redo (4.5) |
| Everywhere | ⌘[ / Ctrl+[ | Back (same as the back button) |
| Everywhere | Esc | Closes the innermost popover, menu or preview; stops a drag; stops following |
| Everywhere | ⌘K / Ctrl+K | Find: boards, nodes, shots, references by name |
| Canvas | ⌥1…⌥9, ⌥0 | Jump to board N; fit everything. With the Assets drawer open, ⌥1…⌥9 still jump and ⌥0 also brings the rail back |
| Canvas | V H P T S B L | Select, Hand, Pen, Text, Sketch area, Board, Link |
| Canvas | Enter | Open the selected node's editor |
| Canvas | ⌘G / ⇧⌘G | Group / ungroup (Excalidraw groups) |
| Canvas | Delete / Backspace | Delete the selection (asks if a job is running) |
| Canvas | Tab / ⇧Tab | Move focus between nodes; with L pressed, between compatible link targets |
| Canvas | ⌘+ / ⌘− / ⇧1 | Zoom in / out / fit |
| Canvas | Esc with a generating node selected | Ends the scope focus (3.16) |
| Questions pill | Tab to it; Enter, or ‹ › buttons | Go to the next or previous open ask (3.17) |
| Ask card | Tab, Enter | Options are buttons; Enter picks the focused one. Later is the last button |
| Send tray | Tab, Space, Enter, Esc | Move through rows, tick or untick a row, press the focused button (Generate is last), Cancel |
| `@` popover | ↑ ↓, Enter or Tab, Esc | Move, insert, close |
| Script | Tab / Enter | Next element type |
| Script | @ / # | Mention a reference / link a shot |
| Script | ⌥M / Alt+M | Add a moment at the caret (read from `event.code`) |
| Script, inline suggestion | Tab to it; Enter | Keep, Keep mine and Why are buttons in that order |
| Lists (outline, AV, storyboard, timeline) | Space, ↑↓, Space or Esc | Lift, move, drop or cancel a shot |
| Image editor | V A B L E T C H, [ ], Space-drag | Tools, brush size, pan |
| Image editor | ⌘Enter | Apply as new version |
| Video editor | Space / K | Play / pause |
| Video editor | J / L | Back / forward 1 s |
| Video editor | , / . | Back / forward one frame |
| Video editor | N | Note at the playhead |
| Video editor | [ / ] with a note selected | Move the window start / end by 1 s |
| Video editor | S | Split at playhead (Picture view) |
| Video editor | ⌥P / ⌥S (Alt+P / Alt+S) | Picture view / Sound view (read from `event.code`; ⌥ types a symbol on a Mac) |
| Sound view | ↑ ↓ | Move focus between lanes |
| Sound view | Tab / ⇧Tab | Move between the items on the focused lane |
| Sound view | M / ⇧M | Mute / solo the focused lane (solo is for your ears only) |
| Sound view | − / = | Lower / raise the focused lane's level by 1 dB |
| Sound view | ⌥← / ⌥→ | Nudge the selected cue, voice-over line or section by 0.1 s (on-screen lines don't move) |
| Sound view | R | Redo the selected line, cue or section (opens the send tray) |
| Sound view | Enter on a take | Use it: put it in the mix |
| Sound view | Space / K, J / L, N | As in the Picture view: play, step, note at the playhead |
| Sound view, checks card | Tab, Enter | Each check's fix and Show are buttons, fix first |
| Character card, Voice tab | Tab, Space, Enter | Play, Use and Test are buttons; the scope and filters are radio groups and toggles |

**No global keydown on the phone.**

---

## 8 Touch and Pencil map (iPad, artboard 5)

| Input | Does |
|---|---|
| Pencil | Draws, or selects with Lasso. Only the Pencil draws while a Pencil is in use, and palm contact is ignored. |
| Pencil hover (on models that support it) | Shows where the tip will land: an 18px faint ring with a dot in the current ink colour and size. Draws nothing. |
| Pencil hold at the end of a stroke | Snaps the stroke to a shape. |
| One finger | Pans the canvas. A tap selects. |
| Two-finger pinch | Zooms. |
| Two-finger tap | Undo. |
| Three-finger tap | Redo. |
| Tap **Open** on a node | Opens its editor. This is the only way in on touch, since double-tap doesn't open. |
| Long press on a node | Opens the selection bar for it. |
| Long press on the Sketch area tool | Ratio picker. |
| Tap **Sheets** in the tool palette | Pack picker (3.19). |
| Tap a reference | Selects it and shows its "Used by" card (hover does this on desktop). |
| Tap the questions pill | Next open ask. |

- **Palm-rejection toast,** shown once per device and dismissed per person: "Pencil draws, fingers move the canvas", with **Dismiss**.
- **Pinch hint** at first use: "Pinch with two fingers to zoom · two-finger tap to undo".
- **Tool palette** docked left, 76px wide:
  - Pen, Highlighter, Eraser, Lasso, Sketch 16:9 and Text, as labelled toggles with `aria-pressed`;
  - ink colours, as a radio group of 44px swatches;
  - stroke width;
  - Undo and Redo;
  - **Sheets** and **+ Node**.
- **Ink group panel** (lasso around handwriting): Ellis's reading first, then **Convert to text**, **Send to shot N** and Delete, with "Converting keeps your ink. Undo brings the strokes back."
  - **Send to shot N** attaches the group as a note on the shot. A "note on shot N" link is drawn, and the frame caption gets a red "1 note" badge.
- **Targets:** every touch target is at least 44px. The top bar is 56px tall. Node **Open** buttons are 44px tall and at least 112px wide in headers, or full width on narrow nodes.
- **Assets on iPad:** the drawer opens as a sheet over the Boards pill. Drag from it with a finger or the Pencil onto a board.
- **Ask cards and the send tray:** option buttons, checkboxes and Generate are at least 44px tall.
- **Editors on iPad:** the mask brush, timeline handles and drag handles work with Pencil and finger. Side panels become sheets below 1180px wide.
- **ML on iPad:** when WebGPU is missing or memory is low, cut-out and click-select run on the relay automatically, and the result says "ran on our server".

---

## 9 Accessibility

- **Contrast.** Text meets 4.5:1. Large text (19px bold or 24px and up) and non-text UI meet 3:1. The old house tokens failed in four places. The owner decided the fixes on 2026-10-13; they apply to every surface and every artboard:
  - **Primary buttons:** background **#D63B1F** with white text (4.66:1). Hover and pressed: **#B8321A**. White on the old #FF4F2E measured only 3.28:1.
  - **Brand orange #FF4F2E** stays, but only where it carries no text: the Napkin mark, the loader's create card, the needs-you bubble on a figure, ask-card borders and other accents.
  - **Grey text (ink3):** **#6B7180** (4.88:1 on white, 4.52:1 on #F5F6F8). The old #737987 measured 4.36:1 on white.
  - **Tool-blue text:** **#1E4ED8**, including on a 10–12% blue tint. Tool-blue fills (selection, focus rings, glows, mask paint) stay **#2F64F5**.
  - **Green (ok) text:** **#166534**, including on #e7f6ed.
  - **Warn:** #b45309, for warn text and the unknown-name underline (3.6).
- **Colour is never alone.** People have initials and names. Loaders have words. Note markers have timecodes. Unknown names have an underline and a tooltip. Stale items have a pill with words. Brand flags name the rule. Ask cards say "Waiting for you" as well as having the orange border.
- **Scope dimming is deliberately below contrast** (about 35%, 3.16). Dimmed items are context, not content, and take no hover. Screen readers still reach them: the "Nodes on this board" list marks them "not linked to <node>".
- **Semantics.**
  - Real `<button>`, `<a>`, `<input>` and `<textarea>` elements, with labels. Icon-only buttons have `aria-label`.
  - Tool toggles use `aria-pressed`. The current board and shot use `aria-current`.
  - Ratio and role pickers are radio groups. Reduce motion is a `switch`.
  - Status lines are `role="status"`.
- **Keyboard.**
  - Every action in this spec has a keyboard path (section 7).
  - Focus is always visible (2px tool blue).
  - Popovers trap focus until closed and return it to their trigger, as today's `ui/Float.tsx` does.
- **The canvas for screen readers.** The board rail and a "Nodes on this board" list give a non-spatial way to reach everything. Selecting from the list selects on the canvas.
- **Motion:** section 6.6. Nothing flashes more than three times a second.
- **Sound.** Nothing about sound is shown by colour or waveform alone. Lanes have names; every level shows its dB; mute says "muted"; the meter shows its number and an "On target" or "too loud" pill; line blocks show their words; on-screen lines have a camera icon and "on screen" in their label. Lane sliders are real range inputs with labels ("Music level, −8 dB"). Nothing plays on its own: audio starts only from a play button or Space. Takes and previews announce "Playing v3" in the status region.
- **Live regions.**
  - Job completions are announced politely ("Frame 3 is ready").
  - Failures are announced assertively, once.

---

## 10 Copy rules and glossary

**Rules:**
- **Point of view.** Write from the user's side, in the imperative, for buttons: "Make video", "Insert a shot here", "Leave note at 0:07". Write in the first person for agents ("I will mark clips 2 and 5 to check"), signed "Dex · directs".
- **Short sentences.** Most lines are under 12 words. No jargon (no "EDL", "inpaint" or "token" in the UI), no lorem ipsum, no rationale text.
- **Models.** Always "<model> on Runway" ("Gemini 3 Pro on Runway", "Veo 3.1 Fast on Runway"), or "<model> on ElevenLabs" for sound made there ("Eleven v3 on ElevenLabs"), from the capability sheet's `display_name`. Never a raw model id.
- **Sound words.** Say "dips under speech", not "ducking"; "the shot's own sound", not "native audio" (the lane is labelled "Native"); "says it on camera", not "lip-synced dialogue" in buttons. Loudness is written as a number with its unit in mono ("−14 LUFS", "−1 dB true peak"), and only on the Mix card, the Export menu and loudness reports.
- **Money.** No prices, costs, estimates or credits anywhere in the UI. The one exception is the decision tree (3.20), where a job node may show what it cost, in dollars ("$0.08").
- **Time.** m:ss (or m:ss.s) in Geist Mono. Shot time always names the shot (3.13).
- **Names.** `@names`, `#shots`, versions (v3) and timecodes are mono. `@refs` are blue.
- **Certainty.** In words ("sure of it"), never percentages.
- **Errors.** Say what happened and what to do next ("Runway is busy. Try again."). Never mention a charge (owner, 2026-10-13).
- **No exclamation marks** except in quoted script lines. **No emoji.**
- **Capitals.** Sentence case everywhere. Mono tags (PLANNING, RENDERING) are uppercase.

**Visual tokens** (owner decision 2026-10-13; contrast figures in section 9):

| Use | Token |
|---|---|
| Primary button background (white text) | #D63B1F |
| Primary button hover and pressed | #B8321A |
| Napkin mark (create card), needs-you bubble on a figure, ask-card border, accents without text | brand orange #FF4F2E |
| Grey text (ink3) | #6B7180 |
| Tool-blue text, links, `@refs` | #1E4ED8 |
| Tool-blue fills: selection, focus ring, glow, mask paint | #2F64F5 |
| Green (ok) text | #166534 |
| Warn text and the unknown-name underline | #b45309 |

- **Never put text on brand orange.** If a label needs an orange background, it is a primary button and uses #D63B1F.
- **One primary button per surface,** as principle 9 says.

**Glossary:**

| Word | Means |
|---|---|
| Board | A titled area of the canvas with a purpose (Script, Characters, …). |
| Node | A typed thing on the canvas with an editor or role: Script, Storyboard, Video, reference, frame. |
| Link | A typed connection between nodes, with a role ("drives", "renders", "lighting"). |
| Reference | A named picture (`@maya_front`) with a role and an optional label. |
| Role | What a reference is for. One open set: character, location, lighting, composition, product, style, wardrobe, pose, prop, texture, colour, layout, logo, palette, typography, brand rule, document, other, plus a free label. |
| Shot | One planned piece of the ad, with camera fields, action, direction, moments and a frame. |
| Frame | The still picture for a shot. It has versions. |
| Clip | The moving picture for a shot. Its versions are takes. |
| Take | One version of a clip. A patched take has a parent and a spliced window. |
| Moment / beat | Something timed inside a shot ("at 0:02 her eyes open"). Moment in the script; beat on the timeline. |
| Direction | Long performance notes for a shot, up to 4,000 characters. |
| Bridge | A shot Dex makes to link two neighbours, from N's last frame to N+1's first. |
| Note | A timed comment on the ad. It widens into a window that Fix this moment patches. |
| Window | The whole-second range a note changes, about 2 s. |
| Sketch area | A ratio-locked white rectangle you draw in. Its frame comes back at that ratio. |
| Ink group | Handwriting or scribbles that move as one. |
| Out of date (stale) | Made from something that has since changed. |
| To check (drift mark) | A neighbour whose cut may need a look after a move. |
| Started by | The person whose action began a job. Its cost is recorded against them in the decision tree. |
| Scope | What a generating node uses: only what is linked to it. |
| Inputs strip | The row of chips on a generating node naming each linked input. |
| Send tray | "What Dex will send": every input and the model, shown before anything goes to Runway. No prices; collapsed to one line by default. |
| Ask | A question an agent puts to the project instead of guessing. Anyone in the project can answer. |
| History | The decision tree: the project's decision chain (decisions, checks, asks and picks), with who made each and why (3.20). |
| Decision chain | The record in the project's `.clan` of every decision: who, what changed, why and when. |
| Team library | Shared references and brand kits, on one shelf per client, for everyone in the agency. |
| Brand board | A board made from a brand book: logo, palette, fonts, tone, do and don't. |
| Brand rule | A do or don't from the Brand board. Dex writes it into prompts; Jude flags breaks; it never blocks. |
| Document | A dropped text file (DOCX). Context once linked. |
| Spin-in | Work arriving from Brief Maker or Research. Nothing happens until Bring in. |
| Scamp sheet (sheet) | A board of ratio-locked sketch areas, one per format in a pack, labelled with format and size. |
| Pack | A set of formats: Social, Out of home, Print, Digital display, Film storyboard frames, or a client's own. |
| Format set | The node holding every size Make all sizes made from one master. |
| Cut-down | A 9:16, 1:1 or 4:5 version of the 16:9 film, reframed to follow the subject. |
| Safe area | The part of a format where logo and copy must sit. |
| Loader | The Napkin logo at work, in its own four colours. The leading card names the department of the work: create, plan, learn or produce (section 6). |
| Inline suggestion | An agent's draft shown in place, old words struck and new words underlined, with Keep, Keep mine and Why. |
| Who-wrote-it mark | The avatar or crew figure on a scene or shot naming who last wrote it, with why?. |
| Path | How a shot gets its sound, chosen per shot by Dex. **Path 1:** the clip model speaks the on-camera line, so the lips match. **Path 2:** a silent clip (or a still for a text shot) with sound made in layers. |
| Sound view | The Video editor's second view (⌥S): the layers, takes, mix, loudness and Jude's checks (3.21). |
| Layer (lane) | One kind of sound in the mix: Native, Voice, Effects, Ambience, Music. Each has mute, solo and a level. |
| Shot sound (Native) | The sound a Path 1 clip came with. Words in it that nobody wrote are muted (R6). |
| Line | One spoken line, with its speaker and whether it is on screen. It has takes. |
| Cue | One effect or ambience: a **hit** (a single sound placed on the motion) or a **bed** (a sound under a stretch). |
| Music section | The music for one scene, or the end-card sting. It can be redone alone. |
| Take (sound) | One version of a line, cue or music section. One take of each is in the mix. |
| In the mix | The take the mix uses. The mix is always rebuilt from these. |
| Mix | Every layer's takes in the mix, with levels, dips and loudness, built by Edie. It has versions (mix v4). |
| Re-voice | Turning a line into another voice, speech to speech, with the same timing, so the lips still match. |
| Character voice | The one voice a character speaks in everywhere, designed, picked from the library or cloned (3.22). |
| Narrator | The voice for voice-over that no character says. |
| Pronunciation list | How the voices say brand names (a respelling or IPA), shared across the agency. |
| Sound checks (R1–R6) | Jude's checks on the sound: dialogue sets the shot length, lips on every on-screen line, one voice at a time, speech first, hits on the motion, no stray words (3.21). |
| Dips under speech | How far effects, ambience and music drop while someone speaks. |
| Loudness target | How loud the finished ad must be: Online −14 LUFS, TV −23 LUFS, Radio −18 LUFS (or the station's figure). |
| Stems | The mix exported as one file per layer. |
| Cue sheet | Every line, cue and section with its times, in Napkin Radio's shape. |
| Radio cut | The ad as a radio spot, 20 or 30 s, made from the same voices and stems. |

---

## 11 Laurence's review items, and what solves each

| # | Item | The interaction that solves it | Where | Acceptance test (Laurence suite) |
|---|---|---|---|---|
| 1 | Art boards with jump nav | Board rail by rank; click to fit; ⌥1–9 and ⌥0; iPad pill and sheet; Ad template boards | 3.2; artboards 1, 3, 5 | Open a template project and press ⌥3: the canvas fits Locations and the rail marks it current. |
| 2 | Open reference roles | Drop on a board takes the board's role, with an inline chip and no dialog; Name this picture with the one open role set (ten pills + More, incl. logo, palette, typography, brand rule, document) + free label; per-role line on what Dex takes | 3.6; artboard 3 | Drop a picture on Locations: it becomes `@loc_<file>` with role location, and no dialog opens. Drop one outside boards, pick Wardrobe and label it: the prompt says "match the clothes only". |
| 3 | Insert a shot between frames, drag reorder, Bridge | "+" in every gap with Empty shot and Bridge; dnd-kit drag with a drop line and drift marks; the same in the outline, the AV table and the timeline | 3.10, 3.11, 3.13; artboards 6, 7, 8 | Insert a Bridge between 1 and 2: a new shot 2 starts on 1's last frame and ends on old 2's first. Drag shot 5 between 2 and 3: frames are kept, and clips 2 and 5 are marked to check. |
| 4 | Full-screen frame editing | Click a frame to open the Image editor route; zoom and pan; tools, layers, masks; Apply as new version | 3.12; artboards 8, 9 | Click frame 3, paint a mask, fill it, Apply: v4 exists, v3 is unchanged, shot 3 shows v4. |
| 5 | "Change this frame" understood | Dex classifies the words. A camera change gives a field diff on the shot's camera chips (dashed until Apply). A local change goes to the mask and fill in the Image editor. Passthrough is said. Words that could be either ("bigger") get Dex's "Bigger how?" ask, with no default. | 3.11, 3.12; artboards 8, 9 | Type "make this an overhead aerial shot" on shot 4: the diff shows angle → overhead and size → wide, and Apply writes both fields and marks clip 4 out of date. Split (features/frame-change-edit.clan): **now**, the relay op frame_edit and the pure helpers (jobs/frameEdit.ts): the overhead-aerial words on shot 4 run as a redraw, Dex's reading carries angle → overhead and size → wide, and applyFrameEdit writes both and marks clip 4; checked by the relay pytest, the director.v7 eval and vitest. **With storyboard-editor and image-editor**: the card's bar, the dashed chips and the result card, mounted in the send tray. |
| 6 | Long performance direction | Direction up to 4,000 with a live counter from the capability sheet; "Veo 3.1 on Runway uses the first 1,000, Dex condenses"; See Dex's 1,000 | 3.10, 3.11; artboards 6, 7, 8 | Paste 1,240 characters: all are kept, the counter reads 1,240 / 4,000, and the clip prompt carries Dex's ≤1,000 version. |
| 7 | Timed moments inside a shot | Inline Moment pill (⌥M) in the screenplay; moments track and Line tied to a moment in AV; Beats row in the Video editor | 3.10, 3.13; artboards 6, 7, 10 | Add "at 0:02 her eyes open; she says 'It's perfect!'" in shot 4: a beat at 0:02 and a line at 0:03 appear on the timeline, and the clip prompt carries the timestamps. |
| 8 | A note patches only ~2 s | A note becomes a whole-second window, shown on the timeline and phone scrubber; Edit still; Fix this moment (Aleph 2 on Runway) makes a patched take spliced with crossfades; Jude checks the seams | 3.13, 3.14; artboards 10, 11, 12 | Leave a note at shot 4, 0:03: the window is 0:02–0:04, and v3's frames outside 0:02–0:04 match v2's exactly. |
| 9 | @ autocomplete with thumbnails by role, unknown names underlined | Shared MentionInput: grouped popover with thumbnails, label matching, `#` shots; each row names its board; picking an unlinked reference links its board or group, with Undo; unknown names get a warn underline, "Did you mean" and "Name a new picture"; nothing is dropped at generation | 3.6, 3.10; artboards 3, 6, 7 | Type "@ma": Characters group first with thumbnails. Type "@maya_runing": underlined, with "Did you mean @maya_laughing?". |
| 10 | Ratio-locked 16:9 sketch area returns 16:9 | Sketch area tool with a ratio picker; the ghost keeps the ratio; Generate goes through the send tray; the export is the area; the result is cropped to the ratio and says so; the Image editor crop keeps the ratio | 3.7, 3.12; artboards 4, 5, 9 | Draw a 16:9 area, sketch, Generate, then Generate in the tray: the frame is exactly 16:9 and says "cropped to 16:9". Repeat for 9:16. The send tray listed the sketch and its inputs before anything was sent. Split (owner, 2026-10-13; features/frame-aspect.clan): **now**, on today's canvas, draw a 16:9 frame, sketch in it (one stroke crossing its edge), Generate from the popover: the frame becomes a sketch area, the result is exactly 16:9 and says "cropped to 16:9"; repeat for 9:16. **With canvas-nodes**: the Sketch area tool, its picker and ghost. **With send-tray**: the tray listed the sketch and its inputs. **With image-editor**: the crop keeps the ratio. |
| 11 | Handwriting to editable text; scribbles move as one group | Strokes cluster into an ink group; Convert to text opens Ellis's preview with editable text and @ chips; Keep replaces the ink, which is kept for Back to ink and undo | 3.8, 8; artboards 4, 5 | Write "more golden light, she should laugh", Convert, Link it, Keep: text with @maya_laughing appears, and one undo restores the strokes. |


### 11.1 Owner additions (2026-10-13), and what solves each

| Decision | The interaction | Where | Acceptance test |
|---|---|---|---|
| Inputs and scope | Links set scope (one per board or group, one per single reference); inputs strip; focus on select dims the unlinked; "Used by" card; Show all links | 3.4, 3.16; artboard 4b | Select the Storyboard: Loc1 · Coast glows, @loc1_beach shows "shots 1, 2", Loc2 · City dims. Pick @loc2_rooftop in `@`: Loc2 · City is linked with an Undo toast; Undo unlinks it and underlines the mention. |
| Send tray | "What Dex will send" on every paid generation, rows with checkboxes, Ellis's reading marked confirm, nearby notes unticked with Include, "<model> on Runway", no price, collapsed by default | 3.16, 5.4; artboard 4b | Generate on a sketch area: the tray opens as one line, "Sketch, 4 inputs, 1 note", with no price; expanded, it lists the sketch, 4 inputs and 1 note; nothing reaches Runway until the tray's Generate. |
| Asks, shared | Anchored ask cards signed by the step's owner; hard block only when nothing can proceed; Recommended on nudges, no default on ambiguity; Later; questions pill; "You chose … · in History" with Change; anyone can answer | 3.17, 4.7, 5.2; artboard 4c | Make video from a script alone: Dex asks "Plan a storyboard first?" with Plan first marked Recommended. Sai answers from her laptop: History shows "Sai chose: plan the storyboard first". |
| Assets and team library | Assets drawer in the rail's place; shelves per client shared across the agency; items with version and publisher; publish replaces for everyone, projects keep their copy | 3.18, 4.8; artboard 4d | Publish @ext_beach v5: the library shows v5 for everyone; an open project still uses v4 and offers Update. |
| Brand rules | Brand book becomes a Brand board as Ellis reads; no font files from a PDF; Dex writes rules into prompts; Jude flags with Fix in image editor / Ignore; never blocks | 3.18; artboard 4d | Drop a brand PDF: the Brand board appears at once and fills page by page; fonts show "no file". A frame with the logo at the edge gets Jude's clear-space flag and still lands. |
| Character sheets, documents, spin-in, export | Rhea proposes crops (Confirm/Adjust); DOCX becomes a Document node used once linked; spin-in card waits for Bring in; Export menu | 3.18; artboard 4d | Drop maya_sheet.png: no reference exists until Confirm. Not now on a spin-in leaves it under From Napkin. |
| Scamp sheets | Sheets opens the pack picker; a pack drops a board of labelled, ratio-locked sketch areas | 3.19; artboard 4e | Pick Social: a sheet lands with one area per format, each labelled with format and size. |
| Make all sizes, cut-downs | Wren adapts the master per format (crop, extend, nearest ratio), safe areas per the Brand board, ask when the subject is unclear, tray lists every size, Format set node, Jude per size, one zip; video cut-downs in the first release | 3.19; artboard 4e | Make all sizes on the key visual with Social: the tray lists every size, with no prices; the Format set links to the master; the zip's files are named by format and size. Make all sizes on the film gives 9:16, 1:1 and 4:5 cut-downs. |
| The loader is the logo | The Napkin logo in its own four colours, a centre pin, the 4 s clockwise loop; the department of the work picks the leading card; 0.6 s still finish; the same loader on the pointer | 6; artboard 14 | Generate a frame: the loader leads with the orange create card, the pointer badge shows it at (+11, +15), and on finish the full logo holds still for 0.6 s. Turn on Reduce motion: the logo is still and only the leading card pulses. |
| The crew as house figures | Dex, Skye, Wren, Rhea, Edie, Ellis and Jude drawn from `AgentFigure`, with idle, working and needs-you states; signed speech bubbles | 5.1; artboard 13 | Raise an ask: the agent's figure shows the "!" bubble, and no loader uses its colour. |
| No chat | Inline suggestions with Keep / Keep mine / Why, floating options on a selection, who-wrote-it marks, anchored asks | principle 10, 3.10; artboards 6, 7 | Select a line and press Tighten: Skye's rewrite appears struck and underlined in place, with a signed bubble; nothing changes until Keep. No chat box exists on any surface. |
| Decision tree | History panel with List and Tree, filters by item, who and kind; Why on any item; versions branch; Restore adds a new decision; pinned decisions | 3.20; artboard 15 | On frame 3 press "Why does this look like this?": the tree opens filtered to frame 3 and shows v2 and v3 as branches. Restore v2: a new decision by you appears at the end, and the older nodes are unchanged. |

### 11.2 Sound (2026-10-14), and what solves each

| Decision | The interaction | Where | Acceptance test |
|---|---|---|---|
| A path per shot | Dex picks Path 1 for on-camera lines, Path 2 otherwise, a still for text shots; path button per shot; switching to Path 2 on a spoken shot asks first | 3.21; artboard 10b | Plan the sound for First Light: shots 4 and 5 read "Path 1 · speaks on camera", shots 1–3 "Path 2", the end card "silent · end card + layers". Set shot 4 to Path 2: the lip-sync question appears and nothing changes until you pick. |
| Layers and takes | Native, Voice, Effects, Ambience, Music lanes with mute, solo and level; takes per line, cue and section, one In the mix | 3.21; artboard 10b | Redo "It's perfect!" softer: a v3 take lands with the same timing, Use puts it in the mix, and no other item gets a new take. Solo Music: nobody else hears it and the mix is unchanged. |
| Re-voice keeps the lips | Re-voice to the character's voice, speech to speech | 3.21, 3.22; artboards 10b, 13b | Re-voice shot 4's line to Aoife: the new take's speech starts and ends at the same hundredth of a second as v1. |
| Character voices | Voice tab with library, design (20–1,000 / 100–400, three previews a round) and clone (name and consent required); changing a voice remakes every line through one batch tray; scope project, shelf or agency | 3.22; artboard 13b | Change Maya's voice: the tray lists her four lines, the radio cut included; the pictures are untouched. Clone voice stays disabled until a name is given and the consent box is ticked. |
| Brand names said right | The agency-wide pronunciation list with Test; changing an entry marks the lines that say it | 3.22; artboard 13b | Add "Vorr · /vɔːr/": Test says it right in Aoife's voice, and the lines that say "Vorr" show "to redo". |
| Jude's checks R1–R6 | Quiet checks with fixes; R4 dips and R6 muting built into the mix and said; checks never block | 3.21; artboard 10b | Make shot 4's line 0.6 s longer than the shot: Jude says "Line runs past the shot", and "Grow it, shot 1 gives 0.6 s" keeps the ad at 15 s. Put the tagline over her line: "Two voices overlap at 0:12", and the fix moves it after. |
| Loudness | Online −14, TV −23 (true peak −1 dB), Radio −18 LUFS; meter with whole-ad loudness, true peak and target | 3.21; artboard 10b | Export the TV master: its report reads within 1 dB of −23 LUFS and true peak at or below −1 dB. |
| Radio cut | Export item; booked 20 or 30 s; same voices and stems; Skye asks about picture-only lines | 3.21, 3.14; artboard 10b | Make a 30 s radio cut: the file is exactly 30 s at −18 LUFS, uses Aoife for Maya, and plays on the phone. |
| Phone plays the mix | The phone player plays the version's mix at −14 LUFS; sound notes are ordinary notes | 3.14 | Leave "music too loud" at 0:09 on the phone: it opens in the Sound view with its window over every lane. |
| No costs in sound | No price on any sound button, tray, take, voice or export; costs in the decision tree only | principle 4, 3.21, 3.22 | Redo a line and make 3 previews: no screen shows a price; the decision tree shows each job's cost. |

---

## 12 Redraws and facts still to check

### 12.1 Redraws (all done)

R1 to R9 are drawn. Where an artboard still shows a value that the 2026-10-13 answers changed (button orange, ⌘M, a red underline, the phone's 0..15 clamp), this spec wins. The same holds for any price, credit count, spend pill, cap line or tray total an artboard still shows (fourth round, principle 4).

- **R1 Loader (done).** Every artboard that shows work running uses the `napkin-loader` of artboard 14: the logo in its own four colours, the department's card leading (section 6). The sector sweeps and the crew-tone loader are gone.
- **R2 Model names (done).** Every model name reads "<model> on Runway": artboard 4, artboard 4b's tray footer, and every take, chip and toast that names a model.
- **R3 Conflict example (done).** Artboard 12's conflict notice moved off shot action (shared live text never conflicts, 4.4) onto a single-value field.
- **R4 Sketch area button (done).** Artboard 4's "Make a frame" is now **Generate**, as on 4b and 4c, and opens the send tray.
- **R5 Role picker (done).** Artboard 3's Name this picture shows ten pills and More…, with More holding Texture, Colour, Layout, Logo, Palette, Typography, Brand rule and Document (3.6).
- **R6 Formats (done).** Artboard 4e shows the pack picker, a dropped Social sheet, the send tray for Make all sizes with every size and the total, a Format set with one of Jude's per-size flags, and the cut-downs of the film.
- **R7 Crew figures (done).** Every agent figure, avatar and mark on every artboard is the house figure from `AgentFigure`, with the names and sign-offs of 5.1. No simplified shapes remain.
- **R8 Script editor without chat (done).** Artboards 6 and 7 have no Skye panel and no chat box. They show inline suggestions with Keep / Keep mine / Why, the floating options, who-wrote-it marks and anchored asks (3.10).
- **R9 Decision tree (done).** Artboard 15 shows the History panel over the Storyboard editor, opened from "Why does this look like this?" on frame 3 (3.20).
- **R10 Sound (drawn 2026-10-14).** Artboard 10b shows the Video editor's Sound view: the Picture | Sound switch, the shot list with paths, the lanes, the selected line with its takes, the Mix card with the loudness meter, Jude's checks and the open Export menu with the radio cut. Artboard 13b shows Maya's card on the Voice tab with the three ways to make a voice, every line she says, the pronunciation list and the voice's scope. Neither shows a price or a chat. Where they differ from this spec, the spec wins: neither artboard 10 nor 10b draws the **History** button every editor carries (3.1, 3.13); artboard 10 (the Picture view) has no **Picture | Sound** switch or **Export** menu yet, and still labels its summary row "Voice-over" (now **Voice**).

### 12.2 Facts still to check

The owner answered every design question on 2026-10-13. Rows 1, 2, 5 and 6 are answered by features/runway-sheet-sync.clan (facts in `docs/production-tool/providers.md`, "Checked 2026-10-13"); rows 3 and 4 need one live check each, which a person runs. What else is left are facts about ElevenLabs and Napkin Radio, and a review. Items 1–7 change no screen. Items 8–10 (sound, 2026-10-14) decide which routes the sound screens can offer; the screens already carry copy for either answer. The cost facts feed the costs recorded per job and shown in the decision tree (3.20), not the UI, which shows no prices. They come from the capability sheet and the relay, so the answers land as data.

| # | What to check | Why it matters | Who checks |
|---|---|---|---|
| 1 | **Answered.** 1 credit is $0.01. Prices live once, in `capabilities/runway.json` `models[].pricing` with the verbatim pricing.md rows, computed by `contracts/pricing.py`; a weekly workflow flags drift (providers.md facts 1, 6, 7, 11). | The recorded cost of every job (History) and the cost model. | Done (runway-sheet-sync). |
| 2 | **Answered from the docs.** Black is edited, white kept (`png_black_edit`). `preciseEdit` keeps the whole composition, so "Keep the label" is a white area in the mask, not `preciseEdit` (providers.md facts 2, 3). | Fill area in the Image editor (3.12). | Done; the image editor feature sets the copy. |
| 3 | **Charge on a stopped render.** Does Runway charge for a task stopped mid-render? A cancelled task cannot be read after DELETE, so the balance is the witness. | What History records for a stopped job (5.3); never shown elsewhere. | A person: `production-tool/relay/scripts/live_check_stop_charge.sh <https image>` (at most $0.40). |
| 4 | **Aleph 2 access.** Is Aleph 2 available on our key? The docs show no tier gate. | Fix this moment's main path (3.13). The Veo 3.1 fallback copy is ready for either answer. | Shrey: `production-tool/relay/scripts/live_check_aleph2.sh <https 4 s mp4> <https image>` (about $1.12). |
| 5 | **Answered.** No Runway image outpaint: pad and fill with an `ideogram_4_5` mask, or re-render on Gemini. Video: `aleph2` `targetAspectRatio` (16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 21:9; no 4:5). No model tracks a subject (providers.md fact 8). | Make all sizes and the video cut-downs (3.19). | Done; the method is those features' to choose. |
| 6 | **Written.** `production-tool/contracts/cost-model.json`, priced by `relay/scripts/ad_costs.py`: $10.89 typical first pass, $27.69 with 3 takes, $18.09 with audio, $49.29 with both, $88.63 heavy. Fixed infrastructure and the tier ceilings wait for Shrey. | Any cap an agency chooses (5.4; caps are off). | Shrey signs off and fills the fixed lines. |
| 7 | **Format packs review.** Review the draft `format-packs.json` and its unverified rows. | Every scamp sheet and Make all sizes (3.19). | The owner. |
| 8 | **ElevenLabs key permissions.** Our key designs voices but returns 401 on everything else: it lacks `text_to_speech`, `speech_to_speech`, `sound_generation`, `music_generation`, `forced_alignment` (and `user_read`). Its name in `.env` is `ELEVELLABS_API_KEY`; the code should read `ELEVENLABS_API_KEY`. Then re-run the direct tests: designed-voice speech with timestamps, music from the cut, alignment and Aurora. | Redo this line, Re-voice, every cue and music section, Rewrite music to the cut, the voice previews, and the word checks (3.21, 3.22). Until then every sound take falls back to Runway with a stand-in voice (5.5). | Shrey, in the ElevenLabs dashboard; the key reaches AWS as a Terraform-applied secret, applied by a person. |
| 9 | **Lip-sync quality on silent shots.** Which route does **Lip-sync it** (R2) use, and is it good enough? WAN 3 on Runway with the frame and our voice-over used our exact line, but the mouth followed it only loosely and continuity drifted (a second robot appeared). The Runway avatar speaks our line word for word but crops to a talking head, and its sync was weak. ElevenLabs Aurora and Sync Labs are untested. Jude's mouth-sync score fails on stylised faces. | Whether **Lip-sync it** is offered on a Path 2 shot at all, and on which framings (3.21). If no route passes, R2's fixes are only **Make it Path 1** and **Make it a voice-over**. | The relay owner, with paid test calls, judged by eye. |
| 10 | **Napkin Radio's loudness bug,** and the radio pieces. Asked for −18 LUFS, Radio's export took a quiet mix from −21.3 to −14.9 LUFS (twice). It also never trims to the booked length, has no auth, and its own ElevenLabs key was rejected (`/voices` returned 502). We need repo access (`larryob78/napkin-radio`), the fix, and a licence to reuse its parser, scorer and station data. | The radio cut (3.21). Our own mix does the loudness pass and measures it, so a miss shows in the report instead of shipping; but the station profiles and the cue-sheet round trip depend on Radio. | Laurence, asked by Shrey. |
