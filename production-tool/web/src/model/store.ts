// The document as a real .clan, written through clan-store's buses
// (contracts/collab.md; features/contract-v3.clan, "the model layer").
//
// Panels change a draft (doc/store.ts updateDoc, systemUpdate). The store
// shows the change at once, and writes it 250 ms after the last one, through
// LocalPatchBus (field patches: one decision per change, with its targets) and
// LocalTextBus (live text, checkpointed). Bookkeeping (job states, assets) is
// folded together and written quietly; typing in one field folds into one
// decision. A write the .clan refuses is rolled back and said. Undo is
// LocalUndo's, kept in ProjectUi.undo so it survives a reload.

import {
  ClanDocumentStore, indexedDbPersistence, LocalPatchBus, LocalTextBus, LocalUndo, recordJobOutcome, TERMINAL,
  type ChainEntry, type JobEntry, type Person, type Persistence, type SerializedUndo,
} from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { record as recordEvent } from '../dogfood/recorder'
import type { Doc, DocumentStore, UndoResult, WriteWhy } from '../doc/types'
import { changeOf } from './diff'

export type { ChainEntry } from '../../../clan-store/src'

/** The IndexedDB database the .clan bytes live in: CLAN_DB + ':' + the project's id (projects/storage.ts). */
export const CLAN_DB = 'napkin-production-tool-clan'

interface Pending {
  why: WriteWhy
  after: Doc
}

export interface ModelStoreOptions {
  /** Where the undo steps are kept (ProjectUi.undo), and where they come from on open. */
  undo?: { saved: SerializedUndo | null | undefined; save: (s: SerializedUndo) => void }
  debounceMs?: number
}

export class ModelStore implements DocumentStore {
  readonly clan: ClanDocumentStore
  readonly bus: LocalPatchBus
  readonly text: LocalTextBus
  readonly undoer: LocalUndo
  private value: Doc | null = null
  private pending: Pending[] = []
  private readonly listeners = new Set<(d: Doc) => void>()
  private readonly chainListeners = new Set<() => void>()
  private readonly troubleListeners = new Set<(message: string) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()
  private readonly outcomes = new Set<string>()
  private readonly delay: number
  private closed = false
  /** The last write the .clan refused, if any. */
  trouble: string | null = null

  constructor(clan: ClanDocumentStore, opts: ModelStoreOptions = {}) {
    this.clan = clan
    this.bus = new LocalPatchBus(clan)
    this.text = new LocalTextBus(this.bus)
    this.undoer = new LocalUndo({ saved: opts.undo?.saved ?? null, onChange: (s) => opts.undo?.save(s) })
    this.undoer.bind(this.bus, this.text)
    this.delay = opts.debounceMs ?? 250
  }

  /** The browser default: the project's own IndexedDB database, napkin-wasm beside the bundle. */
  static inBrowser(person: Person, opts: ModelStoreOptions & { persistence?: Persistence } = {}): ModelStore {
    return new ModelStore(new ClanDocumentStore({ person, persistence: opts.persistence ?? indexedDbPersistence(CLAN_DB) }), opts)
  }

  // ── opening ──

  /** The saved project, or null. Throws UnsupportedContract for one made under another contract. */
  async load(): Promise<Doc | null> {
    const d = await this.clan.load()
    if (!d) return null
    return this.opened()
  }

  /** A .clan from bytes. Throws UnsupportedContract, leaving the bytes as they were. */
  async open(bytes: Uint8Array): Promise<Doc> {
    await this.clan.open(bytes)
    return this.opened()
  }

