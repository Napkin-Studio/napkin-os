// The document: one participant's work, shaped exactly like
// production-tool/contracts/document.schema.json. Behind `DocumentStore` so
// the wiring step (after D9) can swap this for CLAN writes through napkin-wasm
// without the panels changing.

import type { ProductionDocument } from '../contracts/types'
import { idbGet, idbPut } from '../lib/idb'
import { applyMergePatch, createMergePatch } from './mergePatch'
import { noteStep } from './undo'
import type { Doc, DocumentStore, Verdict } from './types'

export type { DocumentStore } from './types'

export function emptyDocument(participant = { id: 'p_local', handle: 'guest' }): ProductionDocument {
  return {
    contract_version: '2',
    app: 'production-tool',
    participant,
    stage: { current: 'character', next_action: 'Draw, write or drop pictures anywhere, select them, then Generate.' },
    assets: [],
    keys: [],
    refs: [],
    script: { revisions: [] },
    shots: [],
    frames: [],
    takes: [],
    jobs: [],
    reviews: [],
    stale: [],
    exports: [],
  }
}

/** Something that keeps a snapshot between reloads. */
export interface Persister<T> {
  load(): Promise<T | undefined>
  save(value: T): Promise<void>
}

export function idbPersister<T>(key: string): Persister<T> {
  return {
    load: () => idbGet<T>('kv', key),
    save: async (v) => {
      await idbPut('kv', key, v)
    },
  }
}

export function memoryPersister<T>(): Persister<T> & { value?: T } {
  const p: Persister<T> & { value?: T } = {
    load: async () => p.value,
    save: async (v) => {
      p.value = structuredClone(v)
    },
  }
  return p
}

/** A small observable value with a debounced snapshot. Used for the document and the UI state. */
export class SnapshotStore<T> {
  protected value: T
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly persister: Persister<T> | null
  private readonly delay: number

  constructor(initial: T, persister: Persister<T> | null = null, delay = 250) {
    this.value = initial
    this.persister = persister
    this.delay = delay
  }

  /** Load the last snapshot, if any. Call once before rendering. */
  async restore(fix?: (v: T) => T): Promise<boolean> {
    if (!this.persister) return false
    try {
      const v = await this.persister.load()
      if (v === undefined) return false
      this.value = fix ? fix(v) : v
      this.emit()
      return true
    } catch {
      return false
    }
  }

  get = (): T => this.value

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  update(fn: (draft: T) => void, _why?: string) {
    const draft = structuredClone(this.value)
    fn(draft)
    this.value = draft
    this.emit()
    this.schedule()
  }

  replace(v: T) {
    this.value = v
    this.emit()
    this.schedule()
  }

  /** Write the snapshot now (tests, export, page hide). */
  async flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.persister) return
    try {
      await this.persister.save(this.value)
    } catch { /* storage refused; keep going in memory */ }
  }

  private schedule() {
    if (!this.persister) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.delay)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}

/**
 * The JSON document in memory, snapshotted to IndexedDB. Implements the shared
 * DocumentStore interface; the CLAN store (napkin-wasm) replaces it at wiring.
 */
export class SnapshotDocumentStore extends SnapshotStore<ProductionDocument> implements DocumentStore {
  /** Human verdicts; the CLAN store appends them to the decision chain. Kept in memory here. */
  readonly verdicts: (Verdict & { at: string })[] = []

  async load(): Promise<Doc | null> {
    return (await this.restore(normaliseDocument)) ? this.get() : null
  }

  async create(init: { participant: { id: string; handle: string } }): Promise<Doc> {
    this.replace(emptyDocument(init.participant))
    return this.get()
  }

  async patch(mergePatch: object, _why: { action: string; rationale?: string }): Promise<Doc> {
    this.replace(applyMergePatch(this.value, mergePatch))
    return this.get()
  }

  async verdict(v: Verdict): Promise<void> {
    this.verdicts.push({ ...v, at: new Date().toISOString() })
  }

  async exportClan(): Promise<Uint8Array> {
    throw new Error('not available until CLAN store is wired')
  }

  onChange(cb: (d: Doc) => void): () => void {
    return this.subscribe(() => cb(this.get()))
  }
}

/**
 * Edit the document with a draft function; the change goes to the store as an
 * RFC 7396 merge patch, so this works the same on the CLAN store.
 */
/** A person's change: written, and kept as an undo step (doc/undo.ts). */
export function updateDoc(store: DocumentStore, fn: (draft: Doc) => void, action = 'edit', rationale?: string): Promise<Doc> {
  return write(store, fn, action, rationale, false)
}

/** The app's own change (job bookkeeping, a result landing, sign in, the stage, the canvas sync): written,
 *  but never an undo step, so undo does not fight with jobs or Excalidraw's own undo. */
export function systemUpdate(store: DocumentStore, fn: (draft: Doc) => void, action = 'edit', rationale?: string): Promise<Doc> {
  return write(store, fn, action, rationale, true)
}

function write(store: DocumentStore, fn: (draft: Doc) => void, action: string, rationale: string | undefined, system: boolean): Promise<Doc> {
  const before = store.get()
  const draft = structuredClone(before)
  fn(draft)
  const mp = createMergePatch(before, draft)
  if (mp === undefined) return Promise.resolve(before)
  if (!system) noteStep(store, before, draft, action)
  return store.patch(mp as object, rationale ? { action, rationale } : { action })
}

/** Subscribe in the shape useSyncExternalStore wants. */
export function subscribeDoc(store: DocumentStore) {
  return (fn: () => void) => store.onChange(() => fn())
}

/** Fill in optional lists an older snapshot may lack, so panels can rely on them. Frame → next frame
 *  marks (the chain before 2026-10-09) no longer mean out of date, so they are dropped on open
 *  (features/one-to-one-updates.clan). */
export function normaliseDocument(d: ProductionDocument): ProductionDocument {
  return {
    ...d,
    keys: d.keys ?? [],
    refs: d.refs ?? [],
    script: d.script ?? { revisions: [] },
    shots: d.shots ?? [],
    frames: d.frames ?? [],
    takes: d.takes ?? [],
    reviews: d.reviews ?? [],
    stale: (d.stale ?? []).filter((s) => !(s.target.kind === 'frame' && s.caused_by.kind === 'frame')),
    exports: d.exports ?? [],
  }
}
