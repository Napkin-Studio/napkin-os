// The main thread's side of the store Worker (features/engine-store.clan):
// StoreClient implements clan-store's ClanStoreApi, so ModelStore and the buses
// use it as they used ClanDocumentStore, while napkin-wasm and every .clan write
// stay in the Worker. get(), documentId() and personClaim() answer at once from a
// read replica the Worker posts after every change (before the call's result, so
// a write's promise resolves with the replica already current).
//
// The scene: openScene(doc) fills a main-thread Y.Doc from the Worker (live store,
// else the .clan checkpoint) and forwards every local update to it. Updates not yet
// acknowledged are kept; if the Worker dies, a new one is spawned, reopened from
// its live store, and those updates are replayed, so nothing drawn is lost.

import * as Y from 'yjs'
import {
  HostRefused, InvalidDocument, UnsupportedContract, type BeforeBytes, type ChainEntry, type ClanStoreApi, type Doc, type MirrorPost,
  type MirrorReason, type Person, type Why,
} from '../../../clan-store/src'
import { PROTOCOL, type Endpoint, type FromWorker, type SceneOpened, type StoreMethod, type ToWorker, type WireError } from './protocol'

/** A Worker, or a port in tests: an Endpoint that can be stopped. */
export interface StoreWorker extends Endpoint {
  terminate(): void
  /** Called when the Worker dies (an uncaught error, or the browser killed it). */
  onDeath?(cb: () => void): void
}

export interface StoreClientOptions {
  spawn: () => StoreWorker
  /** The project's .clan database (null: memory, tests). */
  idbName: string | null
  person?: Person | null
  saveDebounceMs?: number
}

/** The origin a scene update from the Worker carries on the main thread, so it is not sent back. */
export const FROM_WORKER = 'store-worker'

export function fromWire(e: WireError): Error {
  switch (e.name) {
    case 'UnsupportedContract': return new UnsupportedContract(e.found ?? null)
    case 'InvalidDocument': {
      const err = new InvalidDocument(e.problems ?? [])
      err.message = e.message
      return err
    }
    case 'HostRefused': return new HostRefused(e.status ?? 500, e.message)
    default: return Object.assign(new Error(e.message), { name: e.name })
  }
}

