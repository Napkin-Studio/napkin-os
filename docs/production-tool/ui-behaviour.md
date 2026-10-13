# Production Tool UI: behaviour spec

What every screen in the overhauled Production Tool does. The owner approves this file together with the mockups in `project/*.dc.html`. Feature records (`features/<slug>.clan`) build to it and cite its section numbers.

- **Baseline.** `docs/production-tool/overhaul-plan.md`, approved 2026-10-13. Its "Owner decisions" section wins wherever this spec and the plan differ. This spec adds the interaction detail the plan leaves open.
- **Mockups.** 1 Main · 2 CanvasLinking · 3 CanvasReferences · 4 SketchInk · 4b Scope · 4c Asks · 4d Assets · 4e Formats (not drawn yet) · 5 TabletCanvas · 6 ScriptScreenplay · 7 ScriptAV · 8 Storyboard · 9 ImageEditor · 10 VideoEditor · 11 PhoneReview · 12 States · 13 Crew · 14 Loader. In this spec, "artboard N" means the board with that number in `canvas.json`.
- **Owner decisions folded in on 2026-10-13:** inputs and scope, the send tray, asks (shared), assets and the team library by client, brand rules, spin-in, scamp sheets, and Make all sizes with video cut-downs. Also decided that day: the loader uses the crew-tone colours of artboard 14 (6.2), model names always read "<model> on Runway", the reference roles are one open set (3.6), and a node with a running job is never dimmed during a link drag (3.4).
- **When a mockup and this spec disagree,** this spec wins. Section 12.1 lists every place where a mockup has to be redrawn to match it.
- **Words.** "You" is the person at the screen. "Someone else" is another person in the same project. "Agent" is a crew member (section 5).

---

## 1 Principles

1. **The canvas is the project.** All of an ad lives on one canvas: script, pictures, storyboard, video, sketches, notes. Editors open over the canvas and close back onto it. The canvas stays mounted underneath, so results keep landing while an editor is open. No feature adds a separate page of project content.
2. **Meaning lives in the `.clan`; the canvas holds only where things are.** Boards, shots, references, links, jobs, notes and versions are document entities, and each is written by one server as a validated patch. Excalidraw holds geometry and ids only. If the screen and the document ever disagree, the document is right and the screen redraws.
3. **Nothing is silent.** Every running job is visible, along with who started it. Every fallback, passthrough, splice, condensation, crop and failure is said in words where it happened. A tool never quietly drops an `@name`, truncates text, changes a ratio or switches model.
4. **Every cost is shown before it is spent, and you see what is sent.** Anything that calls Runway shows its price in dollars on the button or next to it before you press it. Every paid generation opens the send tray, "What Dex will send" (3.16), which lists each input, the model and the price. Nothing goes to Runway until you press the tray's **Generate**. Batches and large runs open the tray expanded (section 5.4). Free work says "free". Work that runs on your device says "on your device".
5. **Nothing changes until you choose.** Agent proposals arrive as previews with a diff: Skye's rewrites, Dex's camera changes, Ellis's reading of your ink, fuzzy `@` matches, Rhea's crops of a character sheet, a spin-in from Brief Maker. The canvas or the document changes only on Apply, Keep, Link it, Confirm or Bring in, and one undo reverses that step.
6. **Each tool works on its own; agents ask when the input is thin.** This is an owner decision from 2026-10-13. The flow (references → script → storyboard → video) gives the best results, but any node can run alone. When an input is ambiguous or missing, the agent asks a question with options instead of guessing (section 3.17, artboard 4c). The job waits in `needs_input`. An ask blocks only when no option can proceed; otherwise at least one option proceeds. Asks never time out into a guess. Asks are shared: anyone in the project can answer, and History records who did.
7. **Scope is what you link.** A generating node uses only what is linked to it: boards, groups, single references, notes and documents (3.16). Nothing nearby is used because it is nearby.
8. **Plain words.** Use short sentences from your side of the screen ("Make video", "Insert a shot here"). Name the agent doing the work. Name a model as "<model> on Runway". No jargon, no percentages for certainty, no rationale text in the UI. Section 10 has the rules.
9. **One look.** Use the house tokens and vocabulary of artboard 1 (Main). Action orange marks the single primary button of a surface. Tool blue marks identity and selection only.

---

## 2 Surfaces and navigation

### 2.1 Surfaces

| Surface | Route | Devices | Artboards |
|---|---|---|---|
| Canvas | `/production/p/:project` | desktop, iPad | 1, 2, 3, 4, 4b, 4c, 5 |
| Assets drawer and Export menu | over the canvas (`?assets=<tab>`) | desktop, iPad | 4d |
| Format sheets and Format set | on the canvas | desktop, iPad | 4e (not drawn yet) |
| Script editor | `/production/p/:project/script/:scriptId` | desktop, iPad | 6, 7 |
| Storyboard editor | `/production/p/:project/storyboard/:storyboardId` | desktop, iPad | 8 |
| Image editor | `/production/p/:project/frame/:frameId` | desktop, iPad | 9 |
| Video editor | `/production/p/:project/video/:videoId` | desktop, iPad | 10 |
| Phone review | the same video route, below 600px wide | phone | 11 |
| Signed out | `/production` without a session | all | 12 |

- **Query parameters** carry focus, never content:
  - `?shot=<shotId>` scrolls the Script or Storyboard editor to a shot and selects it.
  - `?t=<seconds>` seeks the Video editor or Phone review.
  - `?note=<reviewId>` selects a note.
  - `?board=<boardId>` or `?node=<id>` fits the canvas to that board or node.
  - `?ask=<askId>` fits the canvas to the node that asks and opens its ask card.
  - `?assets=project|library|upload|napkin` opens the Assets drawer on that tab.
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
- the spend pill ("$12.40 of $200 this month");
- **Assets** (opens the Assets drawer, 3.18), **Export** (a menu, 3.18), **Share** and the account button.

- **The spend pill** opens a sheet with this month's spend by person and by kind of work. The sheet also shows the cap and who can raise it (the tenant admin). At 80% of the cap the pill turns warn. At 100% it turns danger, and every paid button says "Monthly limit reached" (section 5.4).
- **Presence avatars:** click one to follow that person's viewport. Section 4.2 covers following.

### 3.2 Boards and jump navigation (review item 1)

**Boards.** A board is an Excalidraw frame, written as `boards[id]{title, purpose, rank}`.
- **Ad template.** A new project starts from it with seven empty, dashed boards: Script, Characters, Locations, References, Products, Storyboard, Video. A Skye card on the Script board reads "Start with the script", with **Write the script** (primary) and **Add pictures** (artboard 12).
- **Sketches board: not in the template.** Artboards 4 and 5 show one; Q2 in section 12.2 has the decision.

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

- **iPad.** The rail is a "Boards · <current>" pill. Tapping it opens a sheet of 48px rows (thumbnail, name, count), then "+ New board". The ⌥ labels are hidden. The sheet closes from its own close button, on the pill, on a board pick, or on a tap on the canvas outside it (artboard 5 left this open; decided here).
- **Empty board:** a dashed frame with a drop hint that names its purpose ("Drop pictures here. They become locations.").

### 3.3 Nodes

A node is a typed Excalidraw element plus an image-element preview plus React overlay chrome (plan 2.1).

| Kind | Card shows | Primary actions |
|---|---|---|
| Script | Title, target length, excerpt with blue `@refs`, "4 scenes · 6 shots · edited by Maya 2 min ago", Skye's last change ("Skye tightened scene 3 · see change"), inputs strip | Open |
| Storyboard | Title, ratio, shot count, length, frame strip, "2 behind the script" when stale, inputs strip | Open |
| Video | Poster, length, "Clips 3 of 6 ready", last ad render, estimate to finish, inputs strip | Open |
| Reference | Picture, `@name`, role pill, library version when it came from the team library ("v4") | Role chip, Name |
| Frame (made from a sketch) | Picture, version, ratio badge, the model that made it ("Gemini 3 Pro on Runway"), its cost | Open, Use in shot N, Make all sizes |
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
- **Needs you:** an orange dot on the agent figure, "Waiting for you" on the node, and the ask card anchored to it (3.17).

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

