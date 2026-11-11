// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The undo stack of one open brief (features/brief-versions-undo.clan): the person's own
// edits this session, newest last. Undo does not delete anything: it writes the inverse as a new
// attributed edit, so the chain keeps both. It applies only while the part still holds what this
// person last wrote; if someone else changed it since, it says so and does nothing.
// The key handling and the stack shape follow the Production Tool's useUndo.ts / undoKeys.ts.

/** One edit of the person's own: the keys it wrote, what they held before and what they hold now. */
export interface UndoEntry {
  /** The decision that recorded it, so one edit is never pushed twice. */
  id: string
  keys: string[]
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export type Plan =
  | { kind: 'write'; entry: UndoEntry; patch: Record<string, unknown> }
  | { kind: 'stale'; entry: UndoEntry; keys: string[] }
  | { kind: 'nothing' }

/** Keys typed here belong to a field's own undo, not the brief's. */
export function keepsItsOwnUndo(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')
}

/** Cmd or Ctrl and Z undoes, with Shift (or Cmd/Ctrl and Y) redoes; anything else is no one's. */
export function undoKeyOf(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): 'undo' | 'redo' | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (k === 'y' && !e.shiftKey) return 'redo'
  return null
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object), kb = Object.keys(b as object)
  return ka.length === kb.length && ka.every(k => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** The merge patch (RFC 7396) that turns `from` into `to`; undefined when they are the same. */
export function mergeDiff(from: unknown, to: unknown): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (isObj(from) && isObj(to)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(to)) {
      if (k in from) {
        const d = mergeDiff(from[k], to[k])
        if (d !== undefined) out[k] = d
      } else out[k] = to[k]
    }
    for (const k of Object.keys(from)) if (!(k in to)) out[k] = null
    return Object.keys(out).length ? out : undefined
  }
  return same(from, to) ? undefined : (to === undefined ? null : to)
}

export interface UndoStack {
  push(e: UndoEntry): void
  canUndo(): boolean
  canRedo(): boolean
  /** What undoing (or redoing) would write, given the parts as they are now. */
  plan(dir: 'undo' | 'redo', current: Record<string, unknown>): Plan
  /** The write landed: move the entry to the other side. */
  done(dir: 'undo' | 'redo'): void
  clear(): void
}

export function createUndoStack(): UndoStack {
  let undo: UndoEntry[] = []
  let redo: UndoEntry[] = []
  const seen = new Set<string>()
  return {
    push(e) {
      if (seen.has(e.id)) return
      seen.add(e.id)
      undo.push(e)
      redo = []
    },
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    plan(dir, current) {
      const entry = (dir === 'undo' ? undo : redo).at(-1)
      if (!entry) return { kind: 'nothing' }
      const from = dir === 'undo' ? entry.after : entry.before // what the parts must hold now
      const to = dir === 'undo' ? entry.before : entry.after
      const stale = entry.keys.filter(k => !same(current[k] ?? null, from[k] ?? null))
      if (stale.length) return { kind: 'stale', entry, keys: stale }
      const patch: Record<string, unknown> = {}
      for (const k of entry.keys) {
        const d = mergeDiff(current[k] ?? null, to[k] ?? null)
        if (d !== undefined) patch[k] = d
      }
      return Object.keys(patch).length ? { kind: 'write', entry, patch } : { kind: 'nothing' }
    },
    done(dir) {
      const from = dir === 'undo' ? undo : redo
      const e = from.pop()
      if (e) (dir === 'undo' ? redo : undo).push(e)
    },
    clear() { undo = []; redo = []; seen.clear() },
  }
}
