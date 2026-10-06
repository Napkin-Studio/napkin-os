// The document as a real .clan: the panels' DocumentStore over the CLAN store
// (production-tool/clan-store, napkin-wasm).
//
// The panels write synchronously and often (a drag, a keystroke, every poll of
// a job). Each CLAN write costs 10-25 ms, so this keeps the document the panels
// see in memory, applies each merge patch to it at once, and writes to the
// .clan 250 ms after the last change:
//
//   - a write the participant meant (describe.ts names it) becomes one
//     decision-chain entry, attributed to their handle;
//   - bookkeeping (job states, asset lists, the stage) is folded together and
//     written without an entry;
//   - each job that reaches a terminal state gets its director and provider
//     entries, once (clan-store/src/attribution.ts).
//
// The JSON store (store.ts) stays as the fallback when the wasm cannot load.

import {
  ClanDocumentStore, buildExportZip, indexedDbPersistence, postClanMirror, recordJobOutcome, TERMINAL,
  type ChainEntry, type JobEntry,
} from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { describeWrite, type Described, type JobCtxOf } from './describe'
import { createMergePatch, applyMergePatch } from './mergePatch'
import { normaliseDocument } from './store'
import type { Doc, DocumentStore, Verdict } from './types'

export type { ChainEntry } from '../../../clan-store/src'
export { buildExportZip, postClanMirror }

/** The IndexedDB database the .clan bytes live in (apart from the app's kv/blobs one). */
export const CLAN_DB = 'napkin-production-tool-clan'

interface Pending {
  /** null: bookkeeping, written without an entry. */
  why: Described | null
  after: Doc
}

export class ClanBackedStore implements DocumentStore {
  readonly clan: ClanDocumentStore
  private value: Doc | null = null
  private pending: Pending[] = []
  private readonly listeners = new Set<(d: Doc) => void>()
  private readonly chainListeners = new Set<() => void>()
  private readonly troubleListeners = new Set<(message: string) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()
  private readonly outcomes = new Set<string>()
  private readonly ctxOf: JobCtxOf
  private readonly delay: number
  /** The last write the .clan refused, if any. */
  trouble: string | null = null

  constructor(clan: ClanDocumentStore, opts: { ctxOf?: JobCtxOf; debounceMs?: number } = {}) {
    this.clan = clan
    this.ctxOf = opts.ctxOf ?? (() => undefined)
    this.delay = opts.debounceMs ?? 250
  }

  /** The browser default: IndexedDB, napkin-wasm beside the bundle. */
  static inBrowser(opts: { ctxOf?: JobCtxOf } = {}): ClanBackedStore {
    return new ClanBackedStore(new ClanDocumentStore({ persistence: indexedDbPersistence(CLAN_DB) }), opts)
  }

  // ── DocumentStore ──

  async load(): Promise<Doc | null> {
    const d = await this.clan.load()
    if (!d) return null
    this.value = normaliseDocument(d as unknown as ProductionDocument)
    this.emit()
    void this.serial(async () => {
      if (await this.recordOutcomes()) this.notifyChain()
    })
    return this.value
  }

  async create(init: { participant: { id: string; handle: string } }): Promise<Doc> {
    // Starting over: nothing still pending belongs to the new document.
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = []
    await this.clan.create(init)
    this.value = normaliseDocument(this.clan.get() as unknown as ProductionDocument)
    this.emit()
    this.notifyChain()
    return this.value
  }

  /** Start a .clan from earlier work (the JSON snapshot the app kept before). */
  async adopt(doc: Doc, why = 'carried over the earlier work'): Promise<Doc> {
    await this.clan.create({ participant: doc.participant })
    const mp = createMergePatch(this.clan.get(), doc)
    if (mp !== undefined) await this.clan.patch(mp as object, { action: why, rationale: 'from the snapshot this browser kept before the .clan' })
    this.value = normaliseDocument(this.clan.get() as unknown as ProductionDocument)
    this.emit()
    this.notifyChain()
    return this.value
  }

  get = (): Doc => {
    if (!this.value) throw new Error('no document: call load() or create() first')
    return this.value
  }