**Dragging a link** (Link tool L, or drag from an output port):
- **Pointer:** a dashed blue line follows it, and the Link tool shows as pressed (`aria-pressed`).
- **Compatible input ports glow blue.** Over one, a tooltip at the pointer reads "Drop to link · drives".
- **Incompatible nodes dim to 40%** and refuse the drop. Only the nearest dimmed node shows its reason, for example "A script cannot feed a product" or "Not a target for a script".
- **A node with a running job is never dimmed during a link drag** (decided 2026-10-13), so its status stays readable. It still refuses the drop while the job runs ("Wren is still making clip 4. Link it when that's done."). Other people's selections, cursors and name tags are never dimmed.
- **The selection bar hides during the drag** and comes back on drop (artboard 2 keeps it up only to fit one frame).

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

A new `drives` link to a storyboard planned from an older script is stale at once. **Update shots** runs FollowScope and UpdateBox: the affected shots are re-planned as a merge, and the price shows first if any paid step follows.

### 3.5 Make video

1. Select a Script and a Storyboard (two clicks, or a lasso). The selection bar reads "Script + Storyboard" with **Make video** (primary), **Plan shots**, **Group** and More.
2. **Make video** creates, as **one undo step**:
   - the Video node, to the right of the storyboard;
   - a `drives` link, only if it is missing;
   - a `renders` link.

   No paid job starts. The node shows "6 clips to make · 15 s · est. $4.80 · waits for 2 shots".
3. A toast reads "Video made from Script and Storyboard · 2 links", with **Undo ⌘Z**. Undo removes the node, both links and the toast. Redo, or Make video again, brings them back.

Other selections:
- **A Storyboard alone:** Make video makes the node and the `renders` link.
- **A Script alone:** Make video makes the Video node with a `drives` link from the script, and Dex asks on it before anything is spent (3.17, artboard 4c): "Plan a storyboard first? Clips come out better from frames you've checked." The options are **Plan the storyboard first** (marked Recommended, "6 shots · about $1.20 for frames") and **Make clips straight from the script** ("6 clips · about $7.20"), with "You can always switch later." and **Later**.
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
- **Key:** the board's name prefix. Each board has one, editable in board settings; Locations defaults to `loc`. A user can type `ext` or `int` instead.
- **View:** the file name, lowercased and slugged ("Cliffs.JPG" becomes `cliffs`).
- **Names are unique across the project,** because they become Runway tags. A clash anywhere in the project adds `2`, `3` and so on.
- **Open:** whether template boards should default to `ext`/`int`-style keys is Q3.

