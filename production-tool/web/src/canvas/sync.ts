// The canvas and the document, kept in step when generated images are deleted
// and come back (the 🗑, the Delete key, Excalidraw's own Ctrl+Z or Ctrl+Y). A
// running job whose image goes is cancelled; the job itself stays on record.
// Names are the document's: a named image is a solid reference and keeps its
// name in References when its node leaves the canvas.
//
// No Excalidraw import here, so it runs (and is tested) on plain elements.

import type { CustomData } from '../contracts/types'
import { TERMINAL_STATES } from '../contracts/types'
import { bareRemoval, deleteFrom, removeGen, removeSketch, restoreTo, type Removal } from '../doc/remove'
import type { DocumentStore } from '../doc/types'

export interface SceneEl {
  id: string
  type: string
  isDeleted?: boolean
  customData?: unknown
}

function genId(e: SceneEl): string | undefined {
  const c = e.customData as CustomData | undefined
  return c && typeof c === 'object' && c.kind === 'gen' ? c.id : undefined
}

/** A sketch area's sketches[id] (features/frame-aspect.clan). */
function sketchId(e: SceneEl): string | undefined {
  const c = e.customData as CustomData | undefined
  return c && typeof c === 'object' && c.kind === 'sketch' && e.type === 'rectangle' ? c.id : undefined
}

export interface CanvasSyncDeps {
  doc: DocumentStore
  /** Stop a job whose image was deleted while it was still being made. */
  cancel(jobId: string): void
}

export class CanvasDocSync {
  private readonly deps: CanvasSyncDeps
  /** Gens alive at the last sync (null until the first). */
  private alive: Set<string> | null = null
  private readonly seen = new Set<string>()
  private readonly removals = new Map<string, Removal>()
  /** Gens whose element goes away without being deleted (a retry moves it to a new id). */
  readonly moved = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  /** Sketch areas alive at the last sync (null until the first). */
  private areas: Set<string> | null = null
  private readonly areasSeen = new Set<string>()

  constructor(deps: CanvasSyncDeps) {
    this.deps = deps
  }

  /** Generated images deleted or brought back since the last call. */
  gens(els: readonly SceneEl[]): Promise<void> {
    const now = new Set(els.filter((e) => !e.isDeleted).map(genId).filter((x): x is string => !!x))
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
      this.queue = this.queue.then(() => this.removeGen(id)).catch((e) => console.warn('could not record the delete', e))
    }
    for (const id of back) this.queue = this.queue.then(() => this.restoreGen(id)).catch((e) => console.warn('could not record the restore', e))
    return this.queue
  }

  /**
   * Sketch areas deleted or brought back since the last call: the sketches[id] row goes with its
   * area (the frames made from it stay) and comes back with it, in step with the canvas's undo.
   */
  sketches(els: readonly SceneEl[]): Promise<void> {
    const now = new Set(els.filter((e) => !e.isDeleted).map(sketchId).filter((x): x is string => !!x))
    if (!this.areas) {
      this.areas = now
      for (const id of now) this.areasSeen.add(id)
      return this.queue
    }
    const gone = [...this.areas].filter((id) => !now.has(id))
    const back = [...now].filter((id) => !this.areas!.has(id) && this.areasSeen.has(id))
    for (const id of now) this.areasSeen.add(id)
    this.areas = now
    for (const id of gone) {
      this.queue = this.queue.then(async () => {
        this.removals.set(id, await deleteFrom(this.deps.doc, (d) => removeSketch(d, id), { system: true }))
      }).catch((e) => console.warn('could not record the delete', e))
    }
    for (const id of back) {
      this.queue = this.queue.then(async () => {
        const r = this.removals.get(id) ?? bareRemoval('sketch', id, `sketch area ${id}`)
        this.removals.delete(id)
        await restoreTo(this.deps.doc, r)
      }).catch((e) => console.warn('could not record the restore', e))
    }
    return this.queue
  }

  private async removeGen(id: string) {
    const store = this.deps.doc
    const job = store.get().jobs[id]
    if (job && !TERMINAL_STATES.includes(job.state)) this.deps.cancel(id)
    this.removals.set(id, await deleteFrom(store, (d) => removeGen(d, id), { system: true }))
  }

  private async restoreGen(id: string) {
    const r = this.removals.get(id) ?? bareRemoval('gen', id, `generated image ${id}`)
    this.removals.delete(id)
    await restoreTo(this.deps.doc, r)
  }
}
