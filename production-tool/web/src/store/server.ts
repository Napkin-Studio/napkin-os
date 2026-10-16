// The store Worker's side (features/engine-store.clan): it owns the project's
// ClanDocumentStore (napkin-wasm) and the scene's Y replica, and is the only .clan
// writer in this browser. The main thread reaches it through StoreClient.
//
// The scene: each update the main thread sends is applied to the replica,
// appended to the live store and acknowledged; every COMPACT_AT updates the live
// store is compacted into one state. The checkpoint (human/assets/canvas.ybin.zst)
// is written only at the four moments ClanDocumentStore's setBeforeBytes calls
// (the 5-minute mirror, accept, handoff and export), only when there is a scene,
// and only when it changed since the last one (export always carries the latest).

import * as Y from 'yjs'
import {
  ClanDocumentStore, HostRefused, InvalidDocument, UnsupportedContract, type Persistence, type Person, type Why,
} from '../../../clan-store/src'
import { CHECKPOINT_NAME, checkpointOf, CheckpointTooNew, decodeCheckpoint, type Codec } from '../../../canvas-engine/src/checkpoint/checkpoint'
import { COMPACT_AT, type LiveLog } from './liveLog'
import { PROTOCOL, type Endpoint, type FromWorker, type InitArgs, type SceneOpened, type ToWorker, type WireError } from './protocol'

export interface StoreServerDeps {
  /** The .clan bytes' persistence for a database name (null: memory). */
  persistence(idbName: string | null): Persistence | null
  /** The live store for a database name (null: memory). */
  liveLog(idbName: string | null): LiveLog
  codec(): Promise<Codec>
  /** napkin_wasm_bg.wasm, in node (tests); the browser finds it beside the glue. */
  wasm?: Uint8Array
}

/** A refusal, as the main thread rebuilds it. */
export function toWire(e: unknown): WireError {
  if (e instanceof UnsupportedContract) return { name: e.name, message: e.message, found: e.found }
  if (e instanceof InvalidDocument) return { name: e.name, message: e.message, problems: e.problems }
  if (e instanceof HostRefused) return { name: e.name, message: e.message, status: e.status }
  if (e instanceof Error) return { name: e.name, message: e.message }
  return { name: 'Error', message: String(e) }
}

export class StoreServer {
  private readonly ep: Endpoint
  private readonly deps: StoreServerDeps
  private store: ClanDocumentStore | null = null
  private idbName: string | null = null
  private scene: Y.Doc | null = null
  private live: LiveLog | null = null
  /** The scene changed since the last checkpoint. */
  private sceneDirty = false
  private readonlyScene: string | null = null
  private sceneQueue: Promise<void> = Promise.resolve()
  private mirrorSeq = 0
  /** Saves asked for and not yet done: dispose waits for them, so a close's save is never dropped. */
  private readonly saving = new Set<Promise<unknown>>()
  private readonly mirrorWaits = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()
  private readonly onMessage = (e: MessageEvent) => void this.handle(e.data as ToWorker)
  /** How many checkpoints were written (tests read it). */
  checkpoints = 0

  constructor(ep: Endpoint, deps: StoreServerDeps) {
    this.ep = ep
    this.deps = deps
    ep.addEventListener('message', this.onMessage)
  }

  private post(msg: FromWorker, transfer?: Transferable[]) {
    this.ep.postMessage(msg, transfer)
  }

  private need(): ClanDocumentStore {
    if (!this.store) throw new Error('the store Worker was not initialised')
    return this.store
  }

  private async handle(msg: ToWorker) {
    if (msg.t === 'scene-update') {
      this.sceneQueue = this.sceneQueue.then(() => this.applyScene(msg.seq, msg.update))
      return
    }
    if (msg.t === 'mirror-done') {
      const w = this.mirrorWaits.get(msg.id)
      this.mirrorWaits.delete(msg.id)
      if (msg.error) w?.reject(Object.assign(new Error(msg.error.message), { name: msg.error.name }))
      else w?.resolve()
      return
    }
    try {
      const value = await this.call(msg.method, msg.args)
      this.post({ t: 'result', id: msg.id, value })
    } catch (e) {
      this.post({ t: 'error', id: msg.id, error: toWire(e) })
    }
  }

