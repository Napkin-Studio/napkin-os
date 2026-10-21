// Which named references are alive: a reference whose picture is on the canvas, or that has no canvas
// picture at all (a library copy, a brand rule, a document's). Deleting a picture on the canvas only
// marks its element deleted, so Undo brings it back; the document keeps its refs[id] row. "Alive" is
// therefore read from the canvas scene, never written to the document: the canvas tells this module
// which node ids are live (CanvasController.onChange), and liveDoc() gives every reader a view of the
// document without the dead refs, and without the links out of them. So a deleted picture's name
// stops counting everywhere (scope, the inputs strip, the send tray, the @ picker, what a job sends)
// and is free to take, and the canvas's Undo brings it all back at once (owner, 2026-10-21).
//
// Before the canvas has reported (a phone, which has no canvas, or the first moments of a load),
// nothing is known to be dead and the document is read as it is.

import type { Id, JobInput, NamedRef, ProductionDocument } from '../contracts/types'
import type { DocumentStore } from '../doc/types'

type Doc = ProductionDocument

/** Is this ref's picture alive, given the canvas's live node ids (null: not known, so alive)? */
export function refAlive(r: Pick<NamedRef, 'node'>, nodes: ReadonlySet<string> | null): boolean {
  return !r.node || !nodes || nodes.has(r.node)
}

/** The refs whose picture is gone from the canvas, by id. */
export function deadRefs(d: Doc, nodes: ReadonlySet<string> | null): Set<Id> {
  const out = new Set<Id>()
  if (!nodes) return out
  for (const r of Object.values(d.refs ?? {})) if (!refAlive(r, nodes)) out.add(r.id)
  return out
}

/** The document without these refs and the links out of them; the same object when there are none. */
export function withoutRefs(d: Doc, dead: ReadonlySet<Id>): Doc {
  if (!dead.size) return d
  const refs: Doc['refs'] = {}
  for (const [id, r] of Object.entries(d.refs ?? {})) if (!dead.has(id)) refs[id] = r
  // A key whose every picture is dead goes too: nothing of it is left to name or send.
  const liveKeys = new Set(Object.values(refs).map((r) => r.key))
  const deadKeys = new Set(Object.values(d.refs ?? {}).filter((r) => dead.has(r.id) && !liveKeys.has(r.key)).map((r) => r.key))
  const keys: Doc['keys'] = {}
  const goneKeyIds = new Set<Id>()
  for (const [id, k] of Object.entries(d.keys ?? {})) {
    if (deadKeys.has(k.key)) goneKeyIds.add(id)
    else keys[id] = k
  }
  const links: Doc['links'] = {}
  for (const [id, l] of Object.entries(d.links ?? {})) {
    if ((l.from.kind === 'ref' && dead.has(l.from.id)) || (l.from.kind === 'key' && goneKeyIds.has(l.from.id))) continue
    links[id] = l
  }
  return { ...d, refs, keys, links }
}

/** The document as the canvas has it alive: dead refs and their links left out. */
export function liveDoc(d: Doc, nodes: ReadonlySet<string> | null): Doc {
  return withoutRefs(d, deadRefs(d, nodes))
}

/** A job's input without any ref that is dead now: the last guard before a request leaves. */
export function liveInput(input: JobInput, dead: ReadonlySet<Id>): JobInput {
  if (!dead.size || !input.refs?.some((r) => dead.has(r.id))) return input
  const refs = input.refs.filter((r) => !dead.has(r.id))
  const { refs: _gone, ...rest } = input
  return refs.length ? { ...rest, refs } : rest
}

// ── the canvas's live nodes, per document store ─────────────────────────────

/** The live node ids the canvas last reported for one document store, and who listens. */
export class SceneLife {
  private nodes: ReadonlySet<string> | null = null
  private readonly listeners = new Set<() => void>()
  private cache: { doc: Doc; sig: string; out: Doc } | null = null

  /** The canvas's live node ids (element ids and node ids), or null when no canvas reports. */
  get(): ReadonlySet<string> | null {
    return this.nodes
  }

  /** Report the live node ids; listeners hear only when the set changed. */
  set(next: ReadonlySet<string> | null) {
    const was = this.nodes
    if (was === next) return
    if (was && next && was.size === next.size && [...next].every((x) => was.has(x))) return
    this.nodes = next
    for (const fn of [...this.listeners]) fn()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  /** liveDoc of `d`, the same object while the document and the dead refs are the same (for React). */
  view(d: Doc): Doc {
    const dead = deadRefs(d, this.nodes)
    const sig = [...dead].sort().join(',')
    if (this.cache && this.cache.doc === d && this.cache.sig === sig) return this.cache.out
    const out = withoutRefs(d, dead)
    this.cache = { doc: d, sig, out }
    return out
  }
}

const lives = new WeakMap<object, SceneLife>()

/** The scene life of a document store (made on first ask). */
export function lifeOf(store: DocumentStore): SceneLife {
  let l = lives.get(store)
  if (!l) lives.set(store, (l = new SceneLife()))
  return l
}

/** The store's document as the canvas has it alive. */
export function liveGet(store: DocumentStore): Doc {
  return lifeOf(store).view(store.get())
}

/** The ids of the store's refs that are dead now. */
export function deadNow(store: DocumentStore): Set<Id> {
  return deadRefs(store.get(), lifeOf(store).get())
}