  patch(mergePatch: object, why: { action: string; rationale?: string }): Promise<Doc> {
    const before = this.get()
    const after = applyMergePatch(before, mergePatch)
    const described = describeWrite(why.action, before, after, this.ctxOf)
    const said = described && why.rationale ? { ...described, rationale: [why.rationale, described.rationale].filter(Boolean).join(' · ') } : described
    this.value = after
    const last = this.pending.at(-1)
    if (last && !this.isWriting(last) && ((said === null && last.why === null) || (said?.coalesce && last.why?.coalesce === said.coalesce))) {
      last.after = after
      if (said) last.why = said
    } else {
      this.pending.push({ why: said, after })
    }
    this.emit()
    this.schedule()
    return Promise.resolve(after)
  }

  async verdict(v: Verdict): Promise<void> {
    await this.flush()
    await this.clan.verdict(v)
    this.notifyChain()
  }

  async exportClan(): Promise<Uint8Array> {
    await this.flush()
    return this.clan.exportClan()
  }

  onChange(cb: (d: Doc) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // ── Beyond the interface ──

  /** A decision with no data change (e.g. "exported the .clan"), as the participant. */
  async record(action: string, rationale?: string): Promise<void> {
    await this.flush()
    await this.clan.record({ action, ...(rationale ? { rationale } : {}) })
    this.notifyChain()
  }

  /** The decision chain, newest first, with every pending write in it. */
  async chain(): Promise<ChainEntry[]> {
    await this.flush()
    return this.clan.chain()
  }

  /** Write everything pending to the .clan, and save it. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.serial(() => this.drain())
    await this.clan.flush()
  }

  /** Called after entries land in the chain. */
  onChain(cb: () => void): () => void {
    this.chainListeners.add(cb)
    return () => this.chainListeners.delete(cb)
  }

  /** Called when the .clan refuses a write (the change is rolled back). */
  onTrouble(cb: (message: string) => void): () => void {
    this.troubleListeners.add(cb)
    return () => this.troubleListeners.delete(cb)
  }

  // ── Inside ──

  private current: Pending | null = null
  private isWriting(p: Pending) {
    return this.current === p
  }

  private serial(fn: () => Promise<void>): Promise<void> {
    const run = this.writing.then(fn, fn)
    this.writing = run.catch(() => {})
    return run
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    // Typing into one field folds into one entry: wait for a pause.
    const typing = !!this.pending.at(-1)?.why?.coalesce
    this.timer = setTimeout(() => {
      this.timer = null
      void this.serial(() => this.drain())
    }, typing ? Math.max(this.delay, 1500) : this.delay)
  }

  private async drain() {
    let wrote = false
    while (this.pending.length) {
      const item = this.pending[0]
      this.current = item
      try {
        const mp = createMergePatch(this.clan.get(), item.after)
        if (mp !== undefined) {
          // The author is whoever the document names once this write lands:
          // signing in renames the participant, and that entry is theirs.
          await this.clan.patch(mp as object, item.why
            ? { action: item.why.action, agent: item.after.participant.handle, ...(item.why.rationale ? { rationale: item.why.rationale } : {}), ...(item.why.pinned ? { pinned: true } : {}) }
            : { action: 'sync', quiet: true })
          if (item.why) wrote = true
        }
        if (item.why?.mirror) void this.clan.mirrorNow('accept').catch(() => {})
      } catch (e) {
        this.current = null
        this.refused(e)
        return
      }
      this.current = null
      this.pending.shift()
      // A job that just finished gets its director and provider entries now,
      // before whatever the participant did next.
      if (await this.recordOutcomes()) wrote = true
    }
    if (await this.recordOutcomes()) wrote = true
    if (wrote) this.notifyChain()
  }

  /** Director and provider entries for every job that has finished. */
  private async recordOutcomes(): Promise<boolean> {
    let wrote = false
    for (const j of (this.clan.get().jobs ?? []) as unknown as JobEntry[]) {
      if (!TERMINAL.has(j.state) || this.outcomes.has(j.id)) continue
      try {
        if (await recordJobOutcome(this.clan, j)) wrote = true
        this.outcomes.add(j.id)
      } catch (e) {
        console.warn('could not record the job in the decision chain', j.id, e)
        this.outcomes.add(j.id)
      }
    }
    return wrote
  }

  private refused(e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`the .clan refused a write; rolling back to what it holds: ${message}`, e)
    this.trouble = message
    this.pending = []
    this.value = normaliseDocument(this.clan.get() as unknown as ProductionDocument)
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