interface Waiting {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class StoreClient implements ClanStoreApi {
  private readonly opts: StoreClientOptions
  private worker!: StoreWorker
  private seq = 0
  private readonly waiting = new Map<number, Waiting>()
  private replica: Doc | null = null
  private docId = ''
  private person: Person | null
  private readonly listeners = new Set<(d: Doc) => void>()
  private post: MirrorPost | null = null
  private mirrorOpts: { everyMs?: number; onError?: (e: unknown) => void } | null = null
  private ready: Promise<unknown>
  private disposed = false
  /** What reopened the document before a restart: load (from the Worker's own bytes). */
  private opened = false
  // the scene
  private scene: Y.Doc | null = null
  private sceneSeq = 0
  private readonly unacked = new Map<number, Uint8Array>()
  private readonly onSceneUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === FROM_WORKER || this.sceneReadOnly) return
    const seq = ++this.sceneSeq
    this.unacked.set(seq, update)
    this.send({ t: 'scene-update', seq, update })
  }
  private sceneReadOnly: string | null = null
  /** How many times the Worker was restarted (tests read it). */
  restarts = 0

  constructor(opts: StoreClientOptions) {
    this.opts = opts
    this.person = opts.person ?? null
    this.ready = this.boot()
  }

  private readonly onMessage = (e: MessageEvent) => this.receive(e.data as FromWorker)

  private boot(): Promise<unknown> {
    this.worker = this.opts.spawn()
    this.worker.addEventListener('message', this.onMessage)
    this.worker.onDeath?.(() => void this.restart())
    return this.rpc('init', [{ protocol: PROTOCOL, idbName: this.opts.idbName, person: this.person, saveDebounceMs: this.opts.saveDebounceMs }])
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg)
  }

  private rpc<T>(method: StoreMethod, args: unknown[]): Promise<T> {
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.send({ t: 'call', id, method, args })
    })
  }

  private async call<T>(method: StoreMethod, args: unknown[] = []): Promise<T> {
    if (this.disposed) throw new Error('the store was closed')
    await this.ready
    return await this.rpc<T>(method, args)
  }

  private receive(msg: FromWorker) {
    switch (msg.t) {
      case 'result':
      case 'error': {
        const w = this.waiting.get(msg.id)
        this.waiting.delete(msg.id)
        if (!w) return
        if (msg.t === 'result') w.resolve(msg.value)
        else w.reject(fromWire(msg.error))
        return
      }
      case 'change': {
        this.replica = msg.doc
        if (msg.documentId) this.docId = msg.documentId
        for (const cb of this.listeners) {
          try {
            cb(msg.doc)
          } catch (e) {
            console.error('onChange listener failed', e)
          }
        }
        return
      }
      case 'scene-ack':
        this.unacked.delete(msg.seq)
        return
      case 'mirror-post': {
        const post = this.post
        const done = (error?: unknown) => this.send({ t: 'mirror-done', id: msg.id, ...(error ? { error: { name: 'MirrorFailed', message: error instanceof Error ? error.message : String(error) } } : {}) })
        if (!post) return done(new Error('no mirror'))
        post(msg.bytes, msg.meta).then(() => done(), (e) => done(e))
        return
      }
    }
  }

  // ── ClanStoreApi ──

  async load(): Promise<Doc | null> {
    const d = await this.call<Doc | null>('load')
    if (d) this.opened = true
    return d
  }

  async open(bytes: Uint8Array): Promise<Doc> {
    const d = await this.call<Doc>('open', [bytes])
    this.opened = true
    return d
  }

  async create(init: { person: Person; title?: string; ratio?: string; target_s?: number }): Promise<Doc> {
    this.person = init.person
    const d = await this.call<Doc>('create', [init])
    this.opened = true
    return d
  }

  get(): Doc {
    if (!this.replica) throw new Error('no document: call load() or create() first')
    return this.replica
  }

  documentId(): string {
    return this.docId
  }

  setPerson(person: Person) {
    this.person = person
    void this.call('setPerson', [person]).catch(() => {})
  }

  personClaim(): string {
    if (!this.person) throw new Error('no person: create() or setPerson() first')
    return `human:${this.person.id}`
  }

  patch(body: object, why: Why): Promise<Doc> {
    return this.call<Doc>('patch', [body, why])
  }

  record(entry: Parameters<ClanStoreApi['record']>[0], opts: { once?: boolean } = {}): Promise<boolean> {
    return this.call<boolean>('record', [entry, opts])
  }

  exportClan(): Promise<Uint8Array> {
    return this.call<Uint8Array>('exportClan')
  }

  onChange(cb: (d: Doc) => void): () => void {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  chain(): Promise<ChainEntry[]> {
    return this.call<ChainEntry[]>('chain')
  }

  flush(): Promise<void> {
    return this.call<void>('flush')
  }

  startMirror(post: MirrorPost, opts: { everyMs?: number; onError?: (e: unknown) => void } = {}): () => void {
    this.post = post
    this.mirrorOpts = opts
    void this.call('startMirror', [{ everyMs: opts.everyMs }]).catch((e) => opts.onError?.(e))
    return () => this.stopMirror()
  }

  stopMirror(): void {
    this.post = null
    this.mirrorOpts = null
    void this.call('stopMirror').catch(() => {})
  }

  mirrorNow(reason: Exclude<MirrorReason, 'interval'> = 'manual'): Promise<void> {
    return this.call<void>('mirrorNow', [reason])
  }

  writeAsset(name: string, bytes: Uint8Array): Promise<void> {
    return this.call<void>('writeAsset', [name, bytes])
  }

  readAsset(name: string): Promise<Uint8Array | null> {
    return this.call<Uint8Array | null>('readAsset', [name])
  }

  /** The checkpoint is the Worker's own; nothing on the main thread runs before the bytes. */
  setBeforeBytes(_fn: BeforeBytes | null): void {
    throw new Error('setBeforeBytes runs in the store Worker; the canvas checkpoint is written there')
  }

  dispose(): void {
    if (this.disposed) return
    this.scene?.off('update', this.onSceneUpdate)
    const w = this.worker
    // Let the Worker finish what it was asked (flush first, as close() does), then stop it.
    void this.rpc('dispose', []).catch(() => {}).finally(() => w.terminate())
    this.disposed = true
    this.listeners.clear()
  }

  // ── the scene ──

  /** Fill `doc` with the project's scene and keep the Worker's replica in step with it. */
  async openScene(doc: Y.Doc): Promise<SceneOpened> {
    this.scene?.off('update', this.onSceneUpdate)
    this.scene = doc
    const opened = await this.call<SceneOpened>('sceneOpen')
    if (opened.state) Y.applyUpdate(doc, opened.state, FROM_WORKER)
    this.sceneReadOnly = opened.readOnly
    doc.on('update', this.onSceneUpdate)
    return opened
  }

  /** Updates sent and not yet in the Worker's live store. */
  pendingSceneUpdates(): number {
    return this.unacked.size
  }

  /** The Worker died: start a new one, reopen the document and the scene, and replay what it had not stored. */
  async restart(): Promise<void> {
    if (this.disposed) return
    this.restarts++
    for (const w of this.waiting.values()) w.reject(new Error('The store Worker stopped; try again.'))
    this.waiting.clear()
    this.worker.removeEventListener('message', this.onMessage)
    try {
      this.worker.terminate()
    } catch {
      // already gone
    }
    this.ready = this.boot()
    await this.ready
    if (this.opened) await this.rpc('load', [])
    if (this.post) await this.rpc('startMirror', [{ everyMs: this.mirrorOpts?.everyMs }])
    if (this.scene) {
      const opened = await this.rpc<SceneOpened>('sceneOpen', [])
      // What the live store had is already on this side; only what it missed goes back.
      void opened
      for (const [seq, update] of [...this.unacked].sort((a, b) => a[0] - b[0])) this.send({ t: 'scene-update', seq, update })
    }
  }
}
