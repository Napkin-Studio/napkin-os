// Variants of the Y scene shape for the same G3 scene (see ybench.mjs).
//  A  spike   : entry Y.Map {el: whole JSON incl. points (float numbers)}         (Spike O today)
//  B  split   : entry Y.Map {el: props only, pts: Uint8Array (Int16 0.1px, pressure u8)}  (move rewrites el only)
// Each with: no UndoManager; UndoManager + stopCapturing per op (one step per op, as Spike O does).
import * as Y from 'yjs'
import { deflateSync } from 'fflate'
const src = await import('./scene.mjs')
const { recs } = src
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
function pack(points) { // [dx,dy,p]* -> Int16 dx,dy (0.1 px) + u8 p
  const n = points.length / 3, b = new ArrayBuffer(n * 5), v = new DataView(b)
  for (let i = 0; i < n; i++) { v.setInt16(i * 5, Math.round(points[i * 3] * 10), true); v.setInt16(i * 5 + 2, Math.round(points[i * 3 + 1] * 10), true); v.setUint8(i * 5 + 4, Math.round(points[i * 3 + 2] * 255)) }
  return new Uint8Array(b)
}
function write(map, id, el, shape) {
  let e = map.get(id)
  if (!(e instanceof Y.Map)) { e = new Y.Map(); map.set(id, e) }
  if (shape === 'B' && el.points) { const { points, ...rest } = el; if (!e.has('pts')) e.set('pts', pack(points)); e.set('el', rest) } else e.set('el', el)
}
for (const shape of ['A', 'B']) for (const undo of [false, true]) {
  const doc = new Y.Doc(); const map = doc.getMap('elements')
  const um = undo ? new Y.UndoManager(map, { trackedOrigins: new Set(['local']), captureTimeout: 2 ** 31 - 1 }) : null
  doc.transact(() => { for (const r of recs) write(map, r.id, r, shape) }, 'system')
  const u0 = Y.encodeStateAsUpdate(doc)
  const loads = []; for (let i = 0; i < 5; i++) { const d = new Y.Doc(); const a = performance.now(); Y.applyUpdate(d, u0); loads.push(performance.now() - a) }
  const enc = []; for (let i = 0; i < 5; i++) { const a = performance.now(); Y.encodeStateAsUpdate(doc); enc.push(performance.now() - a) }
  const moves = []; let on = false; doc.on('update', (u) => on && moves.push(u.length))
  on = true
  for (let i = 0; i < 2000; i++) { const id = recs[(i * 7919) % recs.length].id; const el = { ...map.get(id).get('el'), x: i, y: i }; um?.stopCapturing(); doc.transact(() => write(map, id, el, shape), 'local') }
  on = false
  const u1 = Y.encodeStateAsUpdate(doc)
  for (let i = 0; i < 20000; i++) { const id = recs[(i * 7919) % recs.length].id; const el = { ...map.get(id).get('el'), x: i }; um?.stopCapturing(); doc.transact(() => write(map, id, el, shape), 'local') }
  const u2 = Y.encodeStateAsUpdate(doc)
  console.log(`${shape} undo=${undo}: state ${kb(u0.length)} raw / ${kb(deflateSync(u0).length)} defl; load ${med(loads).toFixed(0)} ms, encode ${med(enc).toFixed(0)} ms; move update median ${med(moves)} B; +2k moves ${kb(u1.length)}; +22k moves ${kb(u2.length)} raw / ${kb(deflateSync(u2).length)} defl; undo steps ${um?.undoStack.length ?? '-'}`)
}
