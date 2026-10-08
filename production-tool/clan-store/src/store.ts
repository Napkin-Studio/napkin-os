// ClanDocumentStore: the Production Tool document as a real .clan.
//
// napkin-wasm holds the archive; every write is a `/patch-data` with the
// participant's handle as the agent, so the SDK records it in the decision
// chain and checks it against the schema the document carries. Before it
// gets there, the merged result is validated here against the locked
// contract (ajv), so an invalid patch is refused with the contract's words
// and leaves the document as it was.
import { parse as parseYaml } from 'yaml'
import { APP_ID, freshHost, route, type NapkinHost, type WasmSource } from './host'
import { mergePatch } from './merge-patch'
import { indexedDbPersistence, type Persistence } from './persist'
import type { Doc, DocumentStore, Participant, Verdict, Why } from './types'
import { assertValid, problems } from './validate'

export interface ClanStoreOptions {
  /** Where napkin_wasm_bg.wasm comes from. Browser default: beside the glue. */
  wasm?: WasmSource
  /** Where the bytes are kept between visits. Default: IndexedDB. null: nowhere. */
  persistence?: Persistence | null
  /** Saves after a write wait this long for the next one (ms). */
  saveDebounceMs?: number
}

/** One entry of agent/decision-chain.yaml, as `/chain` gives it. */
export interface ChainEntry {
  id?: string
  agent: string
  action: string
  rationale?: string
  timestamp: string
  fields_changed?: string[]
  kind?: string
  actor?: string
  claimed_agent?: string
  pinned?: boolean
  [k: string]: unknown
}

export type MirrorPost = (bytes: Uint8Array, meta: { handle: string; reason: 'interval' | 'accept' | 'manual' }) => Promise<void>

/** Verdict entries in the chain are written with this action shape:
 * `<kind> <target.kind> <target.id>`, the note as the rationale. */
export function verdictAction(v: Verdict): string {
  return `${v.kind} ${v.target.kind} ${v.target.id}`
}

/** The data key named in a verdict's no-op `append_keys`. It is never in the
 * patch, so nothing is appended; it only lets a decision with no data change
 * through the host's no-op guard. See README "Gaps". */
const VERDICT_GUARD_KEY = 'verdict'

const VERDICT_KINDS = new Set(['accept', 'reject', 'select'])

function recordKey(agent: string, action: string): string {
  return `${agent}\u0000${action}`
}

export class ClanDocumentStore implements DocumentStore {
  private host: NapkinHost | null = null
  private doc: Doc | null = null
  private listeners = new Set<(d: Doc) => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private readonly persistence: Persistence | null
  private readonly debounceMs: number
  private readonly wasm?: WasmSource
  private mirror: { post: MirrorPost; timer: ReturnType<typeof setInterval> | null; lastPosted: string | null; onError: (e: unknown) => void } | null = null
  private revision = 0
  /** `agent action` of every entry in the chain, built on first need. */
  private recorded: Set<string> | null = null

  constructor(opts: ClanStoreOptions = {}) {
    this.wasm = opts.wasm
    this.persistence = opts.persistence === undefined ? indexedDbPersistence() : opts.persistence
    this.debounceMs = opts.saveDebounceMs ?? 300
  }

  // ── DocumentStore ─────────────────────────────────────────────────────────

  load(): Promise<Doc | null> {
    return this.serial(async () => {
      let saved = null
      try {
        saved = this.persistence ? await this.persistence.read() : null
      } catch {
        saved = null
      }
      if (!saved) return null
      return this.openBytesNow(saved.bytes)
    })
  }

  /** Open a .clan from bytes (an import, or an offline copy). It becomes the
   * current document and is saved. */
  open(bytes: Uint8Array): Promise<Doc> {
    return this.serial(async () => {
      const d = await this.openBytesNow(bytes)
      this.scheduleSave()
      return d
    })
  }

