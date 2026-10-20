# Production Tool: who writes what (contract 3)

How a contract-3 document is written: which values are entity fields
written as patches, which are shared live text, who owns each, and how every
write lands in the decision chain. `document.schema.json` says what the data
is; this file says how it changes. clan-store implements it (`src/bus/`,
`src/text/`, `src/integrity.ts`); the sync service (feature live-sync) will
implement the same buses over the network and run the same contract tests
(`clan-store/test/bus.contract.ts`).

Decided in features/contract-v3.clan (approach A, approved 2026-10-13). The
split is the one Figma, Linear and Tiptap Collaboration use: last-writer-wins
per field with versions, CRDT text only where people type together.

## 1 Two kinds of value

| Kind | What | Written by | Conflicts |
|---|---|---|---|
| **Field** | Every entity field that is not live text: camera, duration, rank, status, picks, roles, names, ratios, windows, links, jobs. | `PatchBus.apply(batch)`: field-level patches (`patch.schema.json`), validated against the whole document before they land. | Two writes to different fields both apply. A set whose `base_version` is older than its leaf's `field_v` is a conflict and is not applied; the writer sees the winning value (ui-behaviour 4.4). |
| **Live text** | A shot's action and direction, a beat's words, a scene's unplanned script text, a note's words. | People and crew typing into Yjs fragments through `TextBus`. | Never: Yjs merges characters. |

Entities never go into the CRDT (overhaul-plan §8). Live text never goes into a
patch: its flat copies in the document are written only by `checkpoint()`.

## 2 The Y.Doc

One fragment per entity that has live text, named `<map>/<id>`:

| Fragment | Holds | Flat fields checkpoint() writes |
|---|---|---|
| `shots/<id>` | `action` blocks, then at most one `direction` block | `prose`, `action` (≤ 600), `direction` (≤ 4,000), `refs` (mentioned ref ids, ≤ 14), `text_problem`, `last_writer` |
| `scenes/<id>` | screenplay text no shot owns yet: `action`, `character`, `parenthetical`, `dialogue` | `prose`, `text` (≤ 20,000), `last_writer` |
| `beats/<id>` | one block: `dialogue` for a line, `action` for every other kind | `prose`, `text` (≤ 500), `last_writer` |
| `reviews/<id>` | the note's words: `action` blocks | `prose`, `text` (≤ 1,000), `last_writer` |

**Node set** (`clan-store/src/text/extensions.ts`, the one list the editors,
`checkpoint()` and `hydrate()` all use): `doc`, `text`, `action`, `character`,
`parenthetical`, `dialogue`, `direction` (added by the spike, 2026-10-13),
`mention` `{id: refId, label}` and `hardBreak`. A mention stores the ref's id,
so renaming the ref renames every mention; its `label` is shown only when the
ref is gone, as an unknown name.

**Order is never in a fragment.** Both script views (screenplay and Video ·
Audio) compose fragments in rank order: scenes by `rank`, a scene's shots by
`rank`, a shot's beats by `rank` and `at_s`. Reordering is one rank write. A
Moment is a beat block; a Line tied to it carries `moment_id`, and moving
either writes both in one batch.

## 3 Field owners

| Field | Owner | Notes |
|---|---|---|
| `shots.prose/action/direction/refs/text_problem/last_writer`, `scenes.prose/text/last_writer`, `beats.prose/text/last_writer`, `reviews.prose/text/last_writer` | `checkpoint()` | PatchBus refuses a patch to them: `owned_by_text`. |
| `shots.direction_condensed` | Dex's job (shot-direction) | Read-only to people. |
| `beats.speaker`, `beats.parenthetical` | patches | A planned line's speaker and parenthetical are fields, not text. |
| `asks[q].answers`, `asks[q].state` for a job's ask | the relay | The document copy is written from `Job.question`, `answeredBy` and `answer`. A second `create` of the ask answers `exists`, which counts as success. |
| `jobs[j].state/outputs/cost/error/provider/model/remote_id` | the job's runner (today the browser; later server-job-landing) | Quiet writes. |
| `suggestions[s]` | Skye's job creates; Keep, Keep mine and staleness are patches | Keep applies the proposed prose through TextBus in the same undo step. |
| `upstream` | the host, at spin-off | Read-only: napkin-host refuses a patch under it. |
| everything else | patches | |

## 4 checkpoint, hydrate, last_writer

- **`checkpoint(doc, kind, id)`** reads the fragment and returns the patch that
  writes its flat fields: `prose` always (it is at most 64 KB; past that the
  checkpoint refuses and says so), and each flat string when it fits its limit.
  A string that overflows keeps its last valid value and sets
  `text_problem {field, length, limit, message}`; a job started for that
  entity refuses with the same message. A fragment that fits again clears it.
- **`hydrate(doc, prose)`** rebuilds a fragment from `prose`. A fresh browser,
  another device or a cleared site rebuilds every fragment from the `.clan`.
  `checkpoint(hydrate(x))` equals `x` for every fragment kind (the parity test).
- **`last_writer`** is the transaction's origin: `human:<personId>` for a
  person's keystrokes, the crew id for an agent's write. Re-planning keeps any
  shot or beat whose `last_writer` is a person.
- **Checkpoints are quiet writes** (no decision). A person's typing in one
  fragment is summed up by **one attributed entry per person per fragment per
  60 s window**, written when the window closes or the person leaves:
  `write shots[<id>]` with the fragment as its target. A hundred checkpoints in
  a minute are one entry.

## 5 Planning moves text

Before planning, pasted script text lives in its scene fragments. Dex's plan
moves each span it turns into a shot out of the scene and into the shot's and
its beats' fragments **in one Y transaction**: one undo step, and the span is
never in two places. `integrity.ts` refuses a document where a shot's action
still appears in its scene's text. Re-planning is a merge keyed by shot id:
shots a person wrote last keep their text; new shots are added; a shot whose
scene is gone is asked about, never deleted.

