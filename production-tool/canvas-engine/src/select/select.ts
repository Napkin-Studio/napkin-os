// The select tool (features/engine-select.clan): DOM-free, driven by the input
// router's press, drag and release in scene coordinates.
//
// - A click selects the topmost element there, with its whole outermost group
//   (groupIds run innermost to outermost, as Excalidraw's and core/nodes.ts read
//   them); shift-click adds or removes it. A double-click on a member of a group picks
//   that member alone (pickOne, as Excalidraw enters a group), so one view of a
//   character can be named or linked on its own.
// - Group adds a new outermost group to the selection and Ungroup takes the
//   outermost one off, each one undoable step (canvas-edit-tools; ui-behaviour 3.8).
// - A press on empty space starts a marquee (mouse, touch) or a lasso (pen); at
//   release it selects what lies inside (the whole box for a marquee, the centre
//   for a lasso), added to the selection with shift.
// - A drag on a corner handle scales the selection round the opposite corner, one
//   scale for both axes, so a group scales as one and a sketch area keeps its
//   ratio (ui-behaviour 3.7: only the ratio picker changes it). Nodes, boards and
//   links have no handles.
// - A drag that starts on the selection moves it: the movement is a preview the
//   renderer draws (nothing is written to Y while dragging), then one undoable
//   step at release. Locked elements are selected but never moved or deleted.

import { recordBounds, unionRects } from '../model/bounds'
import type { PointerKind } from '../input/router'
import type { ElementRecord } from '../model/records'
import type { SceneStore } from '../model/store'

export interface Pt {
  x: number
  y: number
}

