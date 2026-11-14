import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { mainScript, mainStoryboard, mainVideo } from '../model/selectors'
import { addFrame, addShots, addTake, asset, id, job, MAYA, SHA, T } from '../test/model'
import { loadJson, makeAjv, SCHEMA } from '../test/schemas'
import { emptyDocument, memoryPersister, SnapshotDocumentStore, updateDoc } from './store'

// The snapshot store: what stands in when the .clan engine cannot load ("Saving without history").

describe('document store', () => {
  const validate = makeAjv().getSchema(SCHEMA('document'))!

  it('the empty document validates, with one script, storyboard and video, linked', () => {
    const d = emptyDocument(MAYA, 'Rain')
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true)
    expect(d.project).toMatchObject({ title: 'Rain', tenant_id: MAYA.tenant_id, created_by: `human:${MAYA.id}` })
    expect(mainScript(d)).toBeDefined()
    expect(mainStoryboard(d)).toBeDefined()
    expect(mainVideo(d)).toBeDefined()
  })

  it('the contract examples validate (schemas load)', () => {
    for (const f of ['examples/document.json', 'examples/document.ad.json']) expect(validate(loadJson(f)), `${f}: ${JSON.stringify(validate.errors)}`).toBe(true)
  })

  it('round-trips through a snapshot and still validates', async () => {
    const persister = memoryPersister<ProductionDocument>()
    const store = new SnapshotDocumentStore(emptyDocument(MAYA), persister, 0)
    let shotId = ''
    await updateDoc(store, (d) => {
      d.assets[SHA('a')] = asset(SHA('a'), 'image', { origin: 'uploaded', locations: [`idb://sha256/${'a'.repeat(64)}`] })
      const key = { id: id('key'), v: 1, field_v: {}, key: 'maya', role: 'character' as const }
      d.keys[key.id] = key
      const ref = { id: id('ref'), v: 1, field_v: {}, key: 'maya', variant: 'eyes', role: 'character' as const, asset: SHA('a'), named_at: T }
      d.refs[ref.id] = ref
      const [s] = addShots(d, 1, { action: 'Rain. @maya_eyes smiles.', refs: [ref.id] })
      shotId = s.id
      const fj = job(d, 'frame', [SHA('a')], SHA('c'), { node: { kind: 'shot', id: s.id }, purpose: 'frame first' })
      const cj = job(d, 'clip', [SHA('c')], SHA('d'), { node: { kind: 'shot', id: s.id }, purpose: 'clip' })
      d.jobs[fj.id] = fj
      d.jobs[cj.id] = cj
      addFrame(d, s, SHA('c'), { pick: true, job: fj })
      addTake(d, s, SHA('d'), cj, { pick: true })
    }, 'work')
    await store.flush()

    const restored = new SnapshotDocumentStore(emptyDocument(MAYA), persister, 0)
    expect(await restored.load()).not.toBeNull()
    const doc = restored.get()
    expect(doc).toEqual(store.get())
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true)
    expect(doc.frames[doc.shots[shotId].pick!.current].asset).toBe(SHA('c'))
  })

  it('a snapshot of another contract is not read', async () => {
    const persister = memoryPersister<ProductionDocument>()
    persister.value = { ...emptyDocument(MAYA), contract_version: '2' } as unknown as ProductionDocument
    expect(await new SnapshotDocumentStore(emptyDocument(MAYA), persister, 0).load()).toBeNull()
  })

  it('catches a document that breaks the contract', () => {
    const bad = emptyDocument(MAYA)
    const r = id('ref')
    bad.refs[r] = { id: r, v: 1, field_v: {}, key: 'maya_x', variant: 'Front', role: 'character', asset: SHA('a') }
    expect(validate(bad)).toBe(false)
    expect(validate({ ...emptyDocument(MAYA), contract_version: '2' })).toBe(false)
  })
})
