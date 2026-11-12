# Contract 4 — the OS layer

Status: **draft**, pending the W1-C4 contract gate. Owner: Shrey.
Implements foundation decisions P1b (amended), N3, N4, D5, D6, D7, C4, L4.
Task: `W1-C5` in `napkin-build-plan.clan`.

The OS layer is `crates/napkin-host`. It is everything Napkin OS does with a
CLAN document that is not drawing pixels and not thinking: opening it, the
`clan://` contract an app calls, typed decisions, spin-off, locking, and the
app library. Three shells run it: `server/` (FastAPI, via PyO3), the Tauri
desktop shell, and `napkin-wasm`.

This document is what every other track reads. Where it disagrees with the
code, the code is wrong. Where it disagrees with `foundation-spec.clan`, the
spec wins and this document is a defect to report.

---

## 1. Where it sits

```
 App — the installed version (same major) from the app library, sandboxed iframe
      │  clan:// contract, versioned
 ─────┼───────────────────────────────────────────────────────────────
 Shells   server/ FastAPI (authoritative) │ Tauri │ napkin-wasm
      │     └ middleware: auth → Ctx, lease, handlers, ports, gates
 ─────┼───────────────────────────────────────────────────────────────
 OS layer = napkin-host — a library, stateless, domain-free
   routes    clan:// dispatch, trust gate, capabilities
   ops       (Ctx, Document@version, input) → Change
   ports     PartStore · Library · FactResolver · Config
 ─────┼───────────────────────────────────────────────────────────────
 clan-sdk — the format: pack, unpack, verify, fork, merge, spinoff
```

The layer is a library, not a network tier. Python calls it inside its own
transaction (P2). The desktop and wasm shells call it directly.

### What never enters the OS layer

- Prompts, retrieval, model calls, gate logic. Those are middleware (M1).
  (`prompt.rs`, which knew what a creative brief is and defaulted the task to
  `draft_brief`, is gone, with the browser-side model call it served.)
- Tenancy and identity decisions. The layer receives a resolved `Ctx`; it never
  derives scope from a request body (M3).
- Database handles or credentials. It reaches storage only through its ports.
- Anything app-specific. Apps declare; the middleware runs logic; the layer
  provides generic primitives.

---

## 2. Sync model (N3)

The server holds every document. The viewer never downloads a working copy.

1. **Edits go up as operations.** A write carries the fields that changed and
   the version it was based on: `patch-data {patch, base_version}`.
2. **The server applies, records, versions.** One transaction: the change, the
   decision behind it, version N → N+1. A stale `base_version` is a distinct
   conflict error — never retried, merged or overwritten.
3. **Changes fan out.** Every open view of the document receives
   `{doc, version, change}` over SSE and re-renders from `window.__CLAN__.data`.
   The editing client updates optimistically and reconciles on the ack.
4. **One editor at a time.** A lease with heartbeat, presence and a visible
   handoff (N1). A force-take is a recorded decision.
5. **A `.clan` file is packed on demand** for export, client handoff and the
   offline presenter. A packed file is a snapshot, never a working copy.

The offline presenter is **read-only**. Offline editing, if it is ever needed,
becomes a branch that merges back through §6 — no redesign.

Rejected: downloading files and syncing them. Every write re-deflates the whole
ZIP, so byte diffs are the whole file; a held copy written back is the observed
viewer clobber; and two merged offline copies make the chain ambiguous.

---

## 3. Core types

### Ctx — who is asking, resolved before the layer sees the request

```
Ctx {
  actor:     "human:<user-id>" | "process:<job-id>" | "<producer>/<version>"
  org, brand: resolved from the authenticated session, never the body
  handler:   Option<"name@major.minor">   // set when a handler is acting
  backend:   Option<String>               // set when a judgement port answered
  lease:     Option<LeaseId>
}
```

### Address — a stable pointer to a field

`<doc-id>#<entity-keyed path>`, e.g. `3f2a…#competitors[tesco].share`.

- The document id is part of the address, so an address stays valid inside any
  document that carries the origin (§5). No remapping, ever.
- Paths are entity-keyed. A positional index (`shots.0`) is invalid, because a
  re-sort silently re-points it and the app bridge turns arrays into maps.

### Document — the unpacked parts

`manifest · data · facts (pins) · findings · chain · context · view ref ·
asset refs · upstream` where `upstream` is the frozen data of every document
upstream, at `data.upstream.<document_id>`, and `manifest.lineage.carried`
records the hop (§5). The server stores parts — rows in Postgres, blobs by
hash in S3. The desktop and wasm stores pack and unpack at the edge.

Until the loop has closed once, SDK operations still run over `ClanFile`; the
layer packs a transient archive to call them (Tier 0 rule). Moving the SDK
operations onto the part model is a later task.

### Change — what an operation returns instead of writing

```
Change {
  doc, expected_version,
  parts: { data?, facts?, findings?, context?, view?, assets? },
  decisions: [Decision],        // appended, never rewritten
  events: [HostEvent],          // fanned out after commit
}
```

The caller applies it: `FsStore` as a version-checked file write, the server as
one Postgres transaction. This is the single write funnel — the version check
(W2-A4) and the seal check (W5-Z1) live here and nowhere else.

### Decision — one primitive for every mark (D5)

| Field | Meaning |
|---|---|
| `id` | Stable, generated at creation, never content-derived |
| `kind` | `edit` · `contest` · `resolve` · `verdict` · `classify` · `pin` · `finding` · `verify` · `approve` · `lease` · `backref` (§7) · `client_review` · `unlock` (§7.5) · `sign` (§7.7, the planner's signature on a brief; *added 2026-11-11*) |
| `targets[]` | Addresses this decision is about |
| `cites[]` | Fact pins, sources, findings and decisions it rests on |
| `superseded_by` | The decision that replaced this one |
| `actor`, `handler`, `backend`, `scope` | Copied from `Ctx` — never from the body |
| `polarity`, `reason_code`, `taxonomy_version`, `reviewer_role` | Verdicts |
| `licence` | Classify: `{model, export, corpus}` per C2 |
| `rationale` | Required for `resolve`, `verdict` with polarity bad, `lease` force-take, and `approve`. The plain one-line summary older readers show: with `reasoning`, `decided` + its first `because` point, unless the writer supplied one |
| `reasoning` | Why, in the shape of the foundation spec's decisions (below). Optional in the format — a person's edit has none. Required of the middleware on every `pin`, `contest`, `finding` and `verdict` and every proposal, and on what the document's app declares in the `reasoning` block of its `app/pipeline.yaml` (`kinds`, and `edits`: the data paths an edit must say why it wrote) — the layer applies the declaration and knows no app's fields (`napkin.middleware/1` §3). Never rewritten by compression |
| `#[serde(flatten)] rest` | Unknown fields survive a read-modify-write |

Existing fields (`agent`, `action`, `timestamp`, `fields_changed`, `pinned`,
`trace_ref`) stay. Every new field is optional, so every existing file still
validates. Struct work is W1P-I5.

**What came first is the chain's order** (owner, 2026-09-30). The chain is
newest first; a decision nearer the head came after one further down, and no
rule anywhere — host, SDK, middleware or view — compares `timestamp`s to
order decisions: a stamp is for showing, and a clock can be wrong. Parallel
branches are runs with no order between them: `clan merge` appends each
branch's decisions as one contiguous run in the branch's own order, the runs
in branch (argument) order above the base chain (the first branch's run
oldest) — the same order the data fold uses, so under `last-write` the run
nearest the head is the winning writer's — and the merge marker (`agent:
clan-merge`) lists them as `parallel: [{branch, count}]`, from the base up. A
reader must not infer that one run's decision came before another's.

#### `reasoning` — the spec's decision discipline, on every agent decision

```yaml
reasoning:
  decided: Opened a contest on the flagship year; nothing is picked.   # one sentence
  because:                                   # ≥ 1 point
  - point: The market_structure/IE run says 2019
    cites: [f_01JB…IE, src_01JB…]            # facts, findings, sources, materials, decisions, addresses
  - point: The market_structure/GB run says 2020
    cites: [f_01JB…GB]
  rejected:                                  # the alternatives and why each lost
  - { option: pick either value silently, why: nothing in the evidence says which run is right }
  only_option: …                             # only when `rejected` is empty: why there was one option
  certainty: { level: high, why: the values differ as their sources state them }
  would_change_if: a primary source settles the value, or a person resolves the contest
  attention: The runs disagree on the flagship year; a person should resolve it.   # optional
```

| Field | Rule |
|---|---|
| `decided` | Non-empty: what was decided, one sentence |
| `because[]` | At least one point; every cite a non-empty id; a point that states a figure (holds a digit) cites where the figure is |
| `rejected[]` | Each `{option, why}`, both non-empty. Empty only with a non-empty `only_option` saying why there was one option |
| `certainty` | `level` one of `high` · `medium` · `low`, and a non-empty `why`. For anything resting on facts it is the **derived** confidence (source tier + corroboration, Contract 3 §6.1) and its basis — never self-reported |
| `would_change_if` | Non-empty: what new evidence would reverse it |
| `attention` | Optional, non-empty when present: why a person should look — an uncertain call, thin evidence, a contest, a skipped lens that might matter |

It maps onto the foundation spec's decisions one to one: `decision` →
`decided`, `because` → `because`, `rejected` → `rejected`, `reverses_if` →
`would_change_if`; `certainty` and `attention` are what a reviewer needs that
a design record does not. `validate` checks the shape wherever a decision
carries one and requires it nowhere (the format cannot tell who decided);
unknown fields inside it survive like the decision's own. The viewer renders
it as the decision's readable block; `rationale` stays for every reader that
predates it.

---

## 4. The features, as decision kinds

### Collisions (app-specific policy, generic mechanism)

- A **contest** is opened when two writers produce different values for one
  address: two research lenses, a job against a human edit (N2), or a branch
  merge. Fact collisions live in the knowledge layer as contested rows; field
  collisions live in the document as `contest` decisions.
- Each app declares a merge policy per field (`ask`, `append`, `max`, `min`,
  `agent-priority`, `last-write`). **`ask` is the default. An undeclared field
  is `ask`; an unknown policy name is a hard error** (M4). Today
  `clan-sdk/src/merge.rs:264` and `:363` fall through to `last-write` —
  fixed by W1P-I7.
- Under `ask`, the old value stays and nothing is picked. The lease holder
  resolves with a rationale; the losing value is superseded, never deleted.
- Only the contested field waits. The rest of the document keeps syncing.

### Confidential (C4)

A `classify` decision setting the three C2 destinations: may it reach the
model, may it appear in an export, may it enter the corpus.

- On a field backed by a pinned fact, the mark supersedes the **fact's
  licence in the layer**, with the decision behind it. A document-only mark
  would still leak through the layer into the next campaign.
- On authored text, it is a licence on the field in the document.
- Enforced at gate G4 (prompt selection), `compose_export` (this layer), and
  the dossier promotion check (W5-Z2).

### Good and bad (L4)

A `verdict` decision with `polarity`, a `reason_code` and a rationale
(required when bad, and for `other`). Field-scoped.

- **Quality verdicts** go to verdict rows (W4-V4) and the dossier: good feeds
  exemplars, bad feeds CONSTRAINTS.
- **Truth verdicts** ("this figure is wrong") reach the fact. A human
  verification is a **source**: uri `human:<id>`, tier `reviewer-verified`,
  linked to the fact. Confidence stays derived from tier and corroboration.
- The vocabulary gains positive codes beside the ten failure codes. Both need
  the creative director's redline.

### Findings (D1 amended)

- Agent synthesis is a `finding`, stored in `shared/findings.yaml`, status
  `proposed`, labelled **"derived by the agent"**, with `cites[]` to the facts
  it rests on.
- The document may use a proposed finding, visibly labelled. It stays
  **"derived by the agent"** in every document that carries it, until a
  person verifies it — in that document, or upstream before the hop. In a brief it is **cited only**: it
  may ground a drafted field (insight, proposition, reasons to believe,
  desired response), with certainty at most medium, and never fills a field
  captured from the client's material (`napkin.middleware/1` §10.13; owner
  default, 2026-09-29, may be reversed).
- A finding reaches the knowledge layer only when a human verifies it
  (`verify`, which creates the `human:<id>` source). Then it is a fact with
  `method: synthesis`, pinned like any other, and the next campaign inherits it.
- Nothing unverified ever enters the layers.

### The decision history, made useful

With `id`, `targets`, `cites` and `superseded_by`, the chain is a graph. The
layer serves generic views over it:

- `/history?address=` — why is this value here: every decision on the field,
  the facts it cites, each fact's source and tier.
- `/timeline` — filterable by actor and kind.
- `/open` — every unresolved item (§7), including carried ones.
- Handler version and backend on every entry explain why two documents from
  the same app differ.

`compress_chain` must stop splitting on full stops before rationales that cite
paths can be shown (W2-A2).

### How it looks is one rolling entry

A person changing only how a document looks — its kind of brief, its palette,
a field's styling — is not a decision about the work, and asks for no reason.
An app marks those data keys in its schema, once, with
`"x-clan-appearance": true` on the top-level property. The host reads the mark
from the document's schema and from the installed app's.

A person's `patch-data` whose keys are all marked is recorded as one entry,
kind `edit`, action `look`:

- When the newest decision in the chain is already that person's `look`, it is
  updated in place: each key's latest words (`looks`, a mapping in the order
  the keys were first changed), `fields_changed`, the rationale ("Changed the
  look: Studio brief; Harbour palette") and the time, which is the latest
  change's.
- Otherwise a new `look` entry is added, so a look changed after other work
  stands after it, and the chain's order stays true.

The entry never blocks the lock and is never flagged. The extract drops it
(clan-extract §1.7, rule 3), as it drops the older `set style`, `style <key>`
and `set theme`. An agent's write to a marked key is an ordinary decision.

---

## 5. Spin-off carries everything (D6)

A hop carries the source whole. The next document holds it as a frozen,
read-only upstream under the source's document id, so every address,
decision and mark from upstream still resolves.

*Changed 2026-09-29.* The table below was the rule; the SDK did not follow it.
`spinoff()` copied the target app's entries and the source's assets only, so
the facts, findings and sources members, the agent branches and every open
item's evidence were lost, and with no `map` the source's data was folded in
at the root, where research `materials` collided with the brief's and
`projection` came along. This section now says exactly where each part lands
and what the hop records, so the SDK, the host and the views build to one
shape. An app that does not opt in (below) spins off as before.

| Travels | Does not travel |
|---|---|
| All data, frozen, under the source's doc id — without its `projection` | The source app's view (`human/index.html`) |
| Facts member (pins), findings member and sources member, merged | The source app's task text (`agent/context.md`) |
| The entire chain: verdicts, classify marks, approvals, open contests | `human/patches.yaml` and `shared/edits.yaml` |
| Unmerged agent branches and the merge report, as collisions | View state, the lease, secrets |
| Assets (by hash on the server) | |
| Lineage, plus the carried hashes and last carried decision id | |

### 5.1 Opting in: `app.spinoff.upstream`

The target app declares the hop in its manifest, as it declares `map` and
`lift` today:

```yaml
app:
  spinoff:
    accepts: [ie.napkin.campaign-research]
    upstream: true        # carry the source whole, under data.upstream (this section)
    lift: {}              # optional seeds of the target's own fields (§5.4)
```

1. `upstream` defaults to `false`. With `false` nothing in this section
   applies and the hop is the older graft — `map`, or the root fold — so
   Advertising Studio's `map: brief` is unchanged.
2. With `true`, `map` must be absent (declared or passed as the `/spinoff`
   override); a spin-off with both is refused (`422`): the source's data has
   one place, `upstream.<id>`.
3. A spin-off from an unlocked document is allowed. What is open travels open
   (§5.5).
4. Source and target must be the same tenant; a cross-tenant hop is refused
   (`403`, §8).
5. A spin-off out of a Brief Maker brief is refused `409` unless the brief is
   open (§7.7): passed, signed by the agency, confirmed by the client and not
   changed since. Creative work (Territories, Deck Maker) starts on a confirmed
   brief. A no-op while `NAPKIN_BRIEF_GATE` is not `on`.

### 5.2 Where each part lands

1. **Data.** The source's `shared/data.yaml`, less its `projection` and its
   `upstream`, is written at `data.upstream.<source document_id>` in the new
   document, value for value. It is host-written and read-only: no data
   patch, `/patch-data`, `/edit` or middleware `data_patch` may write
   anything under `upstream` (refused `400`, like `projection`).
2. **Upstream of upstream is hoisted.** Each key of the source's own
   `data.upstream` becomes a sibling key of the new `data.upstream`, value
   unchanged. Campaign → brief → deck: the deck holds
   `upstream.<campaign>` and `upstream.<brief>`, and the brief's copy holds no
   `upstream` of its own. A key the new document already holds is kept (it
   cannot happen in one hop).
3. **Members are merged, not frozen.** The entries registered with role
   `pinned-facts` (`shared/facts.yaml`), `findings` (`shared/findings.yaml`)
   and `sources` (`shared/sources.yaml`) are merged into the new document's
   member at the same path, by `id`: the target's own entries first, then the
   source's in the source's order, skipping an id the target already holds.
   When the target holds no entry of that member, the source's bytes are
   written unchanged. A member the target does not register is registered with
   the source's `files[]` role. The child verifies or rejects **its copies** of
   the findings and corrects its copies of the pins; the parent's members
   never change (§7, §8.1). A document pin (`kept_in_document`, Contract 3
   §4) carries by id like any pin, with its sources, so a claim citing it in
   the parent still resolves in the child; it stays a document pin there and
   is never written to the layers by the hop.
4. **The chain is carried whole.** Every source decision, field for field,
   below the spin-off marker and above the target template's own; `pinned`
   is set on each when `pin_source_decisions` holds (the default). Nothing is
   dropped, reordered or re-addressed — open contests, bad verdicts, classify
   marks and the source's `approve` included.
5. **Agent branches** (`agents/**`) keep their paths. **The merge report** is
   carried at `upstream/<source document_id>/merge-report.yaml` (role
   `upstream-merge-report`), not at the root: its keys name the source's data,
   which is no longer at the root, and the new document may make its own.
6. **Assets** (`human/assets/**`, the `.extracted/` sidecars included) are
   copied; the target's own asset wins a path collision.
7. **Not carried:** `human/index.html`, `agent/context.md`, the source's
   `app/**` and `agent/output-schema.json` (the target's own are the new
   document's), `human/patches.yaml`, and `shared/edits.yaml` — a person's
   wording for the *source's* view, meaningless in another app's.
8. **The projection is the new document's own.** The source's `projection`
   is not carried (item 1). The SDK writes none at the root; the host builds
   it from the merged members when it writes the spin-off (`/spinoff`), as it
   does on any member write (Contract 3 §5). A spin-off made by the SDK alone
   (`clan spinoff`) has no root `projection` until the host next writes its
   members.

### 5.3 What the hop records: `lineage.carried`

```yaml
lineage:
  parent_id: <source manifest id>          # as today
  parent_uri: clan-store:<DocId>           # as today: how the host finds the parent
  parent_sha256: sha256:…                  # as today: the source archive
  delta: spun off from "…" into Brief Maker v0.6.0
  parents: [ {source}, {template} ]        # as today
  carried:
    document_id: 3f2a…                     # the source's document_id: its key in data.upstream
    data_sha256: sha256:…                  # of the source's shared/data.yaml bytes, as read
    facts_sha256: sha256:…                 # of each member's bytes, as read; absent without it
    findings_sha256: sha256:…
    sources_sha256: sha256:…
    last_decision: d_01JA…                 # the newest source decision with an id; absent if none
```

1. Every hash is `clan_sdk::hash::sha256_prefixed` of the entry's bytes, the
   form `projection.built_from` already uses, so a host can compare the
   parent's current entries with no parsing.
2. `carried` names the **direct** parent only. A hoisted upstream's record is
   the parent's business: the brief was spun off from that version of the
   campaign, and the deck from this version of the brief.
3. Absent on a hop with `upstream: false`, and on every file written before
   it; every existing file still validates.

These make the freeze checkable before sealing exists: the server holds them
on append-only rows, and `GET /upstream` (§8) compares them with the parent.

### 5.4 Seeding the target's own fields

1. The graft (`app.spinoff.lift`) only seeds the target's own fields. With
   `upstream: true` a lift **copies** — the frozen copy stays whole — and
   each seeded field gets one decision:

   ```yaml
   - id: d_…                     # a fresh decision id
     kind: edit
     action: seed
     agent: napkin-spinoff
     actor: process:spinoff
     targets: ["<new doc id>#<to>"]
     cites: ["<source doc id>#<from>"]
     fields_changed: [<to's top-level key>]
     pinned: true
     rationale: Seeded <to> from <from> in "<source title>".
     reasoning:
       decided: Seeded <to> from <from> in "<source title>".
       because: [{ point: <target app> seeds <to> from the upstream <from>, cites: ["<source doc id>#<from>"] }]
       rejected: []
       only_option: The target app declares this lift; the value is copied unchanged.
       certainty: { level: high, why: the value is the upstream value, copied }
       would_change_if: a person edits <to>, or the document takes newer upstream data
   ```

2. Newest first, the chain reads: the seeds, the spin-off marker, the
   source's chain, the template's chain.
3. A lift whose `from` holds nothing seeds nothing and records nothing.

### 5.5 Open items, and when the parent changes

- It accumulates: campaign → brief carries campaign; brief → deck carries both.
- Open items travel open. They show at the field if the target app shows that
  address, otherwise in the decision tree under **open items carried from
  upstream**, and they are on the target's lock list (§7).
- **When the parent changes, the carried copy stays frozen until a person
  takes the newer one.** The child shows "The research has changed since
  this brief started" (each app in its own nouns) and lists what changed —
  pins, findings, contests, and findings rejected upstream — from
  `GET /upstream`. *Changed 2026-11-09 (owner, reversing the 2026-09-29
  default for spin-offs):* taking the newer upstream is an explicit action,
  `POST /upstream/update` (§8.1, item 8), offered in Continue in ▾ under
  **Made from**. It is refused on a locked document: a locked version keeps
  what it was made from.
- No address is ever remapped: a carried decision on
  `<campaign>#selection.contested[ct_…]` means the same contest in the brief
  and in the deck.

### 5.6 The SDK surface

```rust
// manifest.rs
pub struct SpinoffSpec {
    pub accepts: Vec<String>,
    pub map: Option<String>,
    pub lift: BTreeMap<String, String>,
    pub pin_source_decisions: bool,          // default true
    /// Carry the source whole under `data.upstream.<id>` (Contract 4 §5).
    #[serde(default, skip_serializing_if = "is_false")]
    pub upstream: bool,                      // default false
}

pub struct Lineage {
    /* parent_id, parent_uri, parent_sha256, delta, parents, merge — unchanged */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carried: Option<Carried>,
}

