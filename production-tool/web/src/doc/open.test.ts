// Opening a project's document (contract 3): the CLAN store when the wasm loads, the snapshot store
// ("Saving without history") when it cannot, and a project made under another contract refused: said in
// words, never created over, its bytes left as they were.

import { describe, expect, it, vi } from 'vitest'
import { memoryPersistence } from '../../../clan-store/src'
import { mainStoryboard } from '../model/selectors'
import { ModelStore } from '../model/store'
import { memoryStorage, clanDbFor, docKeyFor } from '../projects/storage'
import { MAYA, modelStore, v2Clan } from '../test/model'
import { isRefused, NO_HISTORY, openDocument, type OpenedDocument } from './open'
import { emptyDocument } from './store'

const PROJECT = 'prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8'

describe('openDocument', () => {
  it('a v2 .clan is refused in words; nothing is created over it and its bytes stay as they were', async () => {
    const storage = memoryStorage()
    const bytes = await v2Clan()
    const copy = bytes.slice()
    await storage.clan(clanDbFor(PROJECT)).write({ bytes, handle: 'maya', savedAt: '2026-10-01T09:00:00Z' })
    const create = vi.spyOn(ModelStore.prototype, 'create')
    try {
      const opened = await openDocument({ project: PROJECT, person: MAYA, make: () => modelStore({ persistence: storage.clan(clanDbFor(PROJECT)) }), storage })
      expect(isRefused(opened)).toBe(true)
      expect((opened as { refused: string }).refused).toMatch(/older version of the Production Tool \(contract 2\)/)
      expect(create).not.toHaveBeenCalled()
    } finally {
      create.mockRestore()
    }
    const kept = await storage.clan(clanDbFor(PROJECT)).read()
    expect(Buffer.from(kept!.bytes).equals(Buffer.from(copy))).toBe(true)
    expect(storage.kv.has(docKeyFor(PROJECT))).toBe(false) // no plain-data document made beside it either
  })

  it('a v2 plain-data document is refused the same way when the wasm does not load', async () => {
    const storage = memoryStorage()
    const old = { contract_version: '2', participant: { id: 'p_maya01', handle: 'maya' }, refs: [], jobs: [] }
    await storage.put(docKeyFor(PROJECT), old)
    const opened = await openDocument({ project: PROJECT, person: MAYA, make: () => { throw new Error('no wasm') }, storage })
    expect((opened as { refused: string }).refused).toMatch(/older version/)
    expect(await storage.get(docKeyFor(PROJECT))).toEqual(old)
  })

  it('falls back to the snapshot store, with a visible note, when the wasm does not load', async () => {
    const opened = await openDocument({ project: PROJECT, person: MAYA, title: 'Rain', make: () => { throw new Error('no wasm') }, storage: memoryStorage() }) as OpenedDocument
    expect(opened.clan).toBeNull()
    expect(opened.storeNote).toBe(NO_HISTORY)
    expect(opened.storeNote).toMatch(/^Saving without history/)
    expect(opened.doc.get().project).toMatchObject({ title: 'Rain', created_by: `human:${MAYA.id}` })
  })

  it('opens the CLAN store when it loads: a new project the first time, the same one after', async () => {
    const storage = memoryStorage()
    const persistence = memoryPersistence()
    const make = () => modelStore({ persistence })
    const opened = await openDocument({ project: PROJECT, person: MAYA, title: 'Rain', make, storage }) as OpenedDocument
    expect(opened.clan).not.toBeNull()
    expect(opened.storeNote).toBeNull()
    expect((await opened.clan!.chain()).map((e) => e.action)).toContain('start the project')
    const sb = mainStoryboard(opened.doc.get())!.id
    await opened.clan!.close()
    const again = await openDocument({ project: PROJECT, person: MAYA, make, storage }) as OpenedDocument
    expect(mainStoryboard(again.doc.get())!.id).toBe(sb)
  })

  it('an empty document says its contract', () => {
    expect(emptyDocument(MAYA).contract_version).toBe('3')
  })
})
