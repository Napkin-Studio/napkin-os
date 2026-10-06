// The canvas and the document, kept in step when things are deleted and come
// back. The canvas is the source: a reference or a generated image leaves the
// document when its element is deleted (the 🗑, the Delete key, Excalidraw's
// own Ctrl+Z or Ctrl+Y), and comes back exactly when the element does.
//
// No Excalidraw import here, so it runs (and is tested) on plain elements.

import type { CharacterRef, CustomData, View, ViewPick } from '../contracts/types'
import { TERMINAL_STATES } from '../contracts/types'
import { bareRemoval, deleteFrom, removeGen, restoreTo, type Removal } from '../doc/remove'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'

export interface SceneEl {
  id: string
  type: string
  isDeleted?: boolean
  customData?: unknown
}

type GenData = Extract<CustomData, { kind: 'gen' }>
type RefData = Extract<CustomData, { kind: 'ref' }>

function cdOf(e: SceneEl | undefined): CustomData | undefined {
  const c = e?.customData as CustomData | undefined
  return c && typeof c === 'object' && 'kind' in c ? c : undefined
}

const genOf = (e: SceneEl) => {
  const c = cdOf(e)
  return c?.kind === 'gen' ? c : undefined
}

/** Can this image fill that view slot? (The views strip's candidates.) */
export function fitsView(g: GenData, v: View): boolean {
  return g.state === 'completed' && !!g.asset && (g.view === v || (v === 'front' && !g.view && (g.op === 'generate' || g.op === 'combine')))
}

export interface CanvasSyncDeps {
  doc: DocumentStore
  /** Set or clear customData.pickedAs on gen elements (by job id), outside the undo history. */
  setPickedAs(changes: Map<string, View | undefined>): void
  /** Stop a job whose image was deleted while it was still being made. */
  cancel(jobId: string): void
}

export class CanvasDocSync {
  private readonly deps: CanvasSyncDeps
  /** Gens alive at the last sync (null until the first). */
  private alive: Set<string> | null = null
  private readonly seen = new Set<string>()
  private readonly removals = new Map<string, Removal>()
  private readonly removedRefs = new Map<string, CharacterRef>()
  /** Gens whose element goes away without being deleted (a retry moves it to a new id). */
  readonly moved = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(deps: CanvasSyncDeps) {
    this.deps = deps
  }

  /** Mirror the canvas's references into document.character.refs. */
  refs(els: readonly SceneEl[]) {
    const store = this.deps.doc
    const doc = store.get()
    const onCanvas = els.filter((e) => !e.isDeleted).map((e) => ({ e, c: cdOf(e) })).filter((x): x is { e: SceneEl; c: RefData } => x.c?.kind === 'ref')
    const here = new Set(onCanvas.map((x) => x.c.id))
    for (const r of doc.character.refs) if (!here.has(r.id)) this.removedRefs.set(r.id, r)
    let restoring = false
    const next: CharacterRef[] = onCanvas.map(({ e, c }) => {
      let prev = doc.character.refs.find((r) => r.id === c.id)
      if (!prev && this.removedRefs.has(c.id)) {
        prev = this.removedRefs.get(c.id)
        this.removedRefs.delete(c.id)
        restoring = true
      }
      const ref: CharacterRef = { id: c.id, asset: c.asset, tag: c.tag, role: c.role, kind: e.type === 'frame' ? 'sketch' : 'picture' }
      if (prev?.label) ref.label = prev.label
      return ref
    })
    if (JSON.stringify(next) !== JSON.stringify(doc.character.refs)) {
      void updateDoc(store, (d) => { d.character.refs = next }, restoring ? 'restore refs' : 'sync refs')
    }
  }

  /** Generated images deleted or brought back since the last call. */
  gens(els: readonly SceneEl[]): Promise<void> {
    const all = els.filter((e) => genOf(e))
    const now = new Set(all.filter((e) => !e.isDeleted).map((e) => genOf(e)!.id))
    if (!this.alive) {
      this.alive = now
      for (const id of now) this.seen.add(id)
      return this.queue
    }
    const gone = [...this.alive].filter((id) => !now.has(id))
    const back = [...now].filter((id) => !this.alive!.has(id) && this.seen.has(id))
    for (const id of now) this.seen.add(id)
    this.alive = now
    for (const id of gone) {
      if (this.moved.delete(id)) continue
      this.queue = this.queue.then(() => this.removeGen(id, all)).catch((e) => console.warn('could not record the delete', e))
    }
    for (const id of back) this.queue = this.queue.then(() => this.restoreGen(id, all)).catch((e) => console.warn('could not record the restore', e))
    return this.queue
  }

  private async removeGen(id: string, all: readonly SceneEl[]) {
    const store = this.deps.doc
    const doc = store.get()
    const job = doc.jobs.find((j) => j.id === id)
    if (job && !TERMINAL_STATES.includes(job.state)) this.deps.cancel(id)
    const alive = all.filter((e) => !e.isDeleted).map((e) => genOf(e)!).filter((g) => g.id !== id)
    const next: Partial<Record<View, ViewPick>> = {}
    const picked = new Map<string, View | undefined>()
    for (const [v, p] of Object.entries(doc.character.views) as [View, ViewPick | undefined][]) {
      if (p?.job_id !== id) continue
      const g = alive.filter((x) => fitsView(x, v)).at(-1)
      if (!g) continue
      next[v] = { asset: g.asset!, job_id: g.id, picked_at: new Date().toISOString() }
      picked.set(g.id, v)
    }
    const r = await deleteFrom(store, (d) => removeGen(d, id, next))
    this.removals.set(id, r)
    if (picked.size) this.deps.setPickedAs(picked)
  }

  private async restoreGen(id: string, all: readonly SceneEl[]) {
    const r = this.removals.get(id) ?? bareRemoval('gen', id, `generated image ${id}`)
    this.removals.delete(id)
    // The images that stood in for it give their slots back.
    const picked = new Map<string, View | undefined>()
    const views = this.deps.doc.get().character.views
    for (const { view } of r.views) {
      const holder = views[view]?.job_id
      if (holder && holder !== id) picked.set(holder, undefined)
    }
    await restoreTo(this.deps.doc, r)
    const back = new Set(r.views.map((v) => v.view))
    for (const e of all) {
      const g = genOf(e)
      if (!g || g.id === id || e.isDeleted) continue
      if (g.pickedAs && back.has(g.pickedAs)) picked.set(g.id, undefined)
    }
    for (const { view, before } of r.views) if (before?.job_id === id) picked.set(id, view)
    if (picked.size) this.deps.setPickedAs(picked)
  }
}
