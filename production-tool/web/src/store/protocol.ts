// The store Worker's messages (features/engine-store.clan). One Worker per open
// project owns napkin-wasm, ClanDocumentStore and the scene's Y replica; the main
// thread talks to it through these, and only these. Internal to web: both ends
// ship in the same build.
//
// main -> worker   call {id, method, args}        a ClanStoreApi call (or init / scene-open)
//                  scene-update {seq, update}     a scene change made on the main thread
//                  mirror-done {id, error?}       the main thread posted the bytes (or failed)
// worker -> main   result {id, value} | error {id, error}
//                  change {doc, documentId}       after every change, before the call's result
//                  scene-ack {seq}                the update is in the replica and the live store
//                  mirror-post {id, bytes, meta}  post these bytes to the relay (the main thread holds the auth)

import type { Doc, MirrorReason, Person } from '../../../clan-store/src'

export const PROTOCOL = 1

export type StoreMethod =
  | 'init' | 'load' | 'open' | 'create' | 'setPerson' | 'patch' | 'record' | 'exportClan' | 'chain' | 'flush'
  | 'startMirror' | 'stopMirror' | 'mirrorNow' | 'writeAsset' | 'readAsset' | 'dispose' | 'sceneOpen'

export interface InitArgs {
  protocol: number
  /** The IndexedDB database of the project's .clan bytes; null keeps them in memory (tests). */
  idbName: string | null
  person: Person | null
  saveDebounceMs?: number
}

export interface SceneOpened {
  /** The scene's Y state to start from (null: a project with no scene yet). */
  state: Uint8Array | null
  from: 'live' | 'checkpoint' | 'none'
  /** Why the scene is read-only (a checkpoint from a newer build). */
  readOnly: string | null
}

export interface WireError {
  name: string
  message: string
  /** UnsupportedContract's found, InvalidDocument's problems, HostRefused's status. */
  found?: string | null
  problems?: string[]
  status?: number
}

export type ToWorker =
  | { t: 'call'; id: number; method: StoreMethod; args: unknown[] }
  | { t: 'scene-update'; seq: number; update: Uint8Array }
  | { t: 'mirror-done'; id: number; error?: WireError }

export type FromWorker =
  | { t: 'result'; id: number; value: unknown }
  | { t: 'error'; id: number; error: WireError }
  | { t: 'change'; doc: Doc; documentId: string }
  | { t: 'scene-ack'; seq: number }
  | { t: 'mirror-post'; id: number; bytes: Uint8Array; meta: { handle: string; reason: MirrorReason } }

/** What both ends talk over: a Worker on the main thread, the global scope in the Worker, a MessagePort in tests. */
export interface Endpoint {
  postMessage(msg: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void
  removeEventListener(type: 'message', fn: (e: MessageEvent) => void): void
}
