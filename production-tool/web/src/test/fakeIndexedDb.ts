// Just enough IndexedDB for lib/idb.ts, shared by every tab of a test (lib/idb.test.ts, projects/tabs.test.ts).

type Req = { result?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; onblocked?: () => void }

/** Just enough IndexedDB for lib/idb.ts: one database, stores of key → value, transactions that end once
 *  their requests (and the requests those make) are done. Values are copied in and out, as IndexedDB does. */
export function fakeIndexedDb() {
  const stores = new Map<string, Map<string, unknown>>()
  const db = {
    objectStoreNames: { contains: (s: string) => stores.has(s) },
    createObjectStore: (s: string) => { stores.set(s, new Map()) },
    transaction(name: string) {
      let open = 0
      const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: (s: string) => unknown; abort: () => void } = {
        objectStore: () => store,
        abort: () => { aborted = true },
      }
      let aborted = false
      const finish = () => setTimeout(() => {
        if (open > 0) return
        if (aborted) tx.onabort?.()
        else tx.oncomplete?.()
      }, 0)
      const request = (run: () => unknown): Req => {
        const req: Req = {}
        open++
        setTimeout(() => {
          req.result = run()
          req.onsuccess?.()
          open--
          finish()
        }, 0)
        return req
      }
      const data = stores.get(name)!
      const store = {
        get: (k: string) => request(() => structuredClone(data.get(k))),
        put: (v: unknown, k: string) => request(() => { data.set(k, structuredClone(v)) }),
        delete: (k: string) => request(() => { data.delete(k) }),
      }
      return tx
    },
  }
  return {
    stores,
    open() {
      const req: Req & { result?: typeof db } = {}
      setTimeout(() => {
        req.result = db
        req.onupgradeneeded?.()
        req.onsuccess?.()
      }, 0)
      return req
    },
  }
}
