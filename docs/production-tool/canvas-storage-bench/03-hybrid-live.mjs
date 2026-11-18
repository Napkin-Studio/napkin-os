// 03 (part 1): HYBRID live stream. With the G3 scene loaded in a Y.Doc, the
// update one person's edit makes, and what it costs a peer to apply it:
//   - a finished stroke committed once (the own-engine model: one record per stroke)
//   - a stroke re-committed every 5 points while drawing (12 sets for 60 points)
//   - a move of one element, a move of 50 elements (marquee drag commit)
// plus the doc growth those edits leave behind (tombstones), gc on.
import * as Y from 'yjs'
import { generateScene, quantize, toYDoc, writeEl, makeStroke, rng, med, pct, now } from './lib.mjs'

const recs = generateScene(1).map(quantize)
const A = toYDoc(recs)
const B = new Y.Doc(); Y.applyUpdate(B, Y.encodeStateAsUpdate(A))
const am = A.getMap('elements')
let last = null
A.on('update', (u) => { last = u })
const r = rng(7)

function measure(label, n, fn) {
  const sizes = [], encodeT = [], applyT = []
  for (let i = 0; i < n; i++) {
    const t0 = now(); fn(i); const t1 = now()
    const u = last; sizes.push(u.length); encodeT.push(t1 - t0)
    const t2 = now(); Y.applyUpdate(B, u, 'remote'); applyT.push(now() - t2)
  }
  console.log(`${label.padEnd(44)} update median ${med(sizes)} B (p90 ${pct(sizes, 0.9)}) | local tx ${med(encodeT).toFixed(3)} ms | peer apply median ${med(applyT).toFixed(3)} ms p90 ${pct(applyT, 0.9).toFixed(3)} ms`)
  return { label, size_med: med(sizes), size_p90: pct(sizes, 0.9), tx_med: med(encodeT), apply_med: med(applyT), apply_p90: pct(applyT, 0.9) }
}
const size0 = Y.encodeStateAsUpdate(A).length
const out = []
out.push(measure('finished stroke, one commit (60 pts, quant)', 300, (i) => {
  const s = quantize(makeStroke(r, 200000 + i)); A.transact(() => writeEl(am, s.id, s), 'local')
}))
out.push(measure('finished stroke, one commit (60 pts, float)', 300, (i) => {
  const s = makeStroke(r, 210000 + i); A.transact(() => writeEl(am, s.id, s), 'local')
}))
const after1 = Y.encodeStateAsUpdate(A).length
// a stroke re-set every 5 points while drawing
const prog = []
for (let i = 0; i < 100; i++) {
  const s = quantize(makeStroke(r, 300000 + i))
  for (let k = 15; k <= s.points.length; k += 15) {
    const part = { ...s, points: s.points.slice(0, k) }
    const t0 = now(); A.transact(() => writeEl(am, s.id, part), 'local'); const t1 = now()
    prog.push(last.length)
    Y.applyUpdate(B, last, 'remote')
  }
}
console.log(`${'in-progress stroke, re-set every 5 pts'.padEnd(44)} update median ${med(prog)} B (sum per stroke ≈ ${Math.round(prog.reduce((a, b) => a + b, 0) / 100)} B)`)
const after2 = Y.encodeStateAsUpdate(A).length
const ids = [...am.keys()]
out.push(measure('move 1 element', 300, () => {
  const id = ids[Math.floor(r.next() * ids.length)]; const el = am.get(id).get('el')
  A.transact(() => writeEl(am, id, { ...el, x: el.x + 3 }), 'local')
}))
out.push(measure('move 50 elements (one drag commit)', 100, () => {
  A.transact(() => { for (let j = 0; j < 50; j++) { const id = ids[Math.floor(r.next() * ids.length)]; const el = am.get(id).get('el'); writeEl(am, id, { ...el, x: el.x + 3 }) } }, 'local')
}))
const after3 = Y.encodeStateAsUpdate(A).length
console.log(`\nY state size: G3 ${size0} B; +600 committed strokes ${after1} B (+${after1 - size0}); +100 strokes drawn with 12 re-sets each ${after2} B (+${after2 - after1}); +300 single moves +100x50 moves ${after3} B (+${after3 - after2} for 5,300 moves = ${((after3 - after2) / 5300).toFixed(1)} B/move left behind)`)
console.log('JSON:' + JSON.stringify({ out, size0, after1, after2, after3 }))