  create(init: { participant: Participant }): Promise<Doc> {
    return this.serial(async () => {
      const { participant } = init
      const first: Doc = {
        contract_version: '2',
        app: 'production-tool',
        participant: { id: participant.id, handle: participant.handle },
        stage: { current: 'character' },
        assets: [],
        keys: [],
        refs: [],
        jobs: [],
      }
      assertValid(first, 'the new document')
      const h = await freshHost(this.wasm)
      try {
        h.newDocument(APP_ID, `Production Tool · ${participant.handle}`)
        route(h, '/patch-data', {
          patch: first,
          agent: participant.handle,
          action: 'started the document',
          rationale: '',
        })
      } catch (e) {
        h.free()
        throw e
      }
      this.swapHost(h)
      this.doc = this.readData()
      this.changed()
      this.scheduleSave()
      return this.get()
    })
  }

  get(): Doc {
    if (!this.doc) throw new Error('no document: call load() or create() first')
    return this.doc
  }

  patch(mergePatchBody: object, why: Why): Promise<Doc> {
    return this.serial(async () => {
      const h = this.need()
      if (!mergePatchBody || typeof mergePatchBody !== 'object' || Array.isArray(mergePatchBody)) {
        throw new TypeError('a merge patch is an object')
      }
      if (!why?.action?.trim()) throw new TypeError('why.action is required: it is the decision-chain entry')
      const next = mergePatch(this.get(), mergePatchBody)
      assertValid(next, 'the patched document')
      // A body without `agent` writes the data and no decision (the host's
      // rule), which is what a quiet write is.
      const agent = why.agent?.trim() || this.get().participant.handle
      route(h, '/patch-data', why.quiet
        ? { patch: mergePatchBody }
        : {
            patch: mergePatchBody,
            agent,
            action: why.action,
            rationale: why.rationale ?? '',
            ...(why.pinned ? { pinned: true } : {}),
          })
      if (!why.quiet) this.recorded?.add(recordKey(agent, why.action))
      this.doc = this.readData()
      this.changed()
      this.scheduleSave()
      return this.doc
    })
  }

  /**
   * A decision that changes no data: who did what, and why. With `once`, it is
   * written only if the chain has no entry by the same agent with the same
   * action (so a job's director and provider entries survive reloads and
   * repeated polls without doubling). Resolves true when it was written.
   */
  record(entry: { action: string; rationale?: string; agent?: string; pinned?: boolean }, opts: { once?: boolean } = {}): Promise<boolean> {
    return this.serial(async () => {
      const h = this.need()
      if (!entry?.action?.trim()) throw new TypeError('record: action is required')
      const agent = entry.agent?.trim() || this.get().participant.handle
      const key = recordKey(agent, entry.action)
      if (opts.once && this.recordedKeys(h).has(key)) return false
      route(h, '/patch-data', {
        patch: {},
        append_keys: [VERDICT_GUARD_KEY],
        agent,
        action: entry.action,
        rationale: entry.rationale ?? '',
        ...(entry.pinned ? { pinned: true } : {}),
      })
      this.recorded?.add(key)
      this.revision++
      this.changed()
      this.scheduleSave()
      return true
    })
  }

  verdict(v: Verdict): Promise<void> {
    return this.serial(async () => {
      const h = this.need()
      if (!VERDICT_KINDS.has(v?.kind)) throw new TypeError('verdict.kind is accept, reject or select')
      if (!v.target?.kind || !v.target?.id) throw new TypeError('verdict.target needs kind and id')
      route(h, '/patch-data', {
        patch: {},
        append_keys: [VERDICT_GUARD_KEY],
        agent: this.get().participant.handle,
        action: verdictAction(v),
        rationale: v.note ?? '',
        pinned: true,
      })
      this.recorded?.add(recordKey(this.get().participant.handle, verdictAction(v)))
      this.revision++
      this.changed()
      this.scheduleSave()
      if (v.kind === 'accept' && this.mirror) void this.postMirror('accept')
    })
  }

  async exportClan(): Promise<Uint8Array> {
    await this.queue.catch(() => {})
    return this.bytes()
  }

