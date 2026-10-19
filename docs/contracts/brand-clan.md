# Contract 6 — the Brand Clan: one brand kit per brand, carried into every document

Status: **draft**, for the owner's approval (feature `brand-clan`). Owner: Shrey.
Reads with: `docs/contracts/os-layer.md` (addresses, decisions, spin-off §5,
client review §7.5), `campaign-clan.md` (the field envelope, pins, roster),
`peripherals.md` §4 (the layers port), `production-tool/contracts` (v3, the
Brand board) and `docs/production-tool/ui-behaviour.md` §3.18.

Owner decisions this implements (2026-10-19):

1. **One Brand Clan per brand per agency.** It is the shelf's "Brand kit".
   A project holds a **frozen copy** with a version and an Update chip, the
   way a spin-off holds its source.
2. **Naming a brand the agency has no kit for seeds it from the roster and
   the brand layer only.** Nothing is read from the public web.
3. **Write-back goes through the approved document.** When a document with a
   brand attached is recorded as client-accepted (os-layer §7.5), what it
   made and settled is offered to the brand kit; a person confirms, and the
   kit publishes a new version. Nothing enters the kit silently.
4. **Strictly per agency.** No house seed, nothing crosses tenants.

Foundation rules kept: the document owns no facts (D1: every figure is a pin
into the brand layer); a carried upstream is frozen and read-only (D6);
confidential means kept out of RAG and the corpus; client material never
enters the repo.

---

## 1. What it is

A Brand Clan is a CLAN document of the app `ie.napkin.brand`, stored in the
tenant's document store like every other document, one per `brand/<slug>`
per agency. It holds everything the agency knows and keeps about a brand
that is **not** a measured fact: identity, design language, assets, voice,
rules, channel specs, people, and the approved work made for it. The facts
(awareness, share, launch dates, roster categories, client org) stay in the
brand layer and are **pinned** into the kit's `shared/facts.yaml`, so they
merge into every document the brand is attached to, exactly as a campaign's
pins merge into a brief.

Three verbs, all on the OS layer, none app-specific:

| Verb | Means | Mechanism |
|---|---|---|
| **attach** | Put this brand into this document | §4. The spin-off carry (os-layer §5.2) applied to an existing document: frozen under `data.upstream.<brand document_id>`, members merged, chain carried, `lineage.attached[]` records the hop. One brand per document. |
| **seed** | Make a kit for a brand the agency has none for | §5. Roster row plus the brand layer's facts, through the middleware. An ask when the name is ambiguous. |
| **harvest** | Take what an approved document made back into the kit | §6. Offered on a `client_review` of `accepted`; a person ticks; one `publish`. |

Carry is uniform with the brief: a brief that has a brand attached and is
spun into the Production Tool hoists the brand (os-layer §5.2 item 2), so the
project holds `upstream.<brief>` and `upstream.<brand>` with no extra step.
A project that starts with no brief attaches the same brand directly and
ends up with the same `upstream.<brand>`.

---

## 2. Members

| Member | Role | Holds | Written by |
|---|---|---|---|
| `shared/data.yaml` | canonical-data | §3 | people in the brand view, Ellis (reading a brand book), lifts and harvests |
| `shared/facts.yaml` | pinned-facts | pins into the brand layer (`fact://brand/<slug>/<key>@v`), the roster pins included | seed, Research, a person |
| `shared/sources.yaml` | sources | the source record frozen beside each pin | seed, Research |
| `human/assets/**` | assets | logos (svg, png), fonts (woff2, ttf, otf, with licence), imagery examples, sonic logo, the brand book PDF and its `.extracted/` text | uploads, harvests |
| `agent/decision-chain.yaml` | agent-chain | every change, publish, harvest and backref | the OS layer |

No `findings` member: a brand kit synthesises nothing. Findings a Research
document carried stay in that document.

---

## 3. `shared/data.yaml`

### 3.1 Every item carries its provenance

Each leaf item below is an object with the item's own keys **plus** the
campaign contract's envelope keys (`campaign-clan.md` §2.1): `origin`
(`extracted` from a brand book page, `proposed` from a roster or layer pin,
`stated` by a person, `confirmed` by a person), `source` `{material_id,
locator, quote?}` for `extracted`, `fact_ids` for `proposed`, `by` for
`stated` and `confirmed`, and `decision`. Maps are keyed by id, never
positional (addresses, os-layer §3). The view renders envelopes with
`app/templates/shared/clan-fields.html`, as the brief and the campaign do.

Absent means not filled. No empty strings, no placeholders. The empty kit
`{brand: {ref, name}}` validates.

### 3.2 The keys

