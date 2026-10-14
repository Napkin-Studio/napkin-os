// The scene part of the UndoCoordinator (features/engine-select.clan, under
// canvas-engine's undo model; ui-behaviour 4.5). One per person: it records only
// the steps this SceneStore reports for its own local writes (never a remote
// one), as field inverses, at most MAX_STEPS. Undo puts a field back only while it
// still holds the value the step left; a field someone changed since is skipped
// and counted, so the tool can say "Sai changed this after you, so undo skipped
// it". Undo and redo write as SYSTEM: they are never steps themselves, and the Y
// doc keeps no undo history, so none reaches a checkpoint.

import type { ElementRecord } from '../model/records'
import type { FieldChange, SceneStore, Step } from '../model/store'
import { flatten, unflatten } from '../y/layout'

export const MAX_STEPS = 200

export interface UndoResult {
  /** Fields (or whole elements) put back. */
  applied: number
  /** Fields someone else changed after this step; left as they are. */
  skipped: number
}

/** JSON with keys sorted, so two records with the same fields compare equal whatever their key order. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Uint8Array) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
const same = (a: unknown, b: unknown) => a === b || stable(a) === stable(b)

export class SceneUndo {
  private readonly scene: SceneStore
  private undos: Step[] = []
  private redos: Step[] = []
  private applying = false
  private readonly off: () => void

  constructor(scene: SceneStore) {
    this.scene = scene
    this.off = scene.onStep((s) => {
      if (this.applying) return
      this.undos.push(s)
      if (this.undos.length > MAX_STEPS) this.undos.splice(0, this.undos.length - MAX_STEPS)
      this.redos = []
    })
  }

  depth(): { undo: number; redo: number } {
    return { undo: this.undos.length, redo: this.redos.length }
  }

  canUndo() {
    return this.undos.length > 0
  }

  canRedo() {
    return this.redos.length > 0
  }

  undo(): UndoResult | null {
    const s = this.undos.pop()
    if (!s) return null
    const r = this.apply(s, 'back')
    this.redos.push(s)
    return r
  }

  redo(): UndoResult | null {
    const s = this.redos.pop()
    if (!s) return null
    const r = this.apply(s, 'forward')
    this.undos.push(s)
    return r
  }

  destroy() {
    this.off()
  }

  /** Put each change back (or forward), skipping what no longer holds the value the step left. */
  private apply(step: Step, dir: 'back' | 'forward'): UndoResult {
    const res: UndoResult = { applied: 0, skipped: 0 }
    const changes = dir === 'back' ? [...step.changes].reverse() : step.changes
    const from = (c: FieldChange) => (dir === 'back' ? c.after : c.before)
    const to = (c: FieldChange) => (dir === 'back' ? c.before : c.after)
    this.applying = true
    try {
      this.scene.change((tx) => {
        const edited = new Map<string, Map<string, unknown>>()
        const flat = (id: string) => {
          let m = edited.get(id)
          if (!m) {
            const cur = tx.get(id)
            if (!cur) return null
            m = flatten(cur)
            edited.set(id, m)
          }
          return m
        }
        for (const c of changes) {
          if (c.field === '$record') {
            const want = to(c) as ElementRecord | null
            const cur = tx.get(c.id)
            if (want === null) {
              // Undo a create: the element goes, unless someone changed it since.
              if (cur && same(cur, from(c))) {
                tx.remove([c.id])
                edited.delete(c.id)
                res.applied++
              } else if (cur) res.skipped++
            } else if (!cur) {
              tx.put([want])
              res.applied++
            } else res.skipped++
            continue
          }
          if (c.field === '$pts') {
            const want = to(c) as Uint8Array | null
            if (want && !this.scene.points(c.id)) tx.setPoints(c.id, want)
            continue
          }
          const m = flat(c.id)
          if (!m) {
            res.skipped++
            continue
          }
          if (!same(m.get(c.field), from(c))) {
            res.skipped++
            continue
          }
          if (to(c) === undefined) m.delete(c.field)
          else m.set(c.field, to(c))
          res.applied++
        }
        const put: ElementRecord[] = []
        for (const [id, m] of edited) {
          const r = unflatten(id, m)
          if (r) put.push(r)
        }
        if (put.length) tx.put(put)
      }, { undoable: false })
    } finally {
      this.applying = false
    }
    return res
  }
}
