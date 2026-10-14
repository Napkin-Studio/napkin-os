// The ink tools (features/engine-ink.clan): pen, highlighter and eraser over the
// SceneStore. A stroke is gathered from the router's samples (scene coordinates,
// coalesced points included), shown on the live-ink canvas while it is drawn,
// and written once at pointer-up as one undoable step: a record and its
// immutable points. The eraser marks the strokes its path touches and removes
// them in one step at pointer-up. Strokes drawn close in time and space share an
// ink group (groupIds), so a word or a doodle moves as one.

import { encodePoints, localPoints, type InkPoint } from '../model/points'
import { element, type ElementRecord } from '../model/records'
import type { SceneStore } from '../model/store'
import { zTop } from '../model/z'

export type InkTool = 'pen' | 'highlighter' | 'eraser'

export interface InkStyle {
  /** An ink name (ink/palette.ts: 'ink' follows the theme) or, for imports, a literal colour. */
  color: string
  /** Stroke width in scene pixels. */
  width: number
}

/** The highlighter's translucency, and its width when the host gives none of its own. */
export const HIGHLIGHTER = { width: 18, opacity: 0.35 } as const
/** A stroke this soon after the last one, this close to it, joins its group. */
export const GROUP_MS = 1500
export const GROUP_PX = 120
/** How far from a stroke the eraser reaches, beyond the stroke's own half-width. */
export const ERASER_RADIUS = 8

export interface LiveStroke {
  tool: InkTool
  points: InkPoint[]
  style: InkStyle
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const boxOf = (r: Pick<ElementRecord, 'x' | 'y' | 'w' | 'h'>): Box => ({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h })
const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY))

let seq = 0
const defaultId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export class Ink {
  private readonly scene: SceneStore
  private readonly now: () => number
  private readonly newId: (prefix: string) => string
  private current: LiveStroke | null = null
  private readonly erased = new Set<string>()
  private last: { id: string; at: number; box: Box } | null = null

  constructor(scene: SceneStore, opts: { now?: () => number; newId?: (prefix: string) => string } = {}) {
    this.scene = scene
    this.now = opts.now ?? (() => Date.now())
    this.newId = opts.newId ?? defaultId
  }

  begin(tool: InkTool, at: InkPoint, style: InkStyle) {
    this.current = { tool, points: [at], style: tool === 'highlighter' && !(style.width > 0) ? { ...style, width: HIGHLIGHTER.width } : style }
    this.erased.clear()
    if (tool === 'eraser') this.eraseAt([at])
  }

  add(points: InkPoint[]) {
    const c = this.current
    if (!c) return
    if (c.tool === 'eraser') {
      // A fast eraser moves far between samples: test the path between them too.
      const dense: InkPoint[] = []
      let prev = c.points[c.points.length - 1]
      for (const p of points) {
        const n = Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / (ERASER_RADIUS / 2))
        for (let i = 1; i <= n; i++) dense.push({ x: prev.x + ((p.x - prev.x) * i) / n, y: prev.y + ((p.y - prev.y) * i) / n, pressure: p.pressure })
        prev = p
      }
      this.eraseAt(dense)
    }
    c.points.push(...points)
  }

  /** The stroke being drawn, for the live-ink canvas. */
  live(): LiveStroke | null {
    return this.current
  }

  /** Strokes the eraser has marked so far (drawn faded until it lifts). */
  marked(): ReadonlySet<string> {
    return this.erased
  }

  cancel() {
    this.current = null
    this.erased.clear()
  }

  /** Pointer-up: write the stroke (or the erasure) as one step. Returns the new stroke, if any. */
  end(): ElementRecord | null {
    const c = this.current
    this.current = null
    if (!c) return null
    if (c.tool === 'eraser') {
      const ids = [...this.erased]
      this.erased.clear()
      if (ids.length) this.scene.change((tx) => tx.remove(ids))
      return null
    }
    const xs = c.points.map((p) => p.x)
    const ys = c.points.map((p) => p.y)
    const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    const id = this.newId('stroke')
    const at = this.now()
    const prev = this.last && this.scene.get(this.last.id)
    const joins = !!prev && at - this.last!.at <= GROUP_MS && gap(box, boxOf(prev)) <= GROUP_PX
    const group = joins ? (prev!.groupIds[0] ?? this.newId('ink')) : null
    const rec = element({
      id, kind: 'stroke', z: zTop(this.scene.all().map((r) => r.z)),
      x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY,
      groupIds: group ? [group] : [],
      opacity: c.tool === 'highlighter' ? HIGHLIGHTER.opacity : 1,
      style: { stroke: c.style.color, width: c.style.width },
      props: { tool: c.tool },
    })
    const pts = encodePoints(c.points.map((p) => ({ x: p.x - box.minX, y: p.y - box.minY, pressure: p.pressure })), { x: 0, y: 0 })
    this.scene.change((tx) => {
      tx.put([rec])
      tx.setPoints(id, pts)
      if (joins && group && !prev!.groupIds.includes(group)) tx.put([{ ...prev!, groupIds: [group, ...prev!.groupIds] }])
    })
    this.last = { id, at, box }
    return rec
  }

  private eraseAt(points: InkPoint[]) {
    for (const r of this.scene.all()) {
      if (r.kind !== 'stroke' || this.erased.has(r.id) || r.locked) continue
      const reach = (typeof r.style.width === 'number' ? r.style.width / 2 : 2) + ERASER_RADIUS
      const b = boxOf(r)
      const near = points.some((p) => p.x >= b.minX - reach && p.x <= b.maxX + reach && p.y >= b.minY - reach && p.y <= b.maxY + reach)
      if (!near) continue
      const pts = this.scene.points(r.id)
      if (!pts) continue
      const local = localPoints(pts)
      if (points.some((p) => local.some((q) => Math.hypot(r.x + q.x - p.x, r.y + q.y - p.y) <= reach))) this.erased.add(r.id)
    }
  }
}
