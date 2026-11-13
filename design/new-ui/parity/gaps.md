# Napkin Studio new UI: mock vs build, screen by screen

- **Date:** 2026-11-09.
- **Mock:** `design/new-ui/napkin-app-v1.html`, generated through phase 36, in the repo `napkin-studio-new-ui` (branch `feat/new-ui`, HEAD 3a7053fc).
- **Build:** the local stack at 127.0.0.1:18080, napkin-web started 09:53 local time.
- **Test data:** the store had been reset, so Fernhill Cider no longer existed. I recreated it as **tia@tbwa**:
  - client `cli_1471ab6c`;
  - brief `doc-ie-napkin-brief-maker-2257b00c`: drafted, barrier kept with a reason, Competitor context marked Confidential, locked;
  - research `doc-ie-napkin-campaign-research-c15f904a`: two agent questions answered, finished with 6 calls open, then linked to the brief;
  - a spun-off research `…-b738673e`, left at intake and never run.
- **Untouched:** sam@wk's McDonald brief, which someone else started at 04:58 UTC. I only viewed it.
- **Screenshots:** in this folder. `m-*` are the mock and `b-*` the build. Viewport 1440×1000. The scripts are `drv.mjs` (the build, persistent profiles) and `mock*.mjs`.

**Severity**
- **L**: layout or feature missing.
- **V**: visual.
- **C**: copy.

**Backend column**
- **exists**: the data is served today; the route is given.
- **partial**: some of the data is served.
- **no backend**: nothing serves it.

**Routes**
- Tenant routes are `crates/napkin-web/src/api.rs` (`/api/t/{tenant}/…`).
- Per-document host routes are `crates/napkin-host/src/routes.rs`. Apps reach them inside the iframe.

**Root cause, confirmed in the code:**
- `features/new-ui-shell.clan` specifies a "desk where clicking a circle opens an in-place dial" and nothing else. Its build reused `ClientsPage.tsx`, which keeps a ring around the agency hub with a legend at 6 clients or fewer, plus `LandingPage.tsx`, the agency-circle home.
- Phase 33 of the mock rebuilt the desk: greeting, search, Archived, ⋯, Pick up, Worth a look, drop a .clan. No record carries it.
- Phases 33–36 added late changes that the records also miss:
  - the account menu on the agency pill;
  - the document menu on the name;
  - Save split menu;
  - the Decisions views (Graph, By part, By time, Lineage) and Approve all;
  - no state pill in the OS bar (phase 26);
  - the call card rows;
  - the crew with an agent orb;
  - per-part Confidential;
  - Share.

---

## 1. Desk (`?tool=desk` vs `#agency` + `#clients`)

