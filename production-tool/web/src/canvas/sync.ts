// The canvas and the document, kept in step when generated images, sketch areas
// and the document's nodes (Script, Storyboard, Video) are deleted and come back
// (the 🗑, the Delete key, the canvas's own Ctrl+Z or Ctrl+Y). A running job whose
// image or node goes is cancelled; the job itself stays on record.
// Names are the document's: a named image is a solid reference and keeps its
// name in References when its node leaves the canvas.
//
// No Excalidraw import here, so it runs (and is tested) on plain elements.

import type { CustomData, ProductionDocument } from '../contracts/types'
import { TERMINAL_STATES } from '../contracts/types'
import { bareRemoval, deleteFrom, removeGen, removeNode, removeSketch, removeText, restoreTo, type NodeRemovalKind, type Removal } from '../doc/remove'
import { newId } from '../lib/ulid'
import type { DocumentStore } from '../doc/types'
import { systemUpdate } from '../doc/store'

export interface SceneEl {
  id: string
  type: string
  isDeleted?: boolean
  customData?: unknown
  /** A sketch area's ratio, as its tool drew it ('16:9'). */
  ratio?: string
  /** A text's words, and the shape it is bound in (bound text is the shape's, not a text of its own). */
  text?: string
  containerId?: string | null
}

/** The most words a texts[id] row keeps (document.schema.json). */
export const TEXT_WORDS_MAX = 4000

/** A text written on the canvas (features/canvas-text.clan): a text element of its own, not a shape's label. */
const isCanvasText = (e: SceneEl) => !e.isDeleted && e.type === 'text' && !e.containerId
const wordsOf = (e: SceneEl) => (e.text ?? '').slice(0, TEXT_WORDS_MAX)

function genId(e: SceneEl): string | undefined {
  const c = e.customData as CustomData | undefined
  return c && typeof c === 'object' && c.kind === 'gen' ? c.id : undefined
}

/** A sketch area's sketches[id] (features/frame-aspect.clan). */
function sketchId(e: SceneEl): string | undefined {
  const c = e.customData as CustomData | undefined
  return c && typeof c === 'object' && c.kind === 'sketch' && e.type === 'rectangle' ? c.id : undefined
}

const NODE_KINDS: readonly string[] = ['script', 'storyboard', 'video']

/** A node element's document entity (canvas-nodes' tag {kind, id}), as 'kind:id'. */
function nodeKey(e: SceneEl): string | undefined {
  const c = e.customData as { kind?: unknown; id?: unknown } | undefined
  return c && typeof c === 'object' && typeof c.kind === 'string' && NODE_KINDS.includes(c.kind) && typeof c.id === 'string' ? `${c.kind}:${c.id}` : undefined
}

export interface CanvasSyncDeps {
  doc: DocumentStore
  /** Stop a job whose image was deleted while it was still being made. */
  cancel(jobId: string): void
  /** Who draws: a sketch area drawn here gets its sketches[id] row in their name. */
  drawnBy?: () => string
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
  /** Nodes alive at the last sync, as 'kind:id' (null until the first). */
  private nodesAlive: Set<string> | null = null
  private readonly nodesSeen = new Set<string>()
  /** Storyboard nodes whose shots went back to their video when the node went (redo shows them again). */
  private readonly folded = new Set<string>()
  /** Text elements alive at the last sync (null until the first), and every one seen. */
  private textsAlive: Set<string> | null = null
  private readonly textsSeen = new Set<string>()
  /** Text elements whose row is being written (not written twice). */
  private readonly textsPending = new Set<string>()

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
    // An area drawn on our own engine has no row yet: it gets one at its ratio (a system write), so
    // links into it and its Generate find it in the document.
    const drawnBy = this.deps.drawnBy
    if (drawnBy) {
      const d = this.deps.doc.get()
      const fresh = els.filter((e) => !e.isDeleted && sketchId(e) && !this.areasSeen.has(sketchId(e)!) && !d.sketches?.[sketchId(e)!] && /^\d+:\d+$/.test(e.ratio ?? ''))
      if (fresh.length) {
        this.queue = this.queue.then(() => systemUpdate(this.deps.doc, (x) => {
          for (const e of fresh) {
            const id = sketchId(e)!
            const [w, h] = e.ratio!.split(':').map(Number)
            if (!x.sketches[id]) x.sketches[id] = { id, v: 1, field_v: {}, aspect: { w, h }, ratio: e.ratio as never, drawn_by: drawnBy() }
          }
        }, 'sketch area').then(() => {})).catch((e) => console.warn('could not record the sketch area', e))
      }
    }
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

