// The panels' writes, and the snapshot store that stands in when the .clan
// engine cannot load (contract 3). The real store is model/store.ts
// (ModelStore): napkin-wasm behind clan-store's buses.

import { migrateToGenerations, needsGenerations, newProjectData, type Person } from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { idbGet, idbPut } from '../lib/idb'
import { newId } from '../lib/ulid'
import { describeWrite } from './describe'
import type { Doc, DocumentStore, WriteWhy } from './types'

export type { DocumentStore } from './types'

/** A new project's data (one script, storyboard and video, linked), as clan-store's create() makes it. */
export function emptyDocument(person: Person, title = 'Untitled ad'): ProductionDocument {
  return newProjectData({ person, title, newId, now: new Date().toISOString() }) as unknown as ProductionDocument
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

/** A small observable value with a debounced snapshot. Used for the UI state, and the fallback document. */
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

  protected emit() {
    for (const fn of this.listeners) fn()
  }
}

/**
 * The document as plain data in IndexedDB, with no decision chain: used only when the .clan engine
 * cannot load ("Saving without history"). Changes apply as they are; there is no undo.
 */
export class SnapshotDocumentStore extends SnapshotStore<ProductionDocument> implements DocumentStore {
  async load(): Promise<Doc | null> {
    // A snapshot from before generations moves once, as the CLAN store moves a .clan (features/make-and-edit.clan).
    return (await this.restore((v) => (needsGenerations(v) ? migrateToGenerations(v) : v))) && this.get().contract_version === '3' ? this.get() : null
  }

  async create(person: Person, title?: string): Promise<Doc> {
    this.replace(emptyDocument(person, title))
    return this.get()
  }

  async change(fn: (draft: Doc) => void, _why: WriteWhy): Promise<Doc> {
    this.update(fn)
    return this.get()
  }

  async exportClan(): Promise<Uint8Array> {
    throw new Error('the .clan engine did not load in this browser')
  }

  onChange(cb: (d: Doc) => void): () => void {
    return this.subscribe(() => cb(this.get()))
  }
}

/** A person's change: one decision in the chain, named by describe.ts, and one undo step. */
export function updateDoc(store: DocumentStore, fn: (draft: Doc) => void, action = 'set', rationale?: string): Promise<Doc> {
  return write(store, fn, action, rationale, false)
}

/** The app's own change (job bookkeeping, the canvas's sync): never an undo step, and written quietly
 *  unless describe.ts names it a decision (a job asked for). */
export function systemUpdate(store: DocumentStore, fn: (draft: Doc) => void, action = 'sync', rationale?: string): Promise<Doc> {
  return write(store, fn, action, rationale, true)
}

/** An agent's landing: one decision by the crew member, citing the job, not an undo step of anyone's. */
export function landUpdate(store: DocumentStore, fn: (draft: Doc) => void, why: WriteWhy): Promise<Doc> {
  return store.change(fn, { ...why, undo: why.undo ?? false })
}

function write(store: DocumentStore, fn: (draft: Doc) => void, action: string, rationale: string | undefined, system: boolean): Promise<Doc> {
  const before = store.get()
  const draft = structuredClone(before)
  fn(draft)
  if (JSON.stringify(draft) === JSON.stringify(before)) return Promise.resolve(before)
  const said = describeWrite(action, before, draft)
  // A job asked for cites the named refs it sends, so "why does @maya look like this" finds it.
  const docId = action.startsWith('submit ') ? store.documentId?.() : undefined
  if (said && docId) {
    const job = Object.values(draft.jobs).find((j) => !before.jobs[j.id])
    const refs = [...new Set((job?.inputs ?? []).filter((r) => r.kind === 'ref' && r.ref && draft.refs[r.ref]).map((r) => r.ref!))]
    if (refs.length) said.cites = refs.map((r) => `${docId}#refs[${r}]`).slice(0, 32)
  }
  const why: WriteWhy = said
    ? { ...said, rationale: [rationale, said.rationale].filter(Boolean).join(' · ') || undefined, undo: !system }
    : { action, quiet: true, undo: !system }
  // fn ran once, on `draft` (it may make ids): the store takes the draft as it is.
  return store.change((d) => {
    for (const k of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[k]
    Object.assign(d, draft)
  }, why)
}

/** Subscribe in the shape useSyncExternalStore wants. */
export function subscribeDoc(store: DocumentStore) {
  return (fn: () => void) => store.onChange(() => fn())
}
