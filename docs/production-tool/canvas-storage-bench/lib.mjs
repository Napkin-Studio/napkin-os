// Shared helpers: the G3 scene (port of production-tool/spikes/harness/src/scene.ts
// on spike/canvas-own-engine), its Y shape (harness/src/yscene.ts, "wrapped"),
// the napkin-wasm host loader, and timing stats.
import * as Y from 'yjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export const WT = '/home/batunii/Documents/Code/napkin-studio/.claude/worktrees/agent-a406e8e0186a18ce0'
export const CLAN_STORE = `${WT}/production-tool/clan-store`

// mulberry32, as harness/src/rng.ts (same family; exact stream not required)
export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
  }
}

export const G3 = { boards: 10, previews: 300, strokes: 5000, meanPoints: 60, nodes: 500, links: 300 }
const BOARD_W = 3200, BOARD_H = 1800, BOARD_GAP = 400, PW = 640, PH = 360, NODE_W = 280, NODE_H = 180
const INK = ['#1e1e1e', '#2f3b52', '#a33b2b', '#235f3b', '#6b3fa0']
const KINDS = ['shot', 'scene', 'beat', 'note', 'gen', 'video', 'sketch', 'box', 'ref', 'music']
const r1 = (n) => Math.round(n * 10) / 10
const r2 = (n) => Math.round(n * 100) / 100
const boardBox = (i) => ({ x: (i % 5) * (BOARD_W + BOARD_GAP), y: Math.floor(i / 5) * (BOARD_H + BOARD_GAP), w: BOARD_W, h: BOARD_H })
const zkey = (n) => 'a' + n.toString(36).padStart(5, '0') // fractional-index-like z

/** The scene as own-engine Shape records (model.ts): strokes carry flat [dx,dy,p,...]. */
export function generateScene(seed = 1, size = G3) {
  const r = rng(seed)
  let z = 0
  const recs = []
  const boards = []
  for (let i = 0; i < size.boards; i++) {
    const b = { id: `shape:b${i}`, typeName: 'shape', kind: 'board', name: `Board ${i + 1}`, ...boardBox(i), z: zkey(z++), deleted: false }
    boards.push(b); recs.push(b)
  }
  const perBoard = Math.ceil(size.previews / size.boards)
  for (let i = 0; i < size.previews; i++) {
    const b = boards[i % size.boards]
    const slot = Math.floor(i / size.boards) % perBoard
    const hash = 'sha256:' + createHash('sha256').update(`preview-${i}`).digest('hex')
    recs.push({
      id: `shape:p${i}`, typeName: 'shape', kind: 'preview', image: i, blob: hash, mime: 'image/webp', pw: PW, ph: PH,
      x: r1(b.x + 40 + (slot % 6) * (PW * 0.75 + 20) + r.range(-10, 10)),
      y: r1(b.y + 40 + Math.floor(slot / 6) * (PH * 0.75 + 20) + r.range(-10, 10)),
      w: PW * 0.75, h: PH * 0.75, z: zkey(z++), deleted: false,
    })
  }
  for (let i = 0; i < size.strokes; i++) recs.push(makeStroke(r, i, boards[i % size.boards], size.meanPoints, zkey(z++)))
  for (let i = 0; i < size.nodes; i++) {
    const b = boards[i % size.boards]
    const kind = KINDS[i % KINDS.length]
    recs.push({
      id: `shape:n${i}`, typeName: 'shape', kind: 'node', nodeKind: kind, label: `${kind} ${i}`, ref: `ent_${i.toString(36).padStart(8, '0')}`,
      x: r1(b.x + r.range(40, BOARD_W - NODE_W - 40)), y: r1(b.y + r.range(40, BOARD_H - NODE_H - 40)),
      w: NODE_W, h: NODE_H, z: zkey(z++), deleted: false,
    })
  }
  // link geometry (arrows between nodes): endpoints + a bend point
  for (let i = 0; i < size.links; i++) {
    const a = i % size.nodes, c = (i * 7 + 3) % size.nodes
    recs.push({ id: `shape:l${i}`, typeName: 'shape', kind: 'link', from: `shape:n${a}`, to: `shape:n${c}`, bend: r1(r.range(-80, 80)),
      x: 0, y: 0, w: 0, h: 0, z: zkey(z++), deleted: false })
  }
  return recs
}

