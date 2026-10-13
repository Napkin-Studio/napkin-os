# production-tool/clan-store

The Production Tool document (contract 3) as a real `.clan`: napkin-wasm (the
same `napkin-host` and `clan-sdk` the desktop and the server run) behind the
buses `production-tool/contracts/collab.md` defines.

- **Writes go through the buses.** `LocalPatchBus` applies field patches
  (`contracts/patch.schema.json`): it checks the leaf rules, the text owners
  and the versions, applies the batch to a copy, and writes one merge patch
  through the store, which validates the whole document (ajv, then
  `integrity.ts`) and records one decision with the targets the bus derives
  (`/patch-data`'s `targets` and `cites`). `LocalTextBus` holds the live text
  in a Y.Doc (one fragment per shot, scene, beat and note) and checkpoints its
  flat fields as quiet writes, with one attributed entry per person per
  fragment per 60 s. `LocalUndo` keeps one person's steps and persists them.
- **A v2 `.clan` is refused**, never read or overwritten: `open`, `load` and
  `openBytes` throw `UnsupportedContract`.
- The `.clan` carries the contract, bundled into one self-contained schema
  (`scripts/bundle-schema.mjs`), as `agent/output-schema.json`, so the SDK
  refuses an invalid write too.
- The bytes are saved to IndexedDB 300 ms after the last write, and restored
  with `load()`.

## Use it from production-tool/web

```ts
import { ClanDocumentStore, LocalPatchBus, LocalTextBus, LocalUndo } from '../../clan-store/src'

const store = new ClanDocumentStore({ person: { id, handle, tenant_id } })
const doc = (await store.load()) ?? (await store.create({ person, title: 'Untitled ad' }))
const bus = new LocalPatchBus(store)
const text = new LocalTextBus(bus)
const undo = new LocalUndo({ saved: ui.undo, onChange: (s) => (ui.undo = s) })
undo.bind(bus, text)
text.hydrateAll()

await bus.apply({ patches: [{ op: 'set', entity: 'shots', id, path: 'camera/size', value: 'close', base_version: shot.v }],
                  why: { action: 'set shots camera size' } })
await text.replace('shot', id, prose, `human:${person.id}`)
await undo.undo()
```

Import the TypeScript source. Vite resolves the JSON schema imports and the
`napkin_wasm_bg.wasm` URL beside the glue. In node, pass the bytes:
`new ClanDocumentStore({ wasm: bytes })`.

Beyond the buses: `open(bytes)`, `chain()` (newest first, with targets and
cites), `record()` (a decision with no data change: `pin_decision`, a failed
job), `documentId()`, `flush()`, `startMirror()`/`mirrorNow()`, `dispose()`.

## Who did what: people and the crew

A person's write is claimed as `human:<personId>`; the crew's as their id
(`dex`, `skye`, `wren`, `rhea`, `edie`, `ellis`, `jude`). A job's result lands
as one batch: one decision, agent the crew member, citing
`<doc>#jobs[<jobId>]`, with `landingWhy()`'s rationale (what the director
decided, the model, cost, time and outputs). A job that ends with no result is
recorded once by `recordJobOutcome()`.

## Build and test

```bash
npm ci
npm run build   # cargo build napkin-wasm (wasm32) + wasm-bindgen --target web → src/wasm/
npm test        # vitest, node, against the built wasm and the real `clan` CLI on PATH
npm run lint    # tsc --noEmit
npm run app     # rebuild src/app-template.gen.ts after a contract change (needs `clan`)
```

As with `app/src/wasm`, the generated glue and `.wasm` are not committed; only
`src/wasm/napkin_wasm.d.ts` is. `src/app-template.gen.ts` is committed: it is
the Production Tool template app (about 17 KB), built with the `clan` CLI, so
the web build needs neither the CLI nor a fetch. A test fails if it no longer
carries the current contract.

## Mirror (a proposal, not in the locked contracts)

`store.startMirror(post, { everyMs: 300_000 })` calls `post(bytes, {handle, reason})`
every 5 minutes when something changed, and at once on every accept verdict.
`postClanMirror({ relay, token })` is a ready `post` for this route, which the
relay does **not** have yet:

```
POST /clan
Authorization: Bearer <session token from POST /session>
Content-Type: application/vnd.clan+zip
X-Clan-Reason: interval | accept | manual
body: the .clan bytes (about 20 KB for 8 shots and 30 jobs)
→ 204. The relay writes s3://<bucket>/clan/<handle>.clan (latest wins) and
  can keep s3://…/clan/<handle>/<iso-time>.clan for history.
  413 above a size cap (suggest 5 MB); 401 without a valid token.
```

It needs Shrey's decision (contract change by D1 rules: a new relay route in
`relay-api.schema.json`).

## Gaps in napkin-wasm (found while building; no Rust changed)

1. **No decision-only route.** The host has `/verdict`, but it marks a field
   path good or bad (Contract 4), and cannot target a list item by id. A
   `/patch-data` that changes nothing is skipped by the host's no-op guard,
   so it records no decision. The store gets past the guard by sending
   `patch: {}` with `append_keys: ["verdict"]`: a key absent from the patch,
   so nothing is appended and the decision is recorded with
   `fields_changed: []`. That works, but it leans on a quirk. The proper fix
   is a `/decision` route on `clan_sdk::patch_decision` (proposed in
   features/production-tool-clan.clan, open_questions).
2. **No data as JSON.** The store reads `entry('shared/data.yaml')` and parses
   the YAML (the `yaml` package). `document_now()` exists in the session but
   no route serves it.
3. **Write cost grows with the document.** On a 60-shot project (360 frames,
   jobs and beats) one `/patch-data` costs 55-60 ms in node (release wasm):
   clan-sdk compiles the document's JSON Schema on every write
   (`crates/clan-sdk/src/pack.rs`, `jsonschema::validator_for`) and repacks the
   archive. ajv here is 2 ms and integrity 0.2 ms. The store keeps the merged
   result instead of re-reading data.yaml (that saved about 110 ms a write).
   Caching the compiled validator in clan-sdk is the follow-up
   (`spike/write-cost.spike.ts` measures it).
