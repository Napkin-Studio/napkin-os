// Prior-art bench: (a) Yjs update log vs compacted snapshot for a canvas session
// (drags = many small updates, the y-indexeddb / Hocuspocus pattern);
// (b) Excalidraw-style inline base64 media vs referenced media: JSON size + full
// re-serialize cost per save; (c) ZIP (OpenDocument-style) whole-archive rewrite cost.
import * as Y from '../node_modules/yjs/dist/yjs.mjs'
import { performance } from 'node:perf_hooks'
import { randomBytes } from 'node:crypto'
const fflate = await import('/home/batunii/Documents/Code/napkin-studio-production-tool/production-tool/web/node_modules/fflate/esm/index.mjs')
const t = (f) => { const s = performance.now(); const r = f(); return [performance.now() - s, r] }
const kb = (n) => (n / 1024).toFixed(1) + ' KiB'

// (a)
for (const gc of [true, false]) {
  const doc = new Y.Doc({ gc }); const log = []
  doc.on('update', (u) => log.push(u))
  const shapes = doc.getMap('shapes')
  doc.transact(() => { for (let i = 0; i < 1000; i++) { const m = new Y.Map(); m.set('x', i * 10); m.set('y', i * 5); m.set('w', 280); m.set('h', 180); m.set('kind', 'shot'); shapes.set('s' + i, m) } })
  const base = Y.encodeStateAsUpdate(doc).length
  // 200 drags x 30 pointermove frames, each one transaction (one update)
  for (let d = 0; d < 200; d++) { const m = shapes.get('s' + (d * 7 % 1000)); for (let f = 0; f < 30; f++) doc.transact(() => { m.set('x', m.get('x') + 1); m.set('y', m.get('y') + 1) }) }
  // 5000-point stroke appended as one Y.Array of numbers per stroke, 50 strokes
  const ink = doc.getArray('ink'); for (let s = 0; s < 50; s++) doc.transact(() => { const a = new Y.Array(); a.push(Array.from({ length: 180 }, (_, i) => Math.round(i * 1.3))); ink.push([a]) })
  // delete 300 shapes
  doc.transact(() => { for (let i = 0; i < 300; i++) shapes.delete('s' + i) })
  const logBytes = log.reduce((a, u) => a + u.length, 0)
  const [tm, merged] = t(() => Y.mergeUpdates(log))
  const [te, snap] = t(() => Y.encodeStateAsUpdate(doc))
  const [tl, _] = t(() => { const d2 = new Y.Doc(); Y.applyUpdate(d2, snap); return d2 })
  const [tr, __] = t(() => { const d2 = new Y.Doc(); for (const u of log) Y.applyUpdate(d2, u); return d2 })
  console.log(`(a) gc=${gc}: base=${kb(base)} updates=${log.length} logBytes=${kb(logBytes)} mergeUpdates=${kb(merged.length)} in ${tm.toFixed(1)}ms; snapshot(encodeStateAsUpdate)=${kb(snap.length)} in ${te.toFixed(1)}ms; load snapshot ${tl.toFixed(1)}ms; replay log ${tr.toFixed(1)}ms`)
}

// (b) 20 previews of 300 KiB each (JPEG-like random bytes), 500 shapes
const shapes = Array.from({ length: 500 }, (_, i) => ({ id: 's' + i, type: 'shot', x: i, y: i, w: 280, h: 180, version: 1, versionNonce: i }))
const media = Array.from({ length: 20 }, () => randomBytes(300 * 1024))
const inline = { type: 'excalidraw', elements: shapes, files: Object.fromEntries(media.map((b, i) => ['f' + i, { mimeType: 'image/jpeg', dataURL: 'data:image/jpeg;base64,' + b.toString('base64') }])) }
const ref = { type: 'excalidraw', elements: shapes, files: Object.fromEntries(media.map((_, i) => ['f' + i, { mimeType: 'image/jpeg', path: `media/f${i}.jpg` }])) }
for (const [name, o] of [['inline-base64', inline], ['referenced', ref]]) {
  const runs = []; let s; for (let k = 0; k < 7; k++) { const [ms, out] = t(() => JSON.stringify(o)); runs.push(ms); s = out }
  const [pm] = t(() => JSON.parse(s)); runs.sort((a, b) => a - b)
  console.log(`(b) ${name}: json=${kb(s.length)} stringify median=${runs[3].toFixed(1)}ms parse=${pm.toFixed(1)}ms (media raw total ${kb(media.reduce((a, b) => a + b.length, 0))})`)
}

// (c) ZIP container: change one shape, must rewrite whole archive (fflate zipSync, media STORED)
const files = { 'scene.json': [new TextEncoder().encode(JSON.stringify(ref)), { level: 6 }] }
media.forEach((b, i) => { files[`media/f${i}.jpg`] = [b, { level: 0 }] })
const runs = []; let z; for (let k = 0; k < 7; k++) { const [ms, out] = t(() => fflate.zipSync(files)); runs.push(ms); z = out } runs.sort((a, b) => a - b)
const sceneOnly = t(() => fflate.zipSync({ 'scene.json': files['scene.json'] }))
console.log(`(c) zip whole rewrite: ${kb(z.length)} median ${runs[3].toFixed(1)}ms; scene-only part ${kb(sceneOnly[1].length)} in ${sceneOnly[0].toFixed(1)}ms`)
