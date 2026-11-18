// Where each project keeps its things in this browser (features/project-home.clan).
// Blobs (pictures and clips, by sha256) are shared by every project; everything
// else is the project's own:
//   - its .clan: the IndexedDB database CLAN_DB + ':' + id (model/store.ts);
//   - its canvas: kv 'canvas:<id>';
//   - its UI (job purposes, drafts, undo steps, update runs): kv 'ui:<id>';
//   - its plain-data fallback, when the .clan engine does not load: kv 'doc:<id>'.
// The project index is kv 'projects'.

import { indexedDbPersistence, memoryPersistence, type Persistence, type Saved } from '../../../clan-store/src'
import { CLAN_DB } from '../model/store'
import { idbDelete, idbGet, idbPut, idbUpdate } from '../lib/idb'

export const INDEX_KEY = 'projects'

export const clanDbFor = (id: string) => `${CLAN_DB}:${id}`
export const canvasKeyFor = (id: string) => `canvas:${id}`
export const uiKeyFor = (id: string) => `ui:${id}`
export const docKeyFor = (id: string) => `doc:${id}`

/** The browser's storage as the projects use it; tests pass memoryStorage(). */
export interface ProjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  /** Read, change and write `key` as one step no other tab can come between; `fn` must not wait. Returns what was written. */
  update<T>(key: string, fn: (v: T | undefined) => T): Promise<T>
  del(key: string): Promise<void>
  /** The .clan bytes of the database `db`. */
  clan(db: string): Persistence
  /** Remove the database `db`. */
  dropClan(db: string): Promise<void>
}

export const browserStorage: ProjectStorage = {
  get: (key) => idbGet('kv', key),
  put: async (key, value) => {
    await idbPut('kv', key, value)
  },
  update: (key, fn) => idbUpdate('kv', key, fn),
  del: (key) => idbDelete('kv', key),
  clan: (db) => indexedDbPersistence(db),
  dropClan: (db) =>
    new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(db)
        req.onsuccess = () => resolve()
        req.onerror = () => resolve()
        req.onblocked = () => resolve()
      } catch {
        resolve()
      }
    }),
}

/** Everything in memory, for tests. `clans` shows which databases hold a .clan. */
export function memoryStorage(): ProjectStorage & { kv: Map<string, unknown>; clans: Map<string, Persistence & { last: Saved | null }> } {
  const kv = new Map<string, unknown>()
  const clans = new Map<string, Persistence & { last: Saved | null }>()
  return {
    kv,
    clans,
    get: async <T,>(key: string) => structuredClone(kv.get(key)) as T | undefined,
    put: async (key, value) => {
      kv.set(key, structuredClone(value))
    },
    update: async <T,>(key: string, fn: (v: T | undefined) => T) => {
      const next = fn(structuredClone(kv.get(key)) as T | undefined)
      kv.set(key, structuredClone(next))
      return structuredClone(next)
    },
    del: async (key) => {
      kv.delete(key)
    },
    clan: (db) => {
      let p = clans.get(db)
      if (!p) clans.set(db, (p = memoryPersistence()))
      return p
    },
    dropClan: async (db) => {
      clans.delete(db)
    },
  }
}
