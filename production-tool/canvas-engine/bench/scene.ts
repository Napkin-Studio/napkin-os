// The seeded G3 scene (ported from the canvas-spikes harness, spike/canvas-own-engine
// production-tool/spikes/harness/src/{scene.ts, rng.ts, previews.ts}): 10 boards,
// 300 previews of 640x360, 5,000 freehand strokes averaging 60 points, and 500
// typed nodes. The same seed gives the same scene everywhere; seed 1's
// fingerprint is f8082c81, as in the spike runs. The node kinds are names only
// here (the engine never imports the web app's NodeRegistry); they do not enter
// the fingerprint.

import { element, type ElementRecord } from '../src/model/records'
import { encodePoints } from '../src/model/points'

export interface Rng {
  next(): number
  int(min: number, max: number): number
  range(min: number, max: number): number
  pick<T>(xs: readonly T[]): T
}

/** mulberry32, as the harness. */
export function rng(seed: number): Rng {
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
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
  }
}

export const BOARD_W = 3200
export const BOARD_H = 1800
export const BOARD_GAP = 400
export const PREVIEW_W = 640
export const PREVIEW_H = 360
export const NODE_W = 280
export const NODE_H = 180
export const SEED = 1
export const SEED_FINGERPRINT = 'f8082c81'

export interface SceneSize {
  boards: number
  previews: number
  strokes: number
  meanPoints: number
  nodes: number
}

export const G3_SIZE: SceneSize = { boards: 10, previews: 300, strokes: 5000, meanPoints: 60, nodes: 500 }

/** The placeable node kinds, by name (canvas-core's NodeRegistry, onCanvas and not system). */
export const NODE_KINDS = ['board', 'sketch', 'pic', 'drawn', 'note', 'gen', 'script', 'storyboard', 'video', 'link', 'document', 'format_set'] as const

interface Box { x: number; y: number; w: number; h: number }
export interface GenBoard extends Box { id: string; name: string; z: number }
export interface GenPreview extends Box { id: string; boardId: string; image: number; hue: number; z: number }
export interface GenStroke { id: string; boardId: string; x: number; y: number; points: [number, number, number][]; size: number; color: string; z: number }
export interface GenNode extends Box { id: string; boardId: string; kind: string; label: string; z: number }
export interface GenScene { seed: number; size: SceneSize; boards: GenBoard[]; previews: GenPreview[]; strokes: GenStroke[]; nodes: GenNode[]; bounds: Box }

const INK = ['#1e1e1e', '#2f3b52', '#a33b2b', '#235f3b', '#6b3fa0']
const previewHue = (n: number) => (n * 47) % 360
const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

export function boardBox(i: number, cols = 5): Box {
  const col = i % cols
  const row = Math.floor(i / cols)
  return { x: col * (BOARD_W + BOARD_GAP), y: row * (BOARD_H + BOARD_GAP), w: BOARD_W, h: BOARD_H }
}

const boardFor = (i: number, boards: number) => i % boards

export function generateScene(seed: number, size: SceneSize = G3_SIZE): GenScene {
  const r = rng(seed)
  let z = 0
  const boards: GenBoard[] = Array.from({ length: size.boards }, (_, i) => ({ id: `b${i}`, name: `Board ${i + 1}`, ...boardBox(i), z: z++ }))
  const perBoard = Math.ceil(size.previews / size.boards)
  const previews: GenPreview[] = []
  for (let i = 0; i < size.previews; i++) {
    const b = boards[boardFor(i, size.boards)]
    const slot = Math.floor(i / size.boards) % perBoard
    const col = slot % 6
    const row = Math.floor(slot / 6)
    previews.push({
      id: `p${i}`, boardId: b.id, image: i,
      x: b.x + 40 + col * (PREVIEW_W * 0.75 + 20) + r.range(-10, 10),
      y: b.y + 40 + row * (PREVIEW_H * 0.75 + 20) + r.range(-10, 10),
      w: PREVIEW_W * 0.75, h: PREVIEW_H * 0.75, hue: previewHue(i), z: z++,
    })
  }
  const strokes: GenStroke[] = []
  for (let i = 0; i < size.strokes; i++) {
    const b = boards[boardFor(i, size.boards)]
    const n = Math.max(2, Math.round(size.meanPoints + r.range(-0.5, 0.5) * size.meanPoints))
    const pts: [number, number, number][] = []
    let px = 0
    let py = 0
    let heading = r.range(0, Math.PI * 2)
    for (let k = 0; k < n; k++) {
      pts.push([round1(px), round1(py), round2(0.35 + 0.5 * Math.abs(Math.sin(k / 9 + i)))])
      heading += r.range(-0.35, 0.35)
      const step = r.range(3, 9)
      px += Math.cos(heading) * step
      py += Math.sin(heading) * step
    }
    strokes.push({
      id: `s${i}`, boardId: b.id,
      x: round1(b.x + r.range(80, BOARD_W - 300)), y: round1(b.y + r.range(80, BOARD_H - 300)),
      points: pts, size: r.int(2, 6), color: r.pick(INK), z: z++,
    })
  }
  const nodes: GenNode[] = []
  for (let i = 0; i < size.nodes; i++) {
    const b = boards[boardFor(i, size.boards)]
    const kind = NODE_KINDS[i % NODE_KINDS.length]
    nodes.push({
      id: `n${i}`, boardId: b.id, kind, label: `${kind} ${i}`,
      x: round1(b.x + r.range(40, BOARD_W - NODE_W - 40)), y: round1(b.y + r.range(40, BOARD_H - NODE_H - 40)),
      w: NODE_W, h: NODE_H, z: z++,
    })
  }
  const last = boardBox(size.boards - 1)
  const cols = Math.min(size.boards, 5)
  return { seed, size, boards, previews, strokes, nodes, bounds: { x: 0, y: 0, w: cols * (BOARD_W + BOARD_GAP) - BOARD_GAP, h: last.y + BOARD_H } }
}