```yaml
brand:                                  # identity: who this is
  ref: brand/lumen-water                #   the brand layer entity; the key everywhere
  name: Lumen Water
  client_org: org/lumen                 #   from the roster (a pin)
  categories: [drinks.water]            #   from the roster (pins); closed taxonomy
  markets: [IE, GB]
  parent: brand/<slug>                  #   brand architecture, when there is one
  products:                             #   ranges and SKUs the agency works on
    <id>: { name, description?, asset? }
  sites: [https://…]
  handles: { instagram: …, tiktok: … }

kit:                                    # the kit's own state (not brand knowledge)
  version: 5                            #   bumped by publish (§7)
  published: { by: human:<id>, at: <datetime>, revision: sha256:… }
  changelog: [ { version, at, by, summary } ]

strategy:                               # what the brand stands for; seeded from approved briefs
  purpose, positioning, proposition, personality (traits[]), values[],
  audience (summary), proof_points[]

voice:                                  # verbal identity
  principles:  { <id>: { name, text, do[], dont[] } }
  tagline:     { text, since? }
  vocabulary:  { preferred: [ { use, not } ], banned: [] }
  pronunciation: { <term>: { respell, ipa?, audio? } }    # for voices and TTS
  claims:      { <id>: { text, substantiation: fact_ids, markets, expires? } }
  legal_lines: { <id>: { text, markets, channels, mandatory: bool } }
  languages:   [en-IE]

visual:                                 # design language
  logos:
    <id>: { name, kind: primary|secondary|mark|wordmark|lockup,
            variants: { <variant>: { asset, colour: full|mono|reverse, on: light|dark|any } },
            clear_space: { text, ratio? }, min_size: { px?, mm? }, misuse: [text] }
  colours:
    <id>: { name, hex, rgb?, cmyk?, pantone?,
            role: primary|secondary|accent|neutral|background|text,
            usage?, pairs_with: [<id>] }                   # pairs that meet contrast
  typography:
    <id>: { family, role: heading|body|display|caption|mono, weights: [],
            fallbacks: [], file?: asset,                   # never taken from a PDF
            licence: { holder, kind: desktop|web|app|broadcast, note? }, source: google|adobe|custom }
  imagery:     { style, principles: { <id>: { name, text, do[], dont[], examples: [asset] } },
                 photography?: { light, grade, subjects }, illustration?: { style }, iconography?: { style, set?: asset } }
  devices:     { <id>: { name, text, asset? } }           # graphic devices (the wave, the frame)
  layout:      { grid?, margins?, logo_placement?: corner|centre|…, safe_areas?: { <channel>: text } }
  motion:      { principles?, logo_animation?: asset, durations?, easing? }

sound:
  sonic_logo?: { asset, duration_s }
  music:       { direction, do[], dont[], tracks: [ { title, licence } ] }
  voices:      { <id>: { name, text, provider_ref?, consent: on_file|none, used_for: vo|character|all } }

rules:                                  # the flat do/don't list agents read; one line each
  <id>: { kind: do|dont|must, area: logo|colour|type|imagery|voice|legal|layout|sound,
          text, severity: warn,                             # never block (owner, 2026-10-13)
          checkable: bool }                                 # Jude can test it on a result

formats:                                # channel specs for this client
  packs: [ <pack_id> ]                                      # from production-tool/contracts/format-packs.json
  custom: { <id>: { name, width, height, unit, bleed?, safe_area? } }
  channels: { tv?: { durations, end_card }, social?: {…}, ooh?: {…}, print?: {…} }

people:
  <id>: { name, role: approver|guardian|agency_lead|other, email? }

work:                                   # approved exemplars (the harvested documents, §6)
  <id>: { document_id, app_id, title, kind: brief|research|ad|key_visual|other,
          version: sha256:…, client_review: d_…, accepted_at, summary?, assets: [sha256] }

materials:  { <material_id>: … }        # the index of supplied material (brand book, decks), as the brief's
projection: …                           # host-written from the members (os-layer §5)
upstream:   …                           # host-written; a kit attaches nothing today, kept for the schema's sake
```

`rules` is the one table every agent reads (Dex writes them into prompts,
Jude flags breaks, Make all sizes keeps safe areas, Skye keeps vocabulary).
The structured sections above are where people edit; a rule may cite the
item it came from (`cites`) so "Why this rule?" opens it.

### 3.3 What a brand book becomes

