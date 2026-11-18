// Tabs of one browser, saving one project to the relay (re-test N3 and R1, 2026-11-18). Each tab is its own
// copy of lib/idb.ts, the index and the server copy (vi.resetModules) over one IndexedDB, as idb.test.ts runs
// them. Each tab's save sends If-Match with the version ITS document is based on: never the browser's newest
// mark, which another tab may have saved.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductionDocument, SavedProject } from '../contracts/types'
import { fakeIndexedDb } from '../test/fakeIndexedDb'

const X = 'prj_X'
const Y = 'prj_Y'

/** The relay's project routes as far as saving goes (relay/projects.py): a stale If-Match is a 409. */
function relay() {
  let n = 0
  const rows = new Map<string, SavedProject>()
  const saves: { tab: string; id: string; ifMatch: string | null; status: number }[] = []
  /** The ProjectServer one tab sees: its own SaveConflict class (each tab has its own modules). */
  const serverFor = (tab: string, SaveConflict: new (m: string) => Error) => ({
    signedIn: true,
    list: async () => [...rows.values()],
    save: async (id: string, _bytes: Uint8Array, opts: { ifMatch?: string }) => {
      const old = rows.get(id)
      if (old && opts.ifMatch !== old.etag) {
        saves.push({ tab, id, ifMatch: opts.ifMatch ?? null, status: 409 })
        throw new SaveConflict(`This project was saved from somewhere else at ${old.savedAt} since you opened it.`)
      }
      n++
      const row: SavedProject = { id, etag: `${id.slice(-1).toLowerCase()}${n}`, savedAt: new Date(Date.parse('2026-11-18T10:00:00Z') + n * 60_000).toISOString(), bytes: 1 }
      rows.set(id, row)
      saves.push({ tab, id, ifMatch: opts.ifMatch ?? null, status: 200 })
      return row
    },
    putCanvas: async () => {},
  })
  return { rows, saves, serverFor }
}
type Relay = ReturnType<typeof relay>

/** A tab that opens project `id`: its own modules, index and server copy, over the browser's one IndexedDB. */
async function open(name: string, id: string, r: Relay) {
  vi.resetModules()
  const { browserStorage: storage } = await import('./storage')
  const { ProjectIndex } = await import('./projectIndex')
  const { ServerCopy, readBase } = await import('./serverCopy')
  const { SaveConflict } = await import('./server')
  const index = new ProjectIndex(storage)
  await index.load()
  const copy = new ServerCopy({
    id, server: r.serverFor(name, SaveConflict) as never, index, storage, canvasKey: `canvas:${id}`,
    doc: () => ({ assets: {} }) as unknown as ProductionDocument, upload: async () => undefined,
    base: await readBase(storage, index, id),
  })
  let k = 0
  /** A change in this tab, then its save (what Ctrl+S sends). */
  const save = async () => {
    copy.edited()
    await copy.post(new Uint8Array([++k]), { reason: 'manual' })
  }
  return { index, copy, save, storage, SaveConflict }
}

describe('tabs of one browser save one project', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', fakeIndexedDb())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('a reloaded tab saves on its own last save (N3), and a stale tab is refused, never written over another tab’s save (R1)', async () => {
    const r = relay()
    // X and Y are on the relay and in this browser's index, as saved before.
    {
      vi.resetModules()
      const { browserStorage } = await import('./storage')
      const { ProjectIndex } = await import('./projectIndex')
      const seed = new ProjectIndex(browserStorage)
      await seed.load()
      for (const id of [X, Y]) {
        const row = await r.serverFor('seed', Error).save(id, new Uint8Array([0]), {})
        await seed.create({ id, name: id, server: { etag: row.etag, savedAt: row.savedAt } })
      }
    }
    const x0 = r.rows.get(X)!.etag
    const A = await open('A', X, r)
    const C = await open('C', X, r) // the same project in another tab: it never reloads
    const B = await open('B', Y, r)

    // A saves X; B saves Y.
    await A.save()
    const x1 = r.rows.get(X)!.etag
    expect(r.saves.at(-1)).toMatchObject({ tab: 'A', ifMatch: x0, status: 200 })
    await B.save()
    expect(r.saves.at(-1)).toMatchObject({ tab: 'B', status: 200 })

    // N3: A reloads and saves again: on its own last save, 200, no conflict.
    const A2 = await open('A2', X, r)
    expect(A2.copy.basedOn()?.etag).toBe(x1)
    await A2.save()
    const x2 = r.rows.get(X)!.etag
    expect(r.saves.at(-1)).toMatchObject({ tab: 'A2', ifMatch: x1, status: 200 })
    expect(A2.copy.get()).toBeNull()

    // R1: C still has the document it opened (x0). The browser's index knows x2 (C reads it again, as the
    // BroadcastChannel makes it), yet C's save goes on x0: refused, and A's save stays the project.
    await C.index.load()
    expect(C.index.get(X)?.server?.etag).toBe(x2)
    const err = await C.save().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(C.SaveConflict)
    expect(r.saves.at(-1)).toMatchObject({ tab: 'C', ifMatch: x0, status: 409 })
    expect(r.rows.get(X)!.etag).toBe(x2)
    expect(C.copy.get()?.message).toContain('saved from somewhere else')
    // Until C's person chooses, nothing of C's goes (the 5-minute save included).
    const before = r.saves.length
    await expect(C.copy.post(new Uint8Array([9]), { reason: 'interval' })).rejects.toBeInstanceOf(C.SaveConflict)
    expect(r.saves.length).toBe(before)

    // The choice: save this as a new version, on top of the relay's newest (shell.saveAsNewVersion).
    const latest = r.rows.get(X)!
    await C.copy.settle({ etag: latest.etag, savedAt: latest.savedAt })
    await C.copy.post(new Uint8Array([10]), { reason: 'manual' })
    expect(r.saves.at(-1)).toMatchObject({ tab: 'C', ifMatch: x2, status: 200 })
    expect(C.copy.get()).toBeNull()
    const x3 = r.rows.get(X)!.etag

    // A2 never heard of C's version: its next save is refused too, not written over C's.
    await expect(A2.save()).rejects.toBeInstanceOf(A2.SaveConflict)
    expect(r.rows.get(X)!.etag).toBe(x3)

    // What this browser's copy is based on is C's save now, with nothing of its own since.
    const { readBase } = await import('./serverCopy')
    const { ProjectIndex } = await import('./projectIndex')
    const { browserStorage } = await import('./storage')
    const after = new ProjectIndex(browserStorage)
    await after.load()
    expect(after.get(X)?.server?.etag).toBe(x3)
    expect(await readBase(browserStorage, after, Y)).toMatchObject({ mark: { etag: r.rows.get(Y)!.etag }, unsaved: false })
  })

  it('a change after the save leaves this browser’s copy unsaved on top of it', async () => {
    const r = relay()
    const A = await open('A', X, r)
    await A.save()
    const x1 = r.rows.get(X)!.etag
    A.copy.edited()
    // A reload reads what A's copy is based on, and that it has work the relay lacks.
    const A2 = await open('A2', X, r)
    const { readBase } = await import('./serverCopy')
    expect(await readBase(A2.storage, A2.index, X)).toEqual({ mark: { etag: x1, savedAt: r.rows.get(X)!.savedAt }, unsaved: true })
  })
})