  /**
   * The document's nodes deleted or brought back since the last call (features/canvas-edit-tools.clan):
   * a Script, Storyboard or Video node takes its entity out through removeNode (a running job on it is
   * stopped first) and puts it back with restoreTo, in step with the canvas's undo.
   */
  nodes(els: readonly SceneEl[]): Promise<void> {
    const now = new Set(els.filter((e) => !e.isDeleted).map(nodeKey).filter((x): x is string => !!x))
    if (!this.nodesAlive) {
      this.nodesAlive = now
      for (const k of now) this.nodesSeen.add(k)
      return this.queue
    }
    const gone = [...this.nodesAlive].filter((k) => !now.has(k))
    const back = [...now].filter((k) => !this.nodesAlive!.has(k) && this.nodesSeen.has(k))
    for (const k of now) this.nodesSeen.add(k)
    this.nodesAlive = now
    for (const k of gone) {
      const [kind, id] = k.split(/:(.*)/s) as [NodeRemovalKind, string]
      this.queue = this.queue.then(async () => {
        const store = this.deps.doc
        const d = store.get()
        const map = kind === 'script' ? d.scripts : kind === 'storyboard' ? d.storyboards : d.videos
        if (!map[id]) return
        // A storyboard made from a video's own shots (it keeps video_id): its shots go back to the video,
        // its own shot list again, instead of being deleted (decided 2026-10-15). Its arrows go with the node.
        const own = kind === 'storyboard' ? d.storyboards[id]?.video_id : undefined
        if (own && d.videos[own]) {
          this.folded.add(k)
          await systemUpdate(store, (x) => { if (x.storyboards[id]) x.storyboards[id].implicit = true }, `put the shots of storyboards[${id}] back in videos[${own}]`)
          return
        }
        for (const j of runningOn(d, kind, id)) this.deps.cancel(j)
        this.removals.set(k, await deleteFrom(store, (doc) => removeNode(doc, kind, id), { system: true }))
      }).catch((e) => console.warn('could not record the delete', e))
    }
    for (const k of back) {
      this.queue = this.queue.then(async () => {
        if (this.folded.delete(k)) {
          const id = k.split(/:(.*)/s)[1]
          await systemUpdate(this.deps.doc, (x) => { if (x.storyboards[id]) delete x.storyboards[id].implicit }, `show storyboards[${id}] on the canvas again`)
          return
        }
        const r = this.removals.get(k)
        this.removals.delete(k)
        if (r) await restoreTo(this.deps.doc, r)
      }).catch((e) => console.warn('could not record the restore', e))
    }
    return this.queue
  }

  /**
   * Texts on the canvas and their texts[id] rows (features/canvas-text.clan), so a node a text is
   * linked into reads its words from the document: a text gets its row (a system write), an edit
   * rewrites its words, a delete takes the row out with its links, and the canvas's undo puts them back.
   */
  texts(els: readonly SceneEl[]): Promise<void> {
    const live = new Map(els.filter(isCanvasText).map((e) => [e.id, e]))
    const d = this.deps.doc.get()
    const rows = Object.values(d.texts ?? {})
    const rowOf = new Map(rows.map((t) => [t.node, t]))
    const was = this.textsAlive
    this.textsAlive = new Set(live.keys())
    const gone = was ? [...was].filter((id) => !live.has(id)) : []
    const back = was ? [...live.keys()].filter((id) => !was.has(id) && this.textsSeen.has(id) && this.removals.has(`text:${id}`)) : []
    for (const id of live.keys()) this.textsSeen.add(id)
    const make: SceneEl[] = []
    const reword: { id: string; words: string }[] = []
    for (const e of live.values()) {
      if (back.includes(e.id) || this.textsPending.has(e.id)) continue
      const row = rowOf.get(e.id)
      const words = wordsOf(e)
      if (!row) { if (words.trim()) make.push(e) }
      else if (row.words !== words) reword.push({ id: row.id, words })
    }
    if (make.length || reword.length) {
      for (const e of make) this.textsPending.add(e.id)
      this.queue = this.queue.then(() => systemUpdate(this.deps.doc, (x) => {
        x.texts ??= {}
        for (const e of make) {
          if (Object.values(x.texts).some((t) => t.node === e.id)) continue
          const id = newId('text')
          x.texts[id] = { id, v: 1, field_v: {}, node: e.id, words: wordsOf(e) }
        }
        for (const r of reword) if (x.texts[r.id]) x.texts[r.id].words = r.words
      }, make.length ? 'text on the canvas' : 'edit a text').then(() => {})).catch((e) => console.warn('could not record the text', e))
        .finally(() => { for (const e of make) this.textsPending.delete(e.id) })
    }
    for (const node of gone) {
      const row = rowOf.get(node)
      if (!row) continue
      this.queue = this.queue.then(async () => {
        this.removals.set(`text:${node}`, await deleteFrom(this.deps.doc, (x) => removeText(x, row.id), { system: true }))
      }).catch((e) => console.warn('could not record the delete', e))
    }
    for (const node of back) {
      this.queue = this.queue.then(async () => {
        const r = this.removals.get(`text:${node}`)
        this.removals.delete(`text:${node}`)
        if (r) await restoreTo(this.deps.doc, r)
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

/**
 * Jobs still running on a node or on what it holds (a storyboard's shots, a script's scenes): what a
 * delete stops, and what the in-page question names (ui-behaviour 3.3).
 */
export function runningOn(d: ProductionDocument, kind: string, id: string): string[] {
  const held = new Set<string>([`${kind}:${id}`])
  if (kind === 'storyboard') for (const s of Object.values(d.shots)) if (s.storyboard_id === id) held.add(`shot:${s.id}`)
  if (kind === 'script') for (const s of Object.values(d.scenes)) if (s.script_id === id) held.add(`scene:${s.id}`)
  return Object.values(d.jobs).filter((j) => !TERMINAL_STATES.includes(j.state) && held.has(`${j.node.kind}:${j.node.id}`)).map((j) => j.id)
}
