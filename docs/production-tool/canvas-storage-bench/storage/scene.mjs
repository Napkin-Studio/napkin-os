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


export const { out: recs, pts } = scene()
