// ClanDocumentStore: the Production Tool document (contract 3) as a real .clan.
//
// napkin-wasm holds the archive; every write is a `/patch-data` with the
// writer's claim as the agent, so the SDK records it in the decision chain,
// with the targets and cites the buses derive (contracts/collab.md §8), and
// checks it against the schema the document carries. Before it gets there the
// merged result is validated here against the contract (ajv) and the rules the
// schema cannot say (integrity.ts), so a bad write is refused with the
// contract's words and leaves the document as it was.
//
// The app writes through the buses (src/bus): field patches through
// LocalPatchBus, live text through LocalTextBus. This store is what they call.
import { parse as parseYaml } from 'yaml'
import { APP_SCHEMA } from './app-template.gen'
import { APP_ID, freshHost, route, type NapkinHost, type WasmSource } from './host'
import { integrity } from './integrity'
import { mergePatch } from './merge-patch'
import { indexedDbPersistence, type Persistence } from './persist'
import { MAP_NAMES, type Doc, type DocumentStore, type Person, type Why } from './types'
import { assertValid, InvalidDocument } from './validate'

export interface ClanStoreOptions {
  /** Where napkin_wasm_bg.wasm comes from. Browser default: beside the glue. */
  wasm?: WasmSource
  /** Where the bytes are kept between visits. Default: IndexedDB. null: nowhere. */
  persistence?: Persistence | null
  /** Saves after a write wait this long for the next one (ms). */
  saveDebounceMs?: number
  /** Who is writing (recorded as human:<id>). Can be set later with setPerson(). */
  person?: Person
  /** Ids for a new project's first entities; tests pass a fixed one. */
  newId?: (prefix: string) => string
  /** The time, as ISO 8601. */
  now?: () => string
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
  targets?: string[]
  cites?: string[]
  reasoning?: Record<string, unknown>
  [k: string]: unknown
}

export type MirrorPost = (bytes: Uint8Array, meta: { handle: string; reason: 'interval' | 'accept' | 'manual' }) => Promise<void>

/** The contract this build reads. */
export const CONTRACT = '3'

/** A .clan made under another contract: refused, never read or overwritten (features/contract-v3.clan). */
export class UnsupportedContract extends Error {
  readonly found: string | null
  constructor(found: string | null) {
    super(found
      ? `This project was made with an older version of the Production Tool (contract ${found}); this one reads contract ${CONTRACT}, so it cannot open it.`
      : `This file is not a Production Tool project this build can read (contract ${CONTRACT}).`)
    this.name = 'UnsupportedContract'
    this.found = found
  }
}

/** The data key named in a record's no-op `append_keys`: never in the patch, so
 * nothing is appended; it only lets a decision with no data change through the
 * host's no-op guard. */
const RECORD_GUARD_KEY = 'record'

