// S1-12: an edit followed at once by a reload is kept. The page dies inside the model store's debounce (250 ms) and the
// store Worker's (300 ms): the edit is only in the synchronous pending patch, and the next open applies it.
import { describe, expect, it } from 'vitest'
import { ClanDocumentStore, memoryPersistence } from '../../../clan-store/src'
import { updateDoc } from '../doc/store'
import { MAYA, wasm } from '../test/model'
import { ModelStore } from './store'

const memory = () => {
  const m = new Map<string, string>()
  return { m, store: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } }
}
const make = (persistence: ReturnType<typeof memoryPersistence>, ls: ReturnType<typeof memory>, debounceMs: number) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, person: MAYA, saveDebounceMs: 0 }), { debounceMs, recover: { key: 'pending:p1', store: ls.store } })

describe('an edit and a reload at once', () => {
  it('is applied when the project opens again, and the pending patch is gone', async () => {
    const persistence = memoryPersistence()
    const ls = memory()
    const first = make(persistence, ls, 60_000) // the page goes before the 250 ms
    await first.create(MAYA, 'Untitled project', true)
    await first.flush()
    expect(ls.m.size).toBe(0) // written: nothing pending
    await updateDoc(first, (d) => { d.project.title = 'Edited just before reload' }, 'rename')
    expect(JSON.parse(ls.m.get('pending:p1')!).patch).toEqual({ project: { title: 'Edited just before reload' } })
    // The page is gone: nothing was drained, nothing reached the browser's copy.
    const second = make(persistence, ls, 1)
    const doc = await second.load()
    expect(doc?.project.title).toBe('Edited just before reload')
    expect(ls.m.size).toBe(0)
    await second.flush()
    expect((await make(persistence, ls, 1).load())?.project.title).toBe('Edited just before reload')
  })

  it('what the browser did write is not applied again over a later change', async () => {
    const persistence = memoryPersistence()
    const ls = memory()
    const a = make(persistence, ls, 1)
    await a.create(MAYA, 'T', true)
    await updateDoc(a, (d) => { d.project.title = 'One' }, 'rename')
    await a.flush()
    await updateDoc(a, (d) => { d.project.title = 'Two' }, 'rename')
    await a.flush()
    expect(ls.m.size).toBe(0)
    expect((await make(persistence, ls, 1).load())?.project.title).toBe('Two')
  })

  it('a storage that refuses writes leaves the usual path, nothing breaks', async () => {
    const persistence = memoryPersistence()
    const ls = { store: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } }, m: new Map<string, string>() }
    const a = make(persistence, ls as never, 1)
    await a.create(MAYA, 'T', true)
    await updateDoc(a, (d) => { d.project.title = 'Kept' }, 'rename')
    await a.flush()
    expect((await make(persistence, ls as never, 1).load())?.project.title).toBe('Kept')
  })
})
