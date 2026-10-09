# production-tool/clan-store

The Production Tool document as a real `.clan`: napkin-wasm (the same
`napkin-host` and `clan-sdk` the desktop and the server run) behind the
`DocumentStore` interface the ui lane also implements with its JSON store.

- Every write is `handle('/patch-data')` with the participant's handle as the
  agent, so the SDK records it in the decision chain with the exact keys it
  changed.
- Before it reaches the host, the merged result is validated with ajv against
  `production-tool/contracts/document.schema.json` as written (the three
  schema files, cross-file `$ref`s and all). An invalid patch throws
  `InvalidDocument` and the document is left exactly as it was.
- The `.clan` carries the same contract, bundled into one self-contained
  schema (`scripts/bundle-schema.mjs`), as `agent/output-schema.json`, so the
  SDK refuses an invalid write too, and `clan read agent` shows it.
- Verdicts (accept, reject, select) are pinned decision-chain entries with the
  action `<kind> <target.kind> <target.id>` and the note as the rationale.
  They change no data.
- The bytes are saved to IndexedDB 300 ms after the last write, and restored
  with `load()`. Storage that is missing or blocked is skipped silently.

## Use it from production-tool/web

```ts
import { ClanDocumentStore, buildExportZip, postClanMirror } from '../../clan-store/src'

const store = new ClanDocumentStore()             // IndexedDB, 300 ms debounce
const doc = (await store.load()) ?? (await store.create({ participant: { id, handle } }))
const off = store.onChange(d => render(d))

await store.patch({ stage: { current: 'storyboard' } }, { action: 'locked the character' })
await store.verdict({ kind: 'accept', target: { kind: 'take', id: takeId }, note: 'good light' })

const bytes = await store.exportClan()            // the .clan
const { zip, missing } = await buildExportZip({ clan: bytes, doc: store.get(), resolve: assetBytesFromIdbOrS3 })

addEventListener('pagehide', () => void store.flush())
```

Import the TypeScript source, as `app/` does with its own modules. Vite
resolves the JSON schema imports and the `napkin_wasm_bg.wasm` URL beside the
glue. In node, pass the bytes: `new ClanDocumentStore({ wasm: bytes })`.

Writes are serialised. `patch()` replaces arrays, as RFC 7396 does, so to add
one job send the whole `jobs` list. `get()` returns what the SDK stored,
read back from `shared/data.yaml`.

Beyond the interface: `open(bytes)` (an import), `chain()` (the decision chain,
newest first), `flush()`, `startMirror()`/`stopMirror()`/`mirrorNow()`, and
`dispose()`.

## Who did what: three kinds of author

`patch(mp, why)` records the participant's handle unless `why.agent` names
someone else; `why.pinned` pins the entry (locks, verdicts) and `why.quiet`
writes the data with no entry (bookkeeping: a job's state, an asset list).
`record({agent, action, rationale}, {once: true})` writes a decision that
changes no data, once per agent and action.

`recordJobOutcome(store, job)` (src/attribution.ts) writes, for a job in a
terminal state, the director's entry (`director · <model> · <promptVersion>`:
its rationale, the refs it used as what, the prompt it wrote, abbreviated)
and the provider's (`<provider> · <model>`: cost confirmed, time, output
sha256, or the error code). Both name the job id in the action, so they are
written once however often the job is seen. production-tool/web calls it as
each job lands (web/src/doc/clan.ts).

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