**Dropping a picture outside every board** opens the **Name this picture** dialog. It says: "It isn't on a board, so say what it is. Your script uses the name."
- **Name parts:** "Who or what" (key) `_` "This view" (view). The header shows the result live (`@shirt_linen`).
- **What it's for:** one open role set (decided 2026-10-13, contract-v3): `character`, `location`, `lighting`, `composition`, `product`, `style`, `wardrobe`, `pose`, `prop`, `texture`, `colour`, `layout`, `logo`, `palette`, `typography`, `brand_rule`, `document`, `other`, plus the free label below. The picker shows ten pills (Character, Location, Lighting, Composition, Product, Style, Wardrobe, Pose, Prop, Other) and **More…** for the rest (Texture, Colour, Layout, Logo, Palette, Typography, Brand rule, Document). The picker is a radio group. Today's `shape` and `feel` are not carried over (no importer, owner decision).
- **Role line:** each role shows one line saying what Dex takes from the picture:
  - lighting: "Dex matches its light only";
  - wardrobe: "Dex matches the clothes only";
  - layout: "Dex follows where things sit, not how they look".

  The prompt builder uses the same per-role rules, from one table in the contract. The UI line and the prompt never differ.
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
- **Look:** it stays in the text with a wavy warn underline. Use one colour on every surface, warn #b45309; artboard 3's red is changed (Q7).
- **Hover or focus:** shows "No reference called @maya_runing. Did you mean @maya_laughing?", with **Use @maya_laughing** and **Name a new picture**.
- **"Closest":** the reference with the smallest Damerau–Levenshtein distance (at most 2) on the whole name, then the best prefix match on the key, then the closest label. If nothing is that close, only **Name a new picture** is offered. At most one suggestion is shown.
- **Skye** lists unknown names in the script panel ("Make @jogger a character, or cut him").
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
- **Generate** (the area's button, as on artboards 4b and 4c) opens the send tray (3.16) with the sketch, its linked inputs and any handwriting Ellis read. The tray's **Generate** sends a ratio-true export to Runway and returns a frame at that ratio:
  - Wren renders, with the cost on the button.
  - A sketch with no words and no linked references gets Wren's ask, "What is this sketch of?", with **Use it as a layout only** (proceeds) and **Describe it** (3.17).
  - When the model's output size isn't exactly the ratio, it is centre-cropped.
  - The frame says so: "1344×756 · cropped to 16:9".
- **The new frame:** it appears to the right of the area with a `made from` link, and offers **Use in shot N**, which sets it as that shot's frame (one step). "Make another frame" makes a new version beside it.
- **The model name** always reads "<model> on Runway" ("Gemini 3 Pro on Runway"), built from a `display_name` field in the capability sheet (decided 2026-10-13). This holds on every surface: buttons, tray rows, cards, takes, toasts.
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
   - **Working:** the loader in the reading colour, with "Ellis is reading your note".
   - **Error:** "Ellis couldn't read this. Try again, or type it." The ink is unchanged.
   - **Offline:** Convert is disabled with "Needs a connection".

### 3.9 The selection bar

A floating frosted bar sits above the current selection. Its contents depend on what is selected, with the most likely action first. At most one primary (orange) button is shown, and only when the action creates something.

| Selection | Bar |
|---|---|
| Script + Storyboard | **Make video** · Plan shots · Group · More |
| Script | Open · Plan shots · More |
| Storyboard | Open · Make clips… (with price) · More |
| Video | Open · Render ad… (with price) · Make all sizes… · More |
| Reference picture | Role chip · Rename · Use in shot… · More (adds Publish to team library) |
| Frame or key visual | Open · Use in shot N · Make all sizes… · Make another · More |
| Sketch area | Generate (with price) · More |
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
- "← Canvas", Skye's mark and "Script · First Light", then "Saved".
- The view switch.
- Presence ("Sai is in shot 2 · Maya is reading").
- Undo and Redo.
- **Plan shots**, or **Update storyboard** when a storyboard exists and is behind (primary).
- The account button.

**Screenplay view:**
- **Element-type bar:** Scene, Action, Character, Dialogue, Shot, Moment, with a hint for the next element ("Tab for Character").
  - Tab and Enter cycle element types (the Trelby pattern): Scene → Action → Character → Dialogue → Action.
  - Typing `INT.` or `EXT.` at the start of a line makes a Scene.
- **Shot block:** "SHOT 2", with a camera chip ("Medium · handheld") that links to that shot in the Storyboard editor, and its length.
  - Collapsed shots show one line. The current shot expands, showing its action, inline moments, dialogue and a **Direction** row with its counter.
- **Moment:** an inline pill, "at 0:02", followed by its action. Dialogue right after it belongs to that moment's beat.
  - Insert one with **⌥M / Alt+M** (Q9), or from the element bar.
  - Time is shot time, in whole or half seconds, and must lie inside the shot ("0:05 is past the end of this 2.6 s shot").
- **Direction:** per shot, up to 4,000 characters, with the counter "318 / 4,000". The limit comes from the capability sheet, never hard-coded. At 4,000, typing stops and the counter turns warn. Pasting past the limit keeps the first 4,000 characters and says "Kept the first 4,000 characters".

**Outline rail (left):**
- Scenes and shots in order, with drag handles, thumbnails and lengths. The current item is blue.
- A coral dot marks a scene with a pending Skye suggestion.
- A warn-coloured length marks the longest shot, or one Skye flagged.
- The keys list sits at the foot: Tab, @, #, ⌥M.

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
- **Insert between rows:** hover a gap (or focus it with Tab) to show **+ Insert shot here** and **Bridge 1 → 2** (section 3.11).
- **Unknown `@names`** are underlined as in 3.6.

**Skye panel (right; close it with ×; reopen with Ask Skye):**
- **Length meter:** "15 s target · 14.2 s estimated".
  - The estimate is the sum of shot durations, with segments in proportion.
  - The current shot is blue. The longest or flagged shot is coral.
  - A target mark is drawn, with a pill for time to spare (ok) or time over (warn).
- **Suggestions:** each one is a card scoped to a scene ("Tighten scene 3 · −1.1 s"), with a removed/added/unchanged diff and the seconds it saves.
  - **Apply** (primary) changes the text in one undo step, and the card turns into "Applied. The ad now runs 13.1 s." with **Undo**.
  - **Show in script** scrolls to the scene. **Not now** hides the card for you.
- **Other suggestions** are one line each ("Make @jogger a character, or cut him").
- **Skye at work:** the loader in the writing colour (Skye coral), with what she is doing ("Timing scene 4 against the end card").
- **Ask Skye:** a text box with send. ⌘Enter sends. The answer arrives as a suggestion card, never as a direct edit.

**Plan shots / Update storyboard:**
- Dex plans the shots from the script. A free planning step runs at once. When a paid step follows, its price shows first.
- Re-planning is a merge keyed by `shotId`:
  - shots you edited keep your edits;
  - new shots are added;
  - removed scenes are asked about ("Shot 6 no longer has a scene. Keep it or remove it?").

**States:**
- **Empty script:** Skye's card "Paste a script, or tell Skye the idea."
- **Import:** a Fountain file dropped on the page imports, with Fountain's `@` character syntax remapped.
- **Offline:** typing continues and is queued.
- **Two people typing in one shot:** both carets show, and the text merges live.

### 3.11 Storyboard editor (artboard 8; review items 3, 5, 6)

**Top bar:**
- "← Canvas", "Storyboard · First Light", the ratio pill and the project.
- Presence.
- The estimate ("est. $8.00 for 5 clips").
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
- **Clip badges:** "Clip ready" (ok), "Clip out of date · frame changed" (warn) with **Remake clip** and its price, "Rendering clip" (loader), "No clip yet" (grey).
- **Hovering a frame** dims it and shows "Open in image editor". A click opens the Image editor (review item 4). Badges stay readable above the dimming.

**Insert between shots** (review item 3):
- A "+" sits at the midpoint of every gap. Hover or focus shows a dashed blue guide and a menu headed "Insert between 1 and 2":
  - **Empty shot:** "A blank card you fill in". Free, one undo step.
  - **Bridge:** "Dex draws a shot that links 1 and 2 · starts on the last frame of 1, ends on the first of 2 · about $1.60".
- **How Bridge is made:** veo3.1 runs with first = the last frame of shot N and last = the first frame of shot N+1, at a minimum of 4 s.
  - The price comes from the capability sheet.
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
   - **When the words could be either** ("make the bottle bigger"), Dex asks "Bigger how?" on the card, with a camera option and an edit option, each with its price (artboard 4c). This is an ambiguity ask, so no option is preselected or marked Recommended (3.17).
3. **Camera change:**
   - The card's affected chips keep their current values with dashed amber outlines.
   - The result shows a field-by-field diff ("angle: eye level → overhead", "size: close → wide"), "Movement and lens stay", and a "v2 new" thumbnail.
   - **Apply** writes the camera fields and makes the new frame version current, as one step, and marks the clip stale ("Apply puts clip 4 out of date").
   - **Keep both** keeps the new frame as an extra version without touching the fields.
   - **Discard** drops it. The money is already spent; the card says what it cost.
4. **Local change:** Dex sends you to the Image editor with the words in Fill area, or applies the change as an instruction edit. Either way the result returns as a new version with Apply, Keep both and Discard.
5. **When Dex used the words as given** without restructuring them (passthrough), the result says so: "Dex sent your words as they are."

**Direction** (review item 6):
- Collapsed to one line ("Direction · first words · 1,186 / 4,000"). Empty: "Add direction · 0 / 4,000".
- Expanded: a scrolling textarea and "Clips read up to 1,000 characters. Dex condenses the rest for each clip."
- The same field as in the Script editor.

**Make clips:**
- Opens the send tray (3.16), expanded, for every shot without a ready, current clip. The tray lists each clip with its inputs and price, and you can untick any. This is the spend confirm of 5.4.
- Remaking one stale clip from its badge shows the price on the button and opens the tray for that clip, collapsed to one line if you collapsed it before.

### 3.12 Image editor (artboard 9; review items 4, 5 local, 10)

**Top bar:**
- Back, "Frame 3 · Insert" and "16:9 locked · 1920 × 1080".
- Zoom (−, 100%, +, Fit).
- Presence.
- "3 edits not applied".
- The versions menu ("v3 of 3 ▾").
- **Apply as new version**, the only orange button.
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
- The panel is titled "Edits · not applied yet" and says "Nothing is spent until you run an action. v3 is never changed."
- Each edit is numbered and has its own undo. "Next: Fill Mask 1 · est. $0.08" names the next paid step.

**Layers (front first):** Text, masks, cut-outs and Frame (the locked input version).
- Each layer can be hidden.
- A cut-out offers **Save as reference**, which opens Name this picture with the role preselected.
- Upstream inputs arrive as locked layers.

**Actions** (each shows its cost before you run it):

| Action | Who | Cost | Notes |
|---|---|---|---|
| Remove background | Rhea | free, on your device | Uses the relay automatically when WebGPU is missing or memory is low, and then says "ran on our server". |
| Fill area | Rhea (Runway generates) | from the sheet | Runs on the selected mask only: "Only the blue area changes". "Keep the label exactly as it is" is on by default (maps to `preciseEdit`, to verify, Q13). The run button is dark, not orange. |
| Change whole frame | Rhea | from the sheet | A prompt redraws the whole frame. |
| Upscale | Rhea | from the sheet | 2× or 4×, showing the output size ("→ 3840 × 2160"). |

- The panel footer shows the project's spend ("$12.40 of $200").
- Paid actions go through the send tray (3.16), which lists the frame, the mask and the words, and names the model ("<model> on Runway").
- A result lands as a new layer in the op list. Nothing changes the stored version until Apply.
- **Arriving from Jude's brand flag** ("Fix in image editor", 3.18), the editor opens on that frame with the rule shown at the top of the Edits panel ("Logo clear space: one bottle-cap height"). Nothing runs until you choose an action.

**Apply as new version:**
- Saves v(n+1) as `kind: edited`, leaves v(n) as it was, and makes v(n+1) the shot's current frame on the storyboard (one undo step).
- It marks that shot's clip stale.
- The versions menu says beforehand what Apply will make: "Apply saves your 3 edits as v4. v3 stays."

**Before / After** toggles the view. Before hides masks, cut-out outlines and text, and labels the frame "Before · v3 as saved".

**Pointer during a running action:** the busy pointer (section 6) in the retouching colour (Rhea mint). The masked area shows the pending stripes.

### 3.13 Video editor (artboard 10; review items 7, 8)

**Top bar:**
- "← Canvas", "Video · First Light" and "16:9 · 15 s".
- The running-job pill ("Wren · renders: shot 5, take 2 · about 0:40 left · started by Sai").
- Presence.
- Ad versions (v1, v2), with **Compare**.
- **Render ad** (primary, with its price in the confirm).

**Preview:**
- A 16:9 player on the current shot, with the shot caption and take ("Shot 4 · Close · take v3 patched").
- Below the player:
  - frame back and forward, play, and the timecode ("0:07.2 / 0:15.0");
  - **Loop the note window**;
  - **+ Note at 0:07.2**;
  - mute and full screen.
- When a note is ahead, a cue reads "Note at 0:03 in 1.8 s". It counts to the note's moment, not to the window start.

**Time rule (decided here, applies on every surface):**
- Whole-ad positions use **ad time**: the ruler, the playhead, the player timecode, and the phone scrubber and notes list.
- Anything inside a shot uses **shot time** and always names the shot: moments, beats, note windows, patch ranges, take segments. For example: "shot 4 at 0:03".
- Where both help, show both: "shot 4 at 0:03 · ad 0:09".

**Timeline rows:** Notes, Shots (the magnetic main track), Beats, Voice-over, Music.
- **Toolbar:** Magnetic, Split at playhead, + Beat, "Fits 15 s exactly" (or warn), "2 open notes", and zoom.
- **Main track:** drag a clip to reorder, and the track closes gaps itself. Same rank write and drift marks as the storyboard.
  - A clip shows its take ("4 · Close · v3").
  - A spliced range is drawn in the cutting colour, with a crossfade edge ("patched 0:02-0:04").
  - A clip being rendered shows the loader ("take 2 rendering").
- **Beats:** diamonds at exact times, with labels. Beats move with their shot.
- **End card:** the last clip, edited like any shot.

**Notes to windows** (review item 8):
1. **+ Note at <playhead>**, or N, adds a note at the playhead on the shot under it, written as `reviews[id]{range}`.
2. **The window** defaults to `[floor(t) − 1, ceil(t) + 1]` in shot time.
   - It is clamped to the shot, and is never less than 2 s wide. Near a cut it shifts inward rather than shrinking.
   - It never crosses a cut.
   - Whole seconds only, because Aleph 2 on Runway takes whole-second ranges. The panel says so: "Whole seconds only. The rest of the shot stays as it is."
3. **Adjusting the window:**
   - Selecting a note widens it on the timeline into a shaded window with blue handles. The shading runs down through every row.
   - Drag the handles (they snap to seconds), or use the From/To fields (m:ss) and the mini strip in the right panel. All of them move the same window.
4. **Still at the moment:** the panel shows "Still at 0:03. The fix aims for this frame." **Edit still** opens it in the Image editor before the fix runs.
5. **Fix this moment** (primary in the panel) shows "Edie · edits: regenerates only 0:02-0:04 on Aleph 2 on Runway and splices it back · about $0.56".
   - The result is a **new take** (v3, parent v2) that replaces its parent in the cut.
   - The seams get short crossfades.
   - Jude checks both seams ("v3's seams at 0:02 and 0:04 match the take around them").
6. **The note stays open** after a fix. Running Fix again makes v4. **Resolve** closes the note.
7. **Fallback** when Aleph 2 isn't available: Veo 3.1 first/last frame over the window, generated at 4 s and trimmed. The panel says so before you run it ("Aleph 2 on Runway isn't available. Veo 3.1 on Runway will make 4 s and we'll keep the 2 s you need · about $1.60").

**Make all sizes** (in the top bar's More, and on the Video node) makes the cut-downs of the film: 9:16, 1:1 and 4:5 from the 16:9 film, reframed with subject tracking. They are part of the first release. Section 3.19 has the flow.

**Takes for a shot:** a list of v1, v2 and v3, each with the model ("Veo 3.1 on Runway"), length, who made it and when. **Use** puts a take in the cut (one undo step). **Another take** shows its price.

**Render ad:** a free render runs at once ("Render the ad · 15 s · free"). A render that remakes clips opens the send tray with the cost (5.4).
- Edie edits. The result is a new ad version.
- A render with stale clips asks first: "2 clips are out of date. Render anyway, or remake them first?"

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
- **Composer** (pinned): "Leave a note at 0:07 · changes only 0:06 to 0:08", a text box, and **Leave note at 0:07** (52px, orange).

**Rules:**
- **Seeking:** tapping a marker, a shot or a note row seeks there and pauses. The playhead, window, timecode, composer label and button label all update together.
- **The phone window** uses the same rule as 3.13, clamped to the shot, not the ad. Artboard 11's "clamped to 0..15" is changed; Q10.
- **Notes belong to a render version.** A note turns Done when a later version patches it.
- **Presence** shows who is editing. There are no cursors.
- **When the ad is rendering,** the player shows the loader in the cutting colour, with "Edie is cutting v3 · about 1 min".

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

**The send tray, "What Dex will send".** Every paid generation opens it: Generate on a sketch area, Make clips, Remake clip, Bridge, Change this frame, Fill area, Change whole frame, Upscale, Fix this moment, Make all sizes, and a Render ad that remakes clips. Free and on-device work has no tray.
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
- **Footer:** the model, ratio and price ("Gemini 3 Pro on Runway · 16:9 · about $0.20"), **Cancel** and **Generate** (primary).
- **Collapsed** it is one line: "Sketch, 4 inputs, 1 note · $0.20", with **Generate** and an expand control. ("Note" counts handwriting or notes Ellis read.) The collapsed state is remembered per person. Batches and anything over the confirm threshold always open expanded (5.4).
- **Nothing is sent until the tray's Generate.** Cancel or Esc closes it; nothing is spent and nothing on the canvas changes. Generate starts a job, which Stop ends (undo never cancels a job, 4.5).
- **States:** offline, Generate is disabled with "Needs a connection". At the cap, "Monthly limit reached". While the inputs are still loading, rows show the pending stripes and Generate waits.

### 3.17 Asks (artboard 4c)

An ask is how an agent gets an answer instead of guessing (principle 6).

**Shape.** The same as the Research tool's clan Ask: `question{id, text, options[{id, label, value?}], allow_text, address}`. The job waits in `needs_input`. Two fields are new and go into contract-v3: `recommended` (an option id, or none) and, per option, `cost` and `detail` ("6 shots · about $1.20 for frames"). The answer is the person's confirmed choice, written as `by: human:<id>` to the node it settles and appended to History.

**Three kinds:**
- **Hard block,** only when no option can proceed. Example: a Video with nothing linked or described. "What should this video be? Nothing is linked to it yet, so I have nothing to direct from." Options: **Describe it** (a text box: "Describe it in a line or two. Type @ to pull in a character, place or product."), **Link a script**, **Link a storyboard**. The primary button shows the price ("15 s · about $7.20 · Make it").
- **Nudge.** At least one option proceeds, and one may be marked **Recommended**. Examples: "Plan a storyboard first?" (3.5); a sketch with nothing to go on, "What is this sketch of?", with **Use it as a layout only** and **Describe it** (3.7).
- **Ambiguity.** The words could mean two things ("Bigger how?" in Change this frame, 3.11). No option is preselected or recommended.

**The ask card:**
- Anchored to its node, not modal. The node shows "Waiting for you · Make video".
- Orange needs-you border, the Research tool's rule.
- Signed by the agent who owns the step: Dex for planning and direction, Wren for renders.
- The question, one line of why, the options as buttons with their cost or detail, and the text box when `allow_text` is true. `@` works in the text box.
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
- The questions pill counts every open ask in the project, not only the ones you caused. An ask raised by someone else's job still charges that job's starter (4.3).

### 3.18 Assets, the team library and brand (artboard 4d)

**The Assets drawer** opens from **Assets** in the top bar. It takes the board rail's place. ⌥1…⌥9 keep working. **Boards** (⌥0), or ×, swaps the rail back. Four tabs:
- **This project:** everything in the project, by role.
- **Team library:** shelves per client, within the agency (below).
- **Upload:** pick or drop files. Each kind lands as in "Dropped files" below.
- **From Napkin:** spin-ins waiting from Brief Maker and Research.

**Team library.**
- One shelf per client ("Client shelf · Napkin Studio": Lumen Water, Harbour Bank, Kettle & Co). Everyone in the agency shares it: "Shared with everyone at Napkin Studio". **Manage shelves** adds, renames and archives client shelves.
- A shelf holds a **Brand kit** ("v2 · published by Maya": Logo · 3, Palette · 5, Fonts · 2, Tone · 6), then Characters, Locations, Products and the rest by role.
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

Exports are free. A large export shows its progress in a toast and lands as a download.

### 3.19 Formats: scamp sheets and Make all sizes (artboard 4e, not drawn yet)

**Scamp sheets.** **Sheets** on the toolbar opens the pack picker: Social, Out of home, Print, Digital display, Film storyboard frames, and Custom per client (packs saved on the client's library shelf). Each pack lists its formats with their sizes.
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
4. The send tray lists every size with its method and price (a plain crop is free) and the total. You can untick sizes.
5. The results land as a **Format set** node linked to the master (`master`), one tile per size. Jude flags brand-rule breaks per size, with Fix in image editor and Ignore.
6. **Export zip** downloads one zip with every file named by format and size.

- **Video cut-downs** are part of the first release: 9:16, 1:1 and 4:5 from the 16:9 film, reframed with subject tracking. Wren makes them the same way, and they land as a Format set of the film.
- **When the master changes,** the set goes out of date ("Master changed · 3 sizes out of date"), with **Update sizes** and its price.
- **Undo:** Make all sizes is a job, so undo never cancels it (4.5); Stop does. Deleting the set is one undo step, as for any node.

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
  - Its cost goes to the starter's budget ("On Maya's budget").
  - Anyone can stop it, but stopping someone else's job asks first: "Stop…" opens "Maya started this. Stop it anyway?"
- **Pressing a button whose job is already running** (same node, operation and inputs) starts nothing. The button shows "Running, started by Maya" (in-flight dedupe).
  - **Another take** is never deduped, because it sends a client nonce.

### 4.4 Conflicts

- **Shared live text never conflicts.** Script body, shot action, direction, beat text, dialogue and note text are shared live text: both people type at once and see each other's carets.
- **Single-value fields** (camera fields, duration, names, roles, ratio, window edges, the selected take or version):
  - Concurrent changes to different fields both apply.
  - When two changes to the same field cross, the field shows a conflict notice to the person whose change lost: "Sai changed this field while you were typing", with both values side by side.
  - **Keep yours** (ink, the default) re-applies your value. **Take Sai's** accepts theirs. Nothing is overwritten until you choose.
  - Artboard 12 draws this on shot action, which is shared live text. The example should move to a single-value field (redraw R3 in 12.1).

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
- The person whose job raised the ask is still its starter: its cost stays on their budget.

### 4.8 The team library is shared across the agency

- Library shelves are per client and shared by everyone in the agency (3.18). Publishing a new version replaces the old one in the library for everyone at once.
- Projects never change under you: each keeps its copy until someone in it presses Update.
- Two people publishing the same item at once: the second gets "Maya published v5 a moment ago. Publish yours as v6?"

---

## 5 Jobs and the crew

### 5.1 Who appears for which work

| Agent | Sign-off | Appears for | Where |
|---|---|---|---|
| Dex | Dex · directs | planning shots, writing prompts (with brand rules), the send tray, camera changes, Bridge, condensing direction, asks about planning and direction | Storyboard node and editor, camera fields, the insert menu, the send tray |
| Skye | Skye · scripts; Skye · scripts | script drafts (including from a spin-in), rewrites, length fixes, unknown-name suggestions; looking up looks and references | Script node and editor, the Skye panel, References board |
| Wren | Wren · renders | Runway making a frame or clip, Make all sizes, video cut-downs, asks about renders | empty frames and clips, Video board, Format sets, jobs |
| Rhea | Rhea · retouches | cut-out, fill, change whole frame, upscale, character-sheet crops | Image editor, character sheets |
| Edie | Edie · edits | splicing moments, rendering the ad | Video editor, phone player |
| Ellis | Ellis · reads | reading notes and handwriting, extracting text from files, briefs, brand books and documents | ink, notes, Convert to text, Brand board, Document nodes, the send tray's "confirm" rows |
| Jude | Jude · checks | checking each result, seams, retries, brand-rule breaks (per size in a Format set) | check marks and brand flags on frames, clips and sizes |

- **Agents speak in short, signed lines.** Their figures are 20–28px inline, with three states (artboard 13):
  - **Idle.**
  - **Working:** an arc in the agent's colour.
  - **Needs you:** one orange dot at the top right.
- **The figure says who. The loader (section 6) says what kind of work.** The two are separate signals.
- **This crew replaces today's three-member `ui/agents/cast.ts`.** Today Dex is shown for every make. In the new crew, Wren is shown while Runway renders.

### 5.2 Asking (needs_input)

- **When an agent needs an answer,** its job enters `needs_input`. Its node and the jobs list show the agent with the needs-you dot, and the ask card opens on the node (3.17).
- **Answering** resumes the job and is recorded as a human write (`by: human:<id>`), appended to History. Anyone in the project can answer (4.7).
- **A job waiting for an answer is not working:** the loader stops, and the busy pointer does not show for it.
- **It never times out into a guess.** It waits until someone answers or stops it.
- Section 3.17 has the shape, the three kinds of ask, the card and the questions pill.

### 5.3 Job states and their copy

Job states extend `JOB_STATES` in `contracts/types.ts` with `needs_input`. "Refused" is `failed` with a moderation code.

| State | Card pill | Line (exact copy, values vary) | Actions | Charged |
|---|---|---|---|---|
| queued | In the queue | "In the queue, 2 ahead · about 1:30" | Cancel | no |
| submitting | Sending | "Sending to Runway…" | Cancel | no |
| submitted / fetching | Rendering | "Wren · renders · about 0:40 left" (progress bar when Runway reports it) | Stop | yes, when it completes |
| validating | Checking | "Jude · checks @maya matches" | — | — |
| needs_input | Waiting for you | the agent's question | the options · Later | no |
| completed | Done | "Checked by Jude · 1 min ago" | Download · Open | yes, cost shown ("$1.20") |
| failed | Failed | "Runway is busy. Try again." (the reason in plain words) | Retry | "Not charged" |
| failed (moderation) | Refused | "Runway refused this picture. Change the words or the picture." | Change the picture · Edit the words | "Not charged" |
| uncertain | Unsure | "Checking with Runway…" | — | "not charged twice": reconciled by task id, never resent blindly |
| cancelled | Stopped | "Stopped by Maya." | Make again | as the relay reports it (Q14) |
| (take) patched | Patched | "Edie · edits · 2 s replaced" | Compare | yes |

- **Shared jobs** add "Started by Maya" with her avatar, and "On Maya's budget".
- **Errors** say what happened and what to do, never a code alone. The code is in smaller mono under the message, as today's `.errnode .code`.

### 5.4 Spend confirmations and caps

- **Prices on buttons.** Every paid button shows its estimate from the capability sheet ("Bridge · about $1.60", "Fill area · $0.08"). Prices are never hard-coded in the UI.
- **The send tray is the spend confirm.** Every paid generation goes through it (3.16). It always opens expanded, even if you collapsed it before:
  - for any batch (more than one paid job at once: Make clips, Make all sizes, Render ad with remakes, Update shots with frames);
  - for any single action estimated above **$2.00** (Q11).

  Expanded for a batch it reads "Make 6 clips · about $7.20 · you have $187.60 left this month", with the cost line "6 clips × 3 s · Veo 3.1 Fast on Runway · $1.20 each" and "Not charged if Runway refuses or fails". The buttons are **Cancel** and **Generate** (primary). Items in a batch can be unticked, and the total follows.
- **Caps.**
  - The monthly per-tenant cap is set by Napkin. Tenant admins can lower it (D16).
  - At 80% the spend pill turns warn.
  - At 100%, paid buttons are disabled with "Monthly limit reached. Your admin can raise it."
  - A batch that would cross the cap asks to run only what fits ("4 of 6 clips fit your limit").
- **Free and on-device work** never asks.

### 5.5 Fallbacks

- **Fallback stays inside Runway's models** (Runway is the only paid generator in this overhaul).
- **When the chosen model can't make something,** the relay makes it on another Runway model and says so:
  - A toast reads "Veo 3.1 on Runway couldn't make clip 4, so we made it on Gen-4 Turbo on Runway. Napkin's got you." It closes after 9 s, as today's `FallbackNotices.tsx` does.
  - The card keeps a "Made on Gen-4 Turbo on Runway" chip whose hover gives the reason.
- **A passthrough, a crop or a condensation** is said where it happened (sections 3.7, 3.11, 3.10).

---

## 6 The loader and the busy pointer

This replaces today's `.spinner` (a grey ring with an orange top, `styles.css:231`) everywhere. It answers the owner's request: one sector following another to form a circle, with a colour saying what kind of processing is running, and the same mark used as the loading state on the pointer.

### 6.1 Shape and motion

- **The loader is the Napkin mark (`ui/Mark.tsx` StudioMark):** a disc of four 90° sectors rotated −45°.
- **Track.** Underneath, the four brand quadrants sit at 18% opacity, so the mark is always recognisable. A hairline in the background colour separates the sectors.
- **Sweep.** The sectors light one after another, clockwise from the top (top, right, bottom, left):
  - Each starts 0.25 s after the previous one.
  - Each scales from 0.55 to 1 while it fades in, so the disc fills sector by sector.
  - The sectors hold, then fade out in the same order (scaling to 1.06), handing over to the next round.
  - One round takes **2 s**. The CSS is the `lm-sweep` keyframes in artboard 14.
- **Waiting** (queued, submitting): the track only, with one sector stepping slowly in neutral ink3. No work colour shows yet, because no work has started.
- **Finished:** the sweep stops. The node or card shows its done state. Whether the mark first settles into the full brand mark for 0.6 s is Q1.

Artboards 2, 5, 6 and 8 draw 8 sectors, artboard 12 draws 12, and artboard 10 draws 6 static sectors. All of them change to this four-sector mark, in the colours of 6.2 (12.1).

### 6.2 Colour: the work's colour, from the Loader artboard

**Decided 2026-10-13: the loader uses artboard 14's mapping.** The track keeps the four brand quadrants and never carries meaning. The sweep takes the colour of the kind of work, which is the tone of the crew member who does it. This replaces the earlier recommendation to sweep in the logo's own quadrant colours.

| Kind of work | Sweep colour (light theme) | Agent | Covers |
|---|---|---|---|
| Reading | Ellis ink #14161B | Ellis | notes, handwriting, files, briefs, brand books, documents |
| Planning | Dex cobalt #2F64F5 | Dex | shot plans, prompts, the send tray, camera changes, Bridge, condensing direction |
| Rendering | Wren marigold #FFC023 | Wren | frames, clips, Make all sizes, video cut-downs |
| Retouching | Rhea mint #6CD3A2 | Rhea | cut-outs, fills, change whole frame, upscale, character-sheet crops |
| Cutting | Edie iris #7D52F4 | Edie | splicing moments, rendering the ad |
| Writing and researching | Skye coral #FF6A55 | Skye | script drafts and rewrites; looking up looks and references |

- **Checking** (Jude) has no colour of its own in the mapping. It uses the reading ink, which is also Jude's figure colour (artboard 13), next to "Jude · checks". Q16 asks the owner to confirm.
- **Artboard 14's legend pairs each kind with its agent's figure,** whose shape differs per agent, so a legend never relies on colour alone.

**Rules:**
- **Colour is never the only signal.**
  - From 32px up, the agent line or title always sits next to the loader.
  - At 14px and 20px, the words come from the hover or focus label, a toast, or the nearby status line.
  - This matters most for marigold and mint, which fall below 3:1 on white. The words carry the meaning.
- **The loader is the brand mark, not a button,** so its colours do not break the rule that action orange is for primary buttons only.
- **Dark theme:** Ellis ink is drawn in the dark `--plan` value #F2F3F5. The other five tones keep their values; where one falls below 3:1, the words beside it carry the meaning, as on white.
- **States with no kind of work** use the colour of their context, never a seventh colour:
  - offline uses warn #b45309;
  - uncertain uses ink3, next to "Checking with Runway…".
- **The figure and the loader now say the same thing** (who, and so what kind). That is accepted: the loader's colour lets a 14px pointer badge or a presence cursor say who is working where no figure fits.

### 6.3 Sizes and places

| Size | Where | Next to it |
|---|---|---|
| 14px | busy pointer badge; presence cursors | hover-hold label |
| 20px | status pills, toasts, crew status lines, frame and clip badges, inline lines ("Wren is drawing frame 6") | the line |
| 32px | job cards, node status, the masked area in the Image editor | agent sign-off, time left, Stop |
| 64px | a page or panel loading for the first time | a title |

- **Accessibility.** Loader SVGs are `aria-hidden`. The words beside them live in a `role="status"` `aria-live="polite"` region ("Wren is rendering clip 4"). On iPad, a loader on a node has `role="img"` and a label such as "Wren is drawing frame 6".

### 6.4 Reduced motion

There are two triggers:
- the system's `prefers-reduced-motion`;
- the app's own **Reduce motion** setting, in the account menu (per person, stored locally).

Either one switches every loader to the full disc, still, in the work colour, with a slow opacity pulse (1 → 0.5 over 2.4 s, no stagger). It also stops the pending stripes and board-jump animation. Legend and swatch loaders are always flat.

### 6.5 The busy pointer

- **When it shows:** while at least one job **you started** is in progress (queued through validating, or uncertain), on the canvas and in every editor.
  - It does not show for `needs_input`; the needs-you dot shows instead.
  - It does not show for other people's jobs.
- **What it is:**
  - The system arrow stays exactly as it is, so precision and every pointer type are kept.
  - A 14px loader on an 18px white disc follows the pointer at an offset of (+11, +15) px.
  - It is a DOM element with `pointer-events: none`, positioned with `transform` on `pointermove` (CSS cursors can't animate).
  - `cursor: progress` is the fallback when the element can't render.
- **Several jobs at once:** the badge shows the kind of your most recently started job, with a small count when more than one is running ("2").
- **Label:** after the pointer is still for 0.6 s, or on keyboard focus of the badge's status, a dark pill appears: "Wren is rendering frame 3 · started by you". It hides on the next move.
- **It hides:**
  - during a pen stroke, a drag, a port drag or brush painting, and reappears on release;
  - when the pointer leaves the window;
  - on touch devices, which have no cursor. On iPad the loader shows on the node or frame being worked on.
- **Presence cursors** carry a 14px badge in the colour of that person's own running job, so you can see "Sai is planning" at her cursor.
- **Phone:** no pointer. The loader appears in the player and the notes list only.

---

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
| Script | ⌥M / Alt+M | Add a moment at the caret (Q9) |
| Script | ⌘Enter in Ask Skye | Send |
| Lists (outline, AV, storyboard, timeline) | Space, ↑↓, Space or Esc | Lift, move, drop or cancel a shot |
| Image editor | V A B L E T C H, [ ], Space-drag | Tools, brush size, pan |
| Image editor | ⌘Enter | Apply as new version |
| Video editor | Space / K | Play / pause |
| Video editor | J / L | Back / forward 1 s |
| Video editor | , / . | Back / forward one frame |
| Video editor | N | Note at the playhead |
| Video editor | [ / ] with a note selected | Move the window start / end by 1 s |
| Video editor | S | Split at playhead |

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

- **Contrast.** Text meets 4.5:1. Large text (19px bold or 24px and up) and non-text UI meet 3:1. The house tokens fail in four places. Decided here; the owner confirms in Q8:
  - **ink3:** #737987 measures 4.36:1 on white and 4.03:1 on soft. It moves to **#6B7180** (4.88 on white, 4.52 on #F5F6F8), as artboard 14 already uses.
  - **Primary button:** white on action orange #FF4F2E measures 3.28:1. The button background moves to **#D63B1F** (4.66:1), with the brand orange kept for the mark and the loader. The alternative is primary labels at 19px bold and up.
  - **Blue text on its tint:** blue text on a 10–12% blue tint uses **#1E4ED8**.
  - **ok text:** ok text uses **#166534** on #e7f6ed.
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
- **Motion:** section 6.4. Nothing flashes more than three times a second.
- **Live regions.**
  - Job completions are announced politely ("Frame 3 is ready").
  - Failures are announced assertively, once.

---

## 10 Copy rules and glossary

**Rules:**
- **Point of view.** Write from the user's side, in the imperative, for buttons: "Make video", "Insert a shot here", "Leave note at 0:07". Write in the first person for agents ("I will mark clips 2 and 5 to check"), signed "Dex · directs".
- **Short sentences.** Most lines are under 12 words. No jargon (no "EDL", "inpaint" or "token" in the UI), no lorem ipsum, no rationale text.
- **Models.** Always "<model> on Runway" ("Gemini 3 Pro on Runway", "Veo 3.1 Fast on Runway"), from the capability sheet's `display_name`. Never a raw model id.
- **Money.** Always dollars ("$0.08", "about $1.60"). Credits are shown only next to dollars where Runway's credits matter ("8 cr · $0.08"). Use "about" for estimates.
- **Time.** m:ss (or m:ss.s) in Geist Mono. Shot time always names the shot (3.13).
- **Names.** `@names`, `#shots`, versions (v3) and timecodes are mono. `@refs` are blue.
- **Certainty.** In words ("sure of it"), never percentages.
- **Errors.** Say what happened and what to do next ("Runway is busy. Try again."). Say whether you were charged.
- **No exclamation marks** except in quoted script lines. **No emoji.**
- **Capitals.** Sentence case everywhere. Mono tags (PLANNING, RENDERING) are uppercase.

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
| Started by | The person whose action began a job and whose budget pays for it. |
| Scope | What a generating node uses: only what is linked to it. |
| Inputs strip | The row of chips on a generating node naming each linked input. |
| Send tray | "What Dex will send": every input, the model and the price, shown before anything goes to Runway. |
| Ask | A question an agent puts to the project instead of guessing. Anyone in the project can answer. |
| History | The record of answers and choices, with who made each. |
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

---

## 11 Laurence's review items, and what solves each

| # | Item | The interaction that solves it | Where | Acceptance test (Laurence suite) |
|---|---|---|---|---|
| 1 | Art boards with jump nav | Board rail by rank; click to fit; ⌥1–9 and ⌥0; iPad pill and sheet; Ad template boards | 3.2; artboards 1, 3, 5 | Open a template project and press ⌥3: the canvas fits Locations and the rail marks it current. |
| 2 | Open reference roles | Drop on a board takes the board's role, with an inline chip and no dialog; Name this picture with the one open role set (ten pills + More, incl. logo, palette, typography, brand rule, document) + free label; per-role line on what Dex takes | 3.6; artboard 3 | Drop a picture on Locations: it becomes `@loc_<file>` with role location, and no dialog opens. Drop one outside boards, pick Wardrobe and label it: the prompt says "match the clothes only". |
| 3 | Insert a shot between frames, drag reorder, Bridge | "+" in every gap with Empty shot and Bridge (priced); dnd-kit drag with a drop line and drift marks; the same in the outline, the AV table and the timeline | 3.10, 3.11, 3.13; artboards 6, 7, 8 | Insert a Bridge between 1 and 2: a new shot 2 starts on 1's last frame and ends on old 2's first. Drag shot 5 between 2 and 3: frames are kept, and clips 2 and 5 are marked to check. |
| 4 | Full-screen frame editing | Click a frame to open the Image editor route; zoom and pan; tools, layers, masks; Apply as new version | 3.12; artboards 8, 9 | Click frame 3, paint a mask, fill it, Apply: v4 exists, v3 is unchanged, shot 3 shows v4. |
| 5 | "Change this frame" understood | Dex classifies the words. A camera change gives a field diff on the shot's camera chips (dashed until Apply). A local change goes to the mask and fill in the Image editor. Passthrough is said. Words that could be either ("bigger") get Dex's "Bigger how?" ask, with no default. | 3.11, 3.12; artboards 8, 9 | Type "make this an overhead aerial shot" on shot 4: the diff shows angle → overhead and size → wide, and Apply writes both fields and marks clip 4 out of date. |
| 6 | Long performance direction | Direction up to 4,000 with a live counter from the capability sheet; "Veo 3.1 on Runway uses the first 1,000, Dex condenses"; See Dex's 1,000 | 3.10, 3.11; artboards 6, 7, 8 | Paste 1,240 characters: all are kept, the counter reads 1,240 / 4,000, and the clip prompt carries Dex's ≤1,000 version. |
| 7 | Timed moments inside a shot | Inline Moment pill (⌥M) in the screenplay; moments track and Line tied to a moment in AV; Beats row in the Video editor | 3.10, 3.13; artboards 6, 7, 10 | Add "at 0:02 her eyes open; she says 'It's perfect!'" in shot 4: a beat at 0:02 and a line at 0:03 appear on the timeline, and the clip prompt carries the timestamps. |
| 8 | A note patches only ~2 s | A note becomes a whole-second window, shown on the timeline and phone scrubber; Edit still; Fix this moment (Aleph 2 on Runway, priced) makes a patched take spliced with crossfades; Jude checks the seams | 3.13, 3.14; artboards 10, 11, 12 | Leave a note at shot 4, 0:03: the window is 0:02–0:04, the fix costs about $0.56, and v3's frames outside 0:02–0:04 match v2's exactly. |
| 9 | @ autocomplete with thumbnails by role, unknown names underlined | Shared MentionInput: grouped popover with thumbnails, label matching, `#` shots; each row names its board; picking an unlinked reference links its board or group, with Undo; unknown names get a warn underline, "Did you mean" and "Name a new picture"; nothing is dropped at generation | 3.6, 3.10; artboards 3, 6, 7 | Type "@ma": Characters group first with thumbnails. Type "@maya_runing": underlined, with "Did you mean @maya_laughing?". |
| 10 | Ratio-locked 16:9 sketch area returns 16:9 | Sketch area tool with a ratio picker; the ghost keeps the ratio; Generate goes through the send tray; the export is the area; the result is cropped to the ratio and says so; the Image editor crop keeps the ratio | 3.7, 3.12; artboards 4, 5, 9 | Draw a 16:9 area, sketch, Generate, then Generate in the tray: the frame is exactly 16:9 and says "cropped to 16:9". Repeat for 9:16. The send tray listed the sketch and its inputs before anything was sent. |
| 11 | Handwriting to editable text; scribbles move as one group | Strokes cluster into an ink group; Convert to text opens Ellis's preview with editable text and @ chips; Keep replaces the ink, which is kept for Back to ink and undo | 3.8, 8; artboards 4, 5 | Write "more golden light, she should laugh", Convert, Link it, Keep: text with @maya_laughing appears, and one undo restores the strokes. |


### 11.1 Owner additions (2026-10-13), and what solves each

| Decision | The interaction | Where | Acceptance test |
|---|---|---|---|
| Inputs and scope | Links set scope (one per board or group, one per single reference); inputs strip; focus on select dims the unlinked; "Used by" card; Show all links | 3.4, 3.16; artboard 4b | Select the Storyboard: Loc1 · Coast glows, @loc1_beach shows "shots 1, 2", Loc2 · City dims. Pick @loc2_rooftop in `@`: Loc2 · City is linked with an Undo toast; Undo unlinks it and underlines the mention. |
| Send tray | "What Dex will send" on every paid generation, rows with checkboxes, Ellis's reading marked confirm, nearby notes unticked with Include, "<model> on Runway" and price | 3.16, 5.4; artboard 4b | Generate on a sketch area: the tray lists the sketch, 4 inputs and 1 note at $0.20; nothing reaches Runway until the tray's Generate. |
| Asks, shared | Anchored ask cards signed by the step's owner; hard block only when nothing can proceed; Recommended on nudges, no default on ambiguity; Later; questions pill; "You chose … · in History" with Change; anyone can answer | 3.17, 4.7, 5.2; artboard 4c | Make video from a script alone: Dex asks "Plan a storyboard first?" with Plan first marked Recommended. Sai answers from her laptop: History shows "Sai chose: plan the storyboard first". |
| Assets and team library | Assets drawer in the rail's place; shelves per client shared across the agency; items with version and publisher; publish replaces for everyone, projects keep their copy | 3.18, 4.8; artboard 4d | Publish @ext_beach v5: the library shows v5 for everyone; an open project still uses v4 and offers Update. |
| Brand rules | Brand book becomes a Brand board as Ellis reads; no font files from a PDF; Dex writes rules into prompts; Jude flags with Fix in image editor / Ignore; never blocks | 3.18; artboard 4d | Drop a brand PDF: the Brand board appears at once and fills page by page; fonts show "no file". A frame with the logo at the edge gets Jude's clear-space flag and still lands. |
| Character sheets, documents, spin-in, export | Rhea proposes crops (Confirm/Adjust); DOCX becomes a Document node used once linked; spin-in card waits for Bring in; Export menu | 3.18; artboard 4d | Drop maya_sheet.png: no reference exists until Confirm. Not now on a spin-in leaves it under From Napkin. |
| Scamp sheets | Sheets opens the pack picker; a pack drops a board of labelled, ratio-locked sketch areas | 3.19; artboard 4e | Pick Social: a sheet lands with one area per format, each labelled with format and size. |
| Make all sizes, cut-downs | Wren adapts the master per format (crop, extend, nearest ratio), safe areas per the Brand board, ask when the subject is unclear, tray lists every size and total, Format set node, Jude per size, one zip; video cut-downs in the first release | 3.19; artboard 4e | Make all sizes on the key visual with Social: the tray lists every size and the total; the Format set links to the master; the zip's files are named by format and size. Make all sizes on the film gives 9:16, 1:1 and 4:5 cut-downs. |

---

## 12 Redraws and open questions

### 12.1 Redraws (decided, no question)

- **R1 Loader.** Artboards 2, 5, 6 and 8 draw 8 sectors, artboard 12 draws 12, and artboard 10 draws 6 static sectors. All change to the four-sector mark in the colours of 6.2 (artboard 14's crew-tone mapping). Artboard 14 keeps its mapping; its "logo colours" alternative can go.
- **R2 Model names.** Every model name reads "<model> on Runway": artboard 4 ("Gemini 3 Pro"), artboard 4b's tray footer, and every take, chip and toast that names a model.
- **R3 Conflict example.** Artboard 12 draws the conflict notice on shot action, which is shared live text and never conflicts (4.4). It moves to a single-value field, such as a reference name or a camera field.
- **R4 Sketch area button.** Artboard 4's "Make a frame" becomes **Generate**, as on 4b and 4c, and opens the send tray.
- **R5 Role picker.** Artboard 3's Name this picture shows ten pills and More…, with More holding Texture, Colour, Layout, Logo, Palette, Typography, Brand rule and Document (3.6).
- **R6 Formats.** Artboard 4e is listed but not drawn. It should show the pack picker, a dropped Social sheet, the send tray for Make all sizes with every size and the total, a Format set with one of Jude's per-size flags, and the cut-downs of the film.

### 12.2 Open questions for the owner

Each question has a recommendation. The build follows the recommendation unless the owner says otherwise. Questions marked **(redraw)** need artboards changed either way.

Answered on 2026-10-13 and removed: the loader colour model (crew tones, 6.2), who researches (Skye, as artboard 14 signs it), the role set (3.6), a running node during a link drag (never dimmed, 3.4), model names ("<model> on Runway"), whether asks are shared (yes, 4.7), and artboards 4b and 4c (drawn).

1. **Finish settle.** Should the loader settle into the full brand mark for 0.6 s when a job finishes? Recommended: yes, except under reduced motion.
2. **Sketches board.** Artboards 4 and 5 add a "Sketches" board, which the plan doesn't define. Recommended: sketch areas live on any board, and the Ad template gets no Sketches board. People can add one with the "sketches" purpose. Scamp sheets (3.19) are their own `formats` boards either way.
3. **Board name prefixes.** A name is key_view and keys have no underscore, so a board's prefix is the key. Recommended: each board has an editable prefix (Locations `loc`, Characters from the first character's key). `ext`/`int` stay a user choice.
4. **Selection bar during a port drag.** It is hidden (artboard 2 shows it only to fit one frame). Confirm.
5. **Board sheet on iPad.** A tap outside closes it. Confirm.
6. **Per-role lines.** The Name dialog's "Dex matches its light only" lines and the prompt builder share one table in the contract. Confirm this goes into contract-v3, with lines for the new roles (logo, palette, typography, brand rule, document).
7. **Unknown-name underline colour (redraw).** Warn #b45309 everywhere. Artboard 3 uses red. Confirm.
8. **Contrast tokens (redraw, all artboards).** ink3 → #6B7180. Primary button background → #D63B1F, with the brand orange kept for the mark. Tint text → #1E4ED8. ok text → #166534. Or keep #FF4F2E and make primary labels 19px bold.
9. **The Moment shortcut.** ⌘M minimises the window on macOS and can't be overridden. Recommended: ⌥M / Alt+M (read from `event.code`). Artboard 6's keys list shows ⌘M.
10. **The phone note window (redraw).** Artboard 11 clamps to 0..15 s (the ad). Recommended: one rule everywhere, `[floor(t)−1, ceil(t)+1]` in shot time, clamped to the shot, at least 2 s, never crossing a cut.
11. **The spend confirm threshold.** The tray opens expanded for every batch, plus any single action above $2.00? And what defaults for the cap and the 80% warning? These depend on the unit-economics table the critic asked for.
12. **Pricing placeholders.** Artboard 9's prices (Fill $0.08, Change $0.12, Upscale $0.10), artboard 8's veo3.1 rate (40 cr/s, with 1 credit taken as $0.01) and the tray's $0.20 per frame must come from the refreshed `capabilities/runway.json`. Confirm 1 credit = $0.01.
13. **`preciseEdit`.** Does "Keep the label exactly as it is" map to `ideogram_4_5`'s `preciseEdit`? Check against Runway's OpenAPI, together with mask polarity (plan open question 2).
14. **Stopping a running job.** Does Runway charge for a task stopped mid-render? The Stopped card's charge line depends on it.
15. **Aleph 2 access.** Item 8's primary path assumes Aleph 2 on our key (Shrey is checking). The Veo fallback copy in 3.13 is ready for either answer.
16. **The checking colour.** Artboard 14's mapping has no colour for Jude's checks. Recommended: the reading ink, which is Jude's figure colour too (6.2).
17. **What each format pack holds.** The packs are named (Social, Out of home, Print, Digital display, Film storyboard frames, Custom per client), but not their formats, sizes and safe areas. Recommended: start from a list the owner supplies per pack, kept as data next to the capability sheet, and let each client shelf hold its custom packs.
18. **Extend and subject tracking on Runway.** Make all sizes extends pictures and reframes the film with subject tracking, all on Runway. Which Runway models do this, and at what price, must be checked against the capability sheet before 3.19's prices and "nearest supported ratio" list are final.