Pairs:
- `m-desk-wk.png` vs `b-desk.png` (agency home) and `b-clients-after.png` (clients wheel);
- `m-desk-tbwa.png` vs `b-clients-after.png`;
- dark: `m-desk-tbwa-dark.png` vs `b-clients-tbwa-dark.png`;
- dial: `m-desk-dial.png` and `m-desk-newclient-dial.png` vs `b-dial.png` and `b-dial-wk.png`.

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| D1 | One desk screen: eyebrow "YOUR DESK · 4 CLIENTS", h1 "Clients.", greeting "Good morning, Siobhán. Pick a client…" | Two screens. `#agency` shows "HOME / Good morning, Sam." around one big agency orb with Needs you and Running strips. `#clients` shows "WK / Clients / 2 clients, most urgent first…" | exists: `/api/session` (user.name), `/clients`, `/library` | L | `shell/landing/LandingHome.tsx`, `LandingPage.tsx`, `ClientsPage.tsx` |
| D2 | Client circles **in a row**, left-aligned, in **client colours** (Mc red, Bm maroon, G0 black, BB green) with coloured monograms | A **ring around an agency hub orb** (`lc-ring` when there are 6 clients or fewer, `lc-hub`) inside a bordered stage. Grey or pearl 3D orbs with plain initials | **no backend** for colour: `ClientRecord` (`crates/napkin-host/src/clients.rs`) has `initials`, `material` (orb material), `owner`, `created_at`, no colour. Brand Clan colours live on unmerged `feat/brand-clan` (kit `visual.colours`) | L | `ClientsPage.tsx` (`ring` and `lc-hub` branch), `Circle.tsx`, `landing.css` |
| D3 | A **needs badge** (a count) on the circle's top right | No count. The ring arc and the words "needs you" only | exists: `/library` `items[].state.needs_you` per document, which can be summed per client | L | `ClientsPage.tsx`, `Circle.tsx` |
| D4 | A **status line per client** naming the work: "Summer McFlurry · 3 need you", "Midweek pint · agents working", "EU export proof · 14 facts" | A count line: "1 brief · 2 research · needs you" | partial: `/library` gives titles, run labels and needs counts. The "14 facts" count is not in the listing | C | `shell/landing/model.ts` (Status / ACTIVITY_WORD) |
| D5 | **Legend: none** | Legend row: "Needs you / Failed / Working… / Idle / Every state is also said in words." | n/a | L (remove or move) | `ClientsPage.tsx` `lc-legend` |
| D6 | **Find a client** search field, always shown at the left of the tools row | A "Search clients" field only when the list is paged (`page.paged`) | exists, client-side | L | `ClientsPage.tsx` |
| D7 | **Archived · N** link opening a popover list with Restore | An `ArchivedList` rendered below the stage only when the count is above 0 | exists: `/clients/{id}/restore`, plus the host's archived listing (`manage.archived()`) | L | `ClientsPage.tsx`, `Registry.tsx` |
| D8 | **⋯ desk menu**: Adopt clients, Open a .clan file…, Offline copies | "Adopt N clients" is a header button (only with an offer). Open… is under **More ▾** in the bar. Offline is its own bar button | exists: `/clients/legacy`, `/clients/adopt`, the offline store | L | `ClientsPage.tsx`, `components/barMenus.ts` |
| D9 | **"Pick up where you left off"** list with an **Everyone / Me** switch. Rows: icon, title, "client · edited by you 2 days ago", state "2 CALLS / 1 CALL / DONE" | None. The nearest is LandingPage's Needs you and Running strips on `#agency` | partial: `/api/t/{t}/recent` and `/library` (title, `updated_at`, `state`, `run`, client). **No last-editor field**, so "Me" and "edited by you / Aoife" need an actor added to `LibraryItem` (`napkin-host/src/listing.rs`). The decision chain has it (`/chain`, `/decisions`) | L | new section in the desk (`LandingHome.tsx`). Data from `useLanding.ts` |
| D10 | **"Worth a look"** feed: "Kantar tracker updated · touches Summer McFlurry", "A thin finding is waiting", "Bord Bia: EU retail buyers is done" | None on the desk. A per-document "WORTH A LOOK 18" fold exists only inside a document's Decisions drawer | Per kind (see the row after this table). **No tenant-level feed or route.** | L | new desk section. Pieces in `shell/decisions/needs.ts` (quietOf) and `useDecisions.ts` |
| D11 | "+ New client / Start a client desk" circle in the row. The form has **Client name + Sector** with its own validation message | "+ Add client" in the ring and a header "Add client" button. The form has the name only | **no backend** for sector: `ClientRecord` has no sector field | L (sector) / C | `ClientsPage.tsx` AddForm, `clients.rs` |
| D12 | **Dial**: a large pie of 4 quadrants (Brief, Research, Deck, Production), each with an icon, a state chip ("YOUR CALL", "1 deck", "Agents working", "Nothing yet") and a client-coloured hub "McDonald's IRELAND". Other circles fade | Small round petals (B, R, D, P, + "More tools 3") with a yellow agency hub "Open Fernhill Cider". Other circles stay | partial: per-tool state from `/library` | V | `shell/landing/Dial.tsx`, `dialPetals.ts`, `landing.css` |
| D13 | The dial has no More tools petal. Idea, Ads and Soon tools are in **account menu → All tools** | "+ More tools" petal | n/a | L (decide the home; keep the feature) | `Dial.tsx` |
| D14 | Desk background is a warm agency-tinted paper (`--desk`, phase 28). Toggles and selection in agency base (light) or accent (dark) | Pure white (#FFF) or near-black. Only the pill and Decisions carry the agency colour | exists: `shell/agency/palette.ts` | V | `index.css`, `theme.ts`, `palette.ts` (add desk, paper and line tints) |
| D15 | Drop a .clan anywhere on the desk ("Drop the .clan file to open it") | The drop veil exists in the shell | exists | — | (present, keep) |

**D10 backend detail: what can feed "Worth a look" today**

| Item | Status | Where it comes from |
|---|---|---|
| Finished research | **exists** (derive) | `/library` `run.state` (`done`/`idle`) plus `updated_at`, app_id `ie.napkin.campaign-research` |
| Thin finding waiting | **partial** | The count is `state.needs_you`. The text needs a per-document `/decisions` fetch (attention items), which is N calls |
| "Upstream changed" (the research a brief uses changed) | **partial** | Per document, `/upstream` (and the `/related` lineage), with no tenant aggregate |
| Knowledge-layer updates (Kantar tracker) | **no backend** | `layers-service/` is schema and migrations only ("the HTTP service … is the next step"), with no change feed |
| "Agents noticed" quiet items | **partial** | Per document, `quietOf(view)` from `/decisions` |

## 2. Client page (`?tool=client` vs `#client-<id>`)

Pairs: `m-client.png` and `m-client-new.png` vs `b-client.png` (empty) and `b-client-full.png`. Dark: `m-client-dark-tbwa.png` vs `b-client-dark.png`.

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| C1 | Header: a client-coloured avatar "Mc", eyebrow **"CLIENT · SINCE MAR 2025"**, h1 "McDonald's Ireland.", line "Summer McFlurry live · 3 calls need you", **⋯ menu** (Rename, Archive) | Eyebrow "CLIENT", h1, a count line, and **Rename and Archive as two buttons** | exists: `created_at` for "since". Rename and archive exist (`PATCH /clients/{id}`, `/archive`). Colour: no backend (D2) | L / C | `shell/landing/ClientPage.tsx` |
| C2 | **No tool wheel.** The page is lists | A **6-tool wheel** (B, R, I, D, P, A orbs around FC) takes about 500px above the lists | n/a | L (remove; keep number keys and Idea/Ads elsewhere) | `ClientPage.tsx`, `keys.ts` |
| C3 | "Needs you" card list: a doc icon, title, kind, "2 calls" in amber, age "2d" | NEEDS YOU: one row, "Fernhill Cider · Ireland / Research Tool · 6 things to check" | exists: `/library` | V | `ClientPage.tsx` |
| C4 | Sections **Briefs 2 / Research 2 / Decks 1 / Production 1**, each with a tool icon and a round **+**. Rows show title, kind, **state** (2 calls, Draft, Agents working, Done) and **age** (2d, 1w, 4m) | "WORK 3", then "Brief Maker 1 [New brief]" and "Research Tool 2 [New research]". Rows show the title and "Today, 10:46" only. A locked brief shows no "Locked" | exists: `/library` `state.locked`, `state.needs_you`, `run` | V / C | `ClientPage.tsx`, `DocList.tsx` |
| C5 | Empty tool sections say "Nothing here yet." The new client page lists only Briefs and Research | Only tools with documents are listed | n/a | C | `ClientPage.tsx` |
| C6 | **New deck +** opens a popover "Start a deck from: <brief> / <research> / blank" | New per tool, without picking a source | exists: `spinoff-targets`, `/spinoff` | L | `ClientPage.tsx` |
| C7 | **Brand Clan card**: "Brand Clan · v4", "Updated 21 Oct from an accepted brief", voice/rules/assets/approved work counts, colour swatches, voice line, Open kit | "No Brand Clan yet…", with Upload brand files and Start a Brand Clan disabled | **no backend**: the `ie.napkin.brand` app is on unmerged `feat/brand-clan` | L (blocked) | `shell/landing/BrandClanCard.tsx` |
| C8 | Footer link "38 brand facts · 112 category facts · 61 decisions" (opens Decisions By time) | None | **no backend** for layer fact counts (layers-service has no HTTP). Decision count is per document via `/decisions` | L | `ClientPage.tsx` |
| C9 | OS bar shows a **client chip with a switcher ▾** (other clients) | A trail "Clients › FC Fernhill Cider" | exists: `/clients` | L | `components/Toolbar.tsx`, `shell/landing/Trail.tsx` |

## 3. OS bar: desk and documents

Pairs: desk `m-desk-wk.png` vs `b-clients-after.png`; brief `m-brief.png` vs `b-brief.png`; research `m-research.png` vs `b-research.png`; locked `m-brief-locked.png` vs `b-brief-lock-dialog.png` and `b-brief-dark.png` (overflow).

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| B1 | Agency pill reads the **display name** ("Wieden+Kennedy", "TBWA\Dublin") | "Wk", "Tbwa" (the id title-cased; an open question in the shell record) | **no backend**: session `user.agency` is the id only (`/api/session`). Roster and palette carry no display name | C | `components/Toolbar.tsx`, `shell/accountName.ts`, `shell/agency/palette.ts` |
| B2 | **Pill click opens the account menu**: who you are (name, role, agency), All tools, Your crew, Offline copies, Install the app, Change password, Sign out | Pill = "Back to the studio" (goes to `#agency`). Sign out is in More ▾. All tools and "Flat circles" are links at the page bottom. Offline is a bar button. Install is a separate prompt. Crew gallery is `studio/FigureGallery.tsx`, not reachable from the bar | exists: `/auth/sign-out`, `/auth/new-password`. No role field | L | `Toolbar.tsx`, `barMenus.ts` |
| B3 | Desk bar: pill, BETA chip, theme, Decisions. **No trail, no Offline, no More** | Pill, a trail with a tiny glyph ("Clients"), **Offline**, **More ▾** (Open…, Sign out), theme, Decisions | n/a | L | `Toolbar.tsx`, `studio/StudioShell.tsx` |
| B4 | Document bar: pill, **client chip** (colour dot + name), then **doc icon + name in serif with "saved 2m ago · valid ✓" under it and a ▾ document menu**, lineage chip, Continue in ▾, Share. Then right: BETA, theme, crew avatars, Decisions. **Left-aligned groups** (phase 36) | A **centred pill-shaped slot**: "Brief │ title │ ● Draft │ Continue in ▾ │ Share ▾ │ More ▾", then app bar buttons (Save · PDF, Draft it again, Reopen a part…, Client review), green dot, one avatar, Decisions. The trail is glyph crumbs "A › FC Fernhill Cider › B" | exists: `/set-title`, `clan:bar`, `/decisions` | L / V | `Toolbar.tsx`, `AppBarItems.tsx`, `chrome.css` |
| B5 | **No state pill in the bar** (phase 26: state lives in the side panel's Report or Brief box) | "● Draft / Ready to lock / Locked / No report yet" pill in the slot | n/a | L (remove from bar) | `Toolbar.tsx` (`clan:bar` status kind) |
| B6 | **Document menu on the name**: Rename (also double-click), Open…, Save as…, File details (manifest, signature, used by), Edit, Present offline, Where it came from | The same actions sit under **More ▾**: Edit, Open…, Save as…, Present offline, Export, Where it came from, Show the file's details, Sign out | exists | L (move) | `barMenus.ts`, `Toolbar.tsx`, `shell/docTitle.ts` |
| B7 | "saved 2m ago · valid ✓ / signed ✓" under the name | "Saved" text near the right | exists: `SaveStatus.tsx` plus validation | V | `components/SaveStatus.tsx` |
| B8 | Name truncates. The bar never overflows | **Overflow**: a long title (the brief's project-name field becomes the title) pushes the trail and client chip off. When locked, the "Client review" button runs off-screen and **theme and Decisions vanish** at 1440px; in dark the page shifts left (`b-brief-lock-dialog.png`, `b-brief-dark.png`). With the Decisions drawer open, the bar's left is clipped (`b-brief-decisions.png`) | n/a | V (high) | `chrome.css`, `Toolbar.tsx`. Title source in `shell/docTitle.ts` |
| B9 | App actions (Save · PDF, Draft it again, Lock, Reopen) live **only in the side tab** | The same actions are in the bar **and** in the side tab, shown twice | n/a | L | `AppBarItems.tsx`, and the brief's `clan:bar` sender |
| B10 | **Crew**: avatars of people in the document (SR you, CB viewing) plus an **agent orb with a spinning ring while an agent works** | One avatar "TI" and a separate green status dot | **no backend** for presence (who else is viewing). The agent-working state exists (`/library` run, jobs) | L | `Toolbar.tsx` |
| B11 | **BETA chip** (recording popover: It works, It doesn't work, Pause) | `DogfoodBadge` only when dogfood is on (off on this stack) | exists: `/dogfood/*` | — | `dogfood/` (present) |
| B12 | Medallion carries the needs state for the open app | Medallion present; "Back to the studio (this document needs you)" | exists | — | `Medallion.tsx` (present) |

## 4. Decisions drawer and its call card

Pairs: `m-decisions.png` (and `-part`, `-time`, `-lineage`) vs `b-brief-decisions.png`, `b-decisions-desk.png` and `b-decisions-desk-mcd.png`.

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| X1 | Overlays the page with a **blurred backdrop**. Header "DECISIONS / McDonald's Ireland · Summer McFlurry", Close | A side panel that **pushes and clips the page** (the bar's left is cut). Header "What happened · 1 needs your call · ✕" | n/a | V | `shell/decisions/DecisionPanel.tsx`, `DecisionPanel.css`, `AppHost.tsx` (glass insets) |
| X2 | **Call card**: "3 open calls need your sign-off · NEEDS YOU". Each row has the question, its sub-line, **Looks right**, Set aside and Open. Then **"Approve all and lock the brief"** and "Open in Research" | "NEEDS YOUR CALL 1": the Jude card, the part name, **Open, "settle it there", Set aside**. No Looks right, no Approve all | partial: `/resolve`, `/acknowledge`, `/verdict` and `/approve` exist per document. "Looks right" is an `/acknowledge` or `/verdict`. **Approve all and lock** = N resolves plus `/approve`, with no batch route | L | `DecisionPanel.tsx`, `DeskDecisions.tsx`, `useSetAside.ts` |
| X3 | View switch **Graph · By part · By time · Lineage** | "WHO DID WHAT: By time · By part". **No Graph, no Lineage** | exists: `/decisions` (entries with cites), `/related` (lineage) | L | `DecisionPanel.tsx` |
| X4 | **Graph**: "HOW IT WAS DECIDED · SOURCES → FACTS → DECISIONS → BRIEF", step cards 01 Sources, 02 Contest, 03 Insight, 04 Rewrite, 05 Human, each with a badge | None | partial: `/decisions` plus `CiteInfo`. The graph would be built client-side | L | `DecisionPanel.tsx` |
| X5 | **Lineage**: uploads → research v2 → parent v1.2 → this v1.3 (You are here) → deck, each with Open | "Where it came from" (More ▾) opens `WorkspaceView` | exists: `/related`, `/chain` | L (move into the drawer) | `DecisionPanel.tsx`, `shell/WorkspaceView.tsx` |
| X6 | Rows: the what, "who · time · d_id", **Show in document**, folded **Technical details** | Rows: who, what, time, "Why ⌄" and a jump link to the part | exists | V / C | `DecisionBlock.tsx`, `words.ts` |
| X7 | On the desk the call card **lists every call across clients** with Looks right, Set aside and Open | Desk drawer lists documents: "MCDONALD 1 / Brief Maker / Brief · 6 things to check / Open / its calls are in its own Decisions" | partial: per-document `/decisions` (N fetches). No tenant aggregate | L | `shell/decisions/DeskDecisions.tsx`, `deskCalls.ts` |
| X8 | The Decisions button counts in amber when something waits; a running agent's question counts | The research waiting on an agent question shows Decisions **amber with "0"** (`b-research-question.png`) | exists: `run.state == waiting` | C / V | `Toolbar.tsx`, `shell/decisions/needs.ts` |
| X9 | "Worth a look" (per document) — the mock has none in the drawer | "WORTH A LOOK 18 · the crew noticed these" fold | n/a | — | **build-only, keep** (see §11) |

## 5. Brief: sheet, side tab, part panel, Your call, lock, client review, Confidential, Reopen

Pairs:
- sheet: `m-brief.png` vs `b-brief.png`;
- part: `m-brief-part.png` vs `b-brief-barrier-panel.png` and `b-brief-part.png` (the drawer opens);
- locked: `m-brief-locked.png` vs `b-brief-lock-dialog.png`;
- client review: `m-brief-clientreview.png` vs `b-brief-clientreview.png` and `b-brief-cr-changes.png`;
- Confidential: `m-brief-conf.png` vs `b-brief-conf-click.png`;
- dark: `m-brief-dark.png` vs `b-brief-dark.png`;
- home, prompt and loading: `m-brief-home.png`, `m-brief-prompt.png` and `m-brief-loading.png` vs `b-tool-brief.png`, `b-brief-intake.png` and `b-brief-running.png`.

**Sheet**

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| S1 | Sheet head: **client logo tile + agency logo tile**, "McDonald's Ireland · Wieden+Kennedy", "BRIEF". Then "CREATIVE BRIEF / client · v1.3 · date" and a serif title | Head slot shows the client field's long description ("Fernhill Cider, a craft cider maker in Co. Wexford with 12 y…"), a "Brief Maker" chip and "CREATIVE BRIEF". No logo tiles unless added | partial: brief schema `logos` key exists (`schema.json:107`). Client logo needs Brand Clan (**no backend**). **No agency logo library** | L / V | `app/templates/brief-maker/index.html` (sheet head render) |
| S2 | Parts show **heading + text only**. Why notes hidden by default (side tab "Why notes: Hide / Show all") | Every part has an inline **"Dara WHY?" chip** and a "DRAFTED BY DARA" stamp | n/a (UI) | L / V | `brief-maker/index.html` (crewline / why render), `shared/clan-fields.html` |
| S3 | Cell row (Client, Project, Budget & Scope, Version) at the top, then the SMP as a big serif statement | Section bands IDENTITY / THE BRIEF / OBJECTIVES / STRATEGY with part titles in red caps. SMP is a normal part ("To confirm: …") | n/a | V | `brief-maker/index.html` `renderStructured` |
| S4 | A part needing a call has a **"NEEDS YOUR CALL"** badge and an amber fill | A part marked wrong gets a red tint and a "MARKED WRONG" chip in the side tab | exists | V / C | `brief-maker/index.html` |
| S5 | **Click selects** the part, and details open in the side tab's Selected part. Double-click edits | **Clicking the part's text opens the clan-fields slide-over "Where this came from"** over the side tab. Selecting without the drawer needs a click on the heading | n/a | L (high) | `shared/clan-fields.html` (`onDrawerClick`), `brief-maker/index.html` |
| S6 | "YOUR PICTURES" part with image boards | Boards exist in the code (`renderBoards`). None in this run (no images) | exists | — | (present) |

**Side tab**

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| T1 | Top card **"The research changed · 3"** (upstream notice) | `renderFromUp` / `b-upnote` exists in code. Not shown in this run (no research parent) | exists: `/upstream`, `/upstream/update` | — | (present, verify placement) |
| T2 | Save · PDF split ▾: PDF, HTML, Plain PDF, Plain HTML, .clan copy, with Confidential and appendix checkboxes | Save · PDF with "More ways to save" ▾ | exists: `/export` | — | (present; check the options list) |
| T3 | "Draft it again" link | "Draft it again" and "New brief" | exists | — | **New brief is build-only; mock puts it in Continue in → Start fresh** |
| T4 | "Brief ● DRAFT · v1.3 · edited 2 days ago", then **Lock the brief** (outline), then "2 to settle before it can lock" with **question links** | "Brief ● DRAFT", a **filled salmon "Lock the brief"**, "Jude: 1 settles before it can lock. Tap one…" with a MARKED WRONG chip | exists: `/decisions` lock view | V / C | `brief-maker/index.html` `renderLock` |
| T5 | **Brand card** "McDonald's Ireland · Brand applied · Brand Clan v4 · Reset to kit · Detach" | None | **no backend** (`feat/brand-clan` unmerged; `/attach*` routes exist on this branch, but no brand app) | L (blocked) | `brief-maker/index.html` |
| T6 | "Made from Irish summer treats ↗ · 8 pinned facts · research v2" | `renderMadeFrom` exists. Not shown (not spun from research) | exists: `lineage.carried` | — | (present) |
| T7 | "REVIEW 5 notes · 10 parts hold up", **folded** | "JUDE'S REVIEW · IN GOOD SHAPE" **open by default**, a long paragraph plus TOO VAGUE / GOOD rows. Dara and Jude **crew bubbles** above ("Your brief is ready…", "One part needs you… Show me") | exists | V | `brief-maker/index.html` `renderReview`, crewline |
| T8 | Layout: Frame (Open/Boxed), Headings (Label/Tab), **Cover (Plain/Band)**, **Why notes (Hide/Show all)** | Frame and Headings only | **no backend** for cover (no schema key). Why notes is UI only | L | `brief-maker/index.html`, `schema.json` |
| T9 | Colour: **swatches from the brand kit and agency** (red, yellow, then blue, black, orange, blue) and a rainbow custom | Named colours: The brief's own, Stamp red, Ink, Blue, Green, Ochre, Another colour | partial: `theme` exists. Kit colours need Brand Clan (no backend) | V | `brief-maker/index.html` |
| T10 | Logos: **client and agency tiles pre-filled** (Change, ×) plus "+ Add logo" | "Add logo" only | partial: `logos` key, `/upload-asset`. Pre-fill needs Brand Clan and an agency library (no backend) | L | `brief-maker/index.html` |
| T11 | Footer hint "Click a part to see its why and options here. Double-click to edit. Drag ⋮⋮ to move it, its right edge to resize." | No hint. The drawer copy says "To change it, choose Edit under More at the top" (references More, which goes away) | n/a | C | `brief-maker/index.html`, `clan-fields.html` |

**Part panel and Your call**

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| P1 | SELECTED PART: Edit, Redraft…, Keep as is, Confidential | Edit, Redraft…, Keep as is, Mark confidential, and a **Done** link | exists: `regenerate_field`, `locked_fields` | C | (close match) |
| P2 | **YOUR CALL · 2 OPEN**: each open question with **Yes / No / Answer… / Leave it, say why** | Your call only for a Jude verdict: "Jude: this part needs another look", "Fix this with the crew", "Keep it as it is, and say why". **Open questions ("Confirm with ops: …?") are not calls** and have no answer controls | **no backend** for per-question answers: `open_questions` is a plain list (`schema.json`), not attention items. `/resolve` and `/acknowledge` cover attention only | L | `brief-maker/index.html`, `server/napkin/handlers/*` (judge), `ops/decisions` |
| P3 | **BUILT FROM**: compact rows ("Two-spoon sharing UGC clips · f_011 · TikTok comment sample · **2 clips**" value pill, "Source →") | Large source cards (FACT, KNOWLEDGE LAYER chips, a 26px heading, label, "as of … · low confidence · 1 source", "Where this came from") | exists: `/cite` | V | `shared/clan-fields.html` (`clf-sc` source card) |
| P4 | WHY IT SAYS THIS and PLACE ON PAGE folds | The same | — | — | present |
| P5 | Part hover shows ⋮⋮ grip and right-edge resize | Grip, pencil, regen and lock icons over the label; Move and Width | exists | — | present (extra icons are build-only, keep) |

**Lock, client review, Confidential, Reopen**

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| K1 | Locked: "Brief ● LOCKED · v1.3 · locked by Siobhán Ryan, today", **Unlock** button, **Record the client's answer** | "Brief ● LOCKED", a disabled "✓ Locked" bar, "Locked for handoff", **Reopen a part…**. Client review is a red button **in the OS bar** | **no backend for Unlock**: there is no `/unapprove`; "There is no unlocking an approve" (W5-Z1). Reopen exists: `/client-review/reopen` | L (owner decision) | `brief-maker/index.html` `renderLock` |
| K2 | Client's answer form **inside the side tab**: Accepted / With changes / Rejected, **Which parts checkboxes for every part**, paste email, "Or attach it" file, who answered, Cancel, Save the answer | The shell's **ClientReviewPanel replaces the drawer on the right**, with the doc shifted left and a mode bar "● Client review · Cancel". Parts are marked **on the brief**, not by checkboxes. Paste email, "Add the email or PDF file", "Nothing: a call or a chat" and who answered are all there | exists: `/client-review`, `/client-review/confirm` | L (placement) / V | `shell/clientReview/*`, `brief-maker/index.html` |
| K3 | Per-part **Confidential**: chip on the part head, hatch, "● Confidential" toggle; Napkin never learns from it, and the client copy prints it in full (owner, 2026-11-13) | Same: CONFIDENTIAL pill, hatch, dark "Confidential" toggle | exists: `confidential_fields` | — | **match** |
| K4 | Share → "Send the client copy · lock it first" | "Send the client copy · Lock it first…" (disabled); when locked it runs the brief's Client copy · PDF, every part in it (confidential = Napkin never sees it, not the client; owner, 2026-11-13) | exists: `/export` | — | **match** (fix/confidential-means-napkin-never-sees) |
| K5 | Lock gives a toast. The gate lists questions | Lock is instant; toast "Locked & saved as "<long title>..clan"" (**double dot**) | — | C | `brief-maker/index.html` |

**Home, prompt and loading**

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| H1 | **Tool home**: "CLIENT · BRIEFS / Brief Maker. / Pick one to open, or start a new brief", with **paper cards** (tab code, title, state, Budget & Scope, Version, Updated by) and "+ New brief" | `ToolPage`: "BRIEF MAKER / Brief Maker / Client: X / OPEN BRIEFS" list, "New brief for X" button, "Back to X" | partial: `/library` (no budget, version, editor fields) | V | `shell/landing/ToolPage.tsx` |
| H2 | **Prompt**: tool header "Brief Maker." with a **1 Ask, 2 Agents, 3 Brief stepper**, "What's the brief?" card, "From research: … · 12 facts", ruled textarea with word count, Try an example chips, attached files list, + and **Write the brief** | Centred crew intake: "What's the brief?", Ellis bubble, three figures, one-line composer with clip and "Write the brief" | n/a | V / L (decide; the record says keep the intake composer) | `brief-maker/index.html` intake (~line 535) |
| H3 | **Loading**: stage pills (1 Knowledge … 4 Review), inputs and extracted constraints around an agent sphere, "Handing over to strategy…", **Back to the ask / Stop / Skip to the finished brief**, "See each part as it is written · 0 of 15" | "Meet your crew" with four figure cards (Ellis reads, Sam, Dara, Jude: waiting), "Stop the draft", "See each part as it's written" | exists: run stages, `/jobs/{job}/settle` | V | `brief-maker/index.html` proc/meet (~line 557) |

## 6. Research: report, inspector, evidence map, source card

Pairs:
- report: `m-research.png` (and `-y1000` … `-y6000`) vs `b-research.png`, `-2` and `-3`;
- map: `m-research-map.png` vs `b-research-map.png`;
- source card: `m-research-fact.png` vs `b-research-pin.png`;
- finding: `m-research-finding.png` vs `b-research-finding.png`;
- dark: `m-research-dark-tbwa.png` vs `b-research-dark.png`;
- prompt and loading: `m-research-prompt.png` and `m-research-loading.png` vs `b-research-intake.png`, `b-research-question.png` and `b-research-afterq.png`.

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| R1 | Hero title is **the research question** ("What makes 16–24s choose a treat…?"); "Finished 05 Nov…" | Hero "Campaign research" (the question field was empty; it falls back to a generic title) | partial: the ask's question field. The fallback should be the working name or headline | C | `campaign-research/index.html` hero |
| R2 | Body after the summary: § sections per lens (The market, The category, Who it is for, Culture, Competitors), then Confirm, Not researched, **One contest, resolved** (chosen vs not-chosen bar), Gaps, Every figure with its source, Lens × market, Read not pinned, How it ran, Decisions | After the summary it **repeats the headline** in a second "LAID OUT BY DARA" editorial layout (big headline, stat tiles, prose sections "A one-brand market"…, Bulmers, Orchard Thieves, Also in the research, Sources (11)). Then Confirm, Gaps, Every figure, Lens × market, How it ran, Decisions. **No "Not researched" section** | exists: report and the layout doc | L / V | `campaign-research/index.html` (report body render) |
| R3 | **Your call · 1 open** card in the inspector: the question, **Keep / Cut** | "Jude here: your report is ready. Six things… **0 of 6 checked · Next check ↓**" (it walks the in-report "SAM · IS THIS RIGHT? Yes, keep it / No, take it out" cards) | exists: `/verdict` | V / C | `campaign-research/index.html` judgebar |
| R4 | Report box: Refresh, **Lock and accept · 1** (the count of what blocks it), **Run again…**, Find the points | Refresh, Lock and accept (no count), Run research, Find the points | exists | C | `campaign-research/index.html` |
| R5 | Ask the research: textarea, Ask | The same plus an **"About: anything / lens" select** and an explainer | exists: `ask_research@1` | — | build-only extra, keep |
| R6 | Inspector selection: a **breadcrumb with back** (← Report › Summary › f_003 ×) and the full pin card inline: value, unit, key, market and audience chips, AS OF / LEARNED / CONFIDENCE / LICENCE grid, source line quote, WHERE IT CAME FROM (source → layer row → frozen pin), used in | "Close" plus a title, a **compact card** (value, label, as of, confidence, "Where this came from" button), appended **below** Ask the research. The full detail needs the slide-over drawer | exists: `/cite` (CiteInfo with uri, publisher, tier, origin, from, review) | L | `campaign-research/index.html` inspector (`insp-sel`), `shared/clan-fields.html` card mode |
| R7 | Inspector footer: hint, "Checks signed as Siobhán Ryan · **change**" | Hint, a **section nav "Report Request The ask 9/19 Facts 44 Findings 6 Selection"**, "Checks signed as Tia Test" (no change link) | n/a | — / C | build-only nav (keeps the removed outline reachable; keep) |
| R8 | **Evidence map**: the inspector widens to about half the page, Sources · 7 of 9 → Pins · 8 → Findings · 3 → Summary · 5 lines columns, details **below the map** with a breadcrumb | Same structure. Sources column nearly empty at first view (only "The Irish Times" at the bottom); 44 pins make a long column | exists | V | `campaign-research/index.html` map |
| R9 | Report stays **paper in dark mode**; inspector actions take the agency accent (yellow for TBWA) | **Report turns dark.** Buttons turn white (Save · PDF, Lock and accept, Ask) | n/a | V | `campaign-research/index.html` (`clan:colorscheme` handling), `index.css` agency tokens |
| R10 | Locked report says so in the Report box ("LOCKED"), with Unlock | Not exercised (report not locked) | exists: `/approve` | — | — |
| R11 | **Prompt**: tool header "Research." with stepper, a "What do you need to find out?" textarea, examples, **Lenses chips, Markets (IE GB NI), Window 2024–2026**, client deck attached, Start research | Centred crew intake with 11 figures, one-line composer, examples, "Give it a working name", "You're Tia Test". **No lens, market or window pickers before the run** (lenses are picked later by Jude; Run research picks them after) | exists: ask fields, `extract_ask` | V / L (decide) | `campaign-research/index.html` intake |
| R12 | **Loading**: stages 1–4 and sub-questions, an agent's question card (phase 34), Back / Stop / Skip, "See each section as it is written" | Six-step progress (Ellis reads, Ellis finds the brand, Jude picks, researchers, Sam, Dara), agent question cards with sourced options plus "Or type your answer", "Stop the research" | exists | V | (close in function; different look) |

## 7. Continue in / spin-off and link

Pairs: `m-brief-continue.png` vs `b-brief-continue.png`; `m-research-continue.png` vs `b-research-continue.png`; spin-off `b-spinoff-research.png`; link `b-research-linked.png`.

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| L1 | Brief → **Deck, Production, Research**, with a description each ("A board deck from this brief"…) and tool icons | "Continue in Research Tool" and "Continue in Deck Maker", each "Takes its data and decisions along". **No Production** | partial: brief → production exists in the old style (`make_advertising_studio.rs`, `map: brief`), but Advertising Studio isn't offered here (Prod is "Soon" on this stack). Research → production: **no backend** | L / C | `components/ContinueIn.tsx`, `barMenus.ts` |
| L2 | **"Start fresh: New brief for this client"** in the brief's Continue in | Not in the menu (New brief is in the side tab) | exists | L (move or duplicate) | `barMenus.ts` |
| L3 | Research Continue in begins with a gate: **"Not brief-ready yet: 1 call open (Finding 3). You can still start…"** | No gate line | exists: research gates (Brief-ready, still missing) | L | `barMenus.ts` / research `clan:bar` |
| L4 | Link to an existing one: "↔ Summer McFlurry v1.3 / Brief · McDonald's Ireland" | "↔ <title> / Brief Maker. Each keeps its own version; changes show as updates." | exists: link host op (371881e7), `/related`, update and unlink | C | `barMenus.ts` |
| L5 | Spin-off research proposes the ask from the brief | Works: "I'll start from the brief this came from…", the bar shows "from <brief>". Name "<brief title> · Research" | exists | — | match |

## 8. Share, lineage and crew

Pairs: `m-brief-share.png` vs `b-brief-share.png`; lineage `m-brief.png` ("from Irish summer treats") vs `b-research-linked.png` ("↔ Bone Dry … v1").

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| SH1 | Share: Copy link, Send the client copy, Invite to the crew | Copy link, **Download a copy** (extra), Send the client copy (on a locked brief, K4), Invite to the crew (disabled, "Not built yet") | **no backend**: invite (no invitable accounts) | — / L | `barMenus.ts` |
| SH2 | Lineage chip: brief "from **Irish summer treats**"; research "→ **1 brief**" (downstream count) | Chip with the upstream title and version ("↔ Bone Dry (working n… v1", "in Fernhill Cider · Ir…"). **No downstream count chip** | exists: `/related` upstream and downstream | C / V | `Toolbar.tsx` |
| SH3 | Crew avatars plus agent orb | See B10 | no backend for presence | L | `Toolbar.tsx` |

## 9. Dark mode and agency theming

Pairs: `m-desk-wk-dark.png` and `m-desk-tbwa-dark.png` vs `b-clients-wk-dark.png` and `b-clients-tbwa-dark.png`; `m-brief-dark.png` vs `b-brief-dark.png`; `m-research-dark-tbwa.png` vs `b-research-dark.png`.

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| A1 | Surfaces tinted by the agency base (desk 6% light, 12% dark; paper and line tints) | Neutral white or near-black. Only the pill, the Decisions button and some app buttons carry agency colour | exists: `palette.ts` (accent and base per agency) | V | `index.css`, `shell/agency/palette.ts` |
| A2 | Primary actions and selected toggles = agency base (light) or accent (dark: TBWA yellow, W+K yellow) | Brief app primaries stay brand-red (Save · PDF salmon or red). Research primaries black (TBWA base) in light, **white in dark** | partial: the app gets theme via `clan:chrome` and `clan-theme-changed`, but no agency token is passed in | V | `AppHost.tsx` (`clan:chrome` payload), `brief-maker/index.html`, `campaign-research/index.html` |
| A3 | Documents stay paper (brief sheet and research report) | Brief sheet stays paper. **Research report goes dark** | n/a | V | `campaign-research/index.html` |
| A4 | Agency name in the pill (B1) | id | no backend | C | — |

## 10. Empty states

Pairs: `b-empty-home.png`, `b-empty-clients.png`, `b-empty-clients-dark.png`, `b-client.png` (no work), `b-tool-empty.png`, `b-rtool-empty.png` vs `m-desk-newclient-dial.png` and `m-client-new.png`. The mock has no zero-client desk; it only shows a new client.

| # | Mock | Build | Backend | Sev | Likely file |
|---|---|---|---|---|---|
| E1 | (no zero-client desk state in the mock) | `#agency` "No clients yet / Open the studio to add your first client", plus empty Needs you and Running. `#clients` shows a big dashed + with "Every piece of work in the studio belongs to a client. Add the first one." | — | L (design one for the new desk: greeting + "Add your first client" in the row; Pick up and Worth a look hidden or with an empty line) | `LandingHome.tsx`, `ClientsPage.tsx` |
| E2 | New client dial: each quadrant "Nothing yet" | Petals "Start" and "Soon" | — | C | `Dial.tsx` |
| E3 | New client page: "No work yet"; Briefs 0 and Research 0 each "Nothing here yet."; Brand Clan v1 "Started from the roster" | "No work yet", the 6-tool wheel, no Work section, the Brand Clan empty card with disabled buttons | Brand Clan: no backend | L / C | `ClientPage.tsx` |
| E4 | Empty tool home: cards plus "+ New brief" card | "Nothing yet. Start the first brief for X; it is attached to them from the start." | — | V | `ToolPage.tsx` |
| E5 | Research before a report: (mock always has one) | Inspector "Report · No report yet · How it ran" | — | — | fine |
| E6 | Decisions with nothing waiting: "Nothing waits for your sign-off / Every call is answered and on the record." (green) | "Nothing is waiting on you, across every client." | — | C | `DeskDecisions.tsx` |

## 11. What the build has that the mock lacks (keep all; proposed home in the mock's layout)

| Build feature | Where today | Proposed home in the new layout |
|---|---|---|
| Agency home `#agency` (agency orb, Needs you and Running strips, "N clients · N open · N running") | `LandingPage.tsx` | Fold into the desk: Needs you becomes the Pick-up state column and the Decisions call card; Running becomes a "Working now" row in Pick up or the client status lines. Keep `#agency` as a redirect to the desk |
| Client wheel keyboard model (Tab, Enter, Escape, arrows, 1–6 keys) and screen-reader announcements | `ClientsPage.tsx`, `ClientPage.tsx`, `keys.ts` | Keep on the circle row and the dial (arrows rove circles, 1–4 pick quadrants, Esc closes) |
| Legend ("every state is also said in words") | `ClientsPage.tsx` | Drop the visual legend; keep the words in each status line and aria-labels |
| "Flat circles" switch (orb performance) and "All tools" link | `LandingHome.tsx` | Account menu: All tools; Flat circles as a toggle in the account menu (or the Offline copies modal's "On this device") |
| Idea, Ads (`ie.napkin.film`) and Soon tools; "More tools" petal | `Dial.tsx`, `tools.ts` | Account menu → All tools (the mock's home); optional fifth "More" entry under the dial |
| Show all N (paging past many clients) | `ClientsPage.tsx` | Under the circle row: "Show all N" |
| Offline button (`OfflineDialog`) | bar | Account menu → Offline copies; desk ⋯ → Offline copies |
| More ▾ (Edit, Open…, Save as…, Present offline, Export, Where it came from, file details, Sign out) | `barMenus.ts` | Document-name ▾ menu (mock phase 33) and account menu (Sign out) |
| "Download a copy" (.clan) in Share | `barMenus.ts` | Save ▾ → ".clan copy" (mock) and keep in Share |
| "Reopen a part…" with its help text | brief side tab, bar | Side tab under Locked, next to "Record the client's answer" (mock has Unlock there; Unlock has no backend) |
| Client-review mode bar with Cancel; marking parts on the brief; "Nothing: a call or a chat"; record-strength line ("Weaker record…") | `shell/clientReview/*` | Inside the side tab form (mock K2); keep the mode bar as a slim strip above the sheet |
| Jude's review paragraph plus TOO VAGUE / GOOD scorecard; Dara and Jude crew bubbles; "Show me" | brief side tab | Side tab "REVIEW · N notes" fold (folded by default); bubbles condensed into the gate list |
| Jude verdict actions: "Fix this with the crew", "Keep it as it is, and say why" | part panel | Part panel → Your call (alongside Yes, No and Answer for questions) |
| Per-part hover icons (pencil, regen, lock) | sheet | Keep with the ⋮⋮ grip; mirror in Selected part |
| Decisions "Worth a look · N" (quiet items) per document | `DecisionPanel.tsx` | Keep in the drawer (By part / By time views); also feeds the desk "Worth a look" |
| "Where this came from" slide-over drawer (full record, What happened to it, How the brief shows this) | `clan-fields.html` | Inspector / Selected-part source card first; drawer as the "Full record →" fallback (mock "Source →") |
| Research in-report "SAM · IS THIS RIGHT? Yes, keep it / No, take it out" cards and "0 of 6 checked · Next check ↓" | research | Inspector Your call card (Keep / Cut) shows the current check; Next check steps through them |
| Research inspector section nav (Report, Request, The ask, Facts, Findings, Selection) | research | Keep at the inspector foot (replaces the removed outline) |
| "Ask the research · About: <lens>" select | research | Keep in the Ask box |
| Agent question cards with sourced options during the run | research / brief loading | Loading step question card (mock phase 34) |
| "Give it a working name", "You're Tia Test" at intake | research intake | Prompt step footer |
| "Meet your crew" loading with figures | brief loading | Loading step, beside the stages |
| Save status "Saved" | bar | Under the document name ("saved 2m ago · valid ✓") |
| Install prompt, device banner, update toast, drop veil | shell | Account menu → Install the app; the rest unchanged |

## 12. Backend gaps in one place

| Need | Status | Where |
|---|---|---|
| Client colour (circle, chip, avatar) | **no backend** | add to `ClientRecord` (`napkin-host/src/clients.rs`, `PATCH /api/t/{t}/clients/{id}`), or read from the Brand Clan (unmerged) |
| Client sector | **no backend** | `ClientRecord` |
| Agency display name and user role | **no backend** | session (`/api/session` returns agency id and name only), roster in `napkin-web/src/auth.rs` |
| Pick up: last editor ("Me", "edited by you", "Aoife") | **partial** | `/api/t/{t}/library` lacks an actor; add it to `LibraryItem` (`napkin-host/src/listing.rs`) from the chain |
| Worth a look feed | **partial / no backend** | finished research (`/library` run), thin findings (per-document `/decisions`), upstream changed (per-document `/upstream`); layer updates **no backend** (layers-service has no HTTP); needs a tenant route |
| Cross-document calls (desk call card, Approve all) | **partial** | per-document `/decisions`, `/resolve`, `/acknowledge`, `/approve`; no aggregate or batch |
| Per-question answers in the brief's Open questions | **no backend** | `open_questions` is a plain list (`brief-maker/schema.json`) |
| Unlock a locked brief | **no backend** | no `/unapprove` (W5-Z1); Reopen exists (`/client-review/reopen`) |
| Brand Clan card, brand applied on the brief, kit colours and logos | **no backend here** | `feat/brand-clan` (local branch, not merged); `/attach*` routes exist |
| Agency logo library | **no backend** | — |
| Brief cover style | **no backend** | no schema key |
| Client copy (every part; confidential hides nothing from the client) | exists | `/export` |
| Presence (who is viewing), crew invite | **no backend** | — |
| Layer fact counts on the client page | **no backend** | layers-service |
| Research → Production spin-off | **no backend** | `make_advertising_studio.rs` accepts briefs only |

---

## 13. Mock visual tokens (computed, for an exact replica)

Source: `http://127.0.0.1:8090/napkin-app-v1.html` (byte-identical to the repo file), Chromium, 1440×1000, `getComputedStyle`. Primary brand=tbwa, secondary brand=wk. Raw data for every element/brand/theme: `/tmp/claude-1000/napkin-local/parity/tokens.json` (script `tokens.mjs`). Colours are computed (rgb); `color-mix` tokens are already resolved.

### 13.0 Root tokens (`:root`), resolved per brand and theme

| token | tbwa light | tbwa dark | wk light | wk dark |
|---|---|---|---|---|
| `--desk` | `color-mix(in srgb, #16181D 6%, #F6F1E7)` | `color-mix(in srgb, #16181D 12%, #121110)` | `color-mix(in srgb, #1E22AA 6%, #F6F1E7)` | `color-mix(in srgb, #1E22AA 12%, #121110)` |
| `--paper` | `color-mix(in srgb, #16181D 2.5%, #FFFDF8)` | `color-mix(in srgb, #16181D 9%, #1B1A18)` | `color-mix(in srgb, #1E22AA 2.5%, #FFFDF8)` | `color-mix(in srgb, #1E22AA 9%, #1B1A18)` |
| `--paper-2` | `#F3ECDC` | `#262320` | `#F3ECDC` | `#262320` |
| `--card` | `#FFFFFF` | `color-mix(in srgb, #16181D 7%, #201E1B)` | `#FFFFFF` | `color-mix(in srgb, #1E22AA 7%, #201E1B)` |
| `--ink` | `#141413` | `#EFE9DE` | `#141413` | `#EFE9DE` |
| `--ink-soft` | `#2A2620` | `#D6CEC0` | `#2A2620` | `#D6CEC0` |
| `--muted` | `#6D655A` | `#A49B8D` | `#6D655A` | `#A49B8D` |
| `--faint` | `#9A9082` | `#7B7367` | `#9A9082` | `#7B7367` |
| `--line` | `color-mix(in srgb, #16181D 10%, #E2D9C8)` | `color-mix(in srgb, #16181D 16%, #34302A)` | `color-mix(in srgb, #1E22AA 10%, #E2D9C8)` | `color-mix(in srgb, #1E22AA 16%, #34302A)` |
| `--line-strong` | `#2A2620` | `#CFC6B6` | `#2A2620` | `#CFC6B6` |
| `--accent` | `#16181D` | `#16181D` | `#1E22AA` | `#1E22AA` |
| `--accent-line` | `#C8CBFF` | `#C8CBFF` | `#C8CBFF` | `#C8CBFF` |
| `--ag-base` | `#16181D` | `#16181D` | `#1E22AA` | `#1E22AA` |
| `--ag-acc` | `#FFD400` | `#FFD400` | `#FFB800` | `#FFB800` |
| `--ag-acc-ink` | `#101114` | `#101114` | `#101114` | `#101114` |
| `--ag-act` | `#16181D` | `#FFD400` | `#1E22AA` | `#FFB800` |
| `--ag-act-ink` | `#FFFFFF` | `#141413` | `#FFFFFF` | `#141413` |
| `--warn` | `#B45309` | `#E09A4B` | `#B45309` | `#E09A4B` |
| `--warn-soft` | `#FEF3DC` | `#3A2A18` | `#FEF3DC` | `#3A2A18` |
| `--ok` | `#1D8A4E` | `#5DBB83` | `#1D8A4E` | `#5DBB83` |
| `--ok-soft` | `#E6F6EC` | `#1C2E23` | `#E6F6EC` | `#1C2E23` |
| `--alert` | `#C9462A` | `#C9462A` | `#C9462A` | `#C9462A` |
| `--alert-soft` | `#FFF1EE` | `#FFF1EE` | `#FFF1EE` | `#FFF1EE` |
| `--r-sm` | `4px` | `4px` | `4px` | `4px` |
| `--r-md` | `8px` | `8px` | `8px` | `8px` |
| `--r-lg` | `14px` | `14px` | `14px` | `14px` |
| `--shadow-card` | `0 1px 2px rgba(20,20,19,.06), 0 4px 12px -4px rgba(20,20,19,.08)` | `0 1px 2px rgba(20,20,19,.06), 0 4px 12px -4px rgba(20,20,19,.08)` | `0 1px 2px rgba(20,20,19,.06), 0 4px 12px -4px rgba(20,20,19,.08)` | `0 1px 2px rgba(20,20,19,.06), 0 4px 12px -4px rgba(20,20,19,.08)` |
| `--shadow-paper` | `0 1px 0 rgba(255,255,255,.75) inset, 0 8px 24px -8px rgba(50,38,18,.10), 0 1px 3px rgba(50,38,18,.08)` | `0 1px 0 rgba(255,255,255,.75) inset, 0 8px 24px -8px rgba(50,38,18,.10), 0 1px 3px rgba(50,38,18,.08)` | `0 1px 0 rgba(255,255,255,.75) inset, 0 8px 24px -8px rgba(50,38,18,.10), 0 1px 3px rgba(50,38,18,.08)` | `0 1px 0 rgba(255,255,255,.75) inset, 0 8px 24px -8px rgba(50,38,18,.10), 0 1px 3px rgba(50,38,18,.08)` |
| `--font-ui` | `"Geist", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif` | `"Geist", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif` | `"Geist", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif` | `"Geist", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif` |
| `--font-serif` | `"Newsreader", Georgia, "Iowan Old Style", serif` | `"Newsreader", Georgia, "Iowan Old Style", serif` | `"Newsreader", Georgia, "Iowan Old Style", serif` | `"Newsreader", Georgia, "Iowan Old Style", serif` |
| `--font-mono` | `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace` |
| `--a4w` | `` | `` | `` | `` |
| `--a4m` | `` | `` | `` | `` |

| body background | `#E9E4DB` | `#121212` | `#E9E5E3` | `#131322` |


### 13.1 Desk

tbwa light, full computed values. Font shorthand = family / size / weight / letter-spacing / line-height / transform. Sizes are px.

| element (selector) | exact copy | font | color | background | border-top | radius | shadow | padding | box (w×h, max-w, gap) |
|---|---|---|---|---|---|---|---|---|---|
| topbar (`.topbar-outer`) | TBWA\Dublin NAPKIN STUDIO BETA Decisions 3 | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #E9E4DB / 0.94 | none·#141413 | 0px | none | 0px | 1440px×63px, none, normal |
| agency pill (`#header-name-pill`) | TBWA\Dublin NAPKIN STUDIO | Geist / 15px / 400 / normal / 23.25px / none | #101114 | #FFD400 | 1px solid #101114 / 0.12 | 999px | #101114 / 0.14 0px 4px 12px -4px | 0px 18px 0px 30px | 139.156px×40px, none, normal |
| medallion (`#header-medallion`) | — | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #FFFFFF | 1px solid #CEC6B7 | 50% | #101114 / 0.2 0px 10px 22px -6px, #101114 / 0.08 0px 2px 6px 0px | 0px | 64px×64px, none, normal |
| theme btn (`#tb-theme`) | — | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 50% | none | 0px | 36px×36px, none, normal |
| beta chip (`#tb-beta`) | BETA | Geist Mono / 10px / 600 / 0.6px / normal / uppercase | #6D655A | #000000 / 0 | 1px dashed #CEC6B7 | 99px | none | 0px 9px | 58.4062px×26px, none, 6px |
| Decisions btn (`#tb-decisions-btn`) | Decisions 3 | Geist / 12px / 600 / normal / 18.6px / none | #141413 | #F1E4D7 | 1px solid #B45309 / 0.55 | 999px | none | 0px 12px | 107px×32px, none, 6px |
| Decisions count (`#tb-decisions-cnt`) | 3 | Geist Mono / 10px / 700 / normal / 12px / none | #FFFFFF | #B45309 | none·#FFFFFF | 999px | none | 1px 6px | 18px×14px, none, normal |
| view container (`#view-desk`) | Archived · 0 ⋯ Mc 3 McDonald's Ireland Summer McFlurry · 3 need you Bm Ballymaloe Foods Be | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 1132px×600.625px, none, normal |
| eyebrow (`#hero-eyebrow`) | YOUR DESK · 4 CLIENTS | Geist Mono / 11.5px / 600 / 1.15px / 17.825px / uppercase | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 1108px×17.8125px, none, normal |
| h1 (`#hero-title`) | Clients | Geist / 50px / 800 / -2px / 48px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 1108px×48px, none, normal |
| greeting (`#hero-sub`) | Good morning, Siobhán. Pick a client to open their work, or add a new one. | Geist / 14.5px / 400 / normal / 21.75px / none | #2A2620 | #000000 / 0 | none·#2A2620 | 0px | none | 0px | 620px×21.75px, 620px, normal |
| search field (`.p33-search`) | — | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 99px | none | 6px 12px | 240px×34.9219px, none, 8px |
| search input (`#p33-csearch`) | Find a client | Geist / 13.5px / 400 / normal / 20.925px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 192.5px×20.9219px, none, normal |
| Archived link (`#p33-archived`) | Archived · 0 | Geist / 13px / 600 / normal / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 75px×17px, none, normal |
| ⋯ button (`#p33-desk-more`) | ⋯ | Geist / 16px / 400 / normal / 16px / none | #6D655A | #000000 / 0 | 1px solid #CEC6B7 | 50% | none | 0px | 32px×32px, none, normal |
| circle row (`#cl-row`) | Mc 3 McDonald's Ireland Summer McFlurry · 3 need you Bm Ballymaloe Foods Better With Bally | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 1132px×199.188px, none, 26px 30px |
| circle button (`.cl-circle[data-client="mcd"]`) | Mc 3 McDonald's Ireland Summer McFlurry · 3 need you | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 132px×181.188px, none, 4px |
| circle disc (`.cl-circle[data-client="mcd"] .cl-disc`) | Mc 3 | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | none·#141413 | 50% | #141413 / 0.45 0px 10px 24px -14px | 0px | 116px×116px, none, normal |
| circle name (`.cl-circle[data-client="mcd"] .cl-name`) | McDonald's Ireland | Geist / 14px / 700 / -0.14px / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 128.484px×18px, none, normal |
| circle line (`.cl-circle[data-client="mcd"] .cl-line`) | Summer McFlurry · 3 need you | Geist / 12px / 400 / normal / 15.6px / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 132px×31.1875px, none, normal |
| needs badge (`.cl-circle[data-client="mcd"] .cl-badge`) | 3 | Geist Mono / 12px / 700 / normal / normal / none | #FFFFFF | #B45309 | none·#FFFFFF | 12px | #F6F1E7 0px 0px 0px 3px | 0px | 24px×24px, none, normal |
| new client circle (`#cl-add-btn`) | + New client Start a client desk | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 132px×165.594px, none, 4px |
| desk lower grid (`#p33-desk`) | PICK UP WHERE YOU LEFT OFF Everyone Me Summer McFlurry v1.3 McDonald's Ireland · edited by | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | 1px solid #CEC6B7 | 0px | none | 22px 0px 0px | 1132px×266.516px, none, 28px |
| section h3 (`#p33-desk h3`) | PICK UP WHERE YOU LEFT OFF Everyone Me | Geist Mono / 10.5px / 600 / 0.735px / normal / uppercase | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 643.984px×23px, none, 10px |
| Everyone/Me on (`#p33-from button[aria-pressed="true"]`) | Everyone | Geist Mono / 11.5px / 600 / normal / normal / none | #FFFFFF | #16181D | none·#FFFFFF | 0px | none | 3px 9px | 74px×21px, none, normal |
| Everyone/Me off (`#p33-from button[aria-pressed="false"]`) | Me | Geist Mono / 11.5px / 600 / normal / normal / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 3px 9px | 32px×21px, none, normal |
| pick row (`#p33-pick > *`) | Summer McFlurry v1.3 McDonald's Ireland · edited by you 2 days ago 2 CALLS | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 9px | none | 10px 12px | 643.984px×66.1719px, none, 10px |
| pick title (`#p33-pick > * b`) | Summer McFlurry v1.3 | Geist / 13.5px / 700 / normal / 20.925px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 522.484px×20.9219px, none, normal |
| pick state (`#p33-pick > * [class*=st]`) | 2 CALLS | Geist Mono / 10px / 600 / 0.5px / normal / uppercase | #B45309 | #000000 / 0 | none·#B45309 | 0px | none | 0px | 45.5px×13px, none, normal |
| worth row (`.p33-wl`) | Kantar tracker updated f_007 now runs to Aug 2026 · touches Summer McFlurry | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 10px 12px | 460px×61.5156px, none, 2px |
| worth title (`.p33-wl b`) | Kantar tracker updated | Geist / 13.5px / 600 / normal / 20.925px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 434px×20.9219px, none, normal |
| worth sub (`.p33-wl small`) | f_007 now runs to Aug 2026 · touches Summer McFlurry | Geist / 12px / 400 / normal / 18.6px / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 434px×18.5938px, none, normal |

What changes in the other brand and theme combinations (colour, background, border and shadow only; other values match tbwa light):

| element | tbwa dark | wk light | wk dark |
|---|---|---|---|
| topbar | color: #EFE9DE<br>backgroundColor: #121212 / 0.92<br>borderTop: 0px none #EFE9DE | backgroundColor: #E9E5E3 / 0.94 | color: #EFE9DE<br>backgroundColor: #131322 / 0.92<br>borderTop: 0px none #EFE9DE |
| agency pill | same | backgroundColor: #FFB800 | backgroundColor: #FFB800 |
| medallion | color: #EFE9DE<br>backgroundColor: #1F1E1B<br>borderTop: 1px solid #2F2C28 | borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #201E25<br>borderTop: 1px solid #302E3E |
| theme btn | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #1B1B25<br>borderTop: 1px solid #302E3E |
| beta chip | color: #A49B8D<br>borderTop: 1px dashed #2F2C28 | borderTop: 1px dashed #CEC7C5 | color: #A49B8D<br>borderTop: 1px dashed #302E3E |
| Decisions btn | color: #EFE9DE<br>backgroundColor: #32291F<br>borderTop: 1px solid #E09A4B / 0.55 | backgroundColor: #F1E4DA | color: #EFE9DE<br>backgroundColor: #332A2A<br>borderTop: 1px solid #E09A4B / 0.55 |
| Decisions count | backgroundColor: #E09A4B | same | backgroundColor: #E09A4B |
| view container | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| eyebrow | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| h1 | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| greeting | color: #D6CEC0<br>borderTop: 0px none #D6CEC0 | same | color: #D6CEC0<br>borderTop: 0px none #D6CEC0 |
| search field | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #1B1B25<br>borderTop: 1px solid #302E3E |
| search input | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| Archived link | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| ⋯ button | color: #A49B8D<br>borderTop: 1px solid #2F2C28 | borderTop: 1px solid #CEC7C5 | color: #A49B8D<br>borderTop: 1px solid #302E3E |
| circle row | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| circle button | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| circle disc | color: #EFE9DE<br>backgroundColor: #1F1E1B<br>borderTop: 0px none #EFE9DE<br>boxShadow: #FFFDF8 / 0.22 0px 0px 0px 1px, #000000 / 0.6 0px 10px 24px -10px | backgroundColor: #F9F8F6 | color: #EFE9DE<br>backgroundColor: #201E25<br>borderTop: 0px none #EFE9DE<br>boxShadow: #FFFDF8 / 0.22 0px 0px 0px 1px, #000000 / 0.6 0px 10px 24px -10px |
| circle name | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| circle line | color: #A49B8D<br>borderTop: 0px none #A49B8D | same | color: #A49B8D<br>borderTop: 0px none #A49B8D |
| needs badge | backgroundColor: #E09A4B | same | backgroundColor: #E09A4B |
| new client circle | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| desk lower grid | color: #EFE9DE<br>borderTop: 1px solid #2F2C28 | borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>borderTop: 1px solid #302E3E |
| section h3 | color: #A49B8D<br>borderTop: 0px none #A49B8D | same | color: #A49B8D<br>borderTop: 0px none #A49B8D |
| Everyone/Me on | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 0px none #141413 | backgroundColor: #1E22AA | color: #141413<br>backgroundColor: #FFB800<br>borderTop: 0px none #141413 |
| Everyone/Me off | color: #A49B8D<br>borderTop: 0px none #A49B8D | same | color: #A49B8D<br>borderTop: 0px none #A49B8D |
| pick row | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #1B1B25<br>borderTop: 1px solid #302E3E |
| pick title | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| pick state | color: #E09A4B<br>borderTop: 0px none #E09A4B | same | color: #E09A4B<br>borderTop: 0px none #E09A4B |
| worth row | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| worth title | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| worth sub | color: #A49B8D<br>borderTop: 0px none #A49B8D | same | color: #A49B8D<br>borderTop: 0px none #A49B8D |

### 13.2 Desk dial (McDonald's open)

tbwa light, full computed values. Font shorthand = family / size / weight / letter-spacing / line-height / transform. Sizes are px.

| element (selector) | exact copy | font | color | background | border-top | radius | shadow | padding | box (w×h, max-w, gap) |
|---|---|---|---|---|---|---|---|---|---|
| dial (`#dial`) | Brief YOUR CALL Research YOUR CALL Deck 1 deck Production Agents working McDonald's IRELAN | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 360px×360px, none, normal |
| dial hub (`#dial-hub`) | McDonald's IRELAND | Geist / 15px / 400 / normal / 23.25px / none | #FFC72C | #DA291C | none·#FFC72C | 50% | #F9F7F3 0px 0px 0px 4px, #16181D 0px 0px 0px 6px | 0px | 103.5px×103.5px, none, 2px |
| quadrant label (`#dial [data-tool] b`) | McDonald's | Geist / 14.5px / 800 / -0.435px / 15.225px / none | #FFC72C | #000000 / 0 | none·#FFC72C | 0px | none | 0px 10px | 100.656px×15.2188px, none, normal |
| quadrant chip (`#dial [class*=chip]`) | IRELAND | Geist Mono / 10px / 600 / 0.8px / normal / uppercase | #FFC72C | #000000 / 0 | none·#FFC72C | 0px | none | 0px | 100.656px×13px, none, normal |

What changes in the other brand and theme combinations (colour, background, border and shadow only; other values match tbwa light):

| element | tbwa dark | wk light |
|---|---|---|
| dial | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| dial hub | boxShadow: #1B1A18 0px 0px 0px 4px, #FFD400 0px 0px 0px 6px | boxShadow: #F9F8F6 0px 0px 0px 4px, #1E22AA 0px 0px 0px 6px |

### 13.3 Client page

tbwa light, full computed values. Font shorthand = family / size / weight / letter-spacing / line-height / transform. Sizes are px.

| element (selector) | exact copy | font | color | background | border-top | radius | shadow | padding | box (w×h, max-w, gap) |
|---|---|---|---|---|---|---|---|---|---|
| view container (`#view-client`) | Mc CLIENT · SINCE MAR 2025 McDonald's Ireland Summer McFlurry live · 3 calls need you ⋯ Ne | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 34px 0px 40px | 1080px×1316.11px, 1080px, normal |
| head (`.cp-head`) | Mc CLIENT · SINCE MAR 2025 McDonald's Ireland Summer McFlurry live · 3 calls need you ⋯ | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px 0px 26px | 1080px×127.719px, none, 22px |
| avatar (`.cp-head [class*=av]`) | Mc | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | none·#141413 | 50% | #141413 / 0.45 0px 10px 24px -14px | 0px | 84px×84px, none, normal |
| eyebrow (`.cp-head [class*=eyebrow]`) | CLIENT · SINCE MAR 2025 | Geist Mono / 11.5px / 600 / 1.15px / 17.825px / uppercase | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 419.531px×17.8125px, none, normal |
| h1 (`#view-client h1`) | McDonald's Ireland | Geist / 46px / 800 / -1.84px / 44.16px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 419.531px×44.1562px, none, normal |
| sub line (`.cp-head p`) | Summer McFlurry live · 3 calls need you | Geist / 16.5px / 400 / normal / 24.75px / none | #2A2620 | #000000 / 0 | none·#2A2620 | 0px | none | 0px | 419.531px×24.75px, 594px, normal |
| ⋯ (`#p33-cp-more`) | ⋯ | Geist / 16px / 400 / normal / 16px / none | #6D655A | #000000 / 0 | 1px solid #CEC6B7 | 50% | none | 0px | 32px×32px, none, normal |
| section h2 (`#view-client h2`) | Needs you | Geist / 18px / 700 / -0.18px / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 1080px×23px, none, 10px |
| section count (`#view-client h2 small`) | — | Geist / 18px / 700 / -0.18px / normal / none | #5A4A2A | #F1E6CB | 1px solid #C4AA75 | 50% | none | 0px | 28px×28px, none, normal |
| row card (`.cp-row`) | Summer McFlurry v1.3 Brief 2 calls 2d | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 12px 18px | 1078px×61.5938px, none, 14px |
| row title (`.cp-row b`) | Summer McFlurry v1.3 | Geist / 14.5px / 600 / normal / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 876px×19px, none, normal |
| row kind (`.cp-row small`) | Brief | Geist / 12px / 400 / normal / 18.6px / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 876px×18.5938px, none, normal |
| row state (`.cp-st`) | 2 calls | Geist / 12.5px / 600 / normal / 19.375px / none | #B45309 | #000000 / 0 | none·#B45309 | 0px | none | 0px | 40px×19.375px, none, normal |
| row age (`.cp-d`) | 2d | Geist Mono / 11.5px / 400 / normal / normal / none | #9A9082 | #000000 / 0 | none·#9A9082 | 0px | none | 0px | 56px×15px, none, normal |
| add + (`#view-client [data-new]`) | + | Geist / 22px / 400 / normal / 22px / none | #141413 | #F9F7F3 | 1px solid #2A2620 | 50% | none | 0px | 40px×40px, none, normal |
| brand clan card (`#cp-kit`) | Open kit | Geist / 13px / 600 / normal / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 54px×17px, none, normal |
| client chip (bar) (`#p33-cswitch`) | Mc McDonald's Ireland ▾ | Geist / 13px / 600 / normal / normal / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 999px | none | 0px 12px 0px 4px | 189px×34px, none, 8px |

What changes in the other brand and theme combinations (colour, background, border and shadow only; other values match tbwa light):

| element | tbwa dark | wk light |
|---|---|---|
| view container | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| head | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| avatar | color: #EFE9DE<br>backgroundColor: #1F1E1B<br>borderTop: 0px none #EFE9DE<br>boxShadow: #FFFDF8 / 0.22 0px 0px 0px 1px, #000000 / 0.6 0px 10px 24px -10px | backgroundColor: #F9F8F6 |
| eyebrow | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| h1 | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| sub line | color: #D6CEC0<br>borderTop: 0px none #D6CEC0 | same |
| ⋯ | color: #A49B8D<br>borderTop: 1px solid #2F2C28 | borderTop: 1px solid #CEC7C5 |
| section h2 | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| row card | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| row title | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| row kind | color: #A49B8D<br>borderTop: 0px none #A49B8D | same |
| row state | color: #E09A4B<br>borderTop: 0px none #E09A4B | same |
| row age | color: #7B7367<br>borderTop: 0px none #7B7367 | same |
| add + | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #CFC6B6 | backgroundColor: #F9F8F6 |
| brand clan card | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| client chip (bar) | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 |

### 13.4 Brief: sheet, side tab, OS bar in a document

tbwa light, full computed values. Font shorthand = family / size / weight / letter-spacing / line-height / transform. Sizes are px.

| element (selector) | exact copy | font | color | background | border-top | radius | shadow | padding | box (w×h, max-w, gap) |
|---|---|---|---|---|---|---|---|---|---|
| workspace (`#brief-workspace`) | SUMMER MCFLURRY Mc TB McDonald's Ireland · TBWA\Dublin BRIEF CREATIVE BRIEF MCDONALD'S IRE | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 1332px×1768.31px, none, 32px |
| sheet (`#brief-page`) | Mc TB McDonald's Ireland · TBWA\Dublin BRIEF CREATIVE BRIEF MCDONALD'S IRELAND · V1.3 · 28 | Geist / 15px / 400 / normal / 23.25px / none | #2A2620 | #FFFDF8 | 1px solid #E2D9C8 | 2px | #FFFFFF / 0.75 0px 1px 0px 0px inset, #322612 / 0.1 0px 8px 24px -8px, #322612 / 0.08 0px 1px 3px 0px | 0px | 860px×1752.31px, 860px, normal |
| sheet tab (`#bm-tab`) | SUMMER MCFLURRY | Geist Mono / 10.5px / 600 / 1.05px / normal / uppercase | #5A4A2A | #E7D5AC | 1px solid #C4AA75 | 4px 4px 0px 0px | none | 0px 10px | 127.75px×17px, none, normal |
| part heading (`#brief-page .gi .gi-head h3`) | CLIENT | Geist Mono / 10.5px / 600 / 0.84px / 12.6px / uppercase | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 41.0469px×12.5938px, none, normal |
| part body (`#brief-page .gi p`) | McFlurry volume has been flat for two summers while Fanta Frozen and home-delivery dessert | Geist / 15px / 400 / normal / 23.25px / none | #2A2620 | #000000 / 0 | none·#2A2620 | 0px | none | 0px | 332px×139.5px, none, normal |
| SMP statement (`#brief-page .lay-statement p`) | The best summers are measured in spoons. | Newsreader / 28px / 600 / -0.42px / 32.48px / none | #2A2620 | #000000 / 0 | none·#2A2620 | 0px | none | 0px | 710px×32.4688px, none, normal |
| side tab (`#look-inspector`) | The research changed 3 Save · PDF Draft it again Brief DRAFT v1.3 · edited 2 days ago Lock | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 8px | none | 18px | 440px×906px, none, 16px |
| Save·PDF (`#b-print-pdf`) | Save · PDF | Geist / 13.5px / 600 / normal / 20.925px / none | #FFFFFF | #16181D | 1px solid #16181D | 4px 0px 0px 4px | none | 0px 16px | 356px×38px, none, 7px |
| save ▾ (`.save-more`) | — | Geist / 15px / 400 / normal / 23.25px / none | #FFFFFF | #16181D | none·#FFFFFF | 0px 6px 6px 0px | none | 0px | 44px×38px, none, normal |
| Draft it again (`#b-redraft-btn`) | Draft it again | Geist / 13px / 600 / normal / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 402px×17px, none, normal |
| state chip (`#b-state-chip`) | DRAFT | Geist Mono / 11.5px / 400 / 1.38px / normal / uppercase | #B45309 | #B45309 / 0.16 | none·#B45309 | 999px | none | 4px 12px | 79.9062px×23px, none, normal |
| Lock the brief (`#b-lock-side`) | Lock the brief | Geist / 13px / 600 / normal / normal / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 8px | none | 0px 10px | 402px×36px, none, normal |
| seg on (`#b-frame-seg button[aria-pressed="true"]`) | Open | Geist / 12px / 600 / normal / 18.6px / none | #FFFFFF | #16181D | none·#FFFFFF | 0px | none | 0px 4px | 97px×32px, none, normal |
| seg off (`#b-frame-seg button[aria-pressed="false"]`) | Boxed | Geist / 12px / 600 / normal / 18.6px / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px 4px | 97px×32px, none, normal |
| side label (`#look-inspector small`) | 3 | Geist Mono / 11px / 500 / normal / normal / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 7px×14px, none, normal |
| doc name (bar) (`#tb-app .tba-name b`) | Summer McFlurry | Newsreader / 16px / 600 / normal / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 140.609px×16px, 240px, normal |
| saved line (bar) (`.tba-saved`) | saved 2m ago · valid ✓ | Geist Mono / 10px / 500 / 0.3px / normal / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 140.609px×13px, none, normal |
| lineage chip (`.tba-line`) | from Irish summer treats | Geist / 12.5px / 500 / normal / normal / none | #6D655A | #000000 / 0 | 1px dashed #2A2620 | 999px | none | 4px 10px | 147px×17px, none, normal |
| Continue in btn (`[data-tba="b-cont"]`) | Continue in ▾ | Geist / 12.5px / 600 / normal / normal / none | #2A2620 | #000000 / 0 | 1px solid #CEC6B7 | 8px | none | 0px 11px | 103px×30px, none, normal |
| Share btn (`[data-p36-share]`) | Share | Geist / 12.5px / 600 / normal / normal / none | #2A2620 | #000000 / 0 | 1px solid #CEC6B7 | 8px | none | 0px 11px | 59px×30px, none, normal |
| crew avatar (`#tb-crew .cw`) | SR | Geist / 10.5px / 700 / normal / normal / none | #FFFFFF | #C9462A | none·#FFFFFF | 50% | #E9E4DB 0px 0px 0px 2px | 0px | 30px×30px, none, normal |
| client chip (bar) (`#tb-trail button`) | Mc McDonald's Ireland | Geist / 13px / 600 / normal / normal / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 999px | none | 0px 12px 0px 4px | 174px×34px, none, 8px |

What changes in the other brand and theme combinations (colour, background, border and shadow only; other values match tbwa light):

| element | tbwa dark | wk light | wk dark |
|---|---|---|---|
| workspace | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| sheet | borderTop: 1px solid #000000 / 0<br>boxShadow: #000000 / 0.7 0px 24px 60px -24px | same | borderTop: 1px solid #000000 / 0<br>boxShadow: #000000 / 0.7 0px 24px 60px -24px |
| side tab | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #1B1B25<br>borderTop: 1px solid #302E3E |
| Save·PDF | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 1px solid #FFD400 | backgroundColor: #1E22AA<br>borderTop: 1px solid #1E22AA | color: #141413<br>backgroundColor: #FFB800<br>borderTop: 1px solid #FFB800 |
| save ▾ | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 0px none #141413 | backgroundColor: #1E22AA | color: #141413<br>backgroundColor: #FFB800<br>borderTop: 0px none #141413 |
| Draft it again | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| state chip | color: #E09A4B<br>backgroundColor: #E09A4B / 0.22<br>borderTop: 0px none #E09A4B | same | color: #E09A4B<br>backgroundColor: #E09A4B / 0.22<br>borderTop: 0px none #E09A4B |
| Lock the brief | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #1B1B25<br>borderTop: 1px solid #302E3E |
| seg on | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 0px none #141413 | backgroundColor: #1E22AA | color: #141413<br>backgroundColor: #FFB800<br>borderTop: 0px none #141413 |
| seg off | color: #A49B8D<br>borderTop: 0px none #A49B8D | same | color: #A49B8D<br>borderTop: 0px none #A49B8D |
| side label | color: #A49B8D<br>borderTop: 0px none #A49B8D | same | color: #A49B8D<br>borderTop: 0px none #A49B8D |
| doc name (bar) | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| saved line (bar) | color: #A49B8D<br>borderTop: 0px none #A49B8D | same | color: #A49B8D<br>borderTop: 0px none #A49B8D |
| lineage chip | color: #A49B8D<br>borderTop: 1px dashed #CFC6B6 | same | color: #A49B8D<br>borderTop: 1px dashed #CFC6B6 |
| Continue in btn | color: #D6CEC0<br>borderTop: 1px solid #2F2C28 | borderTop: 1px solid #CEC7C5 | color: #D6CEC0<br>borderTop: 1px solid #302E3E |
| Share btn | color: #D6CEC0<br>borderTop: 1px solid #2F2C28 | borderTop: 1px solid #CEC7C5 | color: #D6CEC0<br>borderTop: 1px solid #302E3E |
| crew avatar | boxShadow: #121212 0px 0px 0px 2px | boxShadow: #E9E5E3 0px 0px 0px 2px | boxShadow: #131322 0px 0px 0px 2px |
| client chip (bar) | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #1B1B25<br>borderTop: 1px solid #302E3E |

### 13.5 Brief: selected part panel

tbwa light, full computed values. Font shorthand = family / size / weight / letter-spacing / line-height / transform. Sizes are px.

| element (selector) | exact copy | font | color | background | border-top | radius | shadow | padding | box (w×h, max-w, gap) |
|---|---|---|---|---|---|---|---|---|---|
| selected part (`#side-part`) | SELECTED PART Open questions & Mandatories Edit Redraft… Keep as is Confidential YOUR CALL | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #FFFFFF | 1px solid #7B7872 | 8px | none | 12px | 402px×562.062px, none, 9px |
| selected title (`#side-part h3`) | Open questions & Mandatories | Geist / 14px / 700 / -0.14px / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 376px×18px, none, normal |
| part btn (`#side-part .sp-btn`) | Edit | Geist / 12px / 600 / normal / normal / none | #C9462A | #F9F7F3 | 1px solid #C9462A / 0.4 | 6px | none | 0px 10px | 44px×28px, none, normal |
| your call box (`#side-part .needs-box`) | YOUR CALL · 2 OPEN Confirm with operations: can counter staff offer two spoons on request? | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #FBF5F0 | 1px solid #B45309 / 0.35 | 6px | none | 10px 12px | 376px×209.562px, none, 8px |
| answer btn (`#side-part [data-ans]`) | Yes | Geist / 12px / 600 / normal / normal / none | #141413 | #FFFFFF | 1px solid #2A2620 | 999px | none | 0px 10px | 42px×26px, none, normal |
| built from row (`#side-part [class*=bf]`) | Two-spoon sharing UGC clips f_011 · TikTok comment sample 2 clips | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 6px | none | 7px 9px | 376px×46.25px, none, 8px |
| selected outline (`#brief-page .gi.sel`) | ⋮⋮ OPEN QUESTIONS & MANDATORIES Confirm with operations: can counter staff offer two spoon | Geist / 15px / 400 / normal / 23.25px / none | #2A2620 | #B45309 / 0.11 | 1px solid #2A2620 / 0.14 | 5px | #B45309 3px 0px 0px 0px inset, #B45309 / 0.45 0px 0px 0px 1px inset | 20px 10px 18px | 352px×224.875px, none, normal |
| needs badge (part head) (`#brief-page .gi.sel .gi-head`) | OPEN QUESTIONS & MANDATORIES | Geist / 15px / 400 / normal / 23.25px / none | #2A2620 | #000000 / 0 | none·#2A2620 | 0px | none | 0px 130px 0px 0px | 332px×26.375px, none, 8px |

What changes in the other brand and theme combinations (colour, background, border and shadow only; other values match tbwa light):

| element | tbwa dark | wk light |
|---|---|---|
| selected part | color: #EFE9DE<br>backgroundColor: #1F1E1B<br>borderTop: 1px solid #8D7816 | borderTop: 1px solid #7F7DB9 |
| selected title | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| part btn | backgroundColor: #1B1A18 | backgroundColor: #F9F8F6 |
| your call box | color: #EFE9DE<br>backgroundColor: #332A20<br>borderTop: 1px solid #E09A4B / 0.35 | same |
| answer btn | color: #EFE9DE<br>backgroundColor: #1F1E1B<br>borderTop: 1px solid #CFC6B6 | same |
| built from row | color: #EFE9DE<br>backgroundColor: #1F1E1B<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 |
| selected outline | backgroundColor: #E09A4B / 0.11<br>boxShadow: #E09A4B 3px 0px 0px 0px inset, #E09A4B / 0.45 0px 0px 0px 1px inset | same |

### 13.6 Research: report and inspector

tbwa light, full computed values. Font shorthand = family / size / weight / letter-spacing / line-height / transform. Sizes are px.

| element (selector) | exact copy | font | color | background | border-top | radius | shadow | padding | box (w×h, max-w, gap) |
|---|---|---|---|---|---|---|---|---|---|
| workspace (`#r-workspace`) | RESEARCH · MCDONALD'S IRELAND What makes 16–24s choose a treat on an Irish summer day? Fin | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 1392px×5779.45px, none, 24px |
| report sheet (`#research-sheet`) | RESEARCH · MCDONALD'S IRELAND What makes 16–24s choose a treat on an Irish summer day? Fin | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #FFFDF8 | 1px solid #E2D9C8 | 8px | #FFFFFF / 0.75 0px 1px 0px 0px inset, #322612 / 0.1 0px 8px 24px -8px, #322612 / 0.08 0px 1px 3px 0px | 0px 44px 44px | 928px×5779.45px, none, 34px |
| hero (`#r-header`) | RESEARCH · MCDONALD'S IRELAND What makes 16–24s choose a treat on an Irish summer day? Fin | Geist / 15px / 400 / normal / 23.25px / none | #F9F7F3 | #141413 | 0px none #F9F7F3 | 8px 8px 0px 0px | #F6E36B 0px -6px 0px 0px inset | 24px 44px 30px | 926px×188.891px, none, 20px |
| hero eyebrow (`#r-header small`) | RESEARCH · MCDONALD'S IRELAND | Geist Mono / 11.5px / 600 / 1.15px / 17.825px / uppercase | #FFFDF8 / 0.7 | #000000 / 0 | none·#FFFDF8 / 0.7 | 0px | none | 0px | 644px×17.8125px, none, normal |
| hero h1 (`.r-question`) | What makes 16–24s choose a treat on an Irish summer day? | Geist / 34px / 600 / -0.85px / 38.08px / none | #F9F7F3 | #000000 / 0 | 0px none #F9F7F3 | 0px | none | 0px | 644px×76.1562px, 644px, normal |
| hero meta (`#r-header p`) | Finished 05 Nov, 10:44 · 9 sources read · 8 facts pinned · 6 decisions on the record | Geist / 13.5px / 400 / normal / 20.925px / none | #FFFDF8 / 0.7 | #000000 / 0 | none·#FFFDF8 / 0.7 | 0px | none | 0px | 644px×20.9219px, none, normal |
| stats row (`#r-stats`) | 9 sources 8 pins 3 findings 1 contest 4 gaps 2 excluded 1 needs your call | Geist Mono / 12px / 400 / normal / normal / none | #2A2620 | #000000 / 0 | none·#2A2620 | 0px | none | 0px 0px 14px | 838px×31px, none, 0px |
| stat (`#r-stats > *`) | 9 sources | Geist Mono / 12px / 400 / normal / normal / none | #2A2620 | #000000 / 0 | none·#2A2620 | 0px | none | 0px 12px 0px 0px | 75px×16px, none, normal |
| section eyebrow (`#research-sheet [class*=eyebrow]`) | RESEARCH · MCDONALD'S IRELAND | Geist Mono / 11.5px / 600 / 1.15px / 17.825px / uppercase | #FFFDF8 / 0.7 | #000000 / 0 | none·#FFFDF8 / 0.7 | 0px | none | 0px | 644px×17.8125px, none, normal |
| section h2 (`#research-sheet h2`) | What makes 16–24s choose a treat on an Irish summer day? | Geist / 34px / 600 / -0.85px / 38.08px / none | #F9F7F3 | #000000 / 0 | 0px none #F9F7F3 | 0px | none | 0px | 644px×76.1562px, 644px, normal |
| headline (`.rp-head`) | McFlurry’s summer is won outside, in unplanned social moments, and lost to the sofa when n | Geist / 26px / 600 / -0.52px / 33.8px / none | #141413 | #000000 / 0 | none·#141413 | 6px | none | 4px 6px | 844px×75.5938px, none, normal |
| inspector (`#r-side`) | Report Evidence map Save · PDF YOUR CALL · 1 OPEN Finding 3 rests on 2 TikTok clips (f_011 | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 8px | none | 0px | 440px×673.844px, none, 0px |
| view switch on (`#rb-viewsw button[aria-pressed="true"]`) | Report | Geist / 12px / 600 / normal / 18.6px / none | #FFFFFF | #16181D | none·#FFFFFF | 0px | none | 0px | 218px×32px, none, normal |
| view switch off (`#rb-viewsw button[aria-pressed="false"]`) | Evidence map | Geist / 12px / 600 / normal / 18.6px / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 218px×32px, none, normal |
| your call card (`.needs-box.r-needs`) | YOUR CALL · 1 OPEN Finding 3 rests on 2 TikTok clips (f_011). Keep it as a working hypothe | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #FBF5F0 | 1px solid #B45309 / 0.35 | 6px | none | 10px 12px | 402px×129.688px, none, 8px |
| report box (`#r-report`) | Report DRAFT refreshed 4m ago Refresh Lock and accept · 1 Run again… Find the points CONFI | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #FFFFFF | 1px solid #2A2620 | 8px | none | 12px | 402px×173px, none, 10px |
| Lock and accept (`#r-lock`) | Lock and accept · 1 | Geist / 12px / 600 / normal / 12px / none | #FFFFFF | #16181D | 1px solid #16181D | 6px | none | 0px 12px | 136px×32px, none, normal |
| Refresh (`#r-refresh`) | Refresh | Geist / 12px / 600 / normal / normal / none | #141413 | #F9F7F3 | 1px solid #CEC6B7 | 6px | none | 0px 10px | 68px×28px, none, normal |
| ask textarea (`#r-ask`) | 00 — THE ASK What the client asked CLIENT McDonald's Ireland BRAND McFlurry MARKET Republi | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 838px×375px, none, normal |
| Ask btn (`.r-ask-go`) | Ask | Geist / 12.5px / 600 / normal / normal / none | #FFFFFF | #16181D | none·#16181D | 999px | none | 0px 16px | 56px×34px, none, normal |

What changes in the other brand and theme combinations (colour, background, border and shadow only; other values match tbwa light):

| element | tbwa dark | wk light | wk dark |
|---|---|---|---|
| workspace | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| report sheet | color: #2A2620<br>borderTop: 1px solid #000000 / 0<br>boxShadow: #000000 / 0.7 0px 24px 60px -24px | same | color: #2A2620<br>borderTop: 1px solid #000000 / 0<br>boxShadow: #000000 / 0.7 0px 24px 60px -24px |
| hero | color: #EFE9DE<br>backgroundColor: #0B0A09<br>borderTop: 0px none #EFE9DE | color: #F9F8F6<br>borderTop: 0px none #F9F8F6 | color: #EFE9DE<br>backgroundColor: #0B0A09<br>borderTop: 0px none #EFE9DE |
| hero eyebrow | color: #EFE9DE / 0.65<br>borderTop: 0px none #EFE9DE / 0.65 | same | color: #EFE9DE / 0.65<br>borderTop: 0px none #EFE9DE / 0.65 |
| hero h1 | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | color: #F9F8F6<br>borderTop: 0px none #F9F8F6 | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| hero meta | color: #EFE9DE / 0.65<br>borderTop: 0px none #EFE9DE / 0.65 | same | color: #EFE9DE / 0.65<br>borderTop: 0px none #EFE9DE / 0.65 |
| section eyebrow | color: #EFE9DE / 0.65<br>borderTop: 0px none #EFE9DE / 0.65 | same | color: #EFE9DE / 0.65<br>borderTop: 0px none #EFE9DE / 0.65 |
| section h2 | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | color: #F9F8F6<br>borderTop: 0px none #F9F8F6 | color: #EFE9DE<br>borderTop: 0px none #EFE9DE |
| headline | color: #2A2620<br>borderTop: 0px none #2A2620 | same | color: #2A2620<br>borderTop: 0px none #2A2620 |
| inspector | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #1B1B25<br>borderTop: 1px solid #302E3E |
| view switch on | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 0px none #141413 | backgroundColor: #1E22AA | color: #141413<br>backgroundColor: #FFB800<br>borderTop: 0px none #141413 |
| view switch off | color: #D6CEC0<br>borderTop: 0px none #D6CEC0 | same | color: #D6CEC0<br>borderTop: 0px none #D6CEC0 |
| your call card | color: #EFE9DE<br>backgroundColor: #332A20<br>borderTop: 1px solid #E09A4B / 0.35 | same | color: #EFE9DE<br>backgroundColor: #332B29<br>borderTop: 1px solid #E09A4B / 0.35 |
| report box | color: #EFE9DE<br>backgroundColor: #1F1E1B<br>borderTop: 1px solid #CFC6B6 | same | color: #EFE9DE<br>backgroundColor: #201E25<br>borderTop: 1px solid #CFC6B6 |
| Lock and accept | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 1px solid #FFD400 | backgroundColor: #1E22AA<br>borderTop: 1px solid #1E22AA | color: #141413<br>backgroundColor: #FFB800<br>borderTop: 1px solid #FFB800 |
| Refresh | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 | color: #EFE9DE<br>backgroundColor: #1B1B25<br>borderTop: 1px solid #302E3E |
| ask textarea | color: #2A2620<br>borderTop: 0px none #2A2620 | same | color: #2A2620<br>borderTop: 0px none #2A2620 |
| Ask btn | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 0px none #FFD400 | backgroundColor: #1E22AA<br>borderTop: 0px none #1E22AA | color: #141413<br>backgroundColor: #FFB800<br>borderTop: 0px none #FFB800 |

### 13.7 Decisions drawer and call card

tbwa light, full computed values. Font shorthand = family / size / weight / letter-spacing / line-height / transform. Sizes are px.

| element (selector) | exact copy | font | color | background | border-top | radius | shadow | padding | box (w×h, max-w, gap) |
|---|---|---|---|---|---|---|---|---|---|
| drawer (`#dtree-drawer`) | DECISIONS McDonald's Ireland · Summer McFlurry Close 3 open calls need your sign-off NEEDS | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #F9F7F3 | none·#141413 | 0px | #141413 / 0.18 -16px 0px 40px 0px | 0px | 540px×1000px, none, normal |
| backdrop (`#dtree-backdrop`) | — | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #141413 / 0.28 | none·#141413 | 0px | none | 0px | 1440px×1000px, none, normal |
| drawer eyebrow (`#dtree-drawer .sec-num`) | DECISIONS | Geist Mono / 11.5px / 700 / 0.92px / 17.825px / uppercase | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 349px×17.8125px, none, normal |
| drawer title (`#dtree-drawer h3`) | McDonald's Ireland · Summer McFlurry | Geist / 18px / 800 / normal / 21.6px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 349px×21.5938px, none, normal |
| close (`#dtree-close-btn`) | Close | Geist / 12px / 600 / normal / 18.6px / none | #141413 | #F9F7F3 | 1px solid #141413 | 4px | none | 0px 12px | 60px×32px, none, 7px |
| call card (`#dtree-open-calls-box`) | 3 open calls need your sign-off NEEDS YOU Can counter staff offer two spoons on request? S | Geist / 15px / 400 / normal / 23.25px / none | #141413 | #FEF3DC | 1px solid #B45309 / 0.38 | 8px | none | 14px 16px | 495px×404.359px, none, 10px |
| call title (`#dtree-call-title`) | 3 open calls need your sign-off | Geist / 13.5px / 700 / normal / 20.925px / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 206px×20.9219px, none, normal |
| call badge (`#dtree-call-badge`) | NEEDS YOU | Geist Mono / 10.5px / 700 / 0.63px / 12.6px / uppercase | #B45309 | #FEF3DC | none·#B45309 | 999px | none | 4px 10px | 79.6719px×20.5938px, none, normal |
| call row title (`.dc-rows b`) | Can counter staff offer two spoons on request? | Geist / 13.5px / 700 / normal / 19.575px / none | #2A2620 | #000000 / 0 | none·#2A2620 | 0px | none | 0px | auto×auto, none, normal |
| Looks right (`.dc-rows [data-np-ok]`) | Looks right | Geist / 12px / 600 / normal / normal / none | #2A2620 | #F9F7F3 | 1px solid #CEC6B7 | 6px | none | 0px 10px | 87px×28px, none, normal |
| Set aside (`.dc-rows [data-np-aside]`) | Set aside | Geist / 13px / 600 / normal / normal / none | #141413 | #000000 / 0 | none·#141413 | 0px | none | 0px | 61px×17px, none, normal |
| Approve all (`#dtree-approve-all`) | Approve all and lock the brief | Geist / 12px / 600 / normal / 18.6px / none | #FFFFFF | #16181D | 1px solid #16181D | 4px | none | 0px 14px | 202px×32px, none, 7px |
| view tab on (`#p33-dv button[aria-pressed="true"]`) | Graph | Geist / 12px / 600 / normal / 18.6px / none | #FFFFFF | #16181D | none·#FFFFFF | 0px | none | 0px | 123.25px×32px, none, normal |
| view tab off (`#p33-dv button[aria-pressed="false"]`) | By part | Geist / 12px / 600 / normal / 18.6px / none | #6D655A | #000000 / 0 | none·#6D655A | 0px | none | 0px | 123.25px×32px, none, normal |

What changes in the other brand and theme combinations (colour, background, border and shadow only; other values match tbwa light):

| element | tbwa dark | wk light |
|---|---|---|
| drawer | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 0px none #EFE9DE | backgroundColor: #F9F8F6 |
| backdrop | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| drawer eyebrow | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| drawer title | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| close | color: #EFE9DE<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #EFE9DE | backgroundColor: #F9F8F6 |
| call card | color: #EFE9DE<br>backgroundColor: #3A2A18<br>borderTop: 1px solid #E09A4B / 0.38 | same |
| call title | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| call badge | color: #E09A4B<br>backgroundColor: #3A2A18<br>borderTop: 0px none #E09A4B | same |
| call row title | color: #D6CEC0<br>borderTop: 0px none #D6CEC0 | same |
| Looks right | color: #D6CEC0<br>backgroundColor: #1B1A18<br>borderTop: 1px solid #2F2C28 | backgroundColor: #F9F8F6<br>borderTop: 1px solid #CEC7C5 |
| Set aside | color: #EFE9DE<br>borderTop: 0px none #EFE9DE | same |
| Approve all | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 1px solid #FFD400 | backgroundColor: #1E22AA<br>borderTop: 1px solid #1E22AA |
| view tab on | color: #141413<br>backgroundColor: #FFD400<br>borderTop: 0px none #141413 | backgroundColor: #1E22AA |
| view tab off | color: #A49B8D<br>borderTop: 0px none #A49B8D | same |

### 13.8 Build base tokens today, against the mock (tbwa light, desk)

Measured on the build at `#clients`.

| What | Mock | Build | Fix |
|---|---|---|---|
| Body | Geist 15px/23.25, ink `#141413`, page bg `#E9E4DB` (`--desk` = 6% agency base into `#F6F1E7`) | Geist 14px, ink `#14161B`, bg `#FFFFFF` | Adopt the mock's `:root` tokens (13.0) in `app/src/index.css`. Derive `--desk`, `--paper`, `--card` and `--line` from `palette.ts` base, as phase 28 does |
| h1 | Geist 50px / 800 / −2px / lh 48px, "Clients." with the trailing period in the accent | Geist 48px / 800 / −1.2px, "Clients" | `landing.css` |
| Eyebrow | Geist Mono 11.5px / 700 / 0.92px / uppercase / ink | Geist Mono 11px / 400 / 1.32px / `#4A4F5C` | `landing.css` |
| Bar buttons | Decisions: Geist 12px / 600, radius 999px, height 32px; theme: 36px circle | Browser default 13.33px buttons in the shell `ch-btn` | `chrome.css` |
| Paper and cards | `--paper` `#FFFDF8`-mix, `--card` `#FFFFFF`, `--shadow-card` and `--shadow-paper` as in 13.0, radii 4/8/14 | White cards, neutral greys | `index.css` |
