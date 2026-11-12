// Storage bench for the G3 scene in Spike O's Y shape (harness/src/yscene.ts, wrapped):
// 10 boards, 300 previews, 5,000 strokes (30-90 pts, mean 60), 500 nodes.
// Sizes: Y update (raw, deflate), JSON (canvas.json analogue); times: encode, load;
// growth after a session of moves/draws/deletes, with gc on and off.
import * as Y from 'yjs'
import { deflateSync } from 'fflate'

let s = 1
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const range = (a, b) => a + rnd() * (b - a)
const r1 = (x) => Math.round(x * 10) / 10
const r2 = (x) => Math.round(x * 100) / 100
const INK = ['#1e1e1e', '#2f3b52', '#a33b2b', '#235f3b', '#6b3fa0']
const KINDS = ['script', 'storyboard', 'video', 'character', 'location', 'reference', 'note', 'product']

function zkey(i) { return 'a' + i.toString(36).padStart(4, '0') } // fractional-index-shaped
function scene() {
  const out = []
  let z = 0
  for (let i = 0; i < 10; i++) out.push({ id: `b${i}`, typeName: 'shape', kind: 'board', x: (i % 5) * 3600, y: Math.floor(i / 5) * 2200, w: 3200, h: 1800, z: zkey(z++), deleted: false, name: `Board ${i + 1}` })
  for (let i = 0; i < 300; i++) out.push({ id: `p${i}`, typeName: 'shape', kind: 'preview', x: r1(range(0, 18000)), y: r1(range(0, 4000)), w: 480, h: 270, z: zkey(z++), deleted: false, image: i, customData: { kind: 'pic', id: `node_01K6XA7Q3M9V2D4R8T0B${String(i).padStart(6, '0')}`, asset: `sha256:${i.toString(16).padStart(64, '0')}` } })
  let pts = 0
  for (let i = 0; i < 5000; i++) {
    const n = Math.max(2, Math.round(60 + range(-0.5, 0.5) * 60))
    pts += n
    const p = []
    let px = 0, py = 0, h = range(0, 6.28)
    for (let k = 0; k < n; k++) { p.push(r1(px), r1(py), r2(0.35 + 0.5 * Math.abs(Math.sin(k / 9 + i)))); h += range(-0.35, 0.35); const st = range(3, 9); px += Math.cos(h) * st; py += Math.sin(h) * st }
    out.push({ id: `s${i}`, typeName: 'shape', kind: 'stroke', x: r1(range(0, 18000)), y: r1(range(0, 4000)), w: 200, h: 200, z: zkey(z++), deleted: false, points: p, size: 2 + Math.floor(rnd() * 5), color: INK[i % 5] })
  }
  for (let i = 0; i < 500; i++) out.push({ id: `n${i}`, typeName: 'shape', kind: 'node', x: r1(range(0, 18000)), y: r1(range(0, 4000)), w: 280, h: 180, z: zkey(z++), deleted: false, nodeKind: KINDS[i % 8], label: `${KINDS[i % 8]} ${i}`, customData: { kind: KINDS[i % 8], id: `shot_01K6XA7Q3M9V2D4R8T0B${String(i).padStart(6, '0')}` } })
  return { out, pts }
}

function writeEl(map, id, el) {
  const e = map.get(id)
  if (e instanceof Y.Map) { e.set('el', el); return }
  const m = new Y.Map(); m.set('el', el); map.set(id, m)
}

const t = (f) => { const a = performance.now(); const v = f(); return [v, performance.now() - a] }
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const { out: recs, pts } = scene()
console.log(`records ${recs.length}, stroke points ${pts}`)
const json = JSON.stringify(recs)
const [jd, jdMs] = t(() => deflateSync(new TextEncoder().encode(json), { level: 6 }))
console.log(`JSON (canvas.json analogue): ${kb(json.length)} raw, ${kb(jd.length)} deflated (${jdMs.toFixed(0)} ms)`)
const [, jpMs] = t(() => JSON.parse(json))
console.log(`JSON.parse: ${jpMs.toFixed(1)} ms`)