pub struct AttachSpec {                       // §5.7
    pub accepts: Vec<String>,
    pub lift: BTreeMap<String, String>,
    pub many: Vec<String>,
}
// AppInfo gains `attach: Option<AttachSpec>`; SpinoffSpec gains
// `by_source: BTreeMap<String, SourceCarry {map, lift, upstream}>`; Lineage
// gains `attached: Vec<Attached>`, copied by every rewrite as `carried` is.

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Carried {
    pub document_id: String,
    pub data_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub findings_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_decision: Option<String>,
}

// instantiate.rs — unchanged signature; SpinoffOptions gains nothing.
pub fn spinoff(template: &ClanFile, source: &ClanFile, opts: SpinoffOptions) -> Result<Vec<u8>>;
```

`clan_sdk` re-exports `Carried` beside `Lineage`. Adding the two fields breaks
the struct literals that name every field. `SpinoffSpec` in `library.rs`,
`tests/routes.rs`, `examples/make_advertising_studio.rs` and `clan-cli` gains
`upstream: false` and nothing else, and the hand-written
`impl Default for SpinoffSpec` gains `upstream: false`. `Lineage` in
`instantiate.rs` gains `carried: None` for `instantiate()` and the filled
record for an upstream `spinoff()`. `Lineage` in `pack.rs`, `render.rs` and
`merge.rs` (fork and merge) copies `carried` from the revision it rewrites:
a document keeps the record of its hop on every later write, or the first
edit would erase it and `GET /upstream` and backrefs (§7.4) would have
nothing to compare or address.

### 5.7 Linking an existing document (attach)

*Added 2026-11-09 (features/spinoff-and-links.clan).* A spin-off makes a new
document; a **link** carries a document into one that already exists, beside
its own work: a research into a brief, a brief into a research, either into a
deck or a production. It is the same carry (§5.2) applied to an existing
document, so the rules of this section hold for it, and it is the mechanism
the Brand Clan uses (`docs/contracts/brand-clan.md` on feat/brand-clan); the
names and shapes below are that branch's, so it merges onto them.

1. **Opting in: `app.attach`**, declared by the *target* app:
   `{accepts: [app_id…], lift: {from: to}, many: [app_id…]}`. `accepts` names
   the source apps; empty takes nothing. `many` names the apps a document may
   hold several of at once (several research in one brief, owner
   2026-11-09); any other app is one at a time and linking another of it
   **replaces** the first. One research may feed many briefs: nothing limits
   how many documents link the same source. `lift` seeds a field only where
   it is empty, or still holds what the previous copy seeded.
2. **What lands** (`clan_sdk::attach`): the source's data frozen at
   `data.upstream.<source document_id>` (less `projection`; its own
   `upstream` hoisted beside it), its pins, findings and sources merged by id
   into the document's own, its assets and branches copied, its decisions
   carried pinned after a boundary entry, and one record in
   `lineage.attached[]`: `{app_id, version?, at, title, revision, taken,
   document_id, data_sha256, facts_sha256?, findings_sha256?,
   sources_sha256?, last_decision?}`. `revision` is the source's revision
   taken — the version kept — and `taken` counts how many times this document
   took it (1 on link, one more on each update); `version` is the source's
   `kit.version` when it declares one, else `taken`.
3. **Versions and the update notice.** The frozen copy never moves by
   itself. `GET /upstream` lists each linked document with `how: linked` and
   `status: current | changed`, compared as for the direct parent (§8.1 item
   6); the shell shows the notice and offers **Update**, which takes the
   newer version (`POST /attach/update`, or `POST /upstream/update
   {document_id}`). An update replaces the frozen copy and adds only what the
   document does not hold yet.
4. **Decisions on both sides.** The document gets one decision per hop,
   `action: attach | update_from_<source noun> | replace | detach`, kind
   `edit`, as the person in `Ctx`, targeting `<this id>#upstream.<source
   id>`. The source gets a backref (§7.4): `linked` (on link and update) or
   `unlinked` (on detach), targeting the source's id, `from` naming the
   document and its decision.
5. **Refused**: a context that is not a person (`403`), a locked document
   (`409`, with the reason: a locked version keeps what it holds), another
   workspace's source (`403`), a source app not in `accepts` (`422`),
   linking what is linked already or updating what has not moved (`409`).
6. **Detach** lets go of one source: its frozen copy, its record and the
   seeds still holding the seeded value go; pins, findings and assets already
   merged stay as the document's own.
7. **A spin-off target may carry one source app its own way**
   (`app.spinoff.by_source: {<app_id>: {map?, lift, upstream}}`). Advertising
   Studio grafts a brief at `brief` and carries a research whole under
   `upstream` with `campaign.name.value → project.name` and
   `campaign.client_org.value → project.client` (owner, 2026-11-09: research
   to production is upstream + lift). Each `by_source` key is accepted.

---

## 6. Parallel work (N4)

- **Parallel:** research agents, and **one drafting agent per field**.
- **Serial:** the judge, the revision, and everything after it. The judge never
  sees the drafting context (UC-6), and it checks coherence across the whole
  brief — per-field drafting's risk is `not_single_minded`.
- Every parallel agent writes to its own branch, `agents/<user>.<agent>.<task>/`
  (spec §24). The user and agent parts come from `Ctx`, never from the request.
- A branch merges under the lease, through the §4 merge policies.

### What needs the lease

| Needs the lease | Does not |
|---|---|
| Edits to data, facts and findings | Gate verdicts, reviewer verdicts |
| `resolve`, `verify` | `classify` marks |
| Merging a branch | Agent work on its own branch |
| A job, only at commit (N2) | Research lenses writing layer rows |
| `approve` (lock) | Decision appends in general — append-only rows cannot clobber |
| `unlock` (reopening a part, §7.5.6) | `client_review` records, confirmations and dismissals |

This narrows the spec's open question: the facts member needs no append
mechanism while only the lease holder or a merge writes it.

---

## 7. Lock = accept = seal (D7)

Locking is file-wide.

*Changed 2026-09-29.* Three things did not hold once a document carried its
upstream. A child of a locked parent was born locked, because the lock was
"any `approve` in the chain" and the chain carries the parent's. A child could
not settle what it carried: targets on another document were refused and
`/resolve` looked at the root contests only. And no `backref` was ever
written. This section scopes the lock to the document, says how each carried
item is settled in the child, and fixes the backref's shape and moment.

### 7.1 What the lock is

1. A document is locked when its chain holds an `approve` decision, not
   superseded, whose `targets` include **this document's id** — the bare
   `document_id`, the form `/approve` writes. When more than one does (a
   document locked again after a part was reopened, §7.5.6), the newest is
   the lock.
2. A carried `approve` (it targets the parent's id) records that the parent
   was accepted. It does not lock the child and settles nothing on the child's
   list.
3. An app's own flag (Brief Maker's older `data.locked: true`) is not the lock.
   The middleware honours either (`napkin.middleware/1` §10.5); a view locks
   through `/approve` only.

### 7.2 The lock list

A document **cannot lock** while anything is unresolved, **carried items
included — every one, whether or not the document cites or shows it** (owner
default, 2026-09-29; may be reversed):

1. **An open contest.**
   - in `data.selection.contested`, status `open`;
   - in any `data.upstream.<id>.selection.contested`, status `open`, unless a
     `resolve` decision in this chain, not superseded, targets
     `<id>#selection.contested[<ct id>]` — the frozen copy never changes, so
     the chain is where a carried contest is settled;
   - a `contest` decision in the chain, own or carried, with no later
     `resolve` on its target;
   - a conflict in `merge-report.yaml`, or in a carried
     `upstream/<id>/merge-report.yaml` (addressed
     `<id>#merge-report[<key>]`, the conflict's `key` verbatim).
2. **An unmerged agent branch** under `agents/`, carried ones included. In a
   document with `lineage.carried` every branch is carried — the host never
   writes a branch into a document (its forks are documents of their own,
   §6) and the spin-off keeps the parent's `agents/**` as they are (§5.2,
   item 5) — and is addressed `<direct parent id>#agents[<branch id>]`. In
   any other document a branch is its own and has no address.
3. **A finding not yet verified or rejected** — any `proposed` entry in this
   document's findings member, carried copies included.
