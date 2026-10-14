// napkin/1 records (features/engine-foundation.clan): every kind validates,
// session state and foreign props are refused, and the migration machinery runs
// a v1-to-v2 fixture through @tldraw/store.

import { createMigrationIds, createMigrationSequence, Store } from '@tldraw/store'
import { describe, expect, it } from 'vitest'
import { element, ElementType, FORMAT, KINDS, makeSchema, MIGRATIONS, SEQUENCE_ID, sequenceVersion, validateElement, type ElementRecord } from '../src/model/records'

describe('napkin/1 records', () => {
  it('is napkin/1 with no migrations yet', () => {
    expect(FORMAT).toBe('napkin/1')
    expect(MIGRATIONS.sequenceId).toBe(SEQUENCE_ID)
    expect(sequenceVersion()).toBe(0)
  })

  it.each(KINDS)('a %s validates with defaults', (kind) => {
    const r = element({ id: `e_${kind}`, kind, z: 'a0' })
    expect(validateElement(r)).toBe(r)
    expect(r).toMatchObject({ x: 0, y: 0, w: 0, h: 0, rotation: 0, flipX: false, flipY: false, parentId: null, groupIds: [], locked: false, opacity: 1 })
  })

  it('keeps the tool’s customData tag and per-kind props', () => {
    const img = element({ id: 'p', kind: 'image', z: 'a1', customData: { kind: 'pic', id: 'node_1', asset: 'sha256:x' }, props: { assetSha: 'sha256:x', crop: null, status: 'saved' } })
    expect(validateElement(img).props.assetSha).toBe('sha256:x')
    const text = element({ id: 't', kind: 'text', z: 'a2', props: { boundTo: 'p', doc: { type: 'doc', content: [] } } })
    expect(validateElement(text).props.boundTo).toBe('p')
  })

  it.each([
    ['selection', { selected: true }],
    ['the camera', { camera: { x: 0, y: 0, z: 1 } }],
    ['a hover', { hovered: true }],
  ])('refuses session state: %s', (_what, extra) => {
    expect(() => validateElement({ ...element({ id: 'x', kind: 'shape', z: 'a0' }), ...extra })).toThrow(/session state/)
  })

  it('refuses a prop of another kind, a bad kind, bytes and NaN', () => {
    expect(() => element({ id: 'x', kind: 'shape', z: 'a0', props: { assetSha: 'nope' } })).toThrow(/prop 'assetSha' on a shape/)
    expect(() => element({ id: 'x', kind: 'blob' as never, z: 'a0' })).toThrow(/kind/)
    expect(() => element({ id: 'x', kind: 'shape', z: 'a0', x: Number.NaN })).toThrow(/x/)
    expect(() => element({ id: 'x', kind: 'image', z: 'a0', props: { crop: new Uint8Array(2) as never } })).toThrow(/props/)
    expect(() => element({ id: 'x', kind: 'shape', z: 'a0', opacity: 2 })).toThrow(/opacity/)
  })

  it('a store refuses an invalid record', () => {
    const store = new Store<ElementRecord>({ schema: makeSchema(), props: {} })
    expect(() => store.put([{ ...element({ id: 'x', kind: 'shape', z: 'a0' }), viewport: 1 } as never])).toThrow()
  })
})

describe('migrations (a v1-to-v2 fixture)', () => {
  // What a later additive change looks like: shapes gain a 'p:geo' default.
  const ids = createMigrationIds(SEQUENCE_ID, { geoDefault: 1 })
  const v2 = createMigrationSequence({
    sequenceId: SEQUENCE_ID,
    retroactive: false,
    sequence: [{
      id: ids.geoDefault, scope: 'record', filter: (r) => (r as ElementRecord).typeName === 'el',
      up: (r) => {
        const e = r as ElementRecord
        if (e.kind === 'shape' && e.props.geo === undefined) e.props = { ...e.props, geo: 'rect' }
      },
      down: (r) => {
        const e = r as ElementRecord
        if (e.kind === 'shape' && e.props.geo === 'rect') {
          const { geo: _geo, ...rest } = e.props
          e.props = rest
        }
      },
    }],
  })
  const schemaV2 = makeSchema(v2)

  it('counts the migration', () => {
    expect(sequenceVersion(schemaV2)).toBe(1)
  })

  it('brings a v1 record up, and a v2 one back down', () => {
    const v1Record = ElementType.create({ ...element({ id: 's', kind: 'shape', z: 'a0' }) })
    const persisted = { schemaVersion: 2 as const, sequences: { [SEQUENCE_ID]: 0 } }
    const up = schemaV2.migratePersistedRecord(v1Record, persisted, 'up')
    expect(up.type).toBe('success')
    expect(up.type === 'success' && up.value.props.geo).toBe('rect')
    const down = schemaV2.migratePersistedRecord(up.type === 'success' ? up.value : v1Record, persisted, 'down')
    expect(down.type === 'success' && down.value.props.geo).toBeUndefined()
  })
})
