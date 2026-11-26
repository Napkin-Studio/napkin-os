// A small key-value wrapper over IndexedDB. Every access is wrapped: private
// windows, blocked storage and old browsers throw or reject, and the app must
// keep working (it just won't survive a reload). Falls back to memory.
//
// IndexedDB is the one copy every tab of this browser shares. The memory copy is
// only a stand-in: for a write still on its way, or when IndexedDB cannot be used
// at all. A finished write leaves nothing in memory, so a read always sees what
// another tab wrote since (re-test N3, 2026-11-18: each tab kept its own last
// write of the project index in memory and read that back for ever, so a second
// tab wrote the first tab's old save mark over its new one).

const DB_NAME = 'napkin-production-tool'
const DB_VERSION = 1
export const STORES = ['kv', 'blobs'] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        try {
          for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
        } catch { /* upgrade failed; get/put will fall back */ }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** Values not (yet) in IndexedDB: a write on its way, or every write when IndexedDB cannot be used. */
const memory: Record<StoreName, Map<string, unknown>> = { kv: new Map(), blobs: new Map() }

/** The write landed: drop the stand-in, unless a newer write of the same key has taken its place. */
function landed(store: StoreName, key: string, value: unknown) {
  if (memory[store].get(key) === value) memory[store].delete(key)
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  if (memory[store].has(key)) return memory[store].get(key) as T
  try {
    const db = await open()
    if (!db) return undefined
    return await new Promise<T | undefined>((resolve) => {
      try {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result as T | undefined)
        req.onerror = () => resolve(undefined)
      } catch {
        resolve(undefined)
      }
    })
  } catch {
    return undefined
  }
}

export async function idbPut(store: StoreName, key: string, value: unknown): Promise<boolean> {
  memory[store].set(key, value)
  try {
    const db = await open()
    if (!db) return false
    return await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).put(value, key)
        tx.oncomplete = () => {
          landed(store, key, value)
          resolve(true)
        }
        tx.onerror = () => resolve(false)
        tx.onabort = () => resolve(false)
      } catch {
        resolve(false)
      }
    })
  } catch {
    return false
  }
}

/**
 * Read, change and write one key in a single IndexedDB transaction, so no other tab's write can land between
 * the read and the write (IndexedDB runs read-write transactions on a store one at a time, across tabs).
 * `fn` must not wait on anything. Returns what was written.
 */
export async function idbUpdate<T>(store: StoreName, key: string, fn: (v: T | undefined) => T): Promise<T> {
  const fallback = () => {
    const next = fn(memory[store].get(key) as T | undefined)
    memory[store].set(key, next)
    return next
  }
  // A write of this key still on its way (or IndexedDB not usable): the memory copy is the newest.
  if (memory[store].has(key)) {
    const next = fallback()
    void idbPut(store, key, next)
    return next
  }
  let db: IDBDatabase | null = null
  try {
    db = await open()
  } catch { /* falls back below */ }
  if (!db) return fallback()
  const conn = db
  return new Promise<T>((resolve, reject) => {
    let next: T | undefined
    let done = false
    const fail = () => {
      if (done) return
      done = true
      try {
        resolve(fallback())
      } catch (e) {
        reject(e)
      }
    }
    try {
      const tx = conn.transaction(store, 'readwrite')
      const os = tx.objectStore(store)
      const req = os.get(key)
      req.onsuccess = () => {
        try {
          next = fn(req.result as T | undefined)
          os.put(next, key)
        } catch {
          tx.abort()
        }
      }
      tx.oncomplete = () => {
        if (done) return
        done = true
        resolve(next as T)
      }
      tx.onerror = fail
      tx.onabort = fail
    } catch {
      fail()
    }
  })
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  memory[store].delete(key)
  try {
    const db = await open()
    if (!db) return
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      } catch {
        resolve()
      }
    })
  } catch { /* nothing to do */ }
}
