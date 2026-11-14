// 05: INSIDE through the native `clan` CLI (what a server / desktop checkpoint
// would call): `clan patch-asset` of the Y checkpoint, quiet and with a decision,
// and `clan patch-data` of a changed-records merge patch into a `canvas` member.
// Process spawn included (that is what the CLI path costs). Also the cost of the
// same checkpoint when the 300 previews (≈30 KB each, incompressible, as WebP is)
// are inside the .clan too: every write re-deflates every entry.
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, copyFileSync, statSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import * as Y from 'yjs'
import zlib from 'node:zlib'
import { generateScene, quantize, toYDoc, writeEl, makeStroke, rng, wasmHost, route, appSchema, med, pct, now } from './lib.mjs'

const CLAN = process.env.CLAN ?? 'clan'
const OUT = new URL('./out/cli/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const N = +(process.env.CHECKPOINTS ?? 20)
const zs = (b) => zlib.zstdCompressSync(b, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })
const env = { ...process.env, CLAN_NO_HINTS: '1' }
function clan(args) {
  const t = now(); const p = spawnSync(CLAN, args, { env, encoding: 'utf8' }); const d = now() - t
  if (p.status !== 0) throw new Error(`clan ${args.slice(0, 2).join(' ')}: ${p.stderr || p.stdout}`)
  return d
}
const size = (f) => statSync(f).size

// a valid contract-3 document from the wasm host, then the canvas schema
const MAPS = appSchema().required.filter((k) => !['contract_version', 'app', 'project', 'assets'].includes(k))
const h = await wasmHost(); h.newDocument('production-tool', 'Bench')
route(h, '/patch-data', { patch: { contract_version: '3', app: 'production-tool',
  project: { id: 'proj_01JBENCH00000000000000000A', tenant_id: '00000000-0000-4000-8000-000000000000', title: 'Bench', created_by: 'human:bench', created_at: '2026-10-14T00:00:00Z' },
  assets: {}, ...Object.fromEntries(MAPS.map((m) => [m, {}])) }, agent: 'human:bench', action: 'start' })
const schema = appSchema(); schema.properties.canvas = { type: 'object' }
route(h, '/patch-schema', schema)
const START = `${OUT}start.clan`
writeFileSync(START, h.download())
console.log(`clan ${spawnSync(CLAN, ['--version'], { encoding: 'utf8' }).stdout.trim()}; start .clan ${size(START)} B`)

const base = generateScene(1).map(quantize)
function session(kind, startFile) {
  const f = `${OUT}${kind}.clan`; copyFileSync(startFile, f)
  const doc = toYDoc(base); const map = doc.getMap('elements'); const r = rng(42)
  const ts = []; const sizes = []
  for (let k = 0; k <= N; k++) {
    let changed = base
    if (k > 0) {
      changed = []
      for (let i = 0; i < 20; i++) { const s = quantize(makeStroke(r, 100000 + k * 20 + i)); changed.push(s) }
      const ids = [...map.keys()]
      for (let i = 0; i < 30; i++) { const id = ids[Math.floor(r.next() * ids.length)]; const el = map.get(id).get('el'); changed.push({ ...el, x: el.x + 5 }) }
      doc.transact(() => { for (const c of changed) writeEl(map, c.id, c) }, 'local')
    }
    let d
    if (kind.startsWith('asset')) {
      const t = now()
      writeFileSync(`${OUT}cp.bin`, zs(Y.encodeStateAsUpdate(doc)))
      const prep = now() - t
      d = prep + clan(['patch-asset', f, 'canvas.ybin.zst', `${OUT}cp.bin`, ...(kind === 'asset-decision' ? ['--agent', 'human:bench', '--action', `canvas checkpoint ${k}`] : ['--no-decision'])])
    } else {
      const t = now()
      writeFileSync(`${OUT}cp.json`, JSON.stringify({ canvas: { elements: Object.fromEntries(changed.map((c) => [c.id, c])) } }))
      const prep = now() - t
      d = prep + clan(['patch-data', f, `${OUT}cp.json`, '--agent', 'human:bench', '--action', `canvas checkpoint ${k}`])
    }
    ts.push(d); sizes.push(size(f))
  }
  const steady = ts.slice(1)
  console.log(`${kind.padEnd(26)} first ${ts[0].toFixed(0)} ms | steady median ${med(steady).toFixed(0)} ms p90 ${pct(steady, 0.9).toFixed(0)} ms | .clan ${(sizes[0] / 1024).toFixed(0)} KB -> ${(sizes.at(-1) / 1024).toFixed(0)} KB after ${N}`)
  return { kind, first: ts[0], steady_med: med(steady), steady_p90: pct(steady, 0.9), size0: sizes[0], sizeN: sizes.at(-1) }
}
const res = []
res.push(session('asset-quiet', START))
res.push(session('asset-decision', START))
if (!process.env.SKIP_DATA) res.push(session('data-member', START))

// previews inside: put 300 x ~30 KB incompressible blobs into human/assets/, then checkpoint
const WITHP = `${OUT}with-previews.clan`; copyFileSync(START, WITHP)
{
  const h2 = await wasmHost(); h2.upload(readFileSync(START), 'p')
  const t = now()
  for (let i = 0; i < 300; i++) route(h2, '/upload-asset', randomBytes(24000 + (i * 97) % 12000), `name=p${i}.webp`)
  console.log(`300 previews uploaded into the .clan through wasm in ${(now() - t).toFixed(0)} ms total (each upload repacks the archive)`)
  writeFileSync(WITHP, h2.download())
  console.log(`.clan with previews: ${(size(WITHP) / 1048576).toFixed(2)} MB`)
}
res.push(session('asset-quiet+previews', WITHP))
console.log('JSON:' + JSON.stringify(res))
