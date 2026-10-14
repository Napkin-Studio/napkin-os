// 02: INSIDE, through napkin-wasm in node (the same host the Production Tool's
// clan-store runs in the browser). 50 checkpoints of a growing scene:
//   (a) data member: shared/data.yaml `canvas` (a merge patch of the changed records)
//   (b) asset: human/assets/canvas.ybin = zstd(Y.encodeStateAsUpdate), quiet (no decision)
//   (c) asset, as (b) but every checkpoint records a decision
// per checkpoint: write time, download() time (the bytes IndexedDB / the mirror get), .clan size,
// decision-chain size; then open/hydrate time of the final file.
import * as Y from 'yjs'
import zlib from 'node:zlib'
import { CLAN_STORE, wasmHost, route, json, appSchema, generateScene, quantize, toYDoc, writeEl, readAll, makeStroke, rng, time, med, pct, kb, ms, now } from './lib.mjs'
const { parse: parseYaml } = await import(`${CLAN_STORE}/node_modules/yaml/dist/index.js`)

const CHECKPOINTS = +(process.env.CHECKPOINTS ?? 50)
const QUANT = process.env.QUANT !== '0'
const zs = (b) => zlib.zstdCompressSync(b, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })
const unzs = (b) => zlib.zstdDecompressSync(b)

const MAPS = appSchema().required.filter((k) => !['contract_version', 'app', 'project', 'assets'].includes(k))
async function freshProject() {
  const h = await wasmHost()
  h.newDocument('production-tool', 'Bench')
  const data = { contract_version: '3', app: 'production-tool',
    project: { id: 'proj_01JBENCH00000000000000000A', tenant_id: '00000000-0000-4000-8000-000000000000', title: 'Bench', created_by: 'human:bench', created_at: '2026-10-14T00:00:00Z' },
    assets: {}, ...Object.fromEntries(MAPS.map((m) => [m, {}])) }
  route(h, '/patch-data', { patch: data, agent: 'human:bench', action: 'start the project' })
  const schema = appSchema()
  schema.properties.canvas = { type: 'object' } // a contract change the data-member path would need
  route(h, '/patch-schema', schema)
  return h
}
const entrySize = (h, p) => { try { return Buffer.byteLength(h.entry(p)) } catch { return 0 } }
const chainCount = (h) => (json(route(h, '/chain')).decisions ?? []).length

// The edit stream between checkpoints: 20 new strokes, 30 moves (≈ a few seconds of busy drawing).
function edits(recs, r, k) {
  const changed = []
  for (let i = 0; i < 20; i++) {
    let s = makeStroke(r, 100000 + k * 20 + i, null, 60, 'b' + k + '_' + i)
    if (QUANT) s = quantize(s)
    recs.set(s.id, s); changed.push(s)
  }
  const ids = [...recs.keys()]
  for (let i = 0; i < 30; i++) {
    const id = ids[Math.floor(r.next() * ids.length)]
    const m = { ...recs.get(id), x: recs.get(id).x + 5, y: recs.get(id).y - 3 }
    recs.set(id, m); changed.push(m)
  }
  return changed
}

const base = generateScene(1).map((x) => (QUANT ? quantize(x) : x))
const results = {}

