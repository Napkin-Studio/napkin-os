// Two tabs of one browser share one IndexedDB (re-test N3, 2026-11-18): each tab is its own copy of
// lib/idb.ts (vi.resetModules), over one small in-memory IndexedDB. A tab's own earlier write must
// never hide what another tab wrote since, and a save mark of the project index only moves forward.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Req = { result?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; onblocked?: () => void }

/** Just enough IndexedDB for lib/idb.ts: one database, stores of key → value, transactions that end once
 *  their requests (and the requests those make) are done. Values are copied in and out, as IndexedDB does. */
function fakeIndexedDb() {
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

/** A tab: its own lib/idb.ts and storage, over the shared IndexedDB. */
async function tab() {
  vi.resetModules()
  const storage = (await import('../projects/storage')).browserStorage
  const { ProjectIndex } = await import('../projects/projectIndex')
  return { storage, ProjectIndex }
}

describe('two tabs over one IndexedDB (re-test N3)', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', fakeIndexedDb())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('a tab reads what another tab wrote after its own write', async () => {
    const a = await tab()
    const b = await tab()
    await a.storage.put('k', 1)
    await b.storage.put('k', 2)
    expect(await a.storage.get('k')).toBe(2)
    expect(await a.storage.update<number>('k', (v) => (v ?? 0) + 10)).toBe(12)
    expect(await b.storage.get('k')).toBe(12)
  })

  it('the second tab’s save never puts back the first tab’s old save mark', async () => {
    const X = 'prj_X'
    const Y = 'prj_Y'
    const A = await tab()
    const B = await tab()
    // Both tabs open with X and Y listed, X saved before as m0.
    const seed = new A.ProjectIndex(A.storage)
    await seed.load()
    await seed.create({ id: X, name: 'PW copy', server: { etag: 'm0', savedAt: '2026-11-18T09:00:00Z' } })
    await seed.create({ id: Y, name: 'Black clouds' })
    const tabA = new A.ProjectIndex(A.storage)
    const tabB = new B.ProjectIndex(B.storage)
    await tabA.load()
    await tabB.load()
    // Each tab has written the index once already (what opening a project does), so each holds its own copy.
    await tabA.touch(X, tabA.get(X)!.summary, { changed: false, name: 'PW copy' })
    await tabB.touch(Y, { ...tabB.get(Y)!.summary, shots: 2 }, { changed: false, name: 'Black clouds' })
    // A saves X: the relay's new mark m1.
    await tabA.setServer(X, { etag: 'm1', savedAt: '2026-11-18T09:45:00Z' })
    // B, which never heard (no BroadcastChannel here), saves Y and touches its card.
    await tabB.setServer(Y, { etag: 'n1', savedAt: '2026-11-18T09:46:00Z' })
    await tabB.touch(Y, { ...tabB.get(Y)!.summary, shots: 3 })
    // B writes the whole list as it holds it (a first load does): still not X's old mark.
    await tabB.saveNow()
    // A reloads: X carries m1, so its next save goes with If-Match m1, not m0.
    const R = await tab()
    const reloaded = new R.ProjectIndex(R.storage)
    await reloaded.load()
    expect(reloaded.get(X)?.server?.etag).toBe('m1')
    expect(reloaded.get(Y)?.server?.etag).toBe('n1')
    expect(reloaded.get(Y)?.summary.shots).toBe(3)
  })

  it('a mark is cleared only on purpose', async () => {
    const T = await tab()
    const index = new T.ProjectIndex(T.storage)
    await index.load()
    const p = await index.create({ name: 'R', server: { etag: 'e2', savedAt: '2026-11-18T10:00:00Z' } })
    // An older mark does not win; an explicit clear (the relay has no copy any more) does.
    await index.setServer(p.id, { etag: 'e1', savedAt: '2026-11-18T09:00:00Z' })
    expect(index.get(p.id)?.server?.etag).toBe('e2')
    await index.setServer(p.id, undefined)
    const again = new T.ProjectIndex(T.storage)
    await again.load()
    expect(again.get(p.id)?.server).toBeUndefined()
  })
})
