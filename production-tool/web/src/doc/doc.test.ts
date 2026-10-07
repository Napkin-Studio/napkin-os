import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { applyFrame, applyShotList, applyTake } from '../jobs/handlers'
import { newId } from '../lib/ulid'
import { makeAjv, SCHEMA, loadJson } from '../test/schemas'
import { emptyDocument, memoryPersister, normaliseDocument, SnapshotDocumentStore, updateDoc } from './store'
import { mockShotList } from '../relay/mock'
import type { Job } from '../contracts/types'

const SHA = (c: string) => `sha256:${c.repeat(64)}`

function job(partial: Partial<Job>): Job {
  return {
    contractVersion: '2', jobId: newId('job'), participantId: 'p_test01', op: 'frame', quotaClass: 'image', state: 'completed',
    inputHashes: [], cost: { currency: 'USD', unknown: false }, kind: 'mock', provider: 'mock', model: 'mock',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...partial,
  }
}

describe('document store', () => {
  const ajv = makeAjv()
  const validate = ajv.getSchema(SCHEMA('document'))!

  it('the empty document validates', () => {
    expect(validate(emptyDocument()), JSON.stringify(validate.errors)).toBe(true)
  })

  it('the contract example validates (schemas load)', () => {
    expect(validate(loadJson('examples/document.json')), JSON.stringify(validate.errors)).toBe(true)
  })

  it('round-trips through a snapshot and still validates', async () => {
    const persister = memoryPersister<ProductionDocument>()
    const store = new SnapshotDocumentStore(emptyDocument({ id: 'p_test01', handle: 'maya' }), persister, 0)
    const refId = newId('ref')
    const jobId = newId('job')
    updateDoc(store, (d) => {
      d.assets.push({ sha256: SHA('a'), kind: 'image', mime: 'image/png', origin: 'uploaded', locations: ['idb://sha256/' + 'a'.repeat(64)] })
      d.keys.push({ key: 'maya', role: 'character' })
      d.refs.push({ id: refId, key: 'maya', variant: 'eyes', asset: SHA('a'), node: newId('node'), named_at: new Date().toISOString() })
      d.jobs.push({ id: jobId, op: 'generate', state: 'completed', parent_ids: [], input_hashes: [SHA('a')], outputs: [SHA('b')], created_at: new Date().toISOString(), cost: { currency: 'USD', unknown: false } })
      d.refs.push({ id: newId('ref'), key: 'maya', variant: 'three-quarter', asset: SHA('b'), node: jobId })
      d.script = { current: newId('rev'), revisions: [] }
      d.script.revisions.push({ id: d.script.current!, created_at: new Date().toISOString(), imported_text: 'Rain. The hero smiles.', target_s: 10, status: 'draft' })
    })
    const shotJob = job({ op: 'shot_list', quotaClass: 'text', shots: mockShotList('Rain. @maya_eyes smiles.', 10, ['maya_eyes']), outputs: [] })
    updateDoc(store, (d) => applyShotList(d, shotJob, { for: 'shot_list', revId: d.script!.current!, request: {} as never }))
    const shotId = store.get().shots![0].id
    updateDoc(store, (d) => applyFrame(d, job({ outputs: [{ sha256: SHA('c'), url: 'https://x.invalid/c', mime: 'image/png' }] }), { for: 'frame', shotId, request: {} as never }))
    updateDoc(store, (d) => {
      d.reviews!.push({ id: newId('pin'), target: { kind: 'take', id: 'x' }, comment: 'brighter', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, at_s: 1.2, resolved: false, created_at: new Date().toISOString() })
    })
    const reviewId = store.get().reviews![0].id
    updateDoc(store, (d) => applyTake(d, job({ op: 'clip', quotaClass: 'video', outputs: [{ sha256: SHA('d'), url: 'https://x.invalid/d', mime: 'video/webm', durationS: 4 }] }), { for: 'clip', shotId, reviewIds: [reviewId], request: {} as never }))
    await store.flush()

    const restored = new SnapshotDocumentStore(emptyDocument(), persister, 0)
    expect(await restored.restore(normaliseDocument)).toBe(true)
    const doc = restored.get()
    expect(doc).toEqual(store.get())
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true)
    expect(doc.frames![0].selected).toBe(true)
    expect(doc.shots![0].storyboard_frame).toBe(SHA('c'))
    expect(doc.takes![0].selected).toBe(true)
    expect(doc.reviews![0].resolved).toBe(true)
    expect(doc.shots![0].refs).toEqual(['maya_eyes'])
  })

  it('catches a document that breaks the contract', () => {
    const bad = emptyDocument() as unknown as Record<string, unknown>
    ;(bad.refs as unknown[]).push({ id: newId('ref'), key: 'maya_x', variant: 'Front', asset: SHA('a') })
    expect(validate(bad)).toBe(false)
    const old = { ...emptyDocument(), contract_version: '1' }
    expect(validate(old)).toBe(false)
  })
})