Only Dex's planning of new entities writes text directly. Every other crew
text (Skye's drafts and rewrites) lands as a suggestion.

## 6 Suggestions and hands_off

A Skye job lands as `suggestions[id]` with `base_hash` (the SHA-256 of the
target's `prose` it was written against) and the proposed `prose` and `text`.
Nothing changes until **Keep**: Keep applies the proposed prose through
TextBus and sets `state: kept` in one undo step. **Keep mine** sets `dropped`
and adds `skye` to the target's `hands_off`, so her later jobs skip it. A
suggestion whose target's prose no longer hashes to `base_hash` is `stale`.
Until live-sync, open suggestions and asks with no job live in one browser and
meet other copies at save (If-Match, `SaveConflict.tsx`).

## 7 Patches: the leaf and array rules

A patch names `entity` (a map), `id`, and for a set, `path` with `/` between
parts (`patch.schema.json`).

- **Leaves.** A path is a leaf when it names one top-level field of the entity,
  or one part of a composite: `camera/<part>`, `pick/current`,
  `pick/alternates`, a video's `timeline/<item>`, `timeline/<item>/<field>`,
  `timeline/<item>/source/<generation_id|asset|in_s|out_s>` and
  `timeline/<item>/follows/<box_id|shot_id>` (an item's `transition_in` is set whole; features/make-and-edit.clan).
  A video's `end_card` and each top-level field of a generation are set whole. Any other object is set whole
  (`region`, `window`, `font`, `rule`, `format`, `ignored`, …). `id`, `v`,
  `field_v` and the entity itself are never paths: `not_leaf`.
- **Arrays are leaves.** An array (`refs`, `alternates`, `answers`, `inputs`,
  `parent_ids`, `edits`, `segments`) is set whole. Its order means something,
  so two people writing one array conflict like any field.
- **Null removes** an optional leaf.
- **create** carries the whole entity; the bus fills `id`, `v: 1` and
  `field_v: {}`. Creating an id that exists is `exists`. **delete** removes
  the entity. A set or delete of a missing entity is `not_found`.
- **Versions.** Every applied batch adds one to `v` of each entity it touches
  and records that `v` in `field_v` under each leaf it set. A set conflicts
  when its leaf's `field_v` is newer than its `base_version`.
- **Atomic.** A batch applies whole or not at all, after one validation of the
  whole document (ajv against `document.schema.json`, then `integrity.ts`).
  `PatchResult.inverse` is the batch that undoes it.

## 8 Recording decisions

Every non-quiet batch is one decision-chain entry, through napkin-host's
`/patch-data` (kind `edit`):

- **`agent`** is the claim: `human:<personId>` for a person, the crew id for an
  agent. The host records who actually asked (`actor`) beside it.
- **`action`** starts with a verb from this list; the rest is free words. The
  verb is the contract: the decision tree reads it.

  `plan`, `render`, `retouch`, `edit`, `write`, `read`, `check`, `ask`,
  `answer`, `change_answer`, `pick`, `keep_both`, `restore`, `apply`, `link`,
  `unlink`, `keep_suggestion`, `keep_mine`, `ignore_check`, `publish`,
  `update_from_library`, `bring_in`, `pin_decision`, `unpin_decision`,
  and the plain verbs of a person's edits: `set`, `create`, `delete`, `move`,
  `name`, `start` (a job asked for), and `undo` and `redo` (LocalUndo taking a
  step back or forward: the rest of the action is the step it reverses).
- **`targets`** are addresses (§9) of what the batch changed: one per entity,
  and one per leaf when the batch sets 8 leaves or fewer. LocalPatchBus derives
  them; nobody writes them by hand.
- **`cites`** are what the decision rests on: a job's landing cites
  `<doc>#jobs[<jobId>]`; a restore cites the restored version; `pin_decision`
  and `unpin_decision` cite the decision id (`d_…`).
- **Agents carry `reasoning`** (decided, because, rejected) when they have it.
- **Kind in the decision tree** comes from the targets' entity and the verb:
  `check` → Checks; `ask`, `answer`, `change_answer` → Asks; `pick`,
  `keep_both`, `restore` → Picks; everything else → Decisions.
- **A restore** is a `restore` decision that sets the pick back, cites the
  restored version, and writes the stale marks of what it fed in the same
  batch: one undo step. History is never rewritten.
- **Pinning after the fact** is `pin_decision` (or `unpin_decision`): a new
  entry citing the decision, never an edit of the old one.
- A job's landing (a frame, a generation, the shot list) is one batch: one undo step
  and one decision, agent the crew member, citing the job.

## 9 Addresses

`<doc-id>#<map>[<id>]` names an entity and `<doc-id>#<map>[<id>].<field>` one
of its fields (docs/contracts/os-layer.md §3); nested parts follow with `.`
and `[key]`: `#shots[shot_X].camera.size`, `#videos[video_Y].timeline[item_Z].source.in_s`.
Keys never hold `.`, `[`, `]` or `#`, which is why map keys are ids and format
ids (which hold dots) are only ever values. napkin-host checks every target and
cite with `normalise_target`; a malformed one is a 400.

## 10 Undo

`LocalUndo` keeps one person's steps and persists them in
`ProjectUi.undo`, so undo survives a reload:

- a **patch step** stores its inverse batch;
- a **text step** stores the fragment's prose before the step; undo restores
  it through TextBus, and is skipped with spec 4.5's notice ("Sai changed this
  after you, so undo skipped it") if the fragment changed since;
- a **mixed step** (the plan move, Keep a suggestion) stores both and undoes
  both;
- asks, tray sends and publishes are never undo steps.
