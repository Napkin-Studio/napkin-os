// Undo and redo anything a person did to the production document, any time
// (features/system-undo.clan). Every person-made write (updateDoc, deleteFrom)
// leaves a step: what it changed, item by item. Lists of items are compared by
// their key (id, sha256, a stale mark's target), so undo puts back exactly what
// the step changed and leaves alone what happened since: a clip that landed
// after a delete stays when the delete is undone.
//
// Not steps: the app's own writes (job bookkeeping, results landing, sign in,
// the stage you are on, the canvas's sync, which Excalidraw undoes itself). The
// job list, the stage and the participant are never part of a step.

import { createMergePatch } from './mergePatch'
import type { DocumentStore } from './types'

type Obj = { [k: string]: unknown }

/** A path step: a field name, or an item in a keyed list. */
export type PathPart = string | { key: string }
export type Op =
  | { op: 'set'; path: PathPart[]; before?: unknown; after?: unknown }
  | { op: 'insert'; path: PathPart[]; item: unknown; index: number }
  | { op: 'remove'; path: PathPart[]; item: unknown; index: number }

export interface Step {
  /** What the person did, as the write said it ("deleted clip … (shot 3, v4)", "pick take"). */
  label: string
  ops: Op[]
  at: number
}

/** Top-level fields that are never part of a step. */
const OUTSIDE = new Set(['jobs', 'stage', 'participant', 'contract_version', 'app'])

/** The key of an item in a list, or undefined when the list is not keyed. */
function keyOf(item: unknown): string | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined
  const o = item as Obj
  if (typeof o.id === 'string') return `id:${o.id}`
  if (typeof o.sha256 === 'string') return `sha:${o.sha256}`
  if (typeof o.key === 'string' && !('target' in o)) return `key:${o.key}`
  const t = o.target as Obj | undefined
  const c = o.caused_by as Obj | undefined
  if (t && typeof t === 'object') return `stale:${t.kind}:${t.id}:${c?.kind}:${c?.id}`
  return undefined
}

const keyed = (a: unknown[]) => a.length > 0 && a.every((x) => keyOf(x) !== undefined)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** What changed from `before` to `after`, item by item. */
export function diff(before: unknown, after: unknown, path: PathPart[] = []): Op[] {
  if (same(before, after)) return []
  if (isObj(before) && isObj(after)) {
    const ops: Op[] = []
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!path.length && OUTSIDE.has(k)) continue
      ops.push(...diff(before[k], after[k], [...path, k]))
    }
    return ops
  }
  if (Array.isArray(before) && Array.isArray(after) && (keyed(before) || keyed(after)) && [...before, ...after].every((x) => keyOf(x) !== undefined)) {
    const ops: Op[] = []
    const was = new Map(before.map((x, i) => [keyOf(x)!, { x, i }]))
    const now = new Map(after.map((x, i) => [keyOf(x)!, { x, i }]))
    for (const [k, { x, i }] of was) if (!now.has(k)) ops.push({ op: 'remove', path, item: clone(x), index: i })
    for (const [k, { x, i }] of now) {
      const old = was.get(k)
      if (!old) ops.push({ op: 'insert', path, item: clone(x), index: i })
      else ops.push(...diff(old.x, x, [...path, { key: k }]))
    }
    return ops
  }
  return [{ op: 'set', path, before: clone(before), after: clone(after) }]
}

/** The same step, the other way round: items put back in the order they stood (lowest place first, so
 *  each lands where it was), then items taken out, then fields set back. */
export function invert(ops: Op[]): Op[] {
  const flipped: Op[] = ops.map((o) => o.op === 'set' ? { ...o, before: o.after, after: o.before }
    : o.op === 'insert' ? { op: 'remove', path: o.path, item: o.item, index: o.index }
    : { op: 'insert', path: o.path, item: o.item, index: o.index })
  const rank = (o: Op) => (o.op === 'insert' ? 0 : o.op === 'remove' ? 1 : 2)
  return flipped.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o)
    || (a.o.op === 'insert' && b.o.op === 'insert' ? a.o.index - b.o.index : b.i - a.i)).map((x) => x.o)
}