export function sceneFingerprint(s: GenScene): string {
  let h = 2166136261
  const mix = (n: number) => {
    h ^= Math.round(n * 10) | 0
    h = Math.imul(h, 16777619)
  }
  for (const b of s.boards) { mix(b.x); mix(b.y) }
  for (const p of s.previews) { mix(p.x); mix(p.y); mix(p.hue) }
  for (const st of s.strokes) { mix(st.x); mix(st.y); mix(st.points.length); mix(st.points.at(-1)![0]) }
  for (const n of s.nodes) { mix(n.x); mix(n.y) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** A sortable fractional-index stand-in: creation order. */
export const zOf = (n: number) => `a${n.toString(36).padStart(5, '0')}`

export const previewSha = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`

/** A generated stroke as a napkin/1 record and its points: x, y at its top-left, points relative to it. */
export function strokeRecord(st: { id: string; x: number; y: number; points: [number, number, number][]; size: number; color: string; z: number; parentId?: string | null }) {
  const minX = Math.min(...st.points.map((p) => p[0]))
  const minY = Math.min(...st.points.map((p) => p[1]))
  const maxX = Math.max(...st.points.map((p) => p[0]))
  const maxY = Math.max(...st.points.map((p) => p[1]))
  const rec = element({
    id: st.id, kind: 'stroke', z: zOf(st.z), x: st.x + minX, y: st.y + minY, w: maxX - minX, h: maxY - minY,
    parentId: st.parentId ?? null, style: { stroke: st.color, width: st.size }, props: { tool: 'pen' },
  })
  const pts = encodePoints(st.points.map(([dx, dy, p]) => ({ x: dx - minX, y: dy - minY, pressure: p })), { x: 0, y: 0 })
  return { rec, pts }
}

/** The G3 scene as napkin/1 records and stroke points. */
export function g3Records(scene = generateScene(SEED)): { records: ElementRecord[]; points: Record<string, Uint8Array> } {
  const records: ElementRecord[] = []
  const points: Record<string, Uint8Array> = {}
  for (const b of scene.boards) records.push(element({ id: b.id, kind: 'board', z: zOf(b.z), x: b.x, y: b.y, w: b.w, h: b.h, props: { name: b.name } }))
  for (const p of scene.previews) {
    records.push(element({
      id: p.id, kind: 'image', z: zOf(p.z), x: p.x, y: p.y, w: p.w, h: p.h, parentId: p.boardId,
      props: { assetSha: previewSha(p.image), status: 'saved' }, customData: { kind: 'gen', id: `job_${p.image}` },
    }))
  }
  for (const st of scene.strokes) {
    const { rec, pts } = strokeRecord({ ...st, parentId: st.boardId })
    records.push(rec)
    points[rec.id] = pts
  }
  for (const n of scene.nodes) {
    records.push(element({ id: n.id, kind: 'node', z: zOf(n.z), x: n.x, y: n.y, w: n.w, h: n.h, parentId: n.boardId, props: { nodeKind: n.kind }, customData: { kind: n.kind, id: n.id } }))
  }
  return { records, points }
}