  async create(person: Person, title?: string): Promise<Doc> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = []
    await this.clan.create({ person, title })
    return this.opened()
  }

  private opened(): Doc {
    this.text.hydrateAll()
    this.value = this.clan.get() as unknown as Doc
    this.emit()
    this.notifyChain()
    void this.serial(async () => {
      if (await this.recordOutcomes()) this.notifyChain()
    })
    return this.value
  }

  /** The project was closed: write what is pending, then take no more writes. */
  async close(): Promise<void> {
    await this.flush()
    await this.text.leave().catch(() => {})
    this.closed = true
    this.clan.dispose()
    this.listeners.clear()
    this.chainListeners.clear()
  }

  // ── DocumentStore ──

  get = (): Doc => {
    if (!this.value) throw new Error('no document: call load() or create() first')
    return this.value
  }

  documentId(): string {
    return this.clan.documentId()
  }

  change(fn: (draft: Doc) => void, why: WriteWhy): Promise<Doc> {
    if (this.closed) {
      console.warn('a write to a closed project was dropped', why.action)
      return Promise.resolve(this.value as Doc)
    }
    const before = this.get()
    const after = structuredClone(before)
    fn(after)
    if (JSON.stringify(after) === JSON.stringify(before)) return Promise.resolve(before)
    this.value = after
    const last = this.pending.at(-1)
    const folds = last && last !== this.current && (
      (why.quiet && last.why.quiet) || (why.coalesce && last.why.coalesce === why.coalesce))
    if (folds) last!.after = after
    else this.pending.push({ why, after })
    this.emit()
    this.schedule()
    return Promise.resolve(after)
  }

  async exportClan(): Promise<Uint8Array> {
    await this.flush()
    return this.clan.exportClan()
  }

  onChange(cb: (d: Doc) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.serial(() => this.drain())
    await this.clan.flush()
  }

  async undo(): Promise<UndoResult> {
    await this.flush()
    const r = await this.serial(() => this.undoer.undo())
    this.settled()
    return r
  }

  async redo(): Promise<UndoResult> {
    await this.flush()
    const r = await this.serial(() => this.undoer.redo())
    this.settled()
    return r
  }

  undoLabels() {
    const s = this.undoer.serialize()
    return { undo: s.undo.at(-1)?.label ?? null, redo: s.redo.at(-1)?.label ?? null }
  }

  async record(action: string, rationale?: string, extra: { cites?: string[]; targets?: string[]; agent?: string } = {}): Promise<void> {
    await this.flush()
    await this.clan.record({ action, ...(rationale ? { rationale } : {}), ...extra })
    this.notifyChain()
  }

  /** The decision chain, newest first, with everything pending in it. */
  async chain(): Promise<ChainEntry[]> {
    await this.flush()
    return this.clan.chain()
  }

  onChain(cb: () => void): () => void {
    this.chainListeners.add(cb)
    return () => this.chainListeners.delete(cb)
  }

  onTrouble(cb: (message: string) => void): () => void {
    this.troubleListeners.add(cb)
    return () => this.troubleListeners.delete(cb)
  }

  // ── Inside ──

  private current: Pending | null = null

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writing.then(fn, fn)
    this.writing = run.then(() => {}, () => {})
    return run
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    const typing = !!this.pending.at(-1)?.why.coalesce
    this.timer = setTimeout(() => {
      this.timer = null
      void this.serial(() => this.drain())
    }, typing ? Math.max(this.delay, 1500) : this.delay)
  }

  /** The buses' document is the truth again (after an undo, a refusal). */
  private settled() {
    if (this.pending.length) return
    this.value = this.bus.doc() as unknown as Doc
    this.emit()
    this.notifyChain()
  }

  private async drain() {
    let wrote = false
    while (this.pending.length) {
      const item = this.pending[0]
      this.current = item
      try {
        const { patches, text } = changeOf(this.bus.doc() as unknown as ProductionDocument, item.after)
        const why = item.why
        const agentLanding = !!why.agent && !why.agent.startsWith('human:')
        const undoable = why.undo ?? (!why.quiet && !agentLanding)
        let applied = false
        if (patches.length) {
          const r = await this.bus.apply({
            patches,
            why: {
              action: why.action,
              ...(why.agent ? { agent: why.agent } : {}),
              ...(why.rationale ? { rationale: why.rationale } : {}),
              ...(why.cites?.length ? { cites: why.cites } : {}),
              ...(why.reasoning ? { reasoning: why.reasoning } : {}),
              ...(why.pinned ? { pinned: true } : {}),
              ...(why.quiet ? { quiet: true } : {}),
            },
          }, { undo: undoable })
          if (!r.applied) throw new Error([...r.refused.map((x) => x.message), ...r.conflicts.map((c) => `${c.entity} ${c.id} ${c.path ?? ''} changed since`)].join('; '))
          applied = true
          if (!why.quiet) wrote = true
        }
        for (const t of text) {
          await this.text.replace(t.kind, t.id, t.prose, why.agent ?? this.clan.personClaim(), { label: why.action, undo: undoable, joinStep: applied })
          applied = true
        }
        if (!why.quiet && applied) recordEvent('decision', why.action, { rationale: why.rationale, pinned: why.pinned })
        if (why.mirror) void this.clan.mirrorNow('accept').catch(() => {})
      } catch (e) {
        this.current = null
        this.refused(e)
        return
      }
      this.current = null
      this.pending.shift()
      if (await this.recordOutcomes()) wrote = true
    }
    if (await this.recordOutcomes()) wrote = true
    // Nothing more waiting: show what the buses hold, with checkpoint's fields (prose, refs, last writer).
    if (!this.pending.length) {
      this.value = this.bus.doc() as unknown as Doc
      this.emit()
    }
    if (wrote) this.notifyChain()
  }

  /** The decision of every job that ended with no result (a landing is its own decision). */
  private async recordOutcomes(): Promise<boolean> {
    let wrote = false
    for (const j of Object.values(this.clan.get().jobs ?? {}) as unknown as JobEntry[]) {
      if (!TERMINAL.has(j.state) || this.outcomes.has(j.id)) continue
      this.outcomes.add(j.id)
      try {
        if (await recordJobOutcome(this.clan, j)) wrote = true
      } catch (e) {
        console.warn('could not record the job in the decision chain', j.id, e)
      }
    }
    return wrote
  }

  private refused(e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`the .clan refused a write; rolling back to what it holds: ${message}`, e)
    this.trouble = message
    this.pending = []
    this.value = this.bus.doc() as unknown as Doc
    this.emit()
    for (const cb of this.troubleListeners) cb(message)
  }

  private emit() {
    const d = this.value
    if (!d) return
    for (const cb of this.listeners) {
      try {
        cb(d)
      } catch (err) {
        console.error('onChange listener failed', err)
      }
    }
  }

  private notifyChain() {
    for (const cb of this.chainListeners) cb()
  }
}
