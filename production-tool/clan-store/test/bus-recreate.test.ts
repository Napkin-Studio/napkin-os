// A delete and a create of the same id in one batch is a change of that entity, never its loss. The web
// writes a changed asset this way (assets are unversioned): its rights (features/prod-assets-route.clan).
import { describe, expect, it } from 'vitest'
import { LocalPatchBus } from '../src/index'
import { MAYA, store } from './fixtures'

const SHA = `sha256:${'a'.repeat(64)}`
const asset = (extra: object = {}) => ({ sha256: SHA, kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [], ...extra })

describe('LocalPatchBus: delete then create in one batch', () => {
  it('keeps the entity with its new fields, in the bus and in the saved document', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const bus = new LocalPatchBus(s)
    expect((await bus.apply({ patches: [{ op: 'create', entity: 'assets', id: SHA, value: asset({ rights: 'unknown', w: 10 }), base_version: 0 }], why: { action: 'add picture' } })).applied).toBe(true)
    const r = await bus.apply({
      patches: [{ op: 'delete', entity: 'assets', id: SHA, base_version: 0 }, { op: 'create', entity: 'assets', id: SHA, value: asset({ rights: 'licensed' }), base_version: 0 }],
      why: { action: 'rights licensed' },
    })
    expect(r.applied).toBe(true)
    expect(bus.doc().assets[SHA]).toEqual(asset({ rights: 'licensed' }))
    expect(s.get().assets[SHA]).toEqual(asset({ rights: 'licensed' })) // w went with the old copy
  })
})