4. **A field citing a rejected finding** — its envelope's `finding_ids`, or
   its **current writing decision**: the newest decision in this chain that
   wrote the field (`napkin.middleware/1` §10.5's rule), not superseded and not
   a `propose`, citing the `fi_` id. A field in a frozen copy counts too,
   through its envelope's `finding_ids` only, when the finding is rejected in
   this document's copy of it; it is addressed `<id>#<path>` (*2026-09-30*).
5. **A bad verdict not yet answered**, own or carried — the field revised
   since, or the verdict overridden since by a good verdict with a written
   reason (`/verdict good`) on the same address. A carried
   bad verdict on an upstream address can only be overridden: the frozen field
   is read-only. A field the document's schema declares
   (`agent/output-schema.json`) is the document's while it is still empty, so
   a bad verdict on an empty part is overridden the same way (*2026-09-30*;
   §8, `/verdict`).
6. **A client's rejection not yet answered** — a rejected part not edited
   since, or a rejected document whose parts are not known yet (§7.5.4). It
   can only arise on a locked document, so it bears on locking again.
7. **A Brief gate item missing, or the brief unsigned** (*added 2026-11-11*,
   `gate_item`; a Brief Maker brief only, and only while `NAPKIN_BRIEF_GATE=on`):
   one blocker for each of the six gate items the brief does not meet, one for
   a brief that does not name its two signers, and one while the planner has not
   signed this content (§7.7). The host reads them from the brief's own data;
   the middleware adds none.

#### 7.2.1 Setting a carried item aside

*Decided 2026-09-30* (owner: a spun-off document may dismiss a carried item
it cannot settle, with a written reason, recorded). Four carried items have
no way to be settled in the child: the frozen copy is read-only, a branch or
a merge report names the parent's data, and a contest with no value the
child holds has nothing for `/resolve` to take.

| Carried item | Lock-list item | Its address |
|---|---|---|
| A frozen field citing a finding rejected here | 4 | `<id>#<path>` |
| An agent branch (the document has `lineage.carried`) | 2 | `<direct parent id>#agents[<branch id>]` |
| A conflict in `upstream/<id>/merge-report.yaml` | 1 | `<id>#merge-report[<key>]` |
| A contest carried open in a frozen copy, none of whose values is a pin this document holds or carries a frozen `pin` (*added 2026-09-30*) | 1 | `<id>#selection.contested[<ct>]` |

1. Each is merged or revised in the document it came from, and reaches the
   child only when it takes the newer upstream (§5.5, §8.1 item 8). Until then
   a person may **set it aside with a written reason**:
   `/acknowledge {target, rationale}` (§8.1, item 7). `/decisions` marks each
   such item `can_set_aside: true`, with its address.
2. **What it writes.** One decision, as the person in `Ctx`:

   ```yaml
   - id: d_…
     kind: verdict
     action: set_aside            # no polarity: it says nothing of whether the item is right
     agent: human:<id>
     actor: human:<id>
     targets: ["<the item's address>"]
     cites: ["<the item's address>", "<fi_… flagging the field>" | "<the conflict's decision>"]
     rationale: <the person's words, required>
   ```

   Nothing else changes: not the frozen copy, not the branch or the report
   (they stay in the file, as carried), not the parent. It writes **no
   backref**: §7.4's table names what a parent is told, and a set-aside is
   not on it — the parent still merges its branch and settles its conflict
   for its own lock.
3. **It leaves the list.** An item is off this document's lock list while a
   `set_aside` verdict, not superseded, targets its address — and, for a
   flagged field, cites the finding that flags it: the same field flagged
   later by another rejected finding is a new item.
4. **What is not set aside.** Only what the list offers (`can_set_aside`).
   A carried contest in `selection.contested` with a value to take is
   settled here with `/resolve`, and a carried bad verdict with `/verdict
   good` and a reason, so either is refused `409`. `/resolve` of a value with
   no pin to take is `409` and names set-aside. This document's own items are settled, not set
   aside (`400`).

A field in a frozen copy whose **writing decision** (not its envelope) cites
a rejected finding is not on the child's list: carried decisions address the
parent's fields, and item 4's writing-decision rule is not run over the
frozen copies. The parent's own list still holds it. `GET /upstream`'s
`cited_by` still skips the frozen copies: it names this document's own
fields.

### 7.3 At lock

- The reviewer is shown the findings list. Confirming verifies them (`verify`
  per finding, recorded in this document). Rejecting a finding marks it
  rejected and flags every field that cites it — a new unresolved item, so the
  lock waits until those fields are revised.
- One `approve` decision records the exact version and content hash. The seal
  (W5-Z1) is taken over that.
- Carried upstream content inside the file is accepted with it — it is the
  frozen copy that was reviewed.
- **Parents are not marked accepted.** Each gets a `backref` (§7.4).
- A contest resolved in a child cannot flow back into the child's frozen copy
  or into the parent. The child records the resolution (§8, `/resolve`); the
  parent gets a `backref` "resolved in <doc>" and must still resolve it itself
  before it can lock.

### 7.4 Back-references

A parent learns what its children did with what they carried, and nothing
else: a `backref` is the only thing a child ever writes to a parent.

1. **When.** In the same request as the child's decision, one `backref` to
   each parent the store holds (found by `lineage.parent_uri` for the direct
   parent, by `document_id` for a hoisted one; one the store does not hold, or
   holds for another tenant, is skipped):

   | The child's decision | Goes to | `action` | `targets` |
   |---|---|---|---|
   | `/approve` | every document in `data.upstream` | `used` | `["<parent id>"]` |
   | `/resolve` of a carried contest | the document the contest is on | `resolved` | `["<parent id>#selection.contested[<ct>]"]` |
   | `/verify` of a finding the direct parent holds | the direct parent | `verified` | `["<parent id>#findings[<fi>]"]` |
   | `/attach`, `/attach/update` (§5.7) | the linked document | `linked` | `["<source id>"]` |
   | `/attach/detach` (§5.7) | the unlinked document | `unlinked` | `["<source id>"]` |

2. **Shape.**

   ```yaml
   - id: d_…
     kind: backref
     action: used | resolved | verified | linked | unlinked
     agent: napkin-host
     actor: human:<id>             # the person in the child's Ctx
     targets: [ … as above … ]
     rationale: Used in locked "<child title>" at sha256:….   # or: Resolved in "<child title>": <chosen>. / Verified in "<child title>".
     from:                          # flatten tail
       document_id: <child document_id>
       decision: d_…                # the child's approve, resolve or verify
       version: sha256:…            # the child's version that decision names
   ```

3. **Allowed on a locked parent.** A backref changes nothing but the parent's
   chain: not its data, members, lock list or lock. It needs no lease (§6).
   The seal (W5-Z1) is over the approved version; a later backref append is
   outside it.
4. A backref settles nothing in the parent. "Resolved in <doc>" is a pointer
   for the parent's reviewer, not a resolution.

Still open: what unsealing means (W5-Z1).

### 7.5 Client review

*Added 2026-09-30.* The owner's design (prototype, version 4; the research
behind it is `docs/research-tool-experiment/client-approval-research.md`,
which this section overrides where they differ). A client's answer to a
locked document, recorded by the agency person it reached — pasted from an
email, attached as a file, or noted from a call.

1. **An OS feature, not an app's.** Client review is a global mode of the
   shell, like edit mode. Every app gets it the same way; an app only declares
   its parts (item 3).
2. **Only on a locked document** (§7.1) with no part reopened (§7.5.6).
   `POST /client-review` is refused `409` otherwise. It does not unlock the
   document: it appends to the chain and changes nothing else. It needs no
   lease (§6), as a backref does not (§7.4).
3. **Parts are the app's.** A brief's fields, a report's sections, later a
   deck's slides: the app hands the shell a list of `{address, label}` and the
   shell sends it with each review (§8.2). How the view hands the list over is
   the bridge's (the UI, built elsewhere). The host checks every address and
   computes each part's value hash from the document; it never takes a hash
   from the body.
4. **Its own kind, `client_review`.** Not `approve`: that is the agency
   accepting its own work, and it is the lock (§7.1). Not `verdict`: verdicts
   feed the quality dossier, and a reasoned good verdict answers a bad one
   (§7.2, item 5), so a client's "accepted" would silently clear the Judge's
   objection. A `client_review` never carries `polarity` or `reason_code` —
   `Decision::is_verdict` counts any decision with a `polarity` as a verdict.