  onChange(cb: (d: Doc) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // ── Beyond the interface ──────────────────────────────────────────────────

  /** The decision chain, newest first. */
  async chain(): Promise<ChainEntry[]> {
    await this.queue.catch(() => {})
    const c = route<{ decisions?: ChainEntry[] }>(this.need(), '/chain')
    return c?.decisions ?? []
  }

  /** Save now instead of after the debounce (e.g. on `pagehide`). */
  async flush(): Promise<void> {
    await this.queue.catch(() => {})
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.save()
  }

  /**
   * Post the .clan bytes every `everyMs` (when something changed since the
   * last post) and on each accept verdict. `post` is the caller's: the relay
   * route it calls is a proposal (README, "Mirror"). Returns the stop.
   */
  startMirror(post: MirrorPost, opts: { everyMs?: number; onError?: (e: unknown) => void } = {}): () => void {
    this.stopMirror()
    const every = opts.everyMs ?? 300_000
    const m = { post, timer: null as ReturnType<typeof setInterval> | null, lastPosted: null as string | null, onError: opts.onError ?? ((e: unknown) => console.warn('clan mirror failed', e)) }
    m.timer = setInterval(() => void this.postMirror('interval'), every)
    this.mirror = m
    return () => this.stopMirror()
  }

  stopMirror(): void {
    if (this.mirror?.timer) clearInterval(this.mirror.timer)
    this.mirror = null
  }

  /** Post the bytes now, whatever changed (e.g. on a lock: reason 'accept'). */
  mirrorNow(reason: 'accept' | 'manual' = 'manual'): Promise<void> {
    return this.postMirror(reason)
  }

  /** Release the wasm host and timers. */
  dispose(): void {
    this.stopMirror()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.host?.free()
    this.host = null
    this.doc = null
    this.listeners.clear()
  }

  // ── Inside ────────────────────────────────────────────────────────────────

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  private need(): NapkinHost {
    if (!this.host || !this.doc) throw new Error('no document: call load() or create() first')
    return this.host
  }

  private swapHost(h: NapkinHost) {
    this.host?.free()
    this.host = h
    this.recorded = null
  }

  private recordedKeys(h: NapkinHost): Set<string> {
    if (!this.recorded) {
      const c = route<{ decisions?: ChainEntry[] }>(h, '/chain')
      this.recorded = new Set((c?.decisions ?? []).map((d) => recordKey(d.agent, d.action)))
    }
    return this.recorded
  }

  private async openBytesNow(bytes: Uint8Array): Promise<Doc> {
    const h = await freshHost(this.wasm)
    h.upload(bytes, 'production-tool')
    const prev = this.host
    this.host = h
    let data: Doc
    try {
      data = this.readData()
    } catch (e) {
      this.host = prev
      h.free()
      throw e
    }
    const p = problems(data)
    if (p.length) {
      // Restored work is never thrown away; the next write must make it valid.
      console.warn(`restored document does not match document.schema.json: ${p.join('; ')}`)
    }
    prev?.free()
    this.recorded = null
    this.doc = data
    this.changed()
    return data
  }

  /** shared/data.yaml of the open document, as the SDK wrote it. */
  private readData(): Doc {
    const yaml = this.host!.entry('shared/data.yaml')
    const data = (parseYaml(yaml) ?? {}) as Doc & { $schema?: unknown }
    delete data.$schema
    return data
  }

  private bytes(): Uint8Array {
    const b = this.need().download() as Uint8Array | number[]
    return b instanceof Uint8Array ? b : Uint8Array.from(b)
  }

  private changed() {
    this.revision++
    const d = this.doc
    if (!d) return
    for (const cb of this.listeners) {
      try {
        cb(d)
      } catch (e) {
        console.error('onChange listener failed', e)
      }
    }
  }

  private scheduleSave() {
    this.dirty = true
    if (!this.persistence) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, this.debounceMs)
  }

  private async save() {
    if (!this.persistence || !this.dirty || !this.host || !this.doc) return
    this.dirty = false
    try {
      await this.persistence.write({
        bytes: this.bytes(),
        handle: this.doc.participant.handle,
        savedAt: new Date().toISOString(),
      })
    } catch (e) {
      this.dirty = true
      console.warn('could not save the document', e)
    }
  }

  private async postMirror(reason: 'interval' | 'accept' | 'manual') {
    const m = this.mirror
    if (!m && reason !== 'manual') return
    if (!this.host || !this.doc) return
    const rev = String(this.revision)
    if (reason === 'interval' && m?.lastPosted === rev) return
    const post = m?.post
    if (!post) throw new Error('no mirror: call startMirror() first')
    try {
      await post(this.bytes(), { handle: this.doc.participant.handle, reason })
      if (m) m.lastPosted = rev
    } catch (e) {
      m?.onError(e)
      if (reason === 'manual') throw e
    }
  }
}