Dropping a brand book (PDF) on a kit, or on a Production Tool project with
a brand attached, runs Ellis's reading as `ui-behaviour.md` §3.18 says. Each
thing read lands as an `extracted` item with `source {material_id, locator:
"p.14", quote}`: logos as `visual.logos` (the page's images as assets),
colours as `visual.colours`, type as `visual.typography` with no file,
tone as `voice.principles`, do/don't as `rules`. Font files are never taken
from a PDF; `typography[].file` arrives only by upload, with `licence`.

---

## 4. Attach

### 4.1 The app declares it

As an app declares `spinoff`, it declares what it attaches:

```yaml
app:
  attach:
    accepts: [ie.napkin.brand]          # today only the brand; the mechanism is general
    lift:                               # seeds of the target's own fields (os-layer §5.4)
      brand.name: client
      visual.colours[primary].hex: theme.accent
    harvest:                            # §6: what an approved document offers back
      - { from: single_minded_proposition, to: strategy.proposition }
```

`accepts` empty means the app attaches nothing and the shell shows no chip.
One document of a given app id can be attached at a time: attaching another
brand replaces the first (recorded, Update semantics, §4.4).

### 4.2 What travels

Exactly os-layer §5.2, applied to an existing document: data frozen at
`data.upstream.<brand document_id>` (less its `projection` and `upstream`),
`pinned-facts` and `sources` merged by id, assets copied (the target's own
win a path collision), the chain carried whole below an **attach marker**.
`pin_source_decisions` defaults to **false** for an attach (a kit's chain
grows for years; the kit keeps it whole, the project keeps it compressed),
unlike a spin-off. Lifts copy with one `seed` decision each (§5.4 shape,
`agent: napkin-attach`, `actor: process:attach`).

### 4.3 What the hop records

```yaml
lineage:
  attached:                              # one record per attached document, the carried shape
    - document_id: <brand document_id>
      app_id: ie.napkin.brand
      version: 5                         # kit.version at attach
      data_sha256: sha256:…
      facts_sha256: sha256:…
      sources_sha256: sha256:…
      last_decision: d_…
      at: <datetime>
```

`carried` keeps naming the spin-off's direct parent only. `GET /upstream`
reports both: what changed in the parent, and what changed in each attached
document, by comparing these hashes with the source's current entries.

### 4.4 Update, replace, detach

- **Update** re-runs the attach against the current kit: the frozen copy is
  replaced whole, merged members take the kit's newer pins (by id, the
  target's own first), the record is rewritten, and one decision
  `update_from_brand` names the versions. The app re-runs its lifts only
  where the target field still holds the seeded value (a person's edit is
  never overwritten; the chip says "Kept yours").
- **Replace** (another brand): detach, then attach.
- **Detach** removes the frozen copy, the record and the seeds' values where
  still unedited, and leaves the merged pins (they are the document's own
  copies now, as after a spin-off). One decision.
- All three refuse on a locked document (`409`) and need the lease.

### 4.5 Routes

Host (`clan://` for apps, `/t/{tenant}/d/{doc}/…` on napkin-web):

| Route | Body → reply |
|---|---|
| `GET /attach-targets` | `[{app_id, documents: [{document_id, title, version}]}]` — the tenant's documents of each accepted app |
| `POST /attach {document_id}` | `{ok, attached: <record>, seeded: [addresses]}`; `403` cross-tenant, `409` locked or already attached, `422` app not accepted |
| `POST /attach/update {document_id}` | same reply; `409` when nothing changed |
| `POST /attach/detach {document_id}` | `{ok}` |
| `GET /upstream` | gains `attached: [{document_id, changed: {data, facts, sources, decisions}}]` |

The SDK gains `attach(target, source, AttachOptions)` beside `spinoff()`
(`crates/clan-sdk`), returning a `Change`; the host applies it as one write.
wasm gets it through `handle()`.

### 4.6 The shell: one Brand chip everywhere

The chip sits in the OS bar on every document whose app accepts the brand
(brief, research, production project; the Production Tool at `/production`
shares the component). Empty: "Set the brand". Click: a picker listing the
agency's kits (from `/attach-targets`), with a search box "or name a brand".
Set: the brand's name and "v5"; "v6 in the kit · Update" when behind. Naming
a brand that has no kit runs **seed** (§5), then attaches.

The Production Tool's "a project picks its client and sees that shelf first"
(os-sign-in decision, 2026-10-13) is this chip: `project.brand {document_id,
version}` in contract v3 (in place of `project.client_id`), and the team
library opens on that client's shelf.

---

## 5. Seed: a kit from the roster and the brand layer

Owner: roster and brand layer only; no web.

1. `POST /brand/identify {text}` (middleware): `find_brands(text)` on the
   agency's layers (`server/napkin/layers`, `peripherals.md` §4). Reply:
   `{candidates: [{ref, name, client_org?, categories}]}`. None: the kit is
   created with the typed name only, `note_brand` records the name, and the
   kit asks "Which category is it in?" (taxonomy `find`) so `set_roster`
   can write the roster row. Several: an ask with the candidates (the
   Research tool's Ask shape, `campaign-research/schema.json` `question`).
2. `POST /brand/seed {ref}`: the roster row and `facts(layer=brand,
   entity=ref)` as pins with their source records, plus the roster's
   proposals (`extract.py roster_proposals`): `brand.client_org`,
   `brand.categories` as `proposed` with `fact_ids`.
3. The host creates the document from the `ie.napkin.brand` template,
   writes the pins into `shared/facts.yaml` and `shared/sources.yaml`, patches
   `brand.*`, and records one `seed` decision citing the pins.

No model call. One middleware round trip. The mock middleware answers from
the mock layers (`mock-backend`).

---

## 6. Harvest: the approved document comes back

Trigger: a `client_review` with `answer: accepted` (os-layer §7.5, §8.2) on
a document with `lineage.attached[]` naming a brand. The review saves as
today; the shell's client-review band then offers **"Add to Lumen Water's
brand kit"**. Nothing happens until a person opens it and confirms.

`GET /harvest` (host) computes the candidates, no model:

1. **The document itself** as `work.<id>`: `document_id`, `app_id`, title,
   kind by app, `version` = the review's `seen.version`, the review's
   decision id, `accepted_at`, the app's cover assets by hash.
2. **Declared fields** from the app's `attach.harvest` map, each with its
   current value and the kit's current value side by side (new, changed,
   same).
3. **Production Tool only:** the project's Brand board items that differ
   from `upstream.<brand>` (a new logo variant, a corrected colour, a rule
   added, a pronunciation confirmed, a voice designed on the project), and
   the final renders as `work[].assets`.

The person ticks. `POST /harvest {items}` writes, in one change on the
**brand** document: the items (`origin: confirmed`, `by`, `cites` the
approved document's addresses and the review decision), a `publish` (§7),
and on the **approved** document a `backref used` (os-layer §7.4: "Used in
Lumen Water brand kit v6"). Harvest needs the brand's lease and refuses on
a locked kit (`409`). A rejected review offers nothing (owner, 2026-10-19).

---

## 7. Publish and versions

`kit.version` is a stamp, not a seal. **Publish** is a pinned decision
(`action: publish`, `fields_changed: [kit]`) that bumps `kit.version`,
writes `kit.published` and a `changelog` line. Attach and Update take the
kit's **current head**; the chip shows the version it took. The kit's view
shows "v5 · 3 changes since" so people publish on purpose. An
`accepted` harvest always publishes. Server revisions are append-only rows
already, so "attach at the published revision" is a later addition that
needs no change to `lineage.attached` (`data_sha256` names the revision).

---

## 8. Who reads the brand, and how

| Reader | Takes | From |
|---|---|---|
| Brief Maker (view) | `client`, `tone_and_world`, `mandatories` seeded; `theme.accent`, `theme.font` **proposed** (Apply / Keep mine), never applied silently | lifts; `upstream.<brand>` |
| Middleware drafters | the frozen kit as part of the upstream index (`middleware-api.md` §1, §10.13); pins through `clan.facts` | the document |
| Research (identify) | `campaign.brand`, `client_org`, `categories` as `proposed` | lifts and pins |
| Production Tool | a **Bring in** card ("From the brand kit: Lumen Water · 3 logos, 5 colours, 2 fonts, 6 rules"), which makes the Brand board: refs with roles logo, palette, typography, brand_rule, each `library {document_id, version, item_id}`; `formats.packs` and `custom`; `sound.voices` on the shelf; `voice.pronunciation` to the ElevenLabs dictionary | `upstream.<brand>` |
| Dex, Jude, Make all sizes, Skye | `rules`, safe areas, vocabulary | the Brand board (one brand link per node, contract v3) |
| Retrieval | approved `work[]` briefs as exemplars in the agency pack, scope `brand:<slug>` (`peripherals.md` §3.3) | a later feature |

---

## 9. Open points for the owner

1. Carry the kit's chain into each project whole and unpinned (D6, as
   above), or data and members only? Recommended: whole, unpinned.
2. Harvest from `accepted_with_changes` once the change is made and the
   document re-locked and accepted? Recommended: only `accepted`.
3. Brief theme from the brand: proposal (recommended) or applied at attach?
4. Words: "Brand" on the chip, "Brand kit" for the document, "Brand board"
   on the canvas (as the UI spec).
5. Contract v3: rename `project.client_id` to `project.brand {document_id,
   version}` before v3 is built (additive now, breaking later).