/** Apply ops to `doc` as it is now. Returns how many could not apply (their place is gone). */
export function apply(doc: Obj, ops: Op[]): number {
  let missed = 0
  for (const o of ops) {
    const parent = walk(doc, o.op === 'set' ? o.path.slice(0, -1) : o.path.slice(0, -1), true)
    const last = o.path[o.path.length - 1]
    if (o.op === 'set') {
      if (parent === undefined || last === undefined) { missed++; continue }
      if (typeof last === 'string') {
        if (!isObj(parent)) { missed++; continue }
        if (o.after === undefined) delete parent[last]
        else parent[last] = clone(o.after)
      } else {
        const list = parent as unknown as unknown[]
        const i = Array.isArray(list) ? list.findIndex((x) => keyOf(x) === last.key) : -1
        if (i < 0) { missed++; continue }
        if (o.after === undefined) list.splice(i, 1)
        else list[i] = clone(o.after)
      }
      continue
    }
    // insert / remove: the list is at `path`.
    let list = walk(doc, o.path, false) as unknown[] | undefined
    if (list === undefined && o.op === 'insert' && isObj(parent) && typeof last === 'string') {
      parent[last] = []
      list = parent[last] as unknown[]
    }
    if (!Array.isArray(list)) { missed++; continue }
    const k = keyOf(o.item)
    const at = list.findIndex((x) => keyOf(x) === k)
    if (o.op === 'remove') {
      if (at < 0) { missed++; continue }
      list.splice(at, 1)
    } else {
      if (at >= 0) continue // already there
      list.splice(Math.min(o.index, list.length), 0, clone(o.item))
    }
  }
  return missed
}

function walk(doc: unknown, path: PathPart[], _forParent: boolean): unknown {
  let cur: unknown = doc
  for (const p of path) {
    if (cur === undefined || cur === null) return undefined
    if (typeof p === 'string') cur = isObj(cur) ? cur[p] : undefined
    else cur = Array.isArray(cur) ? cur.find((x) => keyOf(x) === p.key) : undefined
  }
  return cur
}

// ── the history ─────────────────────────────────────────────────────────────

export const MAX_STEPS = 100
/** Steps of the same kind this close together are one (typing in a shot's action). */
export const MERGE_MS = 2000

export interface UndoState { done: Step[]; undone: Step[] }

/** Where a store's steps live: the UI snapshot (so they survive a reload) in the app, memory in tests. */
export interface UndoKeeper {
  get(): UndoState
  set(s: UndoState): void
}

const keepers = new WeakMap<DocumentStore, UndoKeeper>()

export function keepUndo(store: DocumentStore, keeper: UndoKeeper) {
  keepers.set(store, keeper)
}

export function memoryKeeper(): UndoKeeper {
  let s: UndoState = { done: [], undone: [] }
  return { get: () => s, set: (n) => { s = n } }
}

const pathKey = (ops: Op[]) => JSON.stringify(ops.map((o) => o.path))

/** A person's write: keep its step (merged with the last when it is the same edit moments later). */
export function noteStep(store: DocumentStore, before: unknown, after: unknown, label: string, now = Date.now()) {
  const keeper = keepers.get(store)
  if (!keeper) return
  const ops = diff(before, after)
  if (!ops.length) return
  const s = keeper.get()
  const last = s.done.at(-1)
  if (last && last.label === label && now - last.at < MERGE_MS && pathKey(last.ops) === pathKey(ops) && ops.every((o) => o.op === 'set')) {
    // The same field again: keep the first "before", take the new "after".
    const merged = last.ops.map((o, i) => ({ ...o, after: (ops[i] as Extract<Op, { op: 'set' }>).after })) as Op[]
    keeper.set({ done: [...s.done.slice(0, -1), { ...last, ops: merged, at: now }], undone: [] })
    return
  }
  keeper.set({ done: [...s.done, { label, ops, at: now }].slice(-MAX_STEPS), undone: [] })
}

export function undoState(store: DocumentStore): UndoState {
  return keepers.get(store)?.get() ?? { done: [], undone: [] }
}

/** Plain words for a step, for the button ("Undo: deleted clip v4"). */
export function stepWords(label: string): string {
  return label
    .replace(/ (frame|take|shot|ref|pin)_[0-9A-Z]{26}/g, '')
    .replace(/^pick take$/, 'picked a clip version')
    .replace(/^pick frame$/, 'picked a frame version')
}

/** Undo the last step: its inverse on the document as it is now (not a step itself). */
export async function undo(store: DocumentStore): Promise<{ label: string; partial: boolean } | null> {
  return move(store, 'undo')
}

/** Redo the last undone step. */
export async function redo(store: DocumentStore): Promise<{ label: string; partial: boolean } | null> {
  return move(store, 'redo')
}

async function move(store: DocumentStore, way: 'undo' | 'redo'): Promise<{ label: string; partial: boolean } | null> {
  const keeper = keepers.get(store)
  if (!keeper) return null
  const s = keeper.get()
  const step = way === 'undo' ? s.done.at(-1) : s.undone.at(-1)
  if (!step) return null
  const ops = way === 'undo' ? invert(step.ops) : step.ops
  const before = store.get()
  const draft = structuredClone(before) as unknown as Obj
  const missed = apply(draft, ops)
  const mp = createMergePatch(before, draft)
  const words = stepWords(step.label)
  if (mp !== undefined) await store.patch(mp as object, { action: `${way === 'undo' ? 'undid' : 'redid'}: ${words}` })
  keeper.set(way === 'undo'
    ? { done: s.done.slice(0, -1), undone: [...s.undone, step] }
    : { done: [...s.done, step], undone: s.undone.slice(0, -1) })
  return { label: words, partial: missed > 0 }
}