for (const gc of [true, false]) {
  console.log(`\n== Y.Doc gc=${gc}`)
  const doc = new Y.Doc({ gc })
  const map = doc.getMap('elements')
  const um = new Y.UndoManager(map, { trackedOrigins: new Set(['local']), captureTimeout: 2 ** 31 - 1 })
  const [, seedMs] = t(() => doc.transact(() => { for (const r of recs) writeEl(map, r.id, r) }, 'system'))
  const [u0, encMs] = t(() => Y.encodeStateAsUpdate(doc))
  const [d0, defMs] = t(() => deflateSync(u0, { level: 6 }))
  console.log(`seed ${seedMs.toFixed(0)} ms; state ${kb(u0.length)} raw / ${kb(d0.length)} deflated; encode ${encMs.toFixed(0)} ms, deflate ${defMs.toFixed(0)} ms`)
  const loads = []
  for (let i = 0; i < 5; i++) { const d2 = new Y.Doc(); const [, ms] = t(() => Y.applyUpdate(d2, u0)); loads.push(ms) }
  console.log(`load (applyUpdate into empty doc): median ${med(loads).toFixed(0)} ms`)
  const [, readMs] = t(() => { const a = []; map.forEach((v) => a.push(v.get('el'))); return a })
  console.log(`read all els: ${readMs.toFixed(1)} ms`)

  // one-stroke incremental update and one-move update sizes
  const sizes = { draw: [], move: [] }
  let cur = null
  doc.on('update', (u) => { if (cur) sizes[cur].push(u.length) })
  // session: 2,000 moves (gesture: 20 moves of each of 100 elements = drag frames), 500 new strokes, 200 deletes
  const moveMs = []
  cur = 'move'
  for (let i = 0; i < 2000; i++) {
    const id = recs[(i * 7919) % recs.length].id
    const el = { ...map.get(id).get('el'), x: i, y: i }
    const [, ms] = t(() => doc.transact(() => writeEl(map, id, el), 'local'))
    moveMs.push(ms)
  }
  cur = 'draw'
  const drawMs = []
  for (let i = 0; i < 500; i++) {
    const r = { ...recs[310 + i], id: `new${i}`, z: zkey(99999 + i) }
    const [, ms] = t(() => doc.transact(() => writeEl(map, r.id, r), 'local'))
    drawMs.push(ms)
  }
  cur = null
  doc.transact(() => { for (let i = 0; i < 200; i++) map.delete(`s${i}`) }, 'local')
  console.log(`per-op update bytes: move median ${med(sizes.move)} B, new stroke median ${med(sizes.draw)} B; transact move median ${med(moveMs).toFixed(3)} ms, draw ${med(drawMs).toFixed(3)} ms`)
  const u1 = Y.encodeStateAsUpdate(doc)
  console.log(`after session (2,000 moves, +500 strokes, -200): state ${kb(u1.length)} raw / ${kb(deflateSync(u1, { level: 6 }).length)} deflated; undo stack ${um.undoStack.length}`)
  // 20,000 more moves (a long day of dragging)
  for (let i = 0; i < 20000; i++) { const id = recs[200 + ((i * 7919) % (recs.length - 200))].id; const e = map.get(id); if (!e) continue; doc.transact(() => writeEl(map, id, { ...e.get('el'), x: i }), 'local') }
  const u2 = Y.encodeStateAsUpdate(doc)
  console.log(`after +20,000 moves: state ${kb(u2.length)} raw / ${kb(deflateSync(u2, { level: 6 }).length)} deflated`)
  um.destroy()
  // compaction: rebuild a fresh doc from current JSON (drops history; what a checkpoint could store)
  const fresh = new Y.Doc(); const fm = fresh.getMap('elements')
  fresh.transact(() => map.forEach((v, k) => writeEl(fm, k, v.get('el'))))
  const u3 = Y.encodeStateAsUpdate(fresh)
  console.log(`compacted (fresh doc from current state): ${kb(u3.length)} raw / ${kb(deflateSync(u3, { level: 6 }).length)} deflated`)
}