5. **Recorded by staff, about a client, or by the client through their link.**
   The recorder of `POST /client-review` is the person in `Ctx` (`403` for a
   process), and a body naming `actor` or `recorded_by` is refused `400`. There
   the client is data — a name and an email the recorder typed — and nothing
   checks that the client is that person; the record states its evidence
   (§7.5.2), never more. *Amended 2026-11-11 (features/client-confirm-link.clan;
   needs the OS layer owner's approval):* `Actor::parse` gains a fourth shape,
   `client:<email>`, the client who opened their own link (§7.5.9). The host
   accepts it on `client_review` only: a context with a client actor reaches
   exactly `POST /client-link/state` and `POST /client-link/answer`, and every
   other route answers `403` before it is read.
6. **Confidential is not a filter here** (owner, 2026-09-29: confidential
   means only "kept out of RAG and the corpus"). Clients see everything, so
   nothing in client review — the records, `/decisions`, the extract's
   rendering (§7.5.8) — filters by a `classify` mark. Nothing in client review
   reaches a model or the middleware (*2026-09-30*: the parts are found by the
   host's own word match, §7.5.2a), so `model: false` has nothing to
   withhold here.
7. **The Knowledge agent, shown; the host, recorded.** The shell shows the suggestions as
   the Knowledge agent's (the agent that reads what people send). The chain records the
   process that made them: `actor: process:host`, `handler:
   client_parts_match@1` (§7.5.2a).

#### 7.5.1 Parts and hashes

- **`address`** is a data path on this document in dotted keys — the paths
  `/edit` can write, since "Make this change" answers a request with an
  `/edit` (§7.5.6). An entity-keyed segment (`sections[s_2]`) is refused
  until `/edit` takes one; a part the recorder could reopen but not edit would
  block locking again for good. Bare, or `<this document id>#<path>`; the host
  records the full form. Refused `400`: another document's id (a carried part is the parent's work, and its
  frozen copy is read-only), `upstream`, `projection`, a member
  (`facts[…]`, `findings[…]`, `sources[…]`), `text[<key>]` (a view's wording
  is keyed by layout and is not stable), two parts with one address, and a
  part inside another (`audience` and `audience.commercial`), which would make
  "that part changed" ambiguous. An address the data does not hold yet is
  allowed: the client can reject a field left empty.
- **`label`**: non-empty, at most 80 characters — what the chip and the
  extract call the part. At most 100 parts per review.
- **`aliases`** (optional, *2026-09-30*): other words the client may use for
  the part, from the app's declaration `data-clan-part-aliases="a, b"`. A
  list of words, or that attribute's text as written (split at commas); each
  trimmed, empties dropped, at most 20, each at most 80 characters. The match
  reads them (§7.5.2a); the document answer records them in `seen.parts`.
- **Part hash**: `clan_sdk::hash::sha256_prefixed` of the canonical JSON of
  the value at the address — object keys sorted by code point, no
  insignificant whitespace, strings escaped as `serde_json` writes them. A
  field envelope (an object with `value` and `origin`, Contract 3 §2) hashes
  its `value` only: its provenance is not what the client read. A value the
  data does not hold hashes as `null`.
- **`doc_hash`**: `sha256_prefixed` of the `shared/data.yaml` bytes as read,
  the §5.3 form.

A part answer is **stale** when its part's hash now differs from the hash it
recorded. Another part changing does not stale it.

#### 7.5.2 The records

One `POST /client-review` writes, in one change: one **document answer**,
one **part answer** per part the recorder marked, and — when parts were not
marked and there is proof text — one **suggestion** per part the match found
(§7.5.2a, §8.2). Confirming a suggestion writes a part answer; dismissing it writes a
dismissal. "Make this change" writes an `unlock` (§7.5.6).

```yaml
# The document answer — a person's
- id: d_01K…A
  kind: client_review
  action: client_answer
  agent: human:aoife
  actor: human:aoife                   # the recorder, from Ctx
  targets: ["3f2a…"]                   # the bare document id, the form /approve writes
  cites: [d_01K…LOCK]                  # the approve it answers
  covers: document
  answer: rejected
  reasons: [off_brief, tone]
  said: "Honestly this isn't the brief we talked about. The summer line doesn't feel like us."
  client: { name: Jane Murphy, email: jane@acme.ie }
  channel: file
  evidence: { asset: human/assets/re-brief.eml, sha256: "sha256:…", strength: strong }
  seen:
    version: "sha256:…"                # the version the lock's approve names
    doc_hash: "sha256:…"
    parts:                             # every part the app declared, as the client saw it
    - { address: "3f2a…#single_minded_proposition", label: Single-minded proposition, part_hash: "sha256:…" }
    - { address: "3f2a…#audience", label: Audience, aliases: [who it is for], part_hash: "sha256:…" }
  rationale: Jane Murphy rejected the document (off brief, tone), from an attached file; recorded by aoife.

# A suggestion — the host's word match (§7.5.2a), shown as the Knowledge agent's; counts for nothing until a person confirms it
- id: d_01K…S
  kind: client_review
  action: suggest_part
  agent: client_parts_match
  actor: process:host
  handler: client_parts_match@1
  targets: ["3f2a…#single_minded_proposition"]
  cites: [d_01K…A]
  covers: part
  review: d_01K…A
  label: Single-minded proposition
  answer: rejected
  quote: "The proposition doesn't feel like us."
  matched: { name: proposition }       # the name that matched; `cue` too when one set the answer
  found_by: agent
  seen: { version: "sha256:…", doc_hash: "sha256:…", part_hash: "sha256:…" }
  rationale: "Suggested by matching the client's words: Jane Murphy may mean Single-minded proposition (rejected): “The proposition doesn't feel like us.”"
  reasoning:
    decided: Suggested that Jane Murphy's answer is about Single-minded proposition.
    because:
    - { point: "The client's words name it (“proposition”): “The proposition doesn't feel like us.”", cites: [d_01K…A] }
    - { point: The client rejected the document, so the part is suggested rejected., cites: [d_01K…A] }
    rejected: []
    only_option: a fixed word match over the client's words and the app's part names; a person confirms or dismisses it
    certainty: { level: medium, why: a part's name is in the client's sentence; a word match, not yet confirmed }
    would_change_if: a person dismisses it
    attention: Found by matching words. Confirm or dismiss it; only a confirmed part counts.

# A part answer — a person's: marked in the review, marked later, or a confirmed suggestion
- id: d_01K…P
  kind: client_review
  action: client_answer_part
  agent: human:aoife
  actor: human:aoife
  targets: ["3f2a…#single_minded_proposition"]
  cites: [d_01K…A, d_01K…S]            # the document answer, and the suggestion it confirms
  covers: part
  review: d_01K…A
  label: Single-minded proposition
  answer: rejected
  client: { name: Jane Murphy, email: jane@acme.ie }   # copied from the document answer
  found_by: agent                      # person, when the recorder marked it
  suggestion: d_01K…S                  # found_by agent only: this decision is the confirmation
  quote: "The proposition doesn't feel like us."        # found_by agent only
  said: "The line is flat, make it sing."              # optional: what they said about this part, verbatim
  seen: { version: "sha256:…", doc_hash: "sha256:…", part_hash: "sha256:…" }
  rationale: aoife confirmed that Jane Murphy rejected Single-minded proposition.

# A dismissal — a person's
- { id: d_01K…X, kind: client_review, action: dismiss_part, actor: human:aoife,
    targets: ["3f2a…#audience"], cites: [d_01K…S2], covers: part, review: d_01K…A,
    suggestion: d_01K…S2, rationale: "Dismissed: she means the proposition, not the audience." }
```

| Field | Type | Rule |
|---|---|---|
| `covers` | `document` \| `part` | The owner's `scope`, spelled `covers`: `scope` on a decision is the org and brand from `Ctx` (§3, `DecisionScope`), and a string there would not parse — the whole chain would fail to read |
| `answer` | `accepted` \| `accepted_with_changes` \| `rejected` | Required on a document answer, a suggestion and a part answer. A part's answer may differ from the document's ("love the proposition, the audience is wrong") |
| `reasons` | list of `off_brief` · `wrong_audience` · `tone` · `facts_wrong` · `budget` · `other` | Document answer only, `rejected` only (`400` otherwise). Optional; no repeats, the recorder's order. Absent when empty |
| `said` | string | The client's words, **verbatim**: stored exactly as sent, never trimmed inside, summarised, rewritten or compressed (`compress_chain` rewrites `rationale` only; `decision.rs`, the `rationale` field). All-whitespace is absent. At most 20,000 characters. With `call` it is the recorder's note of what the client said, and every reader says so. On a document answer, the whole answer's words. On a part answer (*2026-09-30*), optional: what the client said about that part, typed under it ("What they said about it") when the recorder marks it, confirms a suggestion or marks it later — by the same rule. The part's popover shows it, and "Make this change" takes it first (§8.2, item 3) |
| `client` | `{name, email?}` | Required on a document answer, copied onto each part answer. `name` non-empty, at most 120 characters. `email`, when given, lower-cased, one `@` with something either side. Data, not identity |
| `channel` | `pasted_email` \| `file` \| `call` \| `none` | `pasted_email` and `call` need `said`; `file` needs an asset; `none` takes neither. An asset means `file` |
| `evidence` | `{asset?, sha256?, strength}` | Host-written; the body sends `asset` only. `asset` is `human/assets/<name>` in this document, a `.eml` or `.pdf`, stored first with `/upload-asset` (which a lock does not refuse); `sha256` is of its bytes. `strength` is `strong` with an asset, `weaker` without — pasted text, a call note, or nothing |
| `seen` | `{version, doc_hash, parts[]}` on the document answer; `{version, doc_hash, part_hash}` on a part record | `version` is the one the lock's `approve` names: every answer is tied to the locked version. `parts[]` is `{address, label, part_hash}` for every part the app declared |
| `review` | decision id | Part records: the document answer they belong to |
| `label` | string | Part records: the part's label as the app declared it |
| `found_by` | `person` \| `agent` | Part answers and suggestions. `agent` on a part answer means a person confirmed a suggestion (the match's, shown as the Knowledge agent's): the part answer is itself the confirming decision, and `suggestion` names what it confirmed. The value keeps its name from when a model suggested; it means "suggested", not "a model" |
| `suggestion` | decision id | A part answer with `found_by: agent`, and a dismissal |
| `quote` | string | Suggestions, and part answers confirming one: the sentence the match found, a verbatim substring of the proof (§7.5.2a, item 5), at most 500 characters. Never compressed |
| `matched` | `{name, cue?}` | Suggestions: the part name the sentence holds (label, alias or the label's last word) and the change cue that set `accepted_with_changes`, when one did — what the match read, so a person can see why |
| `recorded_by` | — | Not stored. It is the decision's `actor`, from `Ctx`, like every decision's; reads show it as `recorded_by` (§8.2). Never from the body |

What counts: a document answer, and part answers. A suggestion or a
dismissal is never an answer — "derived by the agent" until a person
confirms it, and a confirmed one is a part answer like any other. The
document answer and the client's words always count, whatever happens to the
suggestions.

#### 7.5.2a The match

*Added 2026-09-30* (owner: no extra model call). Which parts the client's
words were about is found by the host, deterministically, with no model and
no middleware; it replaced the middleware's `find_client_parts`
(`napkin.middleware/1` §11). The code is `crates/napkin-host/src/ops/client_match.rs`.

It runs inside `POST /client-review` when the document answer is not
`accepted`, no part was marked, the app declared parts, and there are words
— the proof: `said`, else the attached file's extracted text, at most 24,000
characters. It reads the parts' labels and aliases, never their values.

1. **Sentences.** A sentence ends after a run of `.` `!` `?` `…`, with any
   closing quote or bracket (`"` `'` `”` `’` `)` `]` `»`) after it, when
   whitespace or the end of the text follows; and at a line break followed by
   a blank line, by a list bullet (`-` `*` `•` `–` `—`, then whitespace) or
   by a numbered item (one to three digits, then `.` or `)`, then
   whitespace). A numbered item's marker starts its sentence, as a bullet
   does, and ends none. A single line break ends nothing (email is often
   hard-wrapped). A sentence is the proof's own text, trimmed of the
   whitespace around it.
2. **Names.** A part's names are its label, each of its aliases, and the last
   word of its label (stripped of anything but letters and digits at its
   ends), in that order, repeats dropped.
3. **Match.** A sentence matches a part when it holds one of the part's
   names as whole words, ignoring case: both sides lower-cased, each run of
   whitespace one space, `’` read as `'`, in Unicode NFC (an accent typed as
   one character or as two matches alike), and the characters either side of
   the name, if any, neither letters nor digits. A part takes the first
   sentence, in the proof's order, that matches it. One sentence may match
   several parts.
4. **Answer.** The document answer `rejected`: the part is suggested
   `rejected`. `accepted_with_changes`: `accepted_with_changes` when the
   sentence holds a change cue by the rule of item 3 — `wrong` `flat`
   `change` `not` `instead` `rather` `too` `should` `don't` `doesn't` `less`
   `more` `prefer` `missing` `remove` `replace` — else `accepted`.
5. **Quote.** The matched sentence as it appears in the proof; its first 500
   characters when longer, still a verbatim substring.
6. **Order.** One suggestion per matched part, in the order the app declared
   the parts. The same words and parts give the same suggestions, in the same
   order.
7. **No match.** No suggestion: the answer stands for the whole document. A
   rejection then blocks as parts unknown (§7.5.4 b) until a person marks a
   part.

Suggestions stay suggestions: a person confirms or dismisses each one
(§8.2, item 2), and only a confirmed one is a part answer.

#### 7.5.3 The state of each part

For a part address `A` on this document, the **current answer** is the
newest of: a part answer targeting `A`, and a document answer `accepted`
whose `seen.parts` holds `A` ("accepted needs nothing else and marks every
part accepted on that version"). A newer document answer that is not
`accepted` and names no part leaves `A` at its last answer.

| State | When |
|---|---|
| `accepted`, `accepted_with_changes`, `rejected` | The current answer's `answer` |
| `stale` (flag) | `A`'s hash now differs from the one the answer recorded (`seen.part_hash`, or the entry in `seen.parts`) |
| `answered` (flag) | `accepted_with_changes` or `rejected`, and a person's `edit` touching `A` (it, or a path inside it) came after the answer. Every `/edit` says why — it is refused without a rationale — so any such edit is "edited with a reason" |
| `reopened` (flag) | An `unlock` targets `A` after the newest lock (§7.5.6) |

The document's own state is its newest document answer: `current` when its
`seen.version` is the lock's version now, and `parts_known` when a part answer
names it as its `review`.

A carried `client_review` (it targets a parent's address) is the parent's
record: it shows in the history and counts in none of this — no part state,
no lock item, no reopen.

A suggestion still open when the document is locked again is closed by that
lock: `/approve` writes, after its `approve`, one `dismiss_part` per open
suggestion, by the person locking, with `closed_by: <the approve>` and a
rationale saying the new lock closed it, so it leaves `client.suggestions` and
asks for nothing (owner rule, 2026-09-30).

#### 7.5.4 Lock rules — §7.2 item 6

A client's rejection not yet answered. Only locking **again** can meet it (a
client review exists only on a locked document), but `/decisions` lists it
from the moment it is recorded, so the view shows what the next lock needs.

- **a.** A part whose current answer is `rejected` and not `answered`:
  "Jane Murphy rejected Single-minded proposition. Edit it, saying why, before
  locking again." (`client_rejected`, blocks)
- **b.** The newest document answer is `rejected` and no part answer names it:
  "Jane Murphy rejected the document and which parts is not known yet. Mark or
  confirm them, then edit them, before locking again."
  (`client_rejected_parts_unknown`, blocks)
- `accepted_with_changes` **never blocks.** Until answered it is attention:
  "Jane Murphy asked for a change to Audience." (`client_change_asked`)
- An open suggestion is attention, not a blocker: "The Knowledge agent thinks Jane Murphy's
  answer is about Audience. Confirm or dismiss it." (`client_part_suggested`)
- A client's `accepted` is never required to lock.

#### 7.5.5 What the edit must be

"Make this change" answers the request with an ordinary `/edit` on the part,
reason pre-filled "<client> asked: …", which carries `answers: <part answer
id>` (§8.2). The link is for the reader; the rule in §7.5.3 does not need it.

#### 7.5.6 Reopening one part: `unlock`

The lock is file-wide (§7), and an edit needs an unlocked document. "Make this
change" therefore reopens **one part** with a decision of a new kind, and
nothing else:

```yaml
- id: d_01K…U
  kind: unlock
  action: reopen_part
  agent: human:aoife
  actor: human:aoife
  targets: ["3f2a…#single_minded_proposition"]
  cites: [d_01K…P]
  answers: d_01K…P                     # the part answer it reopens for
  lock: d_01K…LOCK                     # the approve it reopens under
  rationale: "Jane Murphy asked: The summer line doesn't feel like us."
```

1. **Only for an open client request.** `POST /client-review/reopen {answer}`:
   a person, holding the lease (§6), on a locked document; `answer` is a part
   answer that is its part's current answer, `accepted_with_changes` or
   `rejected`, not `answered`, on a part not already reopened. Anything else
   is `409`. A document answer with parts unknown reopens nothing: mark or
   confirm a part first.
2. **While a part is reopened** — an `unlock` on it newer than the newest
   `approve` — `/edit` of that address or a path inside it is allowed despite
   the lock. It is `not_locked`'s one exception. Every other write stays
   refused: `/edit` elsewhere, `/edit-text`, the members, jobs, the review
   routes, and `/client-review` itself (a client answers a locked version, and
   with a part reopened the document is no longer the version the lock
   accepted).
3. **Locking again.** `/approve` is allowed on a locked document that has a
   reopened part (still `409` on one that has none). It runs the whole §7.2
   list, item 6 included, writes a new `approve` naming the new version, and
   sends backrefs as any `/approve` does (§7.4). The newest unsuperseded
   `approve` is the lock; the older one is not rewritten. The new `approve`
   closes every reopened part, edited or not.
4. **Nothing else changes.** §7.1 is unchanged. The whole-document unlock is
   §7.6, a separate route.

Why this, and not an `/edit` permitted on a locked document for a part with
an open request:

- **Honest.** An edit on a locked document leaves the lock claiming it accepted
  content it never saw. With `unlock`, the chain reads, in order: the lock, the
  client's answer, the reopen and why, the edit, the new lock. The seal
  (W5-Z1) is over the approved version, and is simply out of date until the
  next `approve`.
- **Smallest.** One kind, one exception in `not_locked`, one relaxation in
  `/approve`. The lock predicate does not change.
- **Scoped to what the client asked about.** The other parts stay exactly as
  the client saw them, so their answers do not go stale.
- **A cancelled edit is harmless.** A reopened `rejected` part still blocks
  the next lock (item 6a) until it is edited; an `accepted_with_changes` part
  does not, and the next lock closes it.

Rejected for a client's request: unlocking the whole document. It reopens
every part, including those the client accepted, for a request about one. A
person who means to unlock the whole document uses §7.6.

#### 7.5.7 Spin-off

Client reviews travel with the chain (§5.2, item 4) and keep their addresses.
In the child they are the parent's (§7.5.3, last paragraph).

#### 7.5.8 In the extract

The extract (`docs/contracts/clan-extract.md`, in design in another branch;
not in this one) renders client reviews. The rules it must keep:

- **One block per document answer, scoped to that client.** Two clients'
  answers are two blocks; they are never merged or counted together.
- The block says: the overall answer and the version it answers; the client's
  words as a quote, **verbatim** (never paraphrased; the recorder's note of a
  call is introduced as such); the reasons; the evidence strength in words; who
  recorded it and when.
- **Part lines only for part answers** — marked by a person, or a suggestion a
  person confirmed. Never an unconfirmed suggestion, a dismissal, or the parts
  an `accepted` document answer implies (the overall line says "accepted").
  Each part line says whether it is stale and whether it was answered, and
  quotes the part's own words (`said`), verbatim, when it has them.
- Evidence strength in words: `strong` — "from an attached file (<name>)";
  `weaker` — "from pasted email text, not verified", "on a call, as noted by
  <recorder>", or "no evidence attached; recorded by <recorder>".
- No filter by confidentiality (item 6 above).

> **Client review** of revision `sha256:9c1e…`: **rejected** (off brief,
> tone). Jane Murphy (jane@acme.ie), from an attached file (re-brief.eml),
> recorded by aoife on 30 Sept: "Honestly this isn't the brief we talked
> about. The summer line doesn't feel like us."
> - Single-minded proposition: rejected — found by the agent, confirmed by
>   aoife: "The summer line doesn't feel like us." Edited since.

Still open: recording an answer against an earlier lock than the newest one;
when the client said it (`said_at`), as against when it was recorded; DKIM
checking of an attached `.eml`, which would make "strong" mean more than
"attached"; and text extraction of `.eml` attachments — the host extracts
PDF and plain text only today (`ops/mod.rs`, `extract_text`), so an `.eml`'s
words reach the match (§7.5.2a) only when the recorder pastes them as `said`.

---


#### 7.5.9 The client's own link

*Added 2026-11-11.* A link to one locked version, opened on a phone with no
account (`features/client-confirm-link.clan`). Three records on the document's
chain, all `kind: client_review`, told apart by `action` and tied by the link's
id (32 lower-case hex digits):

- `issue_link`, by the person who made it (`POST /client-link/issue`
  `{id, name, email, expires}`): `extra.link` holds the `id`, `scope: confirm`,
  `targets: [<document id>]` (one), the `lock` it is for, that lock's `version`,
  the `doc_hash` of `shared/data.yaml` as the client is shown it, the client
  `{name, email}` and `expires`. Refused `409` on a document that is not locked,
  was edited after its lock, or has a part reopened; `400` for an `expires` past
  or more than 30 days away.
- `withdraw_link`, by a person (`POST /client-link/withdraw` `{id}`).
- `client_answer`, by `client:<email>`, the same document answer §7.5.2 records
  (`confirm` is `accepted`; `changes`, which needs words, is
  `accepted_with_changes`), with `channel: link` and `extra.link`. Its `version`
  is the lock's. It never unlocks or edits.

What a link is worth is derived from the chain, never stored: `open`, or `404`
(no such link) or `410` with its state: `withdrawn`, `answered` (a link answers
once), `superseded` (the document is not the version the link names), `expired`.
The token the web shell signs carries the same facts and cannot widen them.

What the link shows the client is the brief's own fields by an allow list, not
what the brief holds (`crates/napkin-web/src/clean.rs`, `FIELDS`): the planner's
working notes, the capture, the review, the passages, the materials and any key
not on the list are never drawn. Unlike the staff-recorded review above (item 6
of §7.5), the link takes the strict reading of `confidential_fields`: a part a
person marked confidential, and the whole field if the key names it, is not
shown to the client, in the sheet or the summary. A default taken on
2026-11-11 until the owner confirms it
(`features/client-confirm-link.clan`, decisions).

### 7.6 Unlocking the whole document: `/unapprove`

Owner, 2026-11-09: a person can unlock a locked document (settles W5-Z1's
whole-document unlock; what an exported seal means is unchanged).

```yaml
- id: d_01K…X
  kind: unlock
  action: unlock_document
  agent: human:aoife
  actor: human:aoife
  targets: ["3f2a…"]                    # the document id, no part
  cites: [d_01K…LOCK]
  lock: d_01K…LOCK                      # the approve it ends
  unlocks_version: "v3"                 # the version that lock accepted
  rationale: "The client moved the launch."
```

1. `POST /unapprove {rationale}`: a person, holding the lease (§6), on a
   locked document, with a non-empty reason. Not locked is `409`; no reason
   is `400`.
2. **The lock predicate (§7.1) gains one clause:** the newest unsuperseded
   decision targeting the document that is an `approve` or an
   `unlock_document` decides. An `approve` locks; an `unlock_document` means
   nothing holds. The `approve` is never rewritten or superseded.
3. After it every write is allowed again, as on a document never locked.
   Parts reopened under the ended lock (§7.5.6) stop counting as reopened.
   Client answers stay in the chain, on the version they answered.
4. The next `/approve` runs the whole §7.2 list and is a new lock.

### 7.7 The Brief gate (features/brief-gate.clan)

*Added 2026-11-11.* No creative work starts on a brief the client has not
confirmed (build prompt v2 §6). The gate is a view over the brief, not a second
record, and the host's lock list (§7.2, item 7) is its one enforcement point.

1. **Six items**, each `pass` or `missing` with the brief's words as evidence:
   one proposition (`single_minded_proposition`, one sentence), one insight,
   one measurable objective (an `objectives` part with a number), feel or do
   (`desired_response.feel` or `.do`), what would make this famous (`famous`),
   and how we will know (`measurement` names a baseline and a number).
2. **Two signers** are a list on the brief, read by the host:
   `signers: [{role: planner, person: <id>}, {role: creative_director, person: <id>}]`.
   The agency signs first, then the client confirms (owner default, 2026-11-11):
   an answer is only recorded on a locked brief (§7.5), so the lock comes first.
3. **`POST /sign {rationale?}`** as a signer. The planner writes one `sign`
   decision (`action: planner_sign`) on the brief as it stands; it is refused
   `409` while an item is missing, `403` for a person the brief does not name,
   and it stops counting once the brief is edited. The creative director's
   signature is `/approve` itself: one `approve` decision that locks the
   version, refused until the planner has signed and for anyone but the creative
   director the brief names.
4. **`GET /gate`** answers the six items, the signers, and `planner_signed`,
   `signed` (locked), `confirmed` (a `client_review` of `accepted` on the locked
   version), `changed_since_lock` (an `edit` newer than the lock: the signed
   version stays as it was, and a new version needs `/unapprove`, §7.6, then
   signing again) and `open`: all met and nothing changed since. `open` is
   always true while `NAPKIN_BRIEF_GATE` is not `on` (the default). The state is
   computed from the decisions in any order; only the screen's wording depends
   on the order of signing and confirming.
5. The library listing carries a short form of it as `state.gate`, which is what
   Territories and the desk's Changed brief alert read.

### 7.8 Versions and restore (features/brief-versions-undo.clan)

*Added 2026-11-11.* A document's versions are read from its own chain; there is
no second store of its past.

1. **A version is each live `approve`** that targets the document; the first is
   v1. The working draft is what stands now.
2. **Every attributed `/patch-data` keeps its inverse**, `before`, on its `edit`
   decision: what each patched key held until then (`null` when it held
   nothing). An appending write (`append_keys`) has no simple inverse and keeps
   none.
3. **`GET /versions`** lists the versions newest first (`n`, `decision`,
   `signer`, `at`, `locked`, `readable`) and the draft (`changed`,
   `restored_from`, `edited_by`, `at`, `last_edit`: the newest write that kept
   its inverse). **`GET /version?n=2`** (or `n=draft`) answers the brief's parts
   as they stood at that approve: the data now with every later write undone,
   newest first, by its `before`. The host's own keys and the signing list
   (`projection`, `upstream`, `signers`, `locked_fields`) are not part of it.
4. **A version is `readable` only while every data write since it kept a
   `before`.** A write that did not (an older edit, an agent's applied draft, an
   append) leaves a gap: the versions before it answer `409` and are listed as
   unreadable rather than guessed.
5. **`POST /restore {version: n}`** by a person writes the old words into the
   draft as one new `edit` (`action: restore v<n>`). It never writes, removes or
   supersedes an `approve`, an `unlock` or a `sign`: a signed version stays
   locked and in the list, and the restored draft is a new version to sign
   (`changed_since_lock`, §7.7). Restoring what the draft already says writes
   nothing.
6. **`GET /current`** answers the document as it stands (`data`, `version`), as a
   host-side write's reply carries it, so a shell can hand it to the open app.

The shell's undo is not a host route: it keeps the person's own edits this
session, and Cmd or Ctrl Z writes the inverse through `/patch-data` as a new
attributed edit, only while the part still holds what that person last wrote.

### 7.9 Tracked changes on a script (features/script-editor.clan)

*Added 2026-11-12.* A script (`ie.napkin.script-editor`) is a list of beats with
stable ids, and `script.proposals` holds every suggested change to one beat.

1. **`POST /script/propose {beat, text, note?}`**: a person suggests new words for
   one beat. The beat is unchanged. The proposal records `was`, the words it
   replaces, and `by`, the session's actor, never the body's. One attributed
   `/patch-data` of `script` (action `mark up beat <id>`), so it keeps its inverse.
2. **`POST /script/answer {proposal, answer: "accept" | "reject"}`**: an accept
   writes the proposal's words into its beat and marks it `accepted` in one
   attributed write (`accept proposal <id> on beat <id>`); a reject marks it
   `rejected` and leaves the beat. `409` when the proposal is already answered,
   or, for an accept, when the beat no longer says `was` (the proposal stays
   open). `403` for the person who marked it up, and for any actor that is not a
   person: only the writer's answer puts a proposal's words on the page.
3. **A proposal is a plain patch, not an appending write.** An append keeps no
   inverse (§7.8 item 4) and would leave a gap in the version list. Nothing here
   needs the lease today; the host has none yet, and when it does §6 gets one
   line for these two routes.
4. **An approved script is locked like a visual brief**, by the same creative
   director rule. It takes the record of where it was sent (`handoffs`, `film`)
   and nothing else; those two keys are not part of what a version says and the
   shell's undo leaves them alone.

## 8. Routes — contract v1

`/capabilities` reports `contract: 1`. A document is shown with the installed
version of its app when that version has the same major and is not older than
the one the document was made with; otherwise with the copy it carries (owner
decision, 2026-09-24 — M2's `name@major` rule applied to views). The copy in
the `.clan` is what export, handoff and the offline presenter use, and old
majors still run, so the route surface is a contract apps depend on: add
freely, never redefine.

- Existing routes stay as they are: `/patch`, `/patch-data`, `/fork`,
  `/upload-asset`, `/assets/*`, `/chain`, `/api-proxy`, `/spinoff`,
  `/spinoff-targets`, `/set-title`, `/set-context`, `/export`, `/notify`,
  `/set-theme`, and the library routes.
- A body `agent` field on `/patch-data` is kept as `claimed_agent` on the
  decision. The actor always comes from `Ctx`. A `/patch-data` with no `agent`
  or no `action` is `400` (ADR-004; the rationale stays optional). The
  environment `NAPKIN_UNATTRIBUTED_WRITES=dry-run` logs the refusal and writes
  as before, for the week before it is enforced.
- New in v1: `/verdict`, `/classify`, `/contest`, `/resolve`, `/finding`,
  `/verify`, `/approve`, `/unapprove` (§7.6), `/history`, `/timeline`, `/open`, `/stale`,
  `/upstream` (§8.1), `/client-review`, `/client-review/confirm` and
  `/client-review/reopen` (§8.2), and `/cite` (§8.3).
- Landed (2026-09-28), each a person's decision — a process is refused `403` —
  recording one decision as the person in `Ctx` with what it changes, in one
  generation; refused `409` once the document is locked (a reopened part's
  `/edit` and locking again excepted, §8.2):
  - `/verdict {target, polarity: good|bad, rationale, reason_code?}` — on a
    finding, `bad` rejects it (`status: rejected`, `rejection`), `good` is
    refused: a finding is verified. A bad verdict needs its rationale. A
    target on this document's data is in the document when the data holds it
    or when `agent/output-schema.json` declares it (each key in `properties`
    at its depth, local `$ref`s and `allOf`/`anyOf`/`oneOf` followed;
    `additionalProperties` names nothing): an empty part can be judged and a
    bad verdict on it overridden (*2026-09-30*). A good verdict on a part the
    data does not hold needs its rationale too (`400`): it says why the part
    may stay empty. Neither holds: `404`, as before.
  - `/classify {target, model, export, corpus, rationale}` — the mark is
    recorded; taking it to the fact's licence in the layer (§4) is not built.
  - `/resolve {contest, chosen, rationale}` — the contest resolved; a chosen
    value not yet pinned is pinned from the copy the research froze beside it,
    and a pin of the same identity it replaces is kept, marked `replaced_by`.
  - `/verify {finding, rationale?}` — the host sets the finding `verified`
    with `verification {decision, by, at}` and records one `verify`
    decision. It writes only this document: what a person reviews reaches
    the layers only through the client-accepted harvest (Contract 3 §6.2).
    No middleware call.
  - `/edit {path, value, gate?, rationale?}` — a person's edit (the shell's
    Edit mode). One pinned `edit` decision; a campaign field's envelope
    becomes `origin: stated`, `by` the person. Members and the projection are
    not edited here.
  - `/edit-text {key, html}` — a person's wording for a piece of a view's
    text, kept in `shared/edits.yaml` (role `edits`) and handed to the view as
    `window.__CLAN__.edits`. One pinned `edit` decision on `text[<key>]`.
  - `/correct {fact, value, source_uri?, rationale}` — a person corrects a
    fact, in this document only. The host makes a new pin (`method: report`,
    `confidence: high`, `review` verified, no `origin` or `version`: no layer
    holds it) whose source is the person's `human:<id>` record — one per
    person per licence — keeps the old pin marked `replaced_by`, and records a
    pinned `edit`, action `correct_fact` (a link the person gave rides on it
    as `source_uri`). No middleware call; it resolves for any document,
    whatever pipeline it was made with. A `/verdict` on a pin also writes
    `review {verdict, by, at, decision}` on it (Contract 3 §6.4).
  - `/acknowledge {decision, rationale?}` — "Looks right": a good verdict
    that cites the decision, which clears what its agent flagged or was unsure
    of (§4) without touching what it wrote. Refused on a finding (verify it).
    With `{target, rationale}` in place of `decision`, it sets a carried item
    aside (§7.2.1, §8.1 item 7).
  - `/approve {rationale?}` — refused while anything on the §7 list is open;
    otherwise one `approve` decision naming the exact version accepted. What
    locking does to other writes (`/patch-data`, a job) is W5-Z1's.
  - `/unapprove {rationale}` — a person, on a locked document, with a reason:
    one `unlock` decision (`action: unlock_document`) that ends the lock
    (§7.6). `409` when not locked, `400` without a reason.
- `/decisions` (landed): every decision, newest first, with who made it, its
  targets as labels, its cites resolved, and what needs a person — derived by
  the host from the chain, the members and the data: `reasoning.attention`,
  low certainty, and the §7 lock list. The shell renders it as the OS layer's
  decision blocks. `/open` above names the lock list alone; it is not built,
  and the path is taken today by the launcher's open-a-document route.
- On the server, `/api-proxy` becomes a dispatch into the handler registry. The
  desktop keeps the transport; it does not assemble prompts.

### 8.1 Upstream-aware routes

*Changed 2026-09-29.* The review routes refused any target on another
document, so a child could not settle what it carried (§7), and nothing told a
child that its parent had moved on (§5.5). What follows is added; no existing
body or reply changes meaning.

1. **Ancestor addresses.** `/verdict`, `/classify`, `/resolve` and `/verify`
   accept a target `<id>#<path>` when `<id>` is this document's id or a key of
   `data.upstream`; any other document id is `400`, as before. The rule: **a
   decision targets what it changes; where it changes nothing — the frozen
   copy — it targets the upstream address.**
   - `facts[…]`, `findings[…]` and `sources[…]` are this document's members,
     whatever the prefix: the entry is looked up in the child's merged member
     (§5.2), what changes is the child's copy, and the decision targets
     `<this id>#…`.
   - Any other path under an ancestor is looked up in
     `data.upstream.<id>`; the decision targets `<id>#<path>` and the frozen
     copy is not written. `/verdict good` with a rationale on such a target is
     how a carried bad verdict is overridden (§7.2, item 5).
   - `/acknowledge {decision}` takes a decision id, own or carried, as today;
     `/acknowledge {target, rationale}` takes a carried item's address
     (item 7).
2. **`/resolve {contest, chosen, rationale}`.** `contest` is a `ct_` id or an
   address. It is looked up in `data.selection.contested`, then in each
   `data.upstream.<id>.selection.contested`. For a carried contest:
   - refused `409` when the frozen entry is not `open`, or a `resolve` in this
     chain, not superseded, already targets it;
   - the chosen value's pin comes from the frozen `values[].pin` and is
     written to **this document's** facts member, with the `replaced_by` rule
     as today;
   - the decision targets `<id>#selection.contested[<ct>]`, plus the
     `<this id>#facts[…]` it pinned or replaced; the frozen entry is left as
     it was;
   - the parent gets a `backref` (§7.4).
3. **`/verify {finding}`** of a finding the direct parent also holds: as
   today, plus a `backref` to the parent. **`/approve`**: the §7.2 list,
   carried items included; then a `backref` to each document in
   `data.upstream` the store holds. The reply of each of the three gains
   `backrefs: [{document_id, decision}]`, one per backref written.
4. **`upstream` is read-only.** `/patch-data`, `/patch`, `/edit` and a
   middleware `data_patch` that name `upstream` or anything under it are
   refused `400` ("upstream is the frozen copy of <id>; it is read-only"),
   as `projection` is.
5. **`/spinoff {app_id, title?, map?}`** — body and reply unchanged. The
   target app's `app.spinoff.upstream` decides the carry (§5.1). Refused
   `422` when `upstream` is declared and a `map` is given; refused `403` when
   the source document and `Ctx` are different tenants (the host passes `Ctx`
   into the spin-off; a library read never crosses tenants).
6. **`GET /upstream`** — what changed upstream since this document was spun
   off. A read: any actor, locked or not. `200` on every open document; one
   with no `lineage.carried` answers `{document_id, carried: null, upstream: []}`.

   ```json
   {
     "document_id": "9c1e…",
     "carried": { "document_id": "3f2a…", "data_sha256": "sha256:…",
                  "facts_sha256": "sha256:…", "findings_sha256": "sha256:…",
                  "sources_sha256": "sha256:…", "last_decision": "d_01JA…" },
     "upstream": [
       { "document_id": "3f2a…", "direct": true, "in_store": true,
         "title": "Lúnasa 0.0 launch", "app_id": "ie.napkin.campaign-research",
         "version": "sha256:…", "locked": false,
         "status": "changed",
         "changed": { "data": true, "facts": true, "findings": true, "sources": false },
         "decisions_since": 4,
         "pins": [ { "id": "f_…", "change": "added | replaced | changed", "label": "…", "replaced_by": "f_…" } ],
         "findings": [ { "id": "fi_…", "change": "added | verified | rejected", "statement": "…",
                         "reason": "…", "cited_by": ["9c1e…#insight"] } ],
         "contests": [ { "id": "ct_…", "change": "opened | resolved", "key": "…",
                         "chosen": "f_…", "resolved_here": false } ] },
       { "document_id": "77ab…", "direct": false, "in_store": true,
         "title": "…", "app_id": "…", "status": "not_compared" }
     ]
   }
   ```

   - `upstream[]` has one entry per key of `data.upstream`, the direct parent
     (`carried.document_id`) first. Only the direct parent is compared; a
     hoisted one is `not_compared` (§5.3, item 2). A parent the store does not
     hold for this tenant is `{document_id, direct, in_store: false, status:
     "unknown"}`.
   - `status` is `current` when each `carried` hash equals the
     `sha256_prefixed` of the parent's entry now (absent on both sides is
     equal), else `changed`. `changed` names which hashes differ. When
     `current`, `pins`, `findings` and `contests` are `[]`.
   - `decisions_since`: the parent's decisions newer than
     `carried.last_decision`; `null` when that id is absent or no longer in
     the parent's chain.
   - `pins`, by id, the parent's facts member now against this document's:
     `added` (only the parent holds it), `replaced` (the parent's copy has
     `replaced_by`, this one's has not; `replaced_by` its value), `changed`
     (`value`, `unit`, `as_of` or `status` differ). A pin only this document
     holds is its own and is not listed.
   - `findings`, likewise: `added`; `verified` (the parent's is `verified`,
     this one's `proposed`); `rejected` (the parent's is `rejected`, this
     one's is not; `reason` the parent's `rejection.reason`). `cited_by`, on
     every entry, lists this document's fields that cite the finding, by the
     §7.2 item 4 rule. A view lists `rejected` entries first.
   - `contests`, the parent's `selection.contested` now against the frozen
     `data.upstream.<id>.selection.contested`: `opened` (open in the parent,
     absent from the frozen copy), `resolved` (open when frozen, resolved in
     the parent; `chosen` the parent's pick; `resolved_here` whether this
     document has resolved it too).
   - Lists are sorted by `id`. `label` is the pin's readable name, as
     `/decisions` labels a target.
7. **`/acknowledge {target, rationale}`** — set aside a carried item this
   document cannot settle (§7.2.1). *Added 2026-09-30.* The existing route,
   extended rather than a new one: it already means "a person has looked and
   the document goes ahead without changing what this names". Exactly one of
   `decision` and `target` is given (`400` otherwise); a `target` is an
   address, `<id>#<path>` (`400` without the `#`), and needs a `rationale`
   (`400` when empty or blank).
   - A person's (`403` for a process); refused `409` on a locked document,
     like every review route.
   - `400`: an address on this document ("settle it here"), on a document
     this one does not carry, or the bare parent (`<id>#`).
   - `409`: the lock list holds the address but it can be settled here (a
     carried contest with a value to take: `/resolve`; a carried bad
     verdict: `/verdict good`), or
     it is already set aside (a `set_aside` not superseded targets it).
   - `404`: nothing carried at that address is on the lock list.
   - Otherwise the §7.2.1 decision, one generation; the reply is the review
     routes' `{ok, decision, kind: "verdict", targets}`. No backref.
   - `/decisions` gains, on an attention item, `can_set_aside: true` (absent
     when false), and a target `kind` gains `branch` (`<id>#agents[…]`); a
     merge conflict's address is labelled `Merge conflict · <key>`, kind
     `contest`.
8. **`POST /upstream/update`** — take the direct parent's newer version
   (§5.5, *added 2026-11-09*). Body ignored; any actor that may write.
   - `409` when the document has no `lineage.carried` ("not made from another
     one"), when it is locked (an `approve` not superseded targets it: a
     locked version keeps what it was made from; a new version takes the
     update), or when `GET /upstream` says the direct parent is `current`.
   - `404` when the store does not hold the parent for `Ctx`.
   - Otherwise one write (`clan_sdk::take_upstream`): `data.upstream.<parent>`
     is the parent's data now (less `projection` and `upstream`; the
     parent's own upstream entries replace the hoisted siblings it holds);
     the parent's facts, findings and sources replace the child's copies by
     id, **except an entry the child reviewed itself** (a decision of its own
     targets `<this id>#facts[…]`, `#findings[…]` or `#sources[…]`) and the
     child's own entries, which stay; the parent's decisions above
     `carried.last_decision` that the child does not hold are carried,
     pinned; new branches, merge reports and assets are copied;
     `lineage.carried` moves on to what was taken; the projection is rebuilt.
     The child's own fields are not touched and no address is remapped.
   - The decision, newest of all, as the person in `Ctx`:

     ```yaml
     - id: d_…
       kind: edit
       agent: napkin-host
       action: update_from_<parent noun>   # app.home.noun[0], else the app's name, snake_case
       version: <the parent's version taken>
       targets: ["<this id>#upstream.<parent id>"]
       cites: [<the parent's newest decision id>]
       rationale: Took the newer research "<title>" (<version>): N decision(s) since this was made from it.
       was: { data_sha256: <carried before>, last_decision: <carried before> }
     ```

   - Reply: `{ok, decision, action, document_id, version, decisions_taken,
     clan}`. No backref (the parent is not changed).
   - *Added 2026-11-09:* with `{document_id}` naming a document linked to
     this one (§5.7), it takes that one's newer version instead: the reply
     and refusals of `/attach/update`.
9. **Links** (§5.7, *added 2026-11-09*). Writes as the person in `Ctx`; the
   reply carries `clan` and `backrefs` as the review routes do.
   - `GET /attach-targets` — `[{app_id, app_name, document_id, title,
     version, path, updated_at, attached, many, locked}]`, by title: this
     tenant's documents the open document's app accepts, never a fork, a
     template, itself or what it was made from. `locked` says a link would be
     refused, so the shell says why instead of offering it.
   - `POST /attach {document_id}` — link it. Reply `{ok, verb: attached |
     replaced, decision, action, document_id, attached: <record>, seeded,
     kept, carried_decisions, backrefs, clan}`.
   - `POST /attach/update {document_id}` — take its newer version; `verb:
     updated`, `action: update_from_<noun>`.
   - `POST /attach/detach {document_id}` (or `{app_id}` naming the one source
     of that app) — let go. Reply `{ok, decision, action: detach,
     document_id, detached, unseeded, backrefs, clan}`.
   - `GET /related` — `{document_id, upstream: [{document_id, title, app_id,
     path, how: made_from | linked, version, taken, status}], downstream:
     [{document_id, title, app_id, noun, path, how: made_into | linked_in,
     updated_at}]}`, downstream newest first. A read of the store's
     manifests; the shell's lineage chips draw it.

### 8.2 Client review routes

*Added 2026-09-30.* The routes behind §7.5. Each is a person's (`403` for a
process), records as the person in `Ctx`, and writes one change.

1. **`POST /client-review`** — the document-level answer, plus any parts the
   recorder marked.

   ```json
   {
     "answer": "accepted | accepted_with_changes | rejected",
     "client": { "name": "Jane Murphy", "email": "jane@acme.ie" },
     "reasons": ["off_brief", "tone"],
     "channel": "pasted_email | file | call | none",
     "said": "…",
     "asset": "human/assets/re-brief.eml",
     "parts": [ { "address": "single_minded_proposition", "label": "Single-minded proposition" },
                { "address": "audience", "label": "Audience", "aliases": ["who it is for"] } ],
     "marked": [ { "address": "audience", "answer": "rejected", "said": "…what they said about it…" } ]
   }
   ```

   - Refused `409` unless the document is locked with no part reopened
     (§7.5, item 2). Refused `400` for a field that breaks §7.5.2's table, a
     part that breaks §7.5.1, a `marked` address not in `parts`, a part marked
     twice, any `marked` with `accepted` (it marks every part already), and a
     body naming `actor` or `recorded_by`. `404` when `asset` is not in the
     document.
   - `parts` is the app's whole list, every time: it is what `seen.parts`
     records. It may be empty — an app that declares no parts gets the
     document answer alone.
   - A `marked` entry's `said` is what the client said about that part, kept
     verbatim on its part answer (§7.5.2, `said`). Optional.
   - **The match.** When `answer` is not `accepted`, `marked` is empty,
     `parts` is not, and there is proof text, the host finds the parts the
     words name itself, by §7.5.2a — no model, no middleware, the same in
     every build (desktop, server, wasm). The proof text is `said` when there
     is one, else the asset's extracted text
     (`human/assets/.extracted/<name>.txt`). *Changed 2026-09-30*: it asked the
     middleware's `find_client_parts` before; nothing in client review calls
     the middleware now. The recorder can still mark parts by hand (item 2).
   - Writes the document answer, a part answer per `marked` entry
     (`found_by: person`), and a suggestion per matched part, in that order,
     in one change.

   ```json
   { "ok": true, "decision": "d_…", "parts": ["d_…"],
     "suggestions": { "status": "none | found", "decisions": ["d_…"], "dropped": 0,
                      "handler": "client_parts_match@1" } }
   ```

   `none`: the match did not run (accepted, parts marked, no parts, no
   proof). `found`: it ran; `decisions` may be empty — no part named, the
   answer stands for the whole document. `dropped` is always `0` and
   `unavailable` is no longer sent; both stay for readers written before.
2. **`POST /client-review/confirm`** — confirm or dismiss a suggestion, or
   mark a part by hand after the fact.

   ```json
   { "suggestion": "d_…", "confirm": true, "answer": "rejected", "said": "…", "rationale": "…" }
   { "review": "d_…", "address": "audience", "answer": "accepted_with_changes", "said": "…" }
   ```

   - `said`, optional either way, is what the client said about the part,
     kept verbatim on the part answer. A dismissal takes none (`400`): its
     `rationale` says why.

   - With `suggestion`: it must be a `suggest_part` in this chain that no part
     answer or dismissal names yet (`409` otherwise). `confirm: true` writes a
     part answer, `found_by: agent`, with the suggestion's `review`, `label`,
     `quote` and `seen`; `answer` may correct the suggestion's, and defaults
     to it. `confirm: false` writes a dismissal; `rationale` is optional.
   - With `review` and `address`: `review` must be a document answer that is
     not `accepted`, and `address` one of its `seen.parts`, which give the
     label and hash. Writes a part answer, `found_by: person`.
   - Either way, `409` when a part answer for that `review` and address
     exists already: a later answer from the client is a new
     `/client-review`. Allowed while the document is locked, a part reopened
     or not. No lease.
3. **`POST /client-review/reopen {answer}`** — "Make this change" (§7.5.6).
   Writes the `unlock`. The reply gives the shell what edit mode opens with:

   ```json
   { "ok": true, "decision": "d_…", "address": "3f2a…#single_minded_proposition",
     "label": "Single-minded proposition", "answers": "d_…",
     "reason": "Jane Murphy asked: The summer line doesn't feel like us." }
   ```

   `reason` is "<client name> asked: " and then the part answer's own
   `said` (*2026-09-30*), else the document answer's `said`, else its reasons
   in words, else "a change" — the words on one line, the whole clipped to 300
   characters. A confirmed suggestion's `quote` is not a step: it is shown on
   the part, and the reason is what the client said. It is the `unlock`'s
   rationale too.
4. **`/edit {path, value, gate?, rationale, answers?}`.** On a locked
   document, allowed only for a path at or inside a reopened part (§7.5.6,
   item 2). `answers`, when given, must be the part answer that part was
   reopened for (`400` otherwise); the `edit` decision records it as
   `answers` and cites it. Unchanged otherwise.
5. **`/approve`** on a locked document with a reopened part locks again
   (§7.5.6, item 3). Body and reply unchanged.
6. **`GET /decisions`** gains `client`, and `lock` gains two fields. A read:
   any actor, locked or not.

   ```json
   "lock": { "can_lock": false, "blockers": 1, "locked": true,
             "reopened": [ { "address": "3f2a…#single_minded_proposition", "label": "Single-minded proposition",
                             "decision": "d_…U", "answers": "d_…P" } ] },
   "client": {
     "available": false,
     "answer": { "decision": "d_…A", "answer": "rejected", "reasons": ["off_brief", "tone"],
                 "said": "…", "client": { "name": "Jane Murphy", "email": "jane@acme.ie" },
                 "channel": "file", "evidence": { "asset": "human/assets/re-brief.eml", "sha256": "sha256:…", "strength": "strong" },
                 "recorded_by": { "id": "aoife", "name": "aoife" }, "at": "2026-09-30T10:20:03Z",
                 "seen": { "version": "sha256:…", "doc_hash": "sha256:…", "parts": [ … ] },
                 "current": true, "parts_known": true },
     "answers": [ "… every document answer, newest first, in the shape of `answer`" ],
     "parts": [ { "address": "3f2a…#single_minded_proposition", "label": "Single-minded proposition",
                  "state": "rejected", "decision": "d_…P", "review": "d_…A", "found_by": "agent",
                  "quote": "The proposition doesn't feel like us.", "said": "…what they said about it…",
                  "client": { "name": "Jane Murphy" }, "at": "2026-09-30T10:21:40Z",
                  "stale": false, "answered": false, "reopened": true } ],
     "suggestions": [ { "decision": "d_…S2", "review": "d_…A", "address": "3f2a…#audience", "label": "Audience",
                        "answer": "rejected", "quote": "…" } ]
   }
   ```

   - `lock.locked`: §7.1 holds. `lock.reopened`: the parts §7.5.6 item 2
     reopens. `can_lock` and `blockers` count §7.5.4 too.
   - `client.available`: `POST /client-review` would be accepted now (locked,
     nothing reopened).
   - `client.answer`: the newest document answer, `null` when there is none.
     `recorded_by` is the actor, labelled as `who` labels a person.
   - `client.parts`: one entry per address that has a current answer
     (§7.5.3), sorted by address. `found_by: document` (a read value; no record carries it)
     marks a part whose current answer is an `accepted` document answer; it
     has no `quote`. `said` is the part answer's own words, verbatim, absent
     when none were typed; the part's popover shows it.
   - `client.suggestions`: suggestions nobody has confirmed or dismissed yet,
     oldest first.
   - A suggestion's block in `decisions` names its maker `Knowledge agent` (`who`:
     `{kind: agent, id: client_parts_match, name: Knowledge agent, you: false}`); the decision says
     `process:host`.
   - The §7.5.4 items are in `attention` with their codes, `address` the
     part's, `decision` the answer's; an open suggestion's item names the
     suggestion.

### 8.3 The source card: `/cite`

One answer to "where did this come from?" for any ref a page shows, whichever
app shows it (feature `os-source-card`, 2026-11-09). A read, for any actor,
locked or not; every host answers it from the same routing table.

- `GET /cite?ref=<ref>` — one card. `400` without a ref; `404` when the
  document holds nothing by that ref.
- `POST /cite {refs: [<ref>, ...]}` — `{cites: {<ref>: card}}`, at most 500
  refs a call (`400` beyond). A ref the document does not hold is in the map
  with `kind: unknown`. A page asks for a section's cards in one call.

A ref is anything `/decisions` resolves in `cites`: a pin, finding or source
id, a material, passage or capture id, a decision id, `human:<id>`, or an
address. A card is that `Cite` — the same resolver, so the same words — with:

- `ref` — as asked.
- `origin` — `research`, `client`, `brand`, `layer`, `person` or `document`.
  The writer's marker is `origin_kind` on the member entry (a pin, finding,
  source, material, capture item or passage); `origin` itself is already
  taken (a pin's layer row `fact://…`, Contract campaign-clan §4; a field
  envelope's `extracted|proposed|confirmed|stated`). Without a marker only
  what the kind settles is said — a client's material or what was read from
  it is `client` (a typed prompt is `person`), a library passage is `layer`,
  `human:` is `person` — and anything else is `document`, never a guess.
  *Writers (2026-11-09, `server/napkin/origin.py`):* the middleware sets it
  on each new pin and finding — `research` for a pin a research lens found
  and filed (`pipeline/research.py`) and every synthesised or reworked
  finding (`synthesise.py`, `reconsider.py`); `layer` for a row the layers
  already held, pinned as it was (a reused row, a roster row in
  `campaign.py`). A client's material and a typed prompt carry no marker:
  the kind settles them. `brand` is written by the Brand Clan's copy
  (feat/brand-clan). The engine writes no member entries. The member
  schemas (`facts.schema.json`, `findings.schema.json`) take the key.
- `from {document_id, title?, app_id?, version?, path?}` — for something
  carried from an ancestor: a pin or finding a carried decision names on that
  ancestor, material or a passage found only in a frozen copy, an address on
  an ancestor. `title` and `app_id` come from the store's copy when it holds
  one (else the frozen copy's name); `version` is the revision carried, for
  the direct parent; `path` is what `POST /open` takes.
- `review {verdict, by, actor?, at?, decision?, note?}` — the newest review
  verdict that still stands: `verified` (a `verify`, a good `verdict`),
  `rejected` (a bad `verdict`) or `set_aside`. `history` holds every one,
  newest first, each `superseded` when replaced; with none in the chain, the
  record's own `review`, `verification` or `rejection`. "Looks right" is not
  a review of a fact.

---

## 9. Retrieval scope

Each agency has its own RAG index (S6, reversed 2026-09-23). House material
stays shared. Every retrieval still records per-hit scope — which index — in
the trace, so a mistake has a readable blast radius. The layer's part is storing
`trace_ref` on the decision; today `TraceRef` is never constructed with a value.

---

## 10. Conformance

Checked against the nine questions in `campaign-flow-usecases.clan`.

| # | Question | Answer here |
|---|---|---|
| 1 | Where does a synthesis live? | `shared/findings.yaml` until verified; then a layer fact, `method: synthesis` (§4) |
| 2 | What travels at a hop? | Everything but the source app's view, task text, legacy patches, text edits and view state (§5.2) |
| 3 | Filter or partition? | Partition per agency; per-hit scope still recorded (§9) |
| 4 | Can a handler name its own scope? | No. Scope, actor and branch namespace come from `Ctx` (§3, §6) |
| 5 | Approval vocabulary vs rejection? | `approve` is file-wide, bound to a hash; `verdict` is field-scoped with polarity (§4, §7) |
| 6 | What raises confidence; is a human one? | Tier and corroboration only; a human verification is a source (§4) |
| 7 | What is frozen at a spin-off, and checkable how? | The whole upstream, at `data.upstream.<id>`; `lineage.carried` holds its hashes and last decision id, and `GET /upstream` compares them (§5.3, §8.1) |
| 8 | What runs under someone else's lease? | See the lease table (§6) |
| 9 | What is parallel; does its target append? | Research and per-field drafters on branches; the chain appends by row (§6) |
| — | How does a client's answer reach the document? | A `client_review` on the locked version, recorded by staff with its evidence strength; per-part state by value hash; a rejection blocks locking again; "Make this change" reopens one part (§7.5, §8.2) |

---

## 11. Build order

| Task | What |
|---|---|
| W1-C5 | This contract |
| W1P-I5 | Decision struct: the §3 fields |
| W1P-I7 | Merge policies: `ask` by default, unknown is an error |
| W2-O1 | Stateless OS layer: Document, Change, Ctx, PartStore/Library split, ViewState out of Session |
| W2-O2 | Typed decision operations and routes (§4, §7, §8) |
| W2-O3 | Bind the OS layer to Python |
| W2-O4 | The server part store and change fan-out |
| W3-O5 | Route parity, then retire `napkin-web` |

Amended by this contract: W1-C1, W1-C3, W1-C4, W1P-I5, W2-A3, W2-A4, W2-A5,
W2-C4, W2-C6, W2-D1, W3-J3, W4-V1, W4-V2, W5-Z1.

---

## 12. Clients, the library listing and the landing

Feature `landing-circles`. Agencies work by client; before this, "client" was
free text inside three tools. This section gives a client an identity the OS
owns, and gives the shell one read that answers "what is open, for whom, and
what needs me". Everything below is additive: an older shell on a newer host,
and a newer shell on an older host, both keep working (the shell falls back to
the Launcher when `/library` answers 404).

### 12.1 The client registry

One CLAN document per tenant (desktop: per data directory, browser: per tab),
`document_type: client-registry`, whose `shared/data.yaml` holds
`clients: [ClientRecord]`. It lives beside the home app (`Library::home("clients-v1")`),
never in `Library::documents()`, so it is not work and never appears in the
recent list or the library. It is created by the first write; a tenant with no
registry has an empty list. Every write is a `Change` through
`PartStore::apply`, based on the version just read (a lost race is a `409`,
never an overwrite). Code: `crates/napkin-host/src/clients.rs`, which uses only
the store traits, so it is the same on `FsStore`, `TenantStore` and the
browser's `MemStore`.

```
ClientRecord {
  id:          "cli_" + 8 lowercase hex   minted by the host, never from a name
  name:        1..60 chars, whitespace collapsed, no control characters
  initials:    1..3 chars; derived from the name unless set by hand
  material:    pearl | ceramic | stone | graphite   (a look, not a permission)
  owner:       the actor who opened it ("human:name@agency"); informational
  created_at:  RFC 3339
  archived_at: RFC 3339, absent while live
}
```

Rules. Names are unique per tenant ignoring case and spacing, archived ones
included (`409`). A rename changes the registry only; initials follow the name
unless hand-set. Archive hides a client from the circles and keeps every
document linked to it; archive and restore are idempotent; an archived client
takes no new work (`409`). Every person in a tenant still sees every client
and the clients are not gated by role (the Clients door is open to Account service and
Management, but `/clients` is an open route). Roles (features/roles-and-homes.clan) gate
only the route groups of `napkin-web/src/roles.rs`: money, client brains and pitches, and
proprietary data. There are no per-client permissions: the check takes `(roles, route, client)`
and ignores `client`, so they can be added without a new check.

### 12.2 `manifest.client`

An optional manifest block `client: {id, name}` (spec/CLAN-SPEC.md section 5;
`clan_sdk::ClientRef`). `id` is the link. `name` is the name when the document
was attached; the registry is the truth and the library always answers with the
registry's current name (a rename never rewrites documents). Absent on every
earlier file; the field is not written when empty, and a reader that does not
know it ignores it. Every write carries it, and a spin-off takes its source's
client. `clan_sdk::with_client` is the one function that sets it on existing
bytes (new revision id; `updated_at` unchanged, because attaching a document to
a client is not work done in it).

`POST /documents` takes an optional `client_id`. An id this tenant's registry
does not hold is `404` (so another tenant's id is a `404`, never a link). A
blank document is reused only for the same client (or for none): a blank made
for one client is never handed to another.

### 12.3 Routes (napkin-web, tenant-addressed under `/api/t/{tenant}`)

Errors keep the existing `{ok:false, error:"message"}` shape.

| Route | Does |
|---|---|
| `GET /clients[?archived=1]` | The clients in the order made; archived ones only with the flag. |
| `POST /clients {name, material?}` | `201` + the record. `400` bad name or material, `409` duplicate. |
| `PATCH /clients/{id} {name?, initials?, material?}` | The record. `404`, `409` (name clash), `400`. |
| `POST /clients/{id}/archive`, `/restore` | The record. Idempotent. `404`. |
| `GET /clients/legacy` | `[{name, documents}]`: the free-text client names (Brief and Advertising `client`, Research `campaign.brand`, `client_org`) that documents without a client carry and no client has yet, most documents first. Reads every document, so the shell asks when the clients page opens and after a change, never on its poll. Tauri `legacy_client_names`, wasm `legacyClientNames`. |
| `POST /clients/adopt {names[]}` | `{created: [record], linked: n}`. Makes a client for each chosen free-text name (reusing one that exists) and links the documents with no client whose own data names it (`client`, `client_org`, `campaign.client_org`, `campaign.brand`). Nothing is guessed: only the names sent are adopted. |
| `GET /library[?client=<id>][&app=<app_id>]` | `{items: [LibraryItem], clients_unassigned: n}`; below. |

`LibraryItem` is `{path, app_id, title, updated_at, client: {id,name}|null,
state: {needs_you, locked}|null, run: {state, label, stage?, since?}|null}`, newest
first, uncapped. It leaves out documents nobody has worked in and installed
templates. `needs_you`/`locked` are `recent_state`, exactly what `/recent`
reports. `run` is, first, what the host has heard of a middleware job on that
document (below), else the document's own `data.run` (Deck Maker: `building`
is `working`, `gate` is `waiting`, `failed`, `done`, `draft` is `idle`; anything
else is none). `stage` is the stage the run names; the shell turns it into the
ring's verb.
`clients_unassigned` counts documents with no client whatever the filter.
`/recent` is unchanged (capped at 12, same fields).

Cost. The listing opens every document, so `napkin_host::LibraryCache` (one per
tenant workspace) keeps what a scan worked out per document, keyed on the
document's id, `updated_at` and size. Every write mints a new revision, so a
changed document is a different key and no invalidation hook is needed. The
client's name is resolved from the registry on every call, never cached.

#### Looking after the registry from the shell (P5)

Only the shell's landing writes the registry (never a document's app, which
reaches the host through `clan://` and has no route to it). The clients page
shows **Adopt clients (n)** when `GET /clients/legacy` offers n names: a panel
of ticked names with their document counts; the chosen ones go to
`POST /clients/adopt`, which says `Added x clients, linked y documents.`
Nothing is guessed: a name left unticked changes nothing. A client's page has
**Rename** (`PATCH`; a name in use is refused with the host's words, and its
work keeps its link because documents follow the id) and **Archive** (asks
first; the work is kept and the client leaves the circles). **Archived clients**
on the clients page lists them with **Restore**. A `registry_error` on the
library listing is shown as a banner. Escape closes whichever of these is open
before it goes up a level. Adopt rewrites each linked document's manifest; a
host session that holds one of those documents open can write its older
snapshot over the link (open question on the record).

#### Running, from the middleware's replies (`napkin_host::RunTracker`)

Brief and Research jobs live in the middleware's memory; the host sees them only
in `settle_middleware`, where every `napkin.middleware/1` reply carries
`job {id, state, stage?, progress?, started_at?}` (middleware-api.md section 2).
A `RunTracker` held beside the tenant's `LibraryCache` and fed by that function
keeps the last word per document and job id: `queued`/`running` is `working`
(label `Working: <stage> (<done> of <total>)`), `needs_input` is `waiting` ("Waiting
for you"), `failed` is `failed`, `done` drops the job. A new job on a document clears
its old failure. It never starts, polls or cancels anything, restarts empty, and
adds no middleware route. Two limits, on purpose: a job nobody has polled for 10
minutes (the document was closed) is not reported, and a failure is reported for a
day. The contract has no `cancelled` state, so there is none here. `Session::with_runs`
connects a session to the tracker; napkin-web, the Tauri host and napkin-wasm all do.

The shell reads this one listing for Needs you (document `needs_you`, or a run
`waiting`), Running and Failed, per client and for the studio, and rings each
circle with the strongest of: needs you, failed, working, thinking, reading,
checking, idle (`app/src/shell/landing/model.ts`). The verb comes from the run's
stage (`extract`/`research` read, `select`/`synthesise`/`report` think, a check or gate
checks, anything else works). Every state is also said in words. The landing re-reads
on focus and every 5 s while it is the screen.

### 12.4 The three hosts

The shell reads and writes through `Host` only (`app/src/host/types.ts`):
`listLibrary(filter?)`, `clients.{list, create, update, archive, restore, adopt}`,
and `newDocumentFromApp(appId, title, clientId?)`. They are implemented in
`http.ts` (the routes above), `tauri.ts` (Tauri commands `list_library`,
`list_clients`, `create_client`, `update_client`, `set_client_archived`,
`adopt_clients`; `new_document_from_app` takes `client_id`) and `wasm.ts`
(`NapkinHost.listLibrary`, `listClients`, `createClient`, `updateClient`,
`setClientArchived`, `adoptClients`, `newDocument(.., clientId)`). All three call the same
`napkin_host::{clients, scan_library}` code. The client writes are deliberately
not `clan://` routes: those are reachable by the app inside a document, and an
app must not be able to open or archive the studio's clients.

### 12.5 The shell route (read by the shell only)

`#agency` (the landing), `#clients`, `#client-<id>`, `#tool-<id>-<tool>`, where
`<id>` is a client id (`cli_` + 8 hex, ASCII) and `<tool>` is `brief | research |
idea | deck | prod | ads`. Anything else falls back to `#agency`. Written from
the shell's screen state, never the other way round: `hashchange` only reads.
Parsed and formatted in `app/src/shell/route.ts` (pure, table-tested).
The shell serves all four levels:

- `#client-<id>`: the client's six tools round it, in fixed places (a hexagon, Brief
  at the top, then Research, Idea, Deck, Prod, Ads clockwise). Idea and Prod, and any
  tool whose app is not installed, are dimmed "Soon" and go nowhere.
- `#tool-<id>-<tool>`: that tool for that client: the client's documents of the tool
  (from `GET /library`, the same listing the counts come from) and "New", which is
  `POST /documents {app_id, client_id}`, so the document is the client's from birth
  (`manifest.client`). A document opened from here runs the app as before.
- Corrections, so the page, the trail and the URL agree: a client that is not here
  (archived, another studio's, mistyped) is `#clients`; a tool that is not live is its
  client's page (`correctRoute` in `route.ts`).
- Escape goes up one level (`up`); the browser's Back and Forward walk the levels; a
  document takes one history entry of its own, so Back from it lands where it was
  opened from.
- The trail (Agency > Clients > Client > Tool) is drawn in the OS bar while a landing
  screen shows, and **in an open document's bar** in place of the studio-home button,
  before the title (the app's own tabs and buttons follow it unchanged, appBar.ts). In
  a document the trail comes from the document itself (`manifest.client`, and the tool
  its `app_id` is in the tool table), not from the route, so it is right for a document
  opened from a strip and after a spin-off, which carries `manifest.client`. A document
  with no client keeps the plain home button.
- Keyboard: the six tools are one tab stop (roving tabindex); arrows, Home and End
  move, `1` to `6` pick a tool, Enter opens it; a live region says each level on
  arrival and "coming soon" for a Soon tool (`app/src/shell/landing/keys.ts`).

### 12.6 The circles are flat

Owner, 2026-11-11: "We only need flat circles." The desk and the client page draw
each client as a flat colour disc (`app/src/shell/nui/Desk.tsx`,
`app/src/shell/landing/Circle.tsx`): plain SVG and CSS, no WebGL, no canvas and
no switch. The 3D client-circle engine (`app/src/orbs/`), its "Flat circles"
setting (`napkin.circles.flat`) and the `<html data-orbs…>` attributes are gone.
The agents keep their spheres from the one agent engine
(`app/templates/shared/agent-sphere`, `app/src/shell/agents/AgentSphere.tsx`).

## 13. Jobs and the job index

(features/job-index-dashboard.clan; v2 sections 3, 4 and 6.)

- **The job registry.** The jobs of a tenant are one CLAN document, `document_type: job-registry`,
  kept beside the client registry (`Library::home("jobs-v1")`, `crates/napkin-host/src/jobs.rs`). A job
  holds its number (`J001`), client, title, owner, `opened_on`, `due` and `budget_hours`. It holds no stage.
  Every write names its actor, goes through `Change` and `PartStore::apply`, and the host stays wasm32-clean.
- **`manifest.job`.** A document names its job by number. `POST /documents` takes `job` beside `client_id`
  (404 for an unknown number, 400 for another client's job), a spin-off carries it, and `clan_sdk::with_job`
  sets it. The registry never lists documents: the job's documents are the ones that name it.
- **The index.** `napkin_host::jobindex::JobIndex` is built from the registry and from the decision chains
  of the job's documents. A job's **stage is derived**, never stored: the Brief gate gives Client brief
  (gate not passed), Brief check (passed, signed, waiting on the client), then Scope and estimate (client
  confirmed). Phase 1 reads only the Brief; the later steps of the eleven are named and wait for their
  tools' decisions. The index is read-only, disposable and rebuilt from the documents when any document's
  version moves (`IndexCache`); a rebuilt index equals the live one (tested).
- **Routes**, all under `/api/t/{tenant}`: `GET /jobs`, `GET /jobs/{number}`, `PATCH /jobs/{number}`, `GET /jobs/{number}/stage`,
  `GET /needs` (the signed-in person's lines, by deadline) and `GET /dashboard` (the six tiles;
  Management, an admin or a demo, else 403 from `roles.rs`). `POST /jobs` opens a job in the registry and
  `PATCH /jobs/{number}` changes it (13.2). A write of any kind to the index routes is 405.
- **Never scores people.** The index and the dashboard hold jobs, stages and what each person is asked
  to do next. They hold no ranking or score of a person.

### 13.1 The approval route (features/approval-route.clan)

Who approves each stage of a job and by when. The route is a fact about the job; whether a step is
approved, who holds the job and what is late are **derived** in the index from the documents' own
decisions and the clock. There is no scheduler and no stored reminder state. `needs-you-full` and
`job-page` build against exactly these fields. Fields are only added: nothing above was renamed or removed.

- **`JobRecord.route`** (`jobs.rs`). A list of steps, in stage order, `#[serde(default)]` and left out
  when empty, so every registry written before it still reads and a newer registry reads here (unknown
  fields are ignored). A step is `{stage, party, role, approver, contact, due, rounds}`:
  `stage` one of `jobindex::STAGES`; `party` `agency` or `client`; `role` optional (`planner`,
  `creative_director`, or a free label, lower case); `approver` a sign-in name `user@agency` for an
  agency step, a name for a client step; `contact` a client step's email, optional; `due` `YYYY-MM-DD`;
  `rounds` a client step's plain number of rounds (1 to 20), optional, until Scope (Phase 3) is its source.
  `(stage, role)` is unique within a route. `jobs::set_route(store, ctx, number, steps)` replaces the
  route whole and `jobs::move_deadline(store, ctx, number, due)` moves the deadline; each records **one
  decision on the registry's own chain** (`agent/decision-chain.yaml`, kind `edit`, `agent` and `actor` the
  person, `action` `set_route` or `move_deadline`, `targets` the job number). A non-person actor is `403`.
  `jobs::route_history` reads who set each route and when from that chain.
- **`PUT /api/t/{tenant}/jobs/{number}/route`** with `{"route": [step, ...]}`. Replies `200` with the
  `JobRecord`; `400` for an unknown stage, a date that is not `YYYY-MM-DD`, an agency approver that is not a
  sign-in name, a contact that is not an email, or two approvers for one `(stage, role)`; `404` for an
  unknown job; `405` for any other method. `roles.rs` `Group::Approvals` (account-service, management;
  an admin or a demo opens everything) answers `403` to everyone else. `GET /jobs`, `/jobs/{number}`,
  `/needs` and `/dashboard` keep their shapes and gain the fields below.
- **`JobEntry.route`**: one `RouteStepState` per step, in route order:
  `{stage, label, party, role, approver, contact, rounds, due, state, approved_by, approved_at, version,
  document, held_since, days_held, days_late}`. `state` is `approved`, `waiting` (the one step the job is held at) or
  `not_started`. A step is approved by a document filed under the job whose app maps to the step's stage
  (`jobindex::APP_STAGES`, one table: a new tool adds a line) carrying, on its current content, the
  planner's `sign` (a brief, role `planner`), an `approve` by the approver (an agency step), or an accepted
  `client_review` (a client step). `approved_by`, `approved_at` and `version` are read from that decision,
  never typed; unlocking or editing the document returns the step to `waiting`. `approver` shows the
  brief's own signer when the brief names one for the role. `held_since`, `days_held` and `days_late` are
  set only on the waiting step. `contact` and `rounds` are the record's, repeated so an editor can send a route back whole.
- **`JobEntry.holder`**: `{party, person, role, stage, since, days, due, days_late}` or `null`: the first
  step, in stage then route order, that is not approved. `since` is the timestamp of the decision that
  approved the step before it, or of the `set_route` decision for the first. `days` is whole days since
  then. A due date is a date: `days_late` is `0` through the due date and counts from the day after,
  by the index's `today` (UTC). It is a fact about one job; the index has no total, average or order by
  person (tests hold the replies to that). When the route has a client step, `waiting_on` and
  `days_waiting_on_client` follow the holder: `client` and the days since the agency's last approval while
  the client holds it, `agency` and none while the agency does.
- **`Need`** gains `id`, `kind`, `stage` and `days_late`. `id` is stable, `{job}:{stage}:{role}:{kind}`
  (role `any` when the step has none; a gate need's role is `planner`, `creative_director` or
  `account_service`). `kind` is `gate` (the existing Brief gate needs), `approval` (the holder's step, for
  the approver, from 48 hours before its due date, with `due` the step's own date and `days_late`), or
  `approval-chase` (from two days late, for the person who set the route: a late client step is chased
  this way too). `days_late` is `null` on a gate need. `path` is the step's document, or empty when none is
  filed yet. The items appear from the clock and leave when the step is approved; nothing is stored.
- **`Dashboard.at_risk`** carries late approvals: a job whose holder is late has a line
  `"<Stage label> approval is N days late."`, joined to `"Due <date>."` when its deadline has also passed.
  The dashboard stays six tiles.
- **Signers.** The gate still enforces `brief.signers` and nothing else. `jobs::fill_signers` writes the
  route's planner and creative director into a brief filed under the job that names none and is not locked,
  by one attributed patch through the document's own session, when the route is set and when such a brief is
  filed under the job.
- **Test clock.** `AppCtx::with_jobs_clock` sets the day the index counts by; the e2e stack moves it by
  writing an RFC 3339 time to the file `NAPKIN_TEST_CLOCK_FILE`. No deployment sets it.
- **Stage 2, not built.** An hourly email digest of a person's open approval items, through
  client-review-full's mailer, with a per-person-per-day marker file as its only state. In-app reminders stay stateless.

### 13.2 The job page (features/job-page.clan)

One screen opens one job. It draws the job index and nothing else: it holds no state of its own.

- **The route `#job-<number>`.** `number` is `J` and three to six digits (`jobs::is_job_number`;
  `isJobNumber` in `app/src/shell/route.ts`); anything else falls back to `#agency`. It is the one address of
  a job: the dashboard's numbers, a Needs you row, Live jobs and, later, the bar link to it. A job that is not
  in this agency is the Empty state with a way to Live jobs. Escape and the trail go up to the agency.
- **Every job write is an attributed decision.** `jobs::create_job` records `open_job`, `jobs::update_job`
  records `update_job` (or `move_deadline` when only the deadline moved), each as **one decision on the
  registry's chain** by the person (`agent` and `actor` the sign-in name, `targets` the number,
  `fields_changed` `<number>/<fields>`, `rationale` the change in words: `Moved the deadline of J001 from
  2026-11-20 to 2026-11-27.`). A non-person actor is `403`; nothing is written for a bad value (`400`), an
  unknown job (`404`) or a registry that moved under the write (`409`); a change that changes nothing writes
  nothing. `write_registry` takes the decision, so no registry write can leave it out.
- **`PATCH /api/t/{tenant}/jobs/{number}`** `{title?, owner?, due?, budget_hours?}`; `due: null` clears the
  deadline, an absent key leaves it. Replies `200` with the `JobRecord`. `POST /jobs` and `PATCH` are for
  planning, account service, management and producers (`roles::may_manage_jobs`; an admin, a demo and a
  person with no role are unrestricted, as everywhere); others get `403`. A role outside the Money group that
  sends `budget_hours` gets `403` on either (`roles::may_set_budget`).
- **The role view (an allow list).** `GET /jobs` and `GET /jobs/{number}` send each role only the fields
  `crates/napkin-web/src/jobview.rs` names, never "everything but": `JOB_KEYS` to everyone, plus
  `budget_hours` for the Money group (producer, account service, management, traffic); `STEP_KEYS` on each route
  step, plus `contact` and `rounds` (a client's email and rounds) for the Approvals group (account service,
  management). The nested objects (client, stage, holder, each document) are listed the same way. A field added
  to `JobEntry` is sent to nobody until it is added to a list; the unit test builds a `JobEntry` by struct
  literal and an API test seeds every field and checks the keys role by role. **Default taken, not yet
  decided by the owner:** budget in hours is money.
- **`GET /jobs/{number}`** answers `{job, needs, can}`: `job` as above, `needs` the signed-in person's needs
  on that job (the `GET /needs` items for it), `can` `{manage, budget}` what this person may do. `GET
  /doors` carries the same `jobs: {manage, budget}` for Live jobs. `GET /jobs` keeps its shape (a list).
- **`JobDoc`** gains `version` (a gated brief's newest signed version, else `null`) and `changed_since_lock`:
  the page's Changed brief reads them (`Update to brief v2` opens the brief, where the new version is signed).
- **Linking to a job from another record:** `<a href="#job-J001">`, or `go({ level: 'job', number })`
  (`formatRoute`). A document opened from the page returns to it through the document's client chip.
## 14. The agency directory (features/agency-setup.clan)

An agency's people are a third registry (after clients and jobs): one CLAN document per tenant,
`document_type: agency-registry`, kept beside the home app (`Library::home("agency-v1")`,
`crates/napkin-host/src/agency.rs`), whose `shared/data.yaml` holds `settings` and `people`. It is
written through `Change` under one lock and never touches `std::fs`, so it stays wasm32-clean. Needs
Shrey's review: it is the agency's own store today, and approach B (control-plane tables in Aurora) can
replace it behind `Directory` without a caller changing.

**One rule.** An agency has a *directory* once it names people. While it has one, the directory is the
only source of who may sign in and with which roles, and the roster column and the identity provider's
`custom:roles` are ignored for that agency. While it has none, sign-in is exactly as it was.

- **`Person`**: `{username, name, email, roles, state, invited_by, at}`. `username` is the sign-in
  name `user@agency`; `state` is `invited` (named, not yet signed in), `active` (a first sign-in turns
  `invited` into `active`) or `removed` (kept for the record, cannot sign in). `roles` is never empty in a
  directory, each one a role the agency's door table knows, or `admin`; `demo` is not given to anyone.
- **`Settings`**: `{name, credit_cap_month_eur, time_zone}` (default zone `Europe/Dublin`). The cap is
  euros per calendar month, stored and shown, not enforced.
- **Every change is one attributed decision** on the registry's own chain: `agent` is `human:<admin>`, the
  `action` is `add_person`, `set_roles`, `edit_person`, `remove_person`, `activate`, `import_people` or
  `set_settings`, and the decision's `before` and `after` hold the roles (or the settings) either side. A
  write by anything but a person is `403`. The last admin cannot be removed or lose the role (`409`).
- **`trait Directory`** (`crates/napkin-web/src/directory.rs`), on `AppCtx.directory`:

  ```rust
  pub trait Directory: Send + Sync {
      fn has(&self, agency: &str) -> bool;                              // the agency names people
      fn person(&self, agency: &str, username: &str) -> Option<Person>; // any state, removed included
      fn people(&self, agency: &str) -> Vec<Person>;                    // in the order they were named
      fn changed(&self, agency: &str) {}                                // this process just wrote
  }
  ```

  `agency` is the slug (the part after `@`). `RegistryDirectory` answers it from the registry with a cache
  keyed by the registry's version, re-checked after 60 seconds; a registry that does not parse is served from
  the last good read, else as no directory, with a warning (writes to it fail). A test moves the cache's
  clock with `AppCtx::with_directory_clock`.
- **Live roles.** `directory::live_roles`, a layer between the tenant layer and the permission check,
  replaces the session's roles with the directory's on every request. A removed person, or one not on the
  list, gets `401 {signin: true}` and the session cookie is cleared; a listed person with no roles gets
  `403` on everything. The session cookie keeps carrying roles as a hint only. A role change or a removal
  is seen by the next request after the cache window (at once by the process that wrote it). The
  sandbox's per-document tokens are not covered: they last until they expire.
- **Sign-in.** `agency::sign_in`: with a directory and no passwords (the roster) the name alone is looked
  up in it; with a password provider the provider proves the person and the directory then has the last
  word. The refusal is the roster's own line, *That name is not on this studio's list. Ask your studio
  admin to add you.*

### `GET /api/t/{tenant}/agency/people`

Any signed-in person of the agency. The tenant is always the signed-in person's own: naming another
agency's tenant is `403` from the tenant extractor. An allow list, by reader:

- **A member**: `[{username, name, roles}]`, people who are not removed. No email.
- **An admin**: `[{username, name, roles, email, state, invited_by, at}]`, removed people included.
- An agency with no directory answers `[]` (its roster is not a directory), as does an anonymous session.

`username` is `user@agency`, `roles` a list of role ids as `roles.rs` has them, `at` RFC 3339.

### Writes (admin of the agency only; `403` otherwise)

| Route | Body | Reply |
| --- | --- | --- |
| `POST /agency/people/invite` | `{username?, email, name, roles}` (`username` defaults to the email's local part at this agency) | `201` an admin person |
| `PUT /agency/people/{username}` | `{name?, email?, roles?}` | `200` an admin person |
| `DELETE /agency/people/{username}` | none | `200` the person, now `removed` |

`400` for a name outside the signed-in agency, an unknown or empty role list, a bad email; `404` for
someone not on the list; `409` for a name already on the list or the last admin. The first person named
for an agency with no directory also names the admin who writes, as `admin`, so the writer is never locked
out. Roles are `Group::Admin`, `Group::Control` in `roles.rs`: `/audit` and `/setup/*` are admin-only
(a person with no role is refused, not let through), `/control/*` needs `napkin-admin`.

### 14.1 Settings, setup and import (stage 2)

All admin only (`403` otherwise), all on the signed-in person's own agency (another agency's tenant in the
path is `403` from the tenant extractor).

- `GET /api/t/{tenant}/agency` answers an admin `{name, credit_cap_month_eur, time_zone, look}` and anyone else
  `{name, look}`. `PUT /agency` takes `{name?, credit_cap_month_eur?, time_zone?}` and records one
  `set_settings` decision; a cap that is not a number, or is below zero, is `400`. The cap is euros per
  calendar month, stored and shown; nothing enforces it until the cost engine. `PUT /agency/look` (the logo)
  is the admin's once the agency has a directory.
- `GET /setup` answers `{steps: [{id, done}], next, complete, people, has_directory}`: the setup flow's
  progress, **read from the data** (a logo, a name, a person besides the admin, a client, a job), never stored.
- `POST /setup/import/{people|clients|jobs}[?dry_run=1]` takes the file as the raw body or one
  `multipart/form-data` part (up to 1 MB and 5,000 rows) and answers a report
  `{kind, dry_run, rows, ok, errors: [{line, reason}], created, updated, unchanged, committed, results:
  [{line, status: new|changed|same|error, label, reason?}], starts_directory, made_before_failure}`. A dry run
  writes nothing. Without it the rows that are fine are written (people in **one** registry write and one
  `import_people` decision; clients and jobs one by one, the report naming which were made if one fails) and the
  bad ones are listed by line. The same file again changes nothing. People columns: `email`, `name`, `roles`
  (roles separated by `;`, `,` or `|`), optional `username`; the sign-in name is the email's local part at the
  agency. Clients: `name`, optional `material`. Jobs: `client` (a client's name that exists), optional `number`,
  `title`, `owner`, `opened_on`, `due`, `budget_hours`. A file may be UTF-8, with or without a byte order mark,
  or Windows-1252, comma, semicolon or tab separated. Cells are kept as typed; a cell that begins with `=`, `+`,
  `-` or `@` is quoted when a list is written out (`import::export_cell`). The first people list starts the
  directory and keeps the importing admin on it as an admin (a file that would demote them is refused on its line).
- `GET /agency/accounts.tsv` is the people as `infra/scripts/create-users.sh` reads them: `user@agency`, name,
  roles, tab separated.

### 14.2 The audit view (stage 3)

`GET /api/t/{tenant}/audit[?kind=&limit=]`, admin only, newest first: `{total, lines: [{at, who, kind, what,
doc?, version?, ip?}]}` with `kind` one of `approval`, `export`, `link`, `sign-in`, `permission`, `settings`.
Approvals (a signature, a lock, a client's answer) are read from the documents' decision chains each time.
Permission and settings changes are the registry's own decisions, copied into the file once each. Exports, client
links and sign-ins (a refused one included, with its source address, 30 an agency in ten minutes, only for an
agency that already has a workspace) are lines of an append-only file per tenant, `audit.jsonl`, behind
`trait AuditLog`. Each line carries the hash of the one before and the newest hash is kept in `audit.head`;
`GET /audit/verify` answers `200 {ok: true, lines}` or `409 {ok: false, line, problem}` after an edited, inserted,
removed or cut-off line. It is tamper-evident, not tamper-proof (S1 anchors the head elsewhere). One web task
writes the file at a time; with several tasks on one disk it needs a lock file. It never holds a timesheet, a
correction or a signal consent. Retention (default 12 months, for the owner to confirm) is not built: it needs a
checkpoint line so a trimmed log still verifies.
