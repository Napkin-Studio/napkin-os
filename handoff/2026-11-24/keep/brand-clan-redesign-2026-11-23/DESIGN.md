# Brand Clan, redesigned (draft for the owner, 2026-11-23)

Nothing here is built or committed. Mocks: `mock/index.html` (PNGs in `mock/shots/`, a1 to e2, at 1280 and 1024). The brand in the mocks, "Tidewell", is invented.

## 1. The flow, end to end

1. Someone adds a file in Brief Maker, Research or Production. Napkin reads it once and decides whether it looks like a brand bible (section 3). If not, nothing happens.
2. If it does, one question appears where the file is (mock a1):
   - the brand has no Brand Clan yet: **Build its Brand Clan** / **Not a brand bible**;
   - the brand has some: **Update "Original"** (the default, or the one the file's name points to) / **Make a new Brand Clan** (name it) / **Not a brand bible**.
3. The answer starts a background job. The person carries on (mock a2); the question never blocks "Write the brief".
4. The result is a Brand Clan: a CLAN file holding the Brand Bible. A new one is the brand's default if it is the first. An update arrives as a **new version waiting for a person**, with what changed listed item by item (mock b3). A person takes all, takes some, or keeps the old. Nothing changes until they do.
5. It lives in the **client window** (the client page, "Brand Clans" at the bottom). It lists the brand's Brand Clans with the default marked (b1), opens one as the rendered Brand Bible (b2: logos, colour board, type board, rules and tone, imagery style, the source file, and empty provision sections), and is editable in place. Edits are CLAN edits with the usual decision record. "Make default" is one click.
6. Work picks a Brand Clan: Brief Maker by a brand chip (c1, c2), Production by a node and its picker (d1 to d3: link it to the Script for everything made from it, or to one Storyboard or Film to try a look there), a Deck by Update look (e1, e2). New work starts on the default.
7. Work already made keeps the version it has. When the Brand Clan moves on, it shows an **Update chip**; a person presses it. Never a silent change.

Everything is per agency: the Brand Clans, the default and the files belong to the agency's tenant. Two agencies serving the same client each hold their own. Nothing is shared and Napkin has no house Brand Clan.

## 2. Data shape

- **One Brand Clan = one CLAN document** of app `ie.napkin.brand`, with the client on its manifest (as every document has). Several per client; each its own document, so each has its own versions and decision chain.
- `data` holds: `name`, `visual` (`logos[]` with variant and the picture as an asset, `colours[]` with name, hex and role, `typography[]` with family, weight, use), `voice` (tone line, rules do and don't), `imagery` (style words, bans, example pictures), `source` (the uploaded file as an asset, name, pages, who and when), and the empty provisions: `previous_work`, `categories_explored`, `likes_dislikes`, `preferences`. Provisions are in the shape from day one so later work only fills them; no UI is built for them yet.
- **Versions.** The document's `version` is its published version. A newer bible does not overwrite: the job writes `pending` = `{from_version, source, changes[]}` (each change: area, old, new). Accepting publishes version + 1 with the taken changes; v1 and v2 stay in the history. Old work keeps its frozen copy.
- **Default.** One field on the **client record**: `default_brand_clan: <document id>`. Recommended over a flag inside the documents: one write, no document revision, and it cannot end up on two documents.
- **How a project records which Brand Clan it uses: develop's `attach`, unchanged.** The Brand Clan's data is frozen at `data.upstream.<brand clan id>`, and `lineage.attached[]` records `{document_id, version}`. Brief Maker, Deck and Production declare `app.attach.accepts: [ie.napkin.brand]`. Picking another Brand Clan in a Brief or Deck is attach's **replace** verb; the Update chip is `/attach/update` (the same call develop has for research linked to a brief). Production lists it in `app.attach.many`, so two Brand Clan nodes can sit side by side (each attach is its own record); a job uses the one linked to it. Spin-off already carries the attached chain down (Brief, Production, Territories, Deck) whole. There is no `project.brand` and no new mechanism.
- No backward compatibility: no Brand Clan documents exist outside the old branch, so the shape is built clean.

## 3. Detecting a brand bible

- **Step 1, free:** the host already extracts text for an added file. A rule looks for signals: file name ("brand", "guidelines", "identity", "book"), words ("logo clear space", "colour palette", "typography"), hex or Pantone codes, page count over 8.
- **Step 2, one cheap model call** only when step 1 is unsure or positive: Claude Haiku on Bedrock reads the first pages' text and the file name and answers `{brand_bible: yes/no, brand name, confidence}` as structured output. About a cent per file; capped and counted under Claude spend like the Territories frame check. The brand name is matched to the client record, never typed by the person.
- **Step 3, the build** (after the answer): a middleware job `brand_build`, a stronger model reading the whole file in pieces (text, then page images for logos and colour chips), filling logos, colours, typography, rules, tone, imagery. A section it cannot find stays empty with a note, never invented. The job shows progress in the client window and on the file chip.
- **On failure:** detection failing or timing out means no question; the file chip keeps a small "Build a Brand Clan from this" action, so the person is never stuck. A build that fails leaves the source file safe, shows the reason and a Retry, creates nothing half-made (the job writes the document only when it has content). Over the page or spend cap (proposed 120 pages) it asks before spending.
- **Confidential** (owner, 2026-11-13): the bible is the client's material in the agency's tenant. It goes to the model through the same path as every other document, is never written to the shared knowledge layers or RAG, evals or run-log bodies, and the harvest path stays off. The client copy shows everything.

## 4. Per-tool reading

- **Brief Maker:** the chip carries the Brand Clan (spin-off carries it on to Production). The brief's look and logo slots offer it as a proposal ("Apply" / "Keep mine"), never applied silently (the branch already built this).
- **Research:** accepts the same attach and reads voice and rules for its own wording later; v1 only carries it so it reaches Production and Deck. No new Research screen.
- **Production:** a Brand Clan node is placed automatically on a project whose client has one (the default), drawn like the colour and typography boards, **not linked** (d1 says so, and how to link it). It powers jobs **only when linked** (same rule as references and the Brief). The picker on the node swaps it for another Brand Clan; a second node can be added beside it to compare looks. The link rules are in 4a.
- **Territories frames:** read style (palette, imagery style, bans) from the attached Brand Clan; this replaces the stand-in `client_of` / `style_folder` in `engine/territory/frames.py`, which then goes (no fallback kept).
- **Deck:** fill `look.brand_tokens` (today a stub returning nothing) from the Brand Clan: colours, type, dark-ground logo, imagery bans. The client's Brand Clan **wins** over the agency look; the agency look applies only when the client has none (reverses Sai's 17 Nov rule; Sai needs telling, Slack only as a draft). A finished deck re-themes **only when a person presses Update look** (e1, e2): `--update-look` is extended to take a new or different Brand Clan, re-resolve and rebuild, same words.

## 4a. Where a Brand Clan node links on the canvas (agreed 2026-11-23)

- **It can link to any node:** Script, Storyboard, Film, or a Key visual / Make all sizes.
- **A link carries downstream.** Linked to a node, the Brand Clan applies to that node and to every step made from it (Script, then Storyboard, then Film; Key visual, then its sizes), for both words and look. This is the same way linked pictures already reach frames and clips from the Script's scope (`web/src/jobs/select.ts`, `shotRefSet`).
- **What each part feeds:** tone, mandatory lines and words to avoid feed the **words**; logo, colours, type and imagery feed the **pictures** (frames, clips, the end card's logo, colours and type, key visuals and layouts). Both carry down.
- **A closer link overrides for its own branch.** Script linked to Original, Storyboard B linked to Summer 26: Storyboard B and its Film use Summer 26; the Script, Storyboard A and Film A use Original. For each step the nearest link upstream wins; with none, the step has no Brand Clan and the agency default look applies as today.
- **Same idea, two looks (mock d3):** one Script linked to Original; Storyboard A has no link of its own and shows "Original, from the Script"; Storyboard B is linked to Summer 26 and shows "Summer 26, linked here"; each Storyboard feeds its own Film. In data this is two `lineage.attached` records on the same Production document plus each node's link; the job's scope walks up the link graph and takes the first Brand Clan it meets.
- The node stays a CLAN `attach` (4: `many` on Production); only the canvas link decides what it reaches.

## 4b. Editing a Brand Clan by hand (mocks f1 to f4b)

- **Edit in place.** "Edit" turns the Brand Bible into a form where it stands: colours (change a hex or name, add, remove), logos (replace or add a file), type (face, use, weights), rules and tone (edit text, add or remove a rule), imagery (add or remove examples).
- **Draft, then publish.** Edits are saved as a **draft** of the next version ("Draft v3 · 3 changes"), seen only by the people editing; each changed item carries a small "changed" or "new" mark. Open work keeps using the published version. **Publish v3** opens a short confirm listing the changes in plain words (as the new-version review does); **Discard** drops the draft.
- **Then the Update chip.** After publishing ("Zero v3 · published"), work that uses Zero shows "Brand Clan updated · Update". Nothing in that work changes until someone presses Update (the same attach update as everywhere).
- **History.** Each Brand Clan lists its versions: who, when, what changed, and where it came from (v1 built from the brand book PDF, v2 from an upload, v3 edited by a person). Opening an old version is **read-only**; "Start a draft from this" is how an old look comes back, as a new version, never by rewriting history.
- **Every edit records who made it.** It is a CLAN file: each change is a patch with the person's name and time in its decision chain, and a published version freezes the chain up to it. The draft's "Edited by Aoife · just now" reads from that chain.

## 5. Reused from feat/brand-clan, and from develop

- **From develop, as is:** attach (`crates/clan-sdk/src/attach.rs`, `/attach`, `/attach/update`, `/attach/detach`, `lineage.attached`, `app.attach`), spin-off carry, the deck look resolver and `--update-look`, the shell client page.
- **From the branch, ported onto a fresh branch from develop:** the Brand Clan schema and example (`app/templates/brand`), the shell chip and popover and the Brief look proposal, `docs/contracts/brand-clan.md` (rewritten for this design), the mock middleware parity pieces.
- **Parked, not dropped:** `harvest.rs` (offering brand-worthy items after a client-accepted document) is how the "previous work" and "likes and dislikes" provisions fill later. Not in v1.
- **Dropped:** the branch's own attach in SDK, host and CLI (duplicate of develop's); the roster and brand-layer seeding (the bible replaces it as the source); `project.brand` in contract v3; the standalone Brand Clan app screen (the client window shows it).

## 6. Build phases

1. **Brand Bible first.** The Brand Clan document shape, the client-window list and Brand Bible view with in-place edits, Make default, and the new-version review. Created from an upload by hand ("Build a Brand Clan from this file"). Then detection and the one question, and the `brand_build` job.
2. **Carry.** `accepts`/`many` on Brief Maker, Research, Production and Deck; the Brief chip; the Update chip.
3. **Production.** The auto-placed node, the picker, jobs reading it when linked, two nodes.
4. **Deck.** `brand_tokens`, client-wins order, Update look with a picked Brand Clan.
5. **Territories** style read, then the provisions and harvest later.
Phases 1 and 2 are the first PR pair; Deck first among the tools because `brand_tokens` is a stub.

## 7. Risks

- Extraction quality on messy brand books (logos in vector PDFs, colours only as pictures). Mitigation: empty beats wrong; every field editable; click a logo tile to replace it.
- Cost on 100+ page books: the page and spend cap above.
- A wrong "this is a brand bible" or "which Brand Clan": the question is always asked; the default is the likeliest answer, never taken for the person.
- `attach.many` for Production must not leak to the other apps: declared per app.
- A new version arriving while a job runs: the job keeps the frozen version it started with; the Update chip appears after.
- The default pointing at a Brand Clan later archived: archiving a default asks for a new default first.

## 8. Open questions, with a recommended answer

1. Where does "default" live? **On the client record.**
2. One Brand Clan or many per project? **Brief and Deck: one (switching = replace). Production: many.**
3. When the file's name points to a non-default Brand Clan ("Zero-guidelines.pdf"), pre-select it? **Yes, highlighted, still asked.**
4. Who may accept a new version, edit, or set the default? **Anyone in the agency who can edit the client; recorded as a decision with their name.**
5. A first Brand Clan's name? **"Original", editable at the question.**
6. Page and spend cap for a build? **120 pages; above it asks first.**
7. Do finished Briefs and Decks show the Update chip too? **Yes, a chip only, never applied.**
8. Is the Update chip a plain "Update" or does it show what changed? **It opens the same what-changed list.**
9. Does Production place the node when the client has no Brand Clan? **No; only when one exists.**
10. Two agencies, one client: a client-owned Brand Clan later? **Not now; per agency (owner, 2026-11-23).**
11. Tell Sai the Deck order changed? **Yes, before Phase 4.**
12. Does a Brand Clan linked to a Script also dress the pictures made from it? **Yes, links carry downstream for words and look; a closer link overrides its own branch (4a).**
13. May the model see the bible given Confidential? **Yes, as for any document; it is the agency's work. Napkin storage, RAG and evals never take it.**