  private async call(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'init': return this.init(args[0] as InitArgs)
      case 'load': return await this.need().load()
      case 'open': return await this.need().open(args[0] as Uint8Array)
      case 'create': return await this.need().create(args[0] as Parameters<ClanDocumentStore['create']>[0])
      case 'setPerson': return this.need().setPerson(args[0] as Person)
      case 'patch': return await this.need().patch(args[0] as object, args[1] as Why)
      case 'record': return await this.need().record(args[0] as Parameters<ClanDocumentStore['record']>[0], args[1] as { once?: boolean })
      case 'exportClan': return await this.need().exportClan()
      case 'chain': return await this.need().chain()
      case 'flush': {
        await this.sceneQueue
        return await this.need().flush()
      }
      case 'startMirror': {
        const opts = (args[0] ?? {}) as { everyMs?: number }
        this.need().startMirror((bytes, meta) => this.mirrorPost(bytes, meta), { everyMs: opts.everyMs, onError: (e) => console.warn('clan mirror failed', e) })
        return null
      }
      case 'stopMirror': return this.need().stopMirror()
      case 'mirrorNow': {
        const run = this.need().mirrorNow(args[0] as Parameters<ClanDocumentStore['mirrorNow']>[0])
        const held = run.catch(() => {})
        this.saving.add(held)
        void held.finally(() => this.saving.delete(held))
        return await run
      }
      case 'writeAsset': return await this.need().writeAsset(args[0] as string, args[1] as Uint8Array)
      case 'readAsset': return await this.need().readAsset(args[0] as string)
      case 'sceneOpen': return await this.sceneOpen()
      case 'dispose': {
        // A save asked for just before (the project's close) finishes first: disposing under it
        // dropped it while the checkpoint was being written (features/picture-storage.clan).
        await Promise.all([...this.saving])
        await this.sceneQueue
        this.store?.dispose()
        this.store = null
        this.scene?.destroy()
        this.scene = null
        this.ep.removeEventListener('message', this.onMessage)
        return null
      }
      default: throw new Error(`the store Worker has no method ${method}`)
    }
  }

  private init(a: InitArgs): null {
    if (a.protocol !== PROTOCOL) throw new Error(`The store Worker speaks protocol ${PROTOCOL}, not ${a.protocol}. Reload to get the latest version.`)
    this.idbName = a.idbName
    this.store = new ClanDocumentStore({
      person: a.person ?? undefined,
      persistence: this.deps.persistence(a.idbName),
      ...(a.saveDebounceMs !== undefined ? { saveDebounceMs: a.saveDebounceMs } : {}),
      ...(this.deps.wasm ? { wasm: this.deps.wasm } : {}),
    })
    this.store.onChange((doc) => this.post({ t: 'change', doc, documentId: safeId(this.store!) }))
    this.store.setBeforeBytes((reason) => this.checkpoint(reason === 'export'))
    return null
  }

  /** Bytes for the relay leave from the main thread, which holds the auth. */
  private mirrorPost(bytes: Uint8Array, meta: { handle: string; reason: Parameters<ClanDocumentStore['mirrorNow']>[0] | 'interval' }): Promise<void> {
    const id = ++this.mirrorSeq
    return new Promise((resolve, reject) => {
      this.mirrorWaits.set(id, { resolve, reject })
      this.post({ t: 'mirror-post', id, bytes, meta: meta as { handle: string; reason: 'interval' } })
    })
  }

  // ── the scene ──

  /**
   * The scene's starting state: the live store when it holds anything (it is never older than the
   * checkpoint), else the .clan's checkpoint, else none.
   */
  private async sceneOpen(): Promise<SceneOpened> {
    await this.sceneQueue
    const store = this.need()
    this.scene?.destroy()
    const doc = new Y.Doc()
    this.scene = doc
    this.live = this.deps.liveLog(this.idbName ? `${this.idbName}:scene` : null)
    this.readonlyScene = null
    const tail = await this.live.readAll()
    let from: SceneOpened['from'] = 'none'
    if (tail.length) {
      for (const u of tail) Y.applyUpdate(doc, u, 'live')
      from = 'live'
    } else {
      const cp = await store.readAsset(CHECKPOINT_NAME)
      if (cp) {
        try {
          Y.applyUpdate(doc, decodeCheckpoint(cp, await this.deps.codec()), 'checkpoint')
          from = 'checkpoint'
          // Start the live store from it, so a reload before the next edit reads the same.
          await this.live.replaceAll(Y.encodeStateAsUpdate(doc))
        } catch (e) {
          if (!(e instanceof CheckpointTooNew)) throw e
          this.readonlyScene = e.message
        }
      }
    }
    this.sceneDirty = false
    return { state: from === 'none' ? null : Y.encodeStateAsUpdate(doc), from, readOnly: this.readonlyScene }
  }

  private async applyScene(seq: number, update: Uint8Array) {
    if (!this.scene || !this.live || this.readonlyScene) return
    Y.applyUpdate(this.scene, update, 'main')
    await this.live.append(update)
    this.sceneDirty = true
    if (this.live.size() >= COMPACT_AT) await this.live.replaceAll(Y.encodeStateAsUpdate(this.scene))
    this.post({ t: 'scene-ack', seq })
  }

  /** Before the bytes leave: the checkpoint, when there is a scene and it changed (or for an export). */
  private async checkpoint(always: boolean) {
    await this.sceneQueue
    const doc = this.scene
    if (!doc || this.readonlyScene || doc.getMap('elements').size === 0) return
    if (!this.sceneDirty && !always) return
    const bytes = checkpointOf(doc, await this.deps.codec())
    await this.need().writeAsset(CHECKPOINT_NAME, bytes)
    this.sceneDirty = false
    this.checkpoints++
  }
}

function safeId(s: ClanDocumentStore): string {
  try {
    return s.documentId()
  } catch {
    return ''
  }
}