function recordKey(agent: string, action: string): string {
  return `${agent}\u0000${action}`
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** A prefixed ULID (common id): 48 bits of time, 80 of randomness. */
export function newUlidId(prefix: string, now = Date.now()): string {
  let t = ''
  let x = now
  for (let i = 0; i < 10; i++) {
    t = CROCKFORD[x % 32] + t
    x = Math.floor(x / 32)
  }
  const r = new Uint8Array(16)
  crypto.getRandomValues(r)
  return `${prefix}_${t}${Array.from(r, (b) => CROCKFORD[b % 32]).join('')}`
}

/** A new project's data: one script, storyboard and video, the script driving
 * the storyboard and the storyboard rendering the video (today's three stages). */
export function newProjectData(args: { person: Person; title: string; newId: (p: string) => string; now: string; ratio?: string; target_s?: number }): Doc {
  const { person, newId, now } = args
  const ratio = args.ratio ?? '16:9'
  const target_s = args.target_s ?? 15
  const e = (id: string, rest: Record<string, unknown>) => ({ id, v: 1, field_v: {}, ...rest })
  const script = newId('script')
  const storyboard = newId('storyboard')
  const video = newId('video')
  const drives = newId('link')
  const renders = newId('link')
  const doc = {
    contract_version: '3',
    app: 'production-tool',
    project: { id: newId('proj'), tenant_id: person.tenant_id, title: args.title, created_by: `human:${person.id}`, created_at: now },
    assets: {},
    ...Object.fromEntries(MAP_NAMES.map((m) => [m, {}])),
  } as unknown as Doc
  doc.scripts[script] = e(script, { title: 'Script', target_s })
  doc.storyboards[storyboard] = e(storyboard, { title: 'Storyboard', ratio, target_s })
  doc.videos[video] = e(video, { title: 'Video', ratio, target_s, edl: {} })
  doc.links[drives] = e(drives, { from: { kind: 'script', id: script }, to: { kind: 'storyboard', id: storyboard }, role: 'drives' })
  doc.links[renders] = e(renders, { from: { kind: 'storyboard', id: storyboard }, to: { kind: 'video', id: video }, role: 'renders' })
  return doc
}

/** Refuse a write whose result breaks a rule the schema cannot say, unless the
 * document already broke it (a restored document is never locked out). */
export function assertIntegrity(before: Doc | null, after: Doc, what = 'the patched document') {
  const had = new Set(before ? integrity(before) : [])
  const fresh = integrity(after).filter((p) => !had.has(p))
  if (fresh.length) throw new InvalidDocument(fresh, what)
}

export class ClanDocumentStore implements DocumentStore {
  private host: NapkinHost | null = null
  private doc: Doc | null = null
  private docId: string | null = null
  private listeners = new Set<(d: Doc) => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private readonly persistence: Persistence | null
  private readonly debounceMs: number
  private readonly wasm?: WasmSource
  private readonly newId: (prefix: string) => string
  private readonly now: () => string
  private person: Person | null
  private mirror: { post: MirrorPost; timer: ReturnType<typeof setInterval> | null; lastPosted: string | null; onError: (e: unknown) => void } | null = null
  private revision = 0
  /** `agent action` of every entry in the chain, built on first need. */
  private recorded: Set<string> | null = null

  constructor(opts: ClanStoreOptions = {}) {
    this.wasm = opts.wasm
    this.persistence = opts.persistence === undefined ? indexedDbPersistence() : opts.persistence
    this.debounceMs = opts.saveDebounceMs ?? 300
    this.person = opts.person ?? null
    this.newId = opts.newId ?? ((p) => newUlidId(p))
    this.now = opts.now ?? (() => new Date().toISOString())
  }

  // ── DocumentStore ─────────────────────────────────────────────────────────

  /** Restore the last document. Throws UnsupportedContract (and keeps the saved
   * bytes) when it was made under another contract. */
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
   * current document and is saved. Throws UnsupportedContract for another
   * contract's document, leaving the current one (and the bytes) as they were. */
  open(bytes: Uint8Array): Promise<Doc> {
    return this.serial(async () => {
      const d = await this.openBytesNow(bytes)
      this.scheduleSave()
      return d
    })
  }

  /** Open bytes without making them current: what contract they hold, or the refusal. */
  static contractOf(data: unknown): string | null {
    const v = (data as { contract_version?: unknown } | null)?.contract_version
    return typeof v === 'string' ? v : null
  }

  create(init: { person: Person; title?: string; ratio?: string; target_s?: number }): Promise<Doc> {
    return this.serial(async () => {
      this.person = init.person
      const first = newProjectData({ person: init.person, title: init.title ?? 'Untitled ad', newId: this.newId, now: this.now(), ratio: init.ratio, target_s: init.target_s })
      assertValid(first, 'the new document')
      assertIntegrity(null, first, 'the new document')
      const h = await freshHost(this.wasm)
      try {
        h.newDocument(APP_ID, first.project.title)
        route(h, '/patch-data', { patch: first, agent: `human:${init.person.id}`, action: 'start the project', rationale: '' })
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

  /** The document id addresses start with (<doc-id>#…): stable across revisions. */
  documentId(): string {
    if (!this.docId) {
      const m = (parseYaml(this.need().entry('manifest.yaml')) ?? {}) as { document_id?: string; id?: string }
      this.docId = m.document_id || m.id || ''
    }
    return this.docId
  }

  /** Who is writing. */
  setPerson(person: Person) {
    this.person = person
  }

  /** The claim a person's write carries. */
  personClaim(): string {
    if (!this.person) throw new Error('no person: create() or setPerson() first')
    return `human:${this.person.id}`
  }

  patch(mergePatchBody: object, why: Why): Promise<Doc> {
    return this.serial(async () => {
      const h = this.need()
      if (!mergePatchBody || typeof mergePatchBody !== 'object' || Array.isArray(mergePatchBody)) {
        throw new TypeError('a merge patch is an object')
      }
      if (!why?.action?.trim()) throw new TypeError('why.action is required: it is the decision-chain entry')
      if ('upstream' in mergePatchBody) throw new InvalidDocument(['/upstream is read-only: the host writes it at spin-off'], 'the patch')
      const before = this.get()
      const next = mergePatch(before, mergePatchBody)
      assertValid(next, 'the patched document')
      assertIntegrity(before, next)
      // A body without `agent` writes the data and no decision (the host's
      // rule), which is what a quiet write is.
      const agent = why.agent?.trim() || this.personClaim()
      route(h, '/patch-data', why.quiet
        ? { patch: mergePatchBody }
        : {
            patch: mergePatchBody,
            agent,
            action: why.action,
            rationale: why.rationale ?? '',
            ...(why.pinned ? { pinned: true } : {}),
            ...(why.targets?.length ? { targets: why.targets } : {}),
            ...(why.cites?.length ? { cites: why.cites } : {}),
            ...(why.reasoning ? { reasoning: why.reasoning } : {}),
          })
      if (!why.quiet) this.recorded?.add(recordKey(agent, why.action))
      // The SDK applied the same RFC 7396 merge to the same data, so the result
      // is `next`; reading data.yaml back would parse the whole document again
      // on every write (store.test.ts checks the bytes reopen to the same data).
      this.doc = next
      this.changed()
      this.scheduleSave()
      return this.doc
    })
  }

  /**
   * A decision that changes no data: pin_decision, an ignored check's note, a
   * job that failed. With `once`, it is written only if the chain has no entry
   * by the same agent with the same action. Resolves true when it was written.
   */
  record(entry: { action: string; rationale?: string; agent?: string; pinned?: boolean; targets?: string[]; cites?: string[] }, opts: { once?: boolean } = {}): Promise<boolean> {
    return this.serial(async () => {
      const h = this.need()
      if (!entry?.action?.trim()) throw new TypeError('record: action is required')
      const agent = entry.agent?.trim() || this.personClaim()
      const key = recordKey(agent, entry.action)
      if (opts.once && this.recordedKeys(h).has(key)) return false
      route(h, '/patch-data', {
        patch: {},
        append_keys: [RECORD_GUARD_KEY],
        agent,
        action: entry.action,
        rationale: entry.rationale ?? '',
        ...(entry.pinned ? { pinned: true } : {}),
        ...(entry.targets?.length ? { targets: entry.targets } : {}),
        ...(entry.cites?.length ? { cites: entry.cites } : {}),
      })
      this.recorded?.add(key)
      this.revision++
      this.changed()
      this.scheduleSave()
      return true
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
   * last post) and on mirrorNow('accept'). Returns the stop.
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
    this.docId = null
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
    this.docId = null
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
    let data: Doc
    try {
      h.upload(bytes, 'production-tool')
      data = readData(h)
    } catch (e) {
      h.free()
      throw e
    }
    // Contract 3 reads contract 3 only. Nothing is written to a document made
    // under another contract: not the schema move below, not a save.
    const found = ClanDocumentStore.contractOf(data)
    if (found !== CONTRACT) {
      h.free()
      throw new UnsupportedContract(found)
    }
    // A document keeps the schema it was made with; one made under an older
    // contract-3 schema moves to the app's when it opens (loosening only).
    let upgraded = false
    try {
      upgraded = !!route<{ changed?: boolean }>(h, '/patch-schema', APP_SCHEMA)?.changed
    } catch (e) {
      console.warn('kept the document\'s own schema: it did not move to the app\'s', e)
    }
    this.swapHost(h)
    this.doc = data
    this.changed()
    if (upgraded) this.scheduleSave()
    return data
  }

  /** shared/data.yaml of the open document, as the SDK wrote it. */
  private readData(): Doc {
    return readData(this.host!)
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
        handle: this.person?.handle ?? this.doc.project.created_by,
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
      await post(this.bytes(), { handle: this.person?.handle ?? this.doc.project.created_by, reason })
      if (m) m.lastPosted = rev
    } catch (e) {
      m?.onError(e)
      if (reason === 'manual') throw e
    }
  }
}

function readData(h: NapkinHost): Doc {
  const yaml = h.entry('shared/data.yaml')
  const data = (parseYaml(yaml) ?? {}) as Doc & { $schema?: unknown }
  delete data.$schema
  return data
}
