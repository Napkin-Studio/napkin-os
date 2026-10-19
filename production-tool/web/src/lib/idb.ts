// A small key-value wrapper over IndexedDB. Every access is wrapped: private
// windows, blocked storage and old browsers throw or reject, and the app must
// keep working (it just won't survive a reload). Falls back to memory.

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

const memory: Record<StoreName, Map<string, unknown>> = { kv: new Map(), blobs: new Map() }

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
          // Persisted; drop the memory copy of big values so it doesn't grow forever.
          if (store === 'blobs') memory[store].delete(key)
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