export interface MovePreview {
  ids: ReadonlySet<string>
  dx: number
  dy: number
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** A scale being dragged: every id round (ox, oy) by s. Drawn by the renderer, written at release. */
export interface ScalePreview {
  ids: ReadonlySet<string>
  ox: number
  oy: number
  s: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The handles sit this far (screen pixels) outside the box's corners, where the renderer draws them. */
export const HANDLE_PAD = 6
/** How near a handle's centre (screen pixels) a press takes it. */
export const HANDLE_PX = 7
/** Kinds the handles never scale: their size is the card's or the board's, or they follow their ends. */
const UNSCALED = new Set(['node', 'board', 'link'])

/** A ratio 'w:h' as a number, or null. */
export function ratioValue(ratio: unknown): number | null {
  if (typeof ratio !== 'string') return null
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio)
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null
}

const isArea = (r: ElementRecord) => r.kind === 'sketch' || r.customData?.kind === 'sketch'

/** A record scaled round (ox, oy); a sketch area's height then follows its ratio exactly. */
export function scaled(r: ElementRecord, ox: number, oy: number, s: number, ratio: number | null = null): ElementRecord {
  const w = r.w * s
  const h = ratio ? w / ratio : r.h * s
  return { ...r, x: ox + (r.x - ox) * s, y: oy + (r.y - oy) * s, w, h }
}

/** The box round records as drawn: a turned one by its turned corners, a stacked photo with its edge (a whole pile). */
const boxOfAll = (rs: readonly ElementRecord[]): Box => unionRects(rs.map(recordBounds))

const centre = (r: ElementRecord): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Is p inside the polygon (even-odd)? */
export function inPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export class SelectTool {
  private readonly scene: SceneStore
  private readonly hit: (x: number, y: number) => ElementRecord | undefined
  selected = new Set<string>()
  preview: MovePreview | null = null
  marquee: { x0: number; y0: number; x1: number; y1: number } | null = null
  lasso: Pt[] | null = null
  scaling: ScalePreview | null = null
  private scaleFrom: { box: Box; ox: number; oy: number } | null = null
  private dragFrom: Pt | null = null
  private additive = false
  private readonly cbs = new Set<() => void>()
  private readonly newId: () => string

  constructor(scene: SceneStore, hit: (x: number, y: number) => ElementRecord | undefined, opts: { newId?: () => string } = {}) {
    this.scene = scene
    this.hit = hit
    this.newId = opts.newId ?? (() => `group_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
  }

  onChange(cb: () => void): () => void {
    this.cbs.add(cb)
    return () => void this.cbs.delete(cb)
  }

  private changed() {
    for (const cb of this.cbs) cb()
  }

  /** An element and the rest of its outermost group (the last of its groupIds). */
  private withGroup(r: ElementRecord): string[] {
    const g = r.groupIds.at(-1)
    if (!g) return [r.id]
    return this.scene.all().filter((x) => x.groupIds.includes(g)).map((x) => x.id)
  }

  /** The selection's units: each outermost group once, and each ungrouped element. */
  private units(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const id of this.selected) {
      const r = this.scene.get(id)
      if (!r) continue
      const key = r.groupIds.at(-1) ?? `#${id}`
      out.set(key, [...(out.get(key) ?? []), id])
    }
    return out
  }

  /** What is selected: nothing, one thing, one whole group (ink when all its members are pen strokes), or several things. */
  selectionKind(): { kind: 'none' } | { kind: 'one' } | { kind: 'group'; group: string; ink: boolean; count: number } | { kind: 'several'; count: number } {
    const units = this.units()
    if (!units.size) return { kind: 'none' }
    if (units.size > 1) return { kind: 'several', count: units.size }
    const [[key, ids]] = [...units]
    if (key.startsWith('#')) return { kind: 'one' }
    const members = this.scene.all().filter((r) => r.groupIds.includes(key))
    const ink = members.every((r) => r.kind === 'stroke' && r.props.tool !== 'highlighter')
    return { kind: 'group', group: key, ink, count: Math.max(ids.length, members.length) }
  }

  /** Group the selection (two or more things) under a new outermost group, as one step. Returns its id, or null. */
  group(): string | null {
    if (this.units().size < 2) return null
    const g = this.newId()
    const recs = [...this.selected].map((id) => this.scene.get(id)).filter((r): r is ElementRecord => !!r && !r.locked)
    if (recs.length < 2) return null
    this.scene.change((tx) => tx.put(recs.map((r) => ({ ...r, groupIds: [...r.groupIds, g] }))))
    this.changed()
    return g
  }

  /** Take the outermost group off the selected elements, as one step. False when nothing was grouped. */
  ungroup(): boolean {
    const recs = [...this.selected].map((id) => this.scene.get(id)).filter((r): r is ElementRecord => !!r && !r.locked && r.groupIds.length > 0)
    if (!recs.length) return false
    this.scene.change((tx) => tx.put(recs.map((r) => ({ ...r, groupIds: r.groupIds.slice(0, -1) }))))
    this.changed()
    return true
  }

  /** The ids and everything on the boards (and frames) among them, at any depth. */
  private withMembers(ids: Iterable<string>): Set<string> {
    const out = new Set(ids)
    const kids = new Map<string, string[]>()
    for (const r of this.scene.all()) if (r.parentId) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r.id])
    const todo = [...out]
    while (todo.length) {
      for (const k of kids.get(todo.pop()!) ?? []) if (!out.has(k)) {
        out.add(k)
        todo.push(k)
      }
    }
    return out
  }

  /** The topmost board under a point, other than `self` (positions as they are about to be). */
  private containerAt(p: Pt, self: string, placed: ReadonlyMap<string, ElementRecord>): string | null {
    const boards = this.scene.all().filter((r) => r.kind === 'board' && r.id !== self).map((r) => placed.get(r.id) ?? r)
    const hit = boards.filter((b) => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h).sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0))[0]
    return hit?.id ?? null
  }

  /** The topmost element at a point, alone, even when it is in a group (a double-click). Its id, or null. */
  pickOne(p: Pt): string | null {
    const hit = this.hit(p.x, p.y)
    if (!hit) return null
    this.selected = new Set([hit.id])
    this.changed()
    return hit.id
  }

  set(ids: Iterable<string>) {
    this.selected = new Set(ids)
    this.changed()
  }

  /** The selected records, as they are drawn now (moved or scaled while a drag runs). */
  private shown(): ElementRecord[] {
    const out: ElementRecord[] = []
    for (const id of this.selected) {
      const r = this.scene.get(id)
      if (!r) continue
      const sc = this.scaling
      if (sc?.ids.has(id)) out.push(scaled(r, sc.ox, sc.oy, sc.s))
      else if (this.preview?.ids.has(id)) out.push({ ...r, x: r.x + this.preview.dx, y: r.y + this.preview.dy })
      else out.push(r)
    }
    return out
  }

  /** The box round the selection, and whether its handles scale it (no node, board or link in it), or null. */
  frame(): { box: Box; scalable: boolean } | null {
    const rs = this.shown().filter((r) => r.kind !== 'link')
    if (!rs.length) return null
    return { box: boxOfAll(rs), scalable: rs.every((r) => !UNSCALED.has(r.kind)) && rs.some((r) => !r.locked) }
  }

  /** The corner handle at a scene point (HANDLE_PX on screen at this zoom), when the selection can be scaled. */
  handleAt(p: Pt, zoom: number): Corner | null {
    const f = this.frame()
    if (!f?.scalable) return null
    const reach = HANDLE_PX / zoom
    const d = HANDLE_PAD / zoom
    const { x, y, w, h } = f.box
    const corners: [Corner, number, number][] = [['nw', x - d, y - d], ['ne', x + w + d, y - d], ['sw', x - d, y + h + d], ['se', x + w + d, y + h + d]]
    return corners.find(([, cx, cy]) => Math.abs(p.x - cx) <= reach && Math.abs(p.y - cy) <= reach)?.[0] ?? null
  }

  press(p: Pt, opts: { shift?: boolean; by?: PointerKind; zoom?: number } = {}) {
    const corner = opts.shift ? null : this.handleAt(p, opts.zoom ?? 1)
    if (corner) {
      const box = this.frame()!.box
      const ox = corner === 'nw' || corner === 'sw' ? box.x + box.w : box.x
      const oy = corner === 'nw' || corner === 'ne' ? box.y + box.h : box.y
      this.scaleFrom = { box, ox, oy }
      this.scaling = { ids: new Set(this.selected), ox, oy, s: 1 }
      this.changed()
      return
    }
    const hit = this.hit(p.x, p.y)
    if (hit) {
      const ids = this.withGroup(hit)
      if (opts.shift) {
        const on = this.selected.has(hit.id)
        for (const id of ids) {
          if (on) this.selected.delete(id)
          else this.selected.add(id)
        }
      } else if (!this.selected.has(hit.id)) this.selected = new Set(ids)
      if (this.selected.has(hit.id)) {
        this.dragFrom = p
        this.preview = { ids: this.withMembers(this.selected), dx: 0, dy: 0 }
      }
    } else {
      this.additive = !!opts.shift
      if (!opts.shift) this.selected = new Set()
      if (opts.by === 'pen') this.lasso = [p]
      else this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
    }
    this.changed()
  }

  drag(p: Pt) {
    if (this.scaling && this.scaleFrom) {
      const { box, ox, oy } = this.scaleFrom
      const want = Math.max(Math.abs(p.x - ox) / Math.max(1e-9, box.w), Math.abs(p.y - oy) / Math.max(1e-9, box.h))
      // Never smaller than 8 px on its long side.
      const s = Math.max(want, 8 / Math.max(1e-9, box.w, box.h))
      this.scaling = { ...this.scaling, s }
    } else if (this.preview && this.dragFrom) {
      this.preview = { ids: this.preview.ids, dx: p.x - this.dragFrom.x, dy: p.y - this.dragFrom.y }
    } else if (this.marquee) {
      this.marquee = { ...this.marquee, x1: p.x, y1: p.y }
    } else if (this.lasso) {
      this.lasso.push(p)
    } else return
    this.changed()
  }

  release(p: Pt) {
    this.drag(p)
    if (this.scaling) {
      const { ids, ox, oy, s } = this.scaling
      this.scaling = null
      this.scaleFrom = null
      if (s !== 1) {
        this.scene.change((tx) => {
          const out: ElementRecord[] = []
          for (const id of ids) {
            const r = tx.get(id)
            if (!r || r.locked || UNSCALED.has(r.kind)) continue
            // A sketch area keeps its ratio: the one it was drawn at, else its shape now.
            const ratio = isArea(r) ? ratioValue(r.props.ratio) ?? (r.h ? r.w / r.h : null) : null
            out.push(scaled(r, ox, oy, s, ratio))
          }
          if (out.length) tx.put(out)
        })
      }
    } else if (this.preview) {
      const { ids, dx, dy } = this.preview
      this.preview = null
      this.dragFrom = null
      if (dx || dy) {
        this.scene.change((tx) => {
          const moved = [...ids].map((id) => tx.get(id)).filter((r): r is ElementRecord => !!r && !r.locked).map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
          // Membership is parentId only (art-boards): what was picked up joins the board its centre
          // lands on, or leaves every board; what came along with a moved board stays on it.
          const carried = new Set(moved.filter((r) => r.parentId && ids.has(r.parentId)).map((r) => r.id))
          const placed = new Map(moved.map((r) => [r.id, r]))
          for (const r of moved) {
            if (carried.has(r.id) || r.kind === 'board') continue
            // Strokes in a drawn frame or a sketch area keep that container; only board membership follows the drop.
            const cur = r.parentId ? tx.get(r.parentId) : undefined
            if (cur && cur.kind !== 'board') continue
            const parent = this.containerAt(centre(r), r.id, placed)
            if (parent !== r.parentId) placed.set(r.id, { ...r, parentId: parent })
          }
          if (placed.size) tx.put([...placed.values()])
        })
      }
    } else if (this.marquee) {
      const m = this.marquee
      this.marquee = null
      const [x0, x1] = [Math.min(m.x0, m.x1), Math.max(m.x0, m.x1)]
      const [y0, y1] = [Math.min(m.y0, m.y1), Math.max(m.y0, m.y1)]
      if (x1 - x0 > 0 || y1 - y0 > 0) {
        const inside = this.scene.all().filter((r) => r.kind !== 'board' && r.x >= x0 && r.y >= y0 && r.x + r.w <= x1 && r.y + r.h <= y1)
        this.add(inside)
      }
    } else if (this.lasso) {
      const poly = this.lasso
      this.lasso = null
      if (poly.length > 2) this.add(this.scene.all().filter((r) => r.kind !== 'board' && inPolygon(centre(r), poly)))
    }
    this.changed()
  }

  private add(rs: ElementRecord[]) {
    const next = this.additive ? new Set(this.selected) : new Set<string>()
    for (const r of rs) for (const id of this.withGroup(r)) next.add(id)
    this.selected = next
    this.additive = false
  }

  /** Delete the selection (not what is locked) as one step. Returns how many went. */
  deleteSelected(): number {
    const ids = [...this.selected].filter((id) => {
      const r = this.scene.get(id)
      return r && !r.locked
    })
    if (!ids.length) return 0
    this.scene.change((tx) => tx.remove(ids))
    for (const id of ids) this.selected.delete(id)
    this.changed()
    return ids.length
  }

  cancel() {
    this.scaling = null
    this.scaleFrom = null
    this.preview = null
    this.marquee = null
    this.lasso = null
    this.dragFrom = null
    this.changed()
  }

  /** Drop ids that are gone (deleted here or by someone else). */
  prune() {
    for (const id of [...this.selected]) if (!this.scene.get(id)) this.selected.delete(id)
  }
}
