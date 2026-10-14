// The scene's local live store (features/engine-store.clan; y-indexeddb style):
// the Worker appends each update the main thread sends, and compacts them into
// one state every COMPACT_AT updates, so nothing is lost between checkpoints and
// reopening reads one record plus a short tail. Every IndexedDB access is
// guarded: blocked storage leaves the scene working, just not remembering.

export const COMPACT_AT = 500

export interface LiveLog {
  /** Every stored update, oldest first (after a compaction: the state, then the tail). */
  readAll(): Promise<Uint8Array[]>
  append(update: Uint8Array): Promise<void>
  /** Replace everything with one state. */
  replaceAll(state: Uint8Array): Promise<void>
  /** How many records are stored now. */
  size(): number
}

/** In memory: tests, and a page that must not remember. */
export function memoryLiveLog(): LiveLog & { records: Uint8Array[]; compactions: number } {
  const log = {
    records: [] as Uint8Array[],
    compactions: 0,
    async readAll() { return [...log.records] },
    async append(u: Uint8Array) { log.records.push(u) },
    async replaceAll(state: Uint8Array) {
      log.records = [state]
      log.compactions++
    },
    size: () => log.records.length,
  }
  return log
}

const STORE = 'updates'

function openDb(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { autoIncrement: true })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest | void): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode)
      const req = op(t.objectStore(STORE))
      t.oncomplete = () => resolve(((req as IDBRequest | undefined)?.result as T) ?? null)
      t.onerror = () => resolve(null)
      t.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** The live store in IndexedDB database `name` (the project's .clan database name + ':scene'). */
export function idbLiveLog(name: string): LiveLog {
  let db: Promise<IDBDatabase | null> | null = null
  const get = () => (db ??= openDb(name))
  let count = 0
  // Ask the browser not to evict this origin's storage (iPad Safari evicts after 7 days unvisited).
  try {
    void (globalThis.navigator as Navigator | undefined)?.storage?.persist?.()
  } catch {
    // not offered here
  }
  return {
    async readAll() {
      const d = await get()
      if (!d) return []
      const all = (await run<unknown[]>(d, 'readonly', (s) => s.getAll())) ?? []
      const out = all.filter((x): x is Uint8Array | ArrayBuffer => x instanceof Uint8Array || x instanceof ArrayBuffer).map((x) => new Uint8Array(x))
      count = out.length
      return out
    },
    async append(update) {
      const d = await get()
      if (!d) return
      await run(d, 'readwrite', (s) => s.add(update))
      count++
    },
    async replaceAll(state) {
      const d = await get()
      if (!d) return
      await run(d, 'readwrite', (s) => {
        s.clear()
        s.add(state)
      })
      count = 1
    },
    size: () => count,
  }
}
