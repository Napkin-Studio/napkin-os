// The .clan bytes in IndexedDB. Every access is guarded: a private window,
// blocked storage or a test without IndexedDB leaves the store working, just
// not remembering.

export interface Saved {
  /** The document's .clan bytes. */
  bytes: Uint8Array
  /** The participant handle, for the restored document's id. */
  handle: string
  savedAt: string
}

export interface Persistence {
  read(): Promise<Saved | null>
  write(saved: Saved): Promise<void>
  clear(): Promise<void>
}

const STORE = 'clan'
const KEY = 'current'

function idb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB
  } catch {
    return null
  }
}

function open(name: string): Promise<IDBDatabase | null> {
  const factory = idb()
  if (!factory) return Promise.resolve(null)
  return new Promise(resolve => {
    try {
      const req = factory.open(name, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest | null): Promise<T | null> {
  return new Promise(resolve => {
    try {
      const t = db.transaction(STORE, mode)
      const req = op(t.objectStore(STORE))
      t.oncomplete = () => resolve((req?.result as T) ?? null)
      t.onerror = () => resolve(null)
      t.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** The document in IndexedDB database `name`, one record. */
export function indexedDbPersistence(name = 'napkin-production-tool'): Persistence {
  let db: Promise<IDBDatabase | null> | null = null
  const get = () => (db ??= open(name))
  return {
    async read() {
      const d = await get()
      if (!d) return null
      const rec = await tx<Saved>(d, 'readonly', s => s.get(KEY))
      const raw = rec?.bytes as unknown
      if (!rec || !(raw instanceof Uint8Array || raw instanceof ArrayBuffer)) return null
      return { ...rec, bytes: new Uint8Array(rec.bytes) }
    },
    async write(saved) {
      const d = await get()
      if (!d) return
      await tx(d, 'readwrite', s => s.put(saved, KEY))
    },
    async clear() {
      const d = await get()
      if (!d) return
      await tx(d, 'readwrite', s => s.delete(KEY))
    },
  }
}

/** Nothing kept: for tests, and for a page that must not remember. */
export function memoryPersistence(): Persistence & { last: Saved | null; writes: number } {
  const p = {
    last: null as Saved | null,
    writes: 0,
    async read() { return p.last },
    async write(s: Saved) { p.last = s; p.writes++ },
    async clear() { p.last = null },
  }
  return p
}