for (const mode of ['data-member', 'asset-quiet', 'asset-decision']) {
  const h = await freshProject()
  const recs = new Map(base.map((x) => [x.id, x]))
  const ydoc = toYDoc(base)
  const ymap = ydoc.getMap('elements')
  const r = rng(42)
  const rows = []
  for (let k = 0; k <= CHECKPOINTS; k++) {
    let changed = k === 0 ? base : edits(recs, r, k)
    if (k > 0) ydoc.transact(() => { for (const c of changed) writeEl(ymap, c.id, c) }, 'local')
    const t0 = now()
    let encodeMs = 0, compressMs = 0, payload = 0
    if (mode === 'data-member') {
      const patch = { canvas: { elements: Object.fromEntries(changed.map((c) => [c.id, c])) } }
      const body = new TextEncoder().encode(JSON.stringify({ patch, agent: 'human:bench', action: `canvas checkpoint ${k}` }))
      payload = body.length
      route(h, '/patch-data', body)
    } else {
      let u; [encodeMs, u] = time(() => Y.encodeStateAsUpdate(ydoc))
      let z; [compressMs, z] = time(() => zs(u))
      payload = z.length
      const q = mode === 'asset-decision' ? 'name=canvas.ybin.zst&agent=human%3Abench' : 'name=canvas.ybin.zst'
      route(h, '/upload-asset', z, q)
    }
    const writeMs = now() - t0
    const [dlMs, bytes] = time(() => h.download())
    rows.push({ k, writeMs, encodeMs, compressMs, dlMs, payload, clan: bytes.length,
      data: entrySize(h, 'shared/data.yaml'), chainBytes: entrySize(h, 'agent/decision-chain.yaml') })
    if (k === CHECKPOINTS) results[mode + ':bytes'] = bytes
  }
  const steady = rows.slice(1)
  const chain = chainCount(h)
  results[mode] = {
    first: rows[0],
    steady_write_med: med(steady.map((x) => x.writeMs)), steady_write_p90: pct(steady.map((x) => x.writeMs), 0.9),
    steady_dl_med: med(steady.map((x) => x.dlMs)),
    encode_med: med(steady.map((x) => x.encodeMs)), compress_med: med(steady.map((x) => x.compressMs)),
    payload_med: med(steady.map((x) => x.payload)),
    size_first: rows[0].clan, size_last: rows.at(-1).clan, data_last: rows.at(-1).data,
    chain_first: rows[0].chainBytes, chain_last: rows.at(-1).chainBytes, chain_entries: chain,
    last_write: rows.at(-1).writeMs,
  }
  h.free()
}

// Open / hydrate the final files (median of 5)
function openRuns(fn, n = 5) { const ts = []; for (let i = 0; i < n; i++) { const t = now(); fn(); ts.push(now() - t) } return med(ts) }
const H = await wasmHost()
results.open = {
  data_member: openRuns(() => {
    const h = H; h.upload(results['data-member:bytes'], 'bench-open')
    const d = parseYaml(h.entry('shared/data.yaml')); return Object.keys(d.canvas.elements).length
  }),
  data_member_upload_only: openRuns(() => H.upload(results['data-member:bytes'], 'bench-open')),
  asset: openRuns(() => {
    const h = H; h.upload(results['asset-quiet:bytes'], 'bench-open2')
    const z = route(h, '/assets/canvas.ybin.zst', new Uint8Array(), '')
    const d = new Y.Doc(); Y.applyUpdate(d, unzs(z)); return readAll(d).length
  }),
  asset_upload_only: openRuns(() => H.upload(results['asset-quiet:bytes'], 'bench-open2')),
  asset_route_only: openRuns(() => route(H, '/assets/canvas.ybin.zst', new Uint8Array(), '')),
  data_entry_only: (H.upload(results['data-member:bytes'], 'bench-open'), openRuns(() => H.entry('shared/data.yaml'))),
  data_yaml_parse_only: (() => { const t = H.entry('shared/data.yaml'); return openRuns(() => parseYaml(t)) })(),
}

const out = {}
for (const m of ['data-member', 'asset-quiet', 'asset-decision']) {
  const x = results[m]
  out[m] = x
  console.log(`\n## ${m} (quantised=${QUANT}, ${CHECKPOINTS} checkpoints of +20 strokes/+30 moves)`)
  console.log(`first checkpoint (whole scene): write ${ms(x.first.writeMs)} (encode ${ms(x.first.encodeMs)}, zstd ${ms(x.first.compressMs)}) download ${ms(x.first.dlMs)} payload ${kb(x.first.payload)} .clan ${kb(x.first.clan)}`)
  console.log(`steady checkpoint: write median ${ms(x.steady_write_med)} p90 ${ms(x.steady_write_p90)} (encode ${ms(x.encode_med)}, zstd ${ms(x.compress_med)}) download median ${ms(x.steady_dl_med)} payload ${kb(x.payload_med)}`)
  console.log(`.clan size: ${kb(x.size_first)} -> ${kb(x.size_last)}; data.yaml last ${kb(x.data_last)}; decision-chain.yaml ${kb(x.chain_first)} -> ${kb(x.chain_last)} (${x.chain_entries} entries)`)
}
console.log('\n## open (median of 5)')
for (const [k, v] of Object.entries(results.open)) console.log(`${k}: ${ms(v)}`)
console.log('\nJSON:' + JSON.stringify({ out, open: results.open }))
