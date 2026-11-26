# Contract 6: the Brand Clan, the Brand Bible of one look of one client's brand

Status: **approved for build** by the owner on 2026-11-23 ("Approved. Build."), after the redesign
(owner workflow of 2026-11-23, mocks a1 to f4b, the 12 answers of DESIGN.md section 8).
Feature `brand-clan` (branch `feat/brand-clan-v2`). Owner: Shrey. Replaces the design-time contract of
2026-10-19, which described a different mechanism (its own attach, roster seeding, `project.brand`); none of that is built.

Reads with: `docs/contracts/os-layer.md` (documents, decisions, attach 5.7, spin-off 5.2),
`docs/contracts/deck-visuals.md` (the deck's look order), `app/templates/brand-clan/schema.json` (the machine-checkable half of section 2)
and the vectors in `docs/contracts/examples/brand-clan/` (each one is checked by a test; they are the shapes to build against).

**Names.** The thing is a **Brand Clan**. Its content is the **Brand Bible**. Several per client (Original, Zero, Summer 26), one of them
the client's **default**. Everything is per agency (tenant): nothing is shared, and Napkin has no house Brand Clan.

**Not here (built elsewhere, never rebuilt):** attach (`crates/clan-sdk/src/attach.rs`, `/attach*` routes, os-layer 5.7), roster seeding,
`project.brand`, a standalone Brand Clan app screen (the client window shows it).

---

## 1. What it is

One Brand Clan is **one CLAN document** of the app `ie.napkin.brand` ("Brand Clan"), with the client on its manifest
(`manifest.client {id, name}`, as every document has). It lives in the agency's tenant like any other document. It has its own version
line and its own decision chain. It is an attach **source**: Brief Maker, Research, Deck and Production declare
`app.attach.accepts: [ie.napkin.brand]` (Production also `many`), and a work document that takes one holds a frozen copy at
`data.upstream.<brand clan document id>` with `lineage.attached[] {document_id, version, ...}`. The Update chip is `/attach/update`.

## 2. The document

### 2.1 `shared/data.yaml`: the published Brand Bible

Schema: `app/templates/brand-clan/schema.json`. **This file changes only when a person publishes or accepts a version.** That is what
makes the frozen copies in work, and `linked_status`, change only then (attach compares the hash of `shared/data.yaml`).

| Key | Meaning |
|---|---|
| `name` | Which look: "Original", "Zero". The client's name is on the manifest, not repeated. A first Brand Clan is "Original", editable. |
| `note` | One line under the name in the list: "The core look". |
| `kit.version` | The **published version**, an integer from 1. Attach reads it. |
| `kit.published {by, at}` | Who published the current version, and when. |
| `kit.changelog[]` | One entry per published version, newest last: `{version, at, by, from, summary, changes?}`. `from.kind` is `create` (made by hand), `build` (built from a brand book), `upload` (a newer file, taken as a new version), `edit` (a person's edit) or `restore` (an old version brought back as a new one); `from.file` names the file. |
| `visual.logos[]` | `{id, label, variant light/dark/mark/other, asset, note?}`. `dark` is the logo for a dark ground (the Deck's dark-ground logo). `asset` is `human/assets/<name>`. An SVG uploaded in the client window is turned into a PNG in the browser first (480 px high, at most 2400 wide; owner 2026-11-24), so `asset` is a PNG, JPEG or WebP the tools take as it is; the original SVG is not kept (one file per logo). |
| `visual.logo_note` | The clear-space / placement rule shown under the logos. |
| `visual.colours[]` | `{id, name, hex, role}`. `role` is one of the deck's tokens (`accent paper ink panel accent_ink`), `chart` or `other`. |
| `visual.typography[]` | `{id, family, weight, use, role head/body/other}`. `weight` is text: "700", "400 / 600". Naming a family never licenses or embeds it. |
| `voice.tone` | The tone line. |
| `voice.rules[]` | `{id, text, kind do/dont}`. Feeds the **words** (Brief, Script). |
| `imagery.style`, `imagery.bans[]`, `imagery.examples[]` | Style words, banned imagery (strings), example pictures `{id, asset, note?}`. Feeds the **pictures**. |
| `source` | The uploaded brand book of this version's origin: `{file, asset?, kind, pages?, by?, at?}`. |
| `gaps[]` | `{area, note}`: a section a build could not find. Empty beats wrong; nothing is invented. |
| `previous_work[]`, `categories_explored[]`, `likes_dislikes[]`, `preferences{}` | **Provisions**: in the shape from day one, empty, no UI. Harvest (parked) fills them later. |

Every list item has a stable `id` (`^[a-z0-9][a-z0-9_-]{0,39}$`); diffs match by id, never by position. `$schema` is allowed on disk and
ignored by the validator. An empty Brand Clan (`data.empty-v1.json`) validates.

**Confidential** (owner, 2026-11-13): the bible is the client's material in the agency's tenant. It goes to a model only through the path every
document takes; it is never written to the shared knowledge layers, RAG, evals or run-log bodies; the harvest path stays off.

* `competitors` (optional, phase 2): the client's competitors, `{id, name, note?, from: {kind: person|research, document_id?, title?, fact_ids?}}`. A Research document that found the category's players (`campaign.competitor_set`, origin `proposed`) is offered in the client window as "Add to the draft"; a person takes it into a draft and publishes it. Nothing writes it silently. The diff names it `competitor` ("Competitor Ariel added").

### 2.2 `app/brand/`: everything that is not the published version

None of these is read by attach. They are registered members (`brand-state`, `brand-version`) of the archive.

* `app/brand/state.yaml`: `{draft: <Draft>|null, pending: <Pending>|null}`.
  * **Draft** (a person's unpublished edit): `{based_on, from {kind edit|restore, version?}, started_by, started_at, edited_by[], edited_at, candidate}`.
    `candidate` is the **complete** next Brand Bible: the shape of `shared/data.yaml` without `kit`. Open work keeps using the published version.
  * **Pending** (a new version waiting for a person): `{from_version, at, by, from {kind build|upload, file}, source, candidate}`.
    `candidate` is the **complete** next Brand Bible, merged against the published one (section 4); its `changes[]` are computed on read.
* `app/brand/versions/v<N>.yaml`: the exact `shared/data.yaml` of published version N, written at each publish. **Old versions are read from these and are
  read-only**: nothing writes a version file twice.

### 2.3 Decisions (who changed what)

Every write is recorded in `agent/decision-chain.yaml` with the actor from the request context (never from the body), and `fields_changed`. Actions:
`brand_clan.create`, `brand_clan.draft` (a save), `brand_clan.draft_start`, `brand_clan.discard`, `brand_clan.publish` (**pinned**),
`brand_clan.proposal`, `brand_clan.accept` (**pinned**), `brand_clan.keep`. "Edited by Aoife, just now" reads `draft.edited_by` and `edited_at`;
the history reads `kit.changelog` and the draft. A published version freezes the chain up to it (the chain is carried by attach like any other).

Who may do what (owner Q4): **any person in the agency who can open the client**; every write below is refused for a context that is not a
person (403), except that `create` with a candidate and `proposal.set` also accept a `process:` actor (the build job).

## 3. The default

`default_brand_clan: <the Brand Clan's document_id>` is **one field on the client record** (the registry in `napkin_host::clients`): one write, no document revision, cannot
be on two documents. It is set to the first Brand Clan a client gets (by `create`), and moved by `default.set`. A document that is not an `ie.napkin.brand` of that
client is refused (422). `list` answers `default` as that id or null. New work starts on the default.

## 4. Changes (the diff)

`changes[]` is computed by the host, deterministically, from two Brand Bibles. Item shape (`#/definitions/change` in the schema):
`{id, area, kind added|changed|removed, label, old, new, text}`. `id` is `<area>:<item id>` (`colour:mint`), or the bare area for a scalar (`tone`).

| area | matched by | `text` |
|---|---|---|
| `name`, `note` | scalar | `Name becomes “Zero”` |
| `logo` | `visual.logos[].id` | `Logo <label> added` / `replaced` (asset differs) / `changed` / `removed` |
| `logo_note` | scalar | `Logo note becomes “…”` |
| `colour` | `visual.colours[].id` | `<name> <old hex> becomes <new hex>`; `Colour <name> <hex> added`; `Colour <name> removed`; a role or name change: `<name> role <old> becomes <new>`, `<old name> renamed <new name>` |
| `typography` | `visual.typography[].id` | `<family>: <old weight use> becomes <new weight use>`; `Typeface <family> added` / `removed` |
| `tone` | scalar | `Tone becomes “…”` |
| `rule` | `voice.rules[].id` | `Rule added: “…”`; `Rule changed: “old” becomes “new”`; `Rule removed: “…”` |
| `imagery_style` | scalar | `Imagery style becomes “…”` |
| `imagery_ban` | the string | `Imagery ban added: “…”` / `removed` |
| `example` | `imagery.examples[].id` | `Example picture added` / `replaced` / `removed` |
| `source` | scalar | `Source is now <file>` |

Order: logos, colours, typography, tone, rules, imagery, source (stable, see `changes.*.json`). A **proposal** (a newer file) compares a list section only when the
candidate **has that section non-empty**; a section it leaves out is kept, never deleted by a build that did not find it. A **draft** is the person's whole bible: a missing item is `removed`.

## 5. Routes

**Two ids, never mixed.** `document_id` is the manifest's id: what attach records (`lineage.attached[].document_id`, `data.upstream.<document_id>`), what `/attach` and `/attach/update` take, and what the client's `default_brand_clan` holds. `path` is the store's id for the document (what the shell opens it by): the routes' `{doc}` and every `path` in a reply. A work document is always named by its `path`.

Tenant routes under `/api/t/{tenant}` on napkin-web. The same operations are one function, `napkin_host::brand_clan::call(store, ctx, op, input)`, which the wasm and desktop hosts
call by op name (the **op** is in brackets). JSON in and out. Errors are the host's: 400 bad input, 403 not a person (or another tenant's document), 404, 409 conflict (a stale
`expect_version`, no draft, nothing to publish), 422 not a Brand Clan, or a bible the schema refuses (on create and publish; a draft or proposal the schema refuses is 400).

| Route [op] | Body | Reply |
|---|---|---|
| `GET /clients/{client}/brand-clans` [`list`] | | `{default, items[Summary], behind[Behind]}` (`list.reply.json`) |
| `POST /clients/{client}/brand-clans` [`create`] | `{name, note?, candidate?, source?, from?}` | the `View` |
| `PUT /clients/{client}/default-brand-clan` [`default.set`] | `{document_id}` (the Brand Clan's manifest id) | the client record, with `default_brand_clan` |
| `GET /brand-clans/{doc}` [`get`] (`?version=N`) | | the `View` (`view.reply.json`); with `version`, that version, `readonly: true` |
| `GET /brand-clans/{doc}/history` [`history`] | | `[HistoryEntry]` (`history.reply.json`) |
| `PUT /brand-clans/{doc}/draft` [`draft.save`] | `{candidate, expect_version?}` | the `View` |
| `POST /brand-clans/{doc}/draft/start` [`draft.start`] | `{from_version?}` | the `View` (a draft from the published, or from that old version: "Start a draft from this") |
| `DELETE /brand-clans/{doc}/draft` [`draft.discard`] | | the `View` |
| `POST /brand-clans/{doc}/publish` [`publish`] | `{summary?, expect_version}` | the `View`, at version + 1 |
| `POST /brand-clans/{doc}/proposal` [`proposal.set`] | `{candidate, source, from}` (`proposal.request.json`) | the `View` with `pending` |
| `POST /brand-clans/{doc}/proposal/accept` [`proposal.accept`] | `{take: "all" \| [change id], expect_version}` | the `View`, at version + 1 |
| `POST /brand-clans/{doc}/proposal/keep` [`proposal.keep`] | | the `View`, pending cleared, version unchanged |
| `POST /brand-clans/{doc}/update-work` [`work.update`] | `{work}` (a work document's `path`) | the attach reply of `/attach/update` |
| `POST /brand-clans/{doc}/assets?name=` [`asset.put`] | the file's bytes | `{name, path}` (`path` is `human/assets/<name>`; the name is made unique by a content prefix) |
| `GET /brand-clans/{doc}/assets/{name}` [`asset.get`] | | the bytes (SVG served as an image only) |

**Summary** (`list`): `{document_id, path, name, note, version, default, updated_at, palette[<=5 hex], logo (asset path|null), source {file}|null, pending {from_version, changes, at, by, file}|null, draft {based_on, changes, by, at}|null}`.
**Behind** (`list`): a work document whose frozen Brand Clan is older than the Brand Clan's published version: `{path, title, app_id, brand_clan (its document_id), brand_name, held, current}`. This is what the **Update chip** reads.
**View**: `{document_id, path, client, name, note, version, default, readonly, shown {version, state published|draft|pending}, data, draft, pending, used_by[{path, title, app_id, held, behind}]}`.
`data` is the shown Brand Bible (published; or version N when `?version`). `draft` and `pending` are as in 2.2, each with `changes[]` computed against the published version.
**HistoryEntry**: `{version, state published|draft, at, by, from, summary, changes[]}`, newest first, the open draft on top as the next version.

Rules: `draft.save` of a candidate equal to the published bible clears the draft. `publish` needs a draft (409), writes `versions/v<N+1>.yaml` and `kit.changelog`, bumps `kit.version`,
clears the draft, and its summary defaults to the changes' texts. `expect_version` is the published version the person saw; a stale one is 409 ("changed while you were editing").
`proposal.accept` with `take` publishes the published bible with only the taken changes applied (added, changed and removed by id; scalar areas by area); the pending is then
cleared. The new version's `from` is the pending's. `proposal.keep` clears pending and records `brand_clan.keep`.
`create` with a `candidate` (a build's result) writes v1 published; without it, v1 is the empty bible plus any `source`. It creates the document in the client's name, and sets the default when the client has none.
`work.update` is attach's `update` for one work document with this Brand Clan, written as the person, plus the `linked` backref: nothing in the work changes until this is called.

## 6. The client window (the only place it shows)

The client page's **Brand Clans** section lists the client's Brand Clans (the default marked, "New version to review" when pending, a draft mark), opens one as the rendered Brand Bible (logos, colour board, type board,
rules and tone, imagery style, the source file, and no UI for the provisions), edits it in place, and holds History. **Make default** is one click. After a publish, the work that uses an older version shows
**"Brand Clan updated · Update"** (from `behind`); pressing it opens what changed (the changelog entries after the held version) and **Update** calls `work.update`. Never a silent change.

## 7. Build jobs (lane B, phase 1; the contract the jobs write against)

* **Detection** (step 1 free rules over the host's extracted text; step 2 one Haiku call, `{brand_bible, brand_name, confidence}`) and the question (mock a1) decide only whether to ask.
* **Build** (`brand_build` job, a stronger model reading the whole file in pieces) produces a **complete candidate** (section 2.2) and a `source`, then writes it through the host:
  a first build: `create {name: "Original", candidate, source, from {kind build, file}}` as `process:brand_build`; an update to an existing one: `proposal.set {candidate, source, from {kind upload, file}}`.
  The job writes the document **only when it has content**; a failed build creates nothing half-made. A section it cannot find is omitted and listed in `candidate.gaps`.
* **Order for assets on a first build** (there is no route that uploads before the document exists): (1) `create` with the candidate, naming each file as `human/assets/<sha10>-<name>`, where `<sha10>` is the first 10 hex digits of the SHA-256 of the file's bytes and `<name>` is the file name (the host's naming rule, so the job knows the names beforehand); (2) `asset.put` each file into the new document (the reply's `path` must equal the name the candidate used); (3) done. A candidate may name a file that is not there yet; the Bible shows it as a missing picture until `asset.put` lands. For an update, `asset.put` into the existing document first, then `proposal.set`.
* **The service credential.** The job is not a signed-in person. napkin-web lets a request in without a session when it carries `Authorization: Bearer <NAPKIN_BRAND_HOST_TOKEN>` (32+ bytes, set on napkin-web and on the middleware as the same secret) and `X-Napkin-Actor: process:brand_build`, and only for: `GET /clients/{c}/brand-clans`, `GET /brand-clans/{doc}`, `POST /clients/{c}/brand-clans`, `POST /brand-clans/{doc}/proposal`, `POST /brand-clans/{doc}/assets`. The workspace is the `{tenant}` in the path. The actor on every decision and every changelog entry is `process:brand_build`, so history reads "built from <file>" by Napkin. A wrong token, another actor name, or any other route is 401. The host refuses a `process:` actor everywhere except `create` with a candidate, `proposal.set` and `asset.put` (403), so the credential cannot publish, accept, edit or set the default.
* The shell reads a client's Brand Clans and default with `host.brandClans.list(clientId)` (`{default, items, behind}`), on every host (`app/src/host/brandClans.ts`: also `get`, `history`, `create`, `saveDraft`, `publish`, `setDefault`, `updateWork`, …).

## 8. What reads it (phase 2, lane B; frozen shapes)

| Reader | Reads | From |
|---|---|---|
| Brief Maker chip (its Logos box offers `visual.logos[]`, `light` first, then `other`, `mark`, `dark`, each from `human/assets/brand/<id>/<file>`), Deck Update look, Production node, Territories frames | `data.upstream.<id>` (the frozen copy), `lineage.attached[].version`, `kit.version`, `visual.*`, `voice.*`, `imagery.*` | the work document |
| Deck `look.brand_tokens` | `visual.colours[].role/hex`, `visual.typography[].role/family`, `visual.logos[]` and their files: the `dark` logo, else `mark`, else `other` (what the Brand Clan editor files an upload as) for the cover, `imagery.bans[]`, `kit.version` | frozen copy, `human/assets/brand/<id>/` |
| Production jobs | `voice` for words; `visual`, `imagery` for pictures; the nearest Brand Clan node up the link graph | the document's `lineage.attached[]` and each node's link |
| Production end card and sizes | the logo (`dark`, else `mark`, else `light`, else any), copied into the project as a picture when the node is placed, swapped or updated (`brand_clans[id].logo`); used when the node is linked and the project has no Brand board logo, which still wins (owner 2026-11-24) | the Brand Clan's asset route |

A frozen copy never holds `app/brand/` (draft, pending, versions): attach takes `shared/data.yaml`, plus the logo files.

**Logo files travel with the copy** (owner, 2026-11-24: "Yes it reaches deck"). When attach, Update or `work.update` carries a Brand Clan, the host also copies each `visual.logos[].asset` file into the work document at `human/assets/brand/<brand document_id>/<file name>` (`napkin_host::library::brand_logo_entry`), so the work holds the logo of the version it holds; a newer logo arrives only with Update. The Deck reads them there (`engine/deck/inputs.py`, `_logo_files`; on the web the host carries the copy and its files to the deck engine beside the upstream index as `brand_upstream`, `docs/contracts/middleware-api.md` §1) and places the `dark` logo (the `mark` when there is no `dark`; SVG, PNG, or a JPEG/WebP turned PNG) on the cover (pptx and web), as the client's own (`for_client`), whatever the Brand Clan is named. A logo whose file is not in the work is held and said ("its file did not reach this deck. Update the Brand Clan on the deck to bring it."), never dropped silently.

## 9. Compatibility

None kept. No Brand Clan documents exist outside the old branch; the shape is built clean. `kit.version` is the only key attach reads, and it is the same key the Style Pack uses.
