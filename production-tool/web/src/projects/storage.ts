// Where each project keeps its things in this browser (features/project-home.clan).
// Blobs (pictures and clips, by sha256) are shared by every project; everything
// else is the project's own:
//   - its .clan: the IndexedDB database CLAN_DB + ':' + id (doc/clan.ts);
//   - its canvas: kv 'canvas:<id>';
//   - its UI (job purposes, drafts, undo steps, update runs): kv 'ui:<id>';
//   - its plain-data fallback, when the .clan engine does not load: kv 'doc:<id>'.
// The project index is kv 'projects'.

import { indexedDbPersistence, memoryPersistence, type Persistence, type Saved } from '../../../clan-store/src'
import { CLAN_DB } from '../doc/clan'
import { idbDelete, idbGet, idbPut } from '../lib/idb'

export const INDEX_KEY = 'projects'

export const clanDbFor = (id: string) => `${CLAN_DB}:${id}`
export const canvasKeyFor = (id: string) => `canvas:${id}`
export const uiKeyFor = (id: string) => `ui:${id}`
export const docKeyFor = (id: string) => `doc:${id}`

/** The browser's storage as the projects use it; tests pass memoryStorage(). */
export interface ProjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
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
