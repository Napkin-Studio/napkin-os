// The select tool (features/engine-select.clan): DOM-free, driven by the input
// router's press, drag and release in scene coordinates.
//
// - A click selects the topmost element there, with its whole outermost group;
//   shift-click adds or removes it.
// - A press on empty space starts a marquee (mouse, touch) or a lasso (pen); at
//   release it selects what lies inside (the whole box for a marquee, the centre
//   for a lasso), added to the selection with shift.
// - A drag that starts on the selection moves it: the movement is a preview the
//   renderer draws (nothing is written to Y while dragging), then one undoable
//   step at release. Locked elements are selected but never moved or deleted.

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
  private dragFrom: Pt | null = null
  private additive = false
  private readonly cbs = new Set<() => void>()

  constructor(scene: SceneStore, hit: (x: number, y: number) => ElementRecord | undefined) {
    this.scene = scene
    this.hit = hit
  }

  onChange(cb: () => void): () => void {
    this.cbs.add(cb)
    return () => void this.cbs.delete(cb)
  }

  private changed() {
    for (const cb of this.cbs) cb()
  }

  /** An element and the rest of its outermost group. */
  private withGroup(r: ElementRecord): string[] {
    const g = r.groupIds[0]
    if (!g) return [r.id]
    return this.scene.all().filter((x) => x.groupIds[0] === g).map((x) => x.id)
  }

  set(ids: Iterable<string>) {
    this.selected = new Set(ids)
    this.changed()
  }

  press(p: Pt, opts: { shift?: boolean; by?: PointerKind } = {}) {
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
        this.preview = { ids: new Set(this.selected), dx: 0, dy: 0 }
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
    if (this.preview && this.dragFrom) {
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
    if (this.preview) {
      const { ids, dx, dy } = this.preview
      this.preview = null
      this.dragFrom = null
      if (dx || dy) {
        this.scene.change((tx) => {
          const moved = [...ids].map((id) => tx.get(id)).filter((r): r is ElementRecord => !!r && !r.locked).map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
          if (moved.length) tx.put(moved)
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