export function makeStroke(r, i, b, meanPoints = 60, z = 'a0') {
  const n = Math.max(2, Math.round(meanPoints + r.range(-0.5, 0.5) * meanPoints))
  const pts = []
  let px = 0, py = 0, heading = r.range(0, Math.PI * 2)
  for (let k = 0; k < n; k++) {
    pts.push(r1(px), r1(py), r2(0.35 + 0.5 * Math.abs(Math.sin(k / 9 + i))))
    heading += r.range(-0.35, 0.35)
    const step = r.range(3, 9)
    px += Math.cos(heading) * step
    py += Math.sin(heading) * step
  }
  b ??= boardBox(0)
  return { id: `shape:s${i}`, typeName: 'shape', kind: 'stroke', x: r1(b.x + r.range(80, BOARD_W - 300)), y: r1(b.y + r.range(80, BOARD_H - 300)),
    w: 0, h: 0, points: pts, size: r.int(2, 6), color: r.pick(INK), z, deleted: false }
}

/** Quantised variant: points as integers (x10 for coords, x100 for pressure) so lib0 writes varints, not float64. */
export function quantize(rec) {
  if (!rec.points) return rec
  const q = new Array(rec.points.length)
  for (let i = 0; i < rec.points.length; i += 3) {
    q[i] = Math.round(rec.points[i] * 10); q[i + 1] = Math.round(rec.points[i + 1] * 10); q[i + 2] = Math.round(rec.points[i + 2] * 100)
  }
  return { ...rec, points: q, pq: 1 }
}

/** The own-engine Y shape: elements: Y.Map<id, Y.Map{el: JSON}>. */
export function writeEl(map, id, el) {
  const e = map.get(id)
  if (e instanceof Y.Map) { e.set('el', el); return }
  const m = new Y.Map(); m.set('el', el); map.set(id, m)
}
export function toYDoc(recs, { gc = true } = {}) {
  const doc = new Y.Doc({ gc })
  const map = doc.getMap('elements')
  doc.transact(() => { for (const r of recs) writeEl(map, r.id, r) }, 'system')
  return doc
}
export function readAll(doc) {
  const out = []
  doc.getMap('elements').forEach((v) => { const el = v instanceof Y.Map ? v.get('el') : v; if (el) out.push(el) })
  return out
}

// ── napkin-wasm in node ──────────────────────────────────────────────────────
let glue = null
export async function wasmHost() {
  if (!glue) {
    glue = await import(`${CLAN_STORE}/src/wasm/napkin_wasm.js`)
    glue.initSync({ module: readFileSync(`${CLAN_STORE}/src/wasm/napkin_wasm_bg.wasm`) })
  }
  const h = new glue.NapkinHost()
  h.installApp(appTemplate())
  return h
}
let tpl = null
export function appTemplate() {
  if (!tpl) {
    const src = readFileSync(`${CLAN_STORE}/src/app-template.gen.ts`, 'utf8')
    const b64 = src.match(/APP_TEMPLATE_BASE64 =\s*'([^']+)'/)[1]
    tpl = new Uint8Array(Buffer.from(b64, 'base64'))
  }
  return tpl
}
export function appSchema() {
  const src = readFileSync(`${CLAN_STORE}/src/app-template.gen.ts`, 'utf8')
  return JSON.parse(src.match(/export const APP_SCHEMA = (\{.*\})\s*$/m)[1])
}
export function route(h, path, body = {}, query = '') {
  const raw = body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body))
  const resp = h.handle(path, query, raw)
  const bytes = resp.body instanceof Uint8Array ? resp.body : Uint8Array.from(resp.body)
  if (resp.status !== 200) throw new Error(`${path} ${resp.status}: ${new TextDecoder().decode(bytes).slice(0, 400)}`)
  return bytes
}
export const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes))

// ── stats ────────────────────────────────────────────────────────────────────
export const now = () => performance.now()
export function time(fn) { const t = now(); const v = fn(); return [now() - t, v] }
export function med(xs) { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
export function pct(xs, p) { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
export function bench(fn, runs = 9, warm = 2) { for (let i = 0; i < warm; i++) fn(); const ts = []; let v; for (let i = 0; i < runs; i++) { const t = now(); v = fn(); ts.push(now() - t) } return { med: med(ts), min: Math.min(...ts), max: Math.max(...ts), v } }
export const kb = (n) => (n / 1024).toFixed(1) + ' KB'
export const mb = (n) => (n / 1048576).toFixed(2) + ' MB'
export const ms = (n) => n.toFixed(n < 10 ? 2 : 1) + ' ms'
