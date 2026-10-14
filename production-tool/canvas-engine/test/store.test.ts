// The Y layout and the scene store (features/engine-foundation.clan): per-field
// writes, points written once, meta, origins, remote merges without echo,
// field-level steps with no undo stack, update sizes, and read-only for a doc
// from a newer build.

import { createMigrationIds, createMigrationSequence } from '@tldraw/store'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodePoints } from '../src/model/points'
import { element, makeSchema, SEQUENCE_ID, type ElementRecord } from '../src/model/records'
import { ReadOnlyScene, SceneStore, type Step } from '../src/model/store'
import { elementsMap, LOCAL, metaMap, readElement, readPoints, SYSTEM, writeElement, writePoints } from '../src/y/layout'

const rect = (id: string, x = 0, y = 0): ElementRecord =>
  element({ id, kind: 'shape', z: 'a0', x, y, w: 100, h: 50, style: { stroke: '#000', width: 2 }, props: { geo: 'rect' }, customData: { kind: 'sketch', id: 's1' } })

/** Two docs kept in step by hand (what the provider does). */
function pair() {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'b' && Y.applyUpdate(b, u, 'a'))
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'a' && Y.applyUpdate(a, u, 'b'))
  return { a, b }
}

describe('the Y layout', () => {
  it('holds each small field as its own key (x,y and w,h as pairs, defaults left out); style as s:<key>, props as p:<key>', () => {
    const doc = new Y.Doc()
    const map = elementsMap(doc)
    doc.transact(() => writeElement(map, rect('r')))
    const el = map.get('r')!.get('el') as Y.Map<unknown>
    expect(el.get('xy')).toEqual([0, 0])
    expect(el.get('wh')).toEqual([100, 50])
    expect(el.has('rotation') || el.has('locked') || el.has('opacity') || el.has('parentId')).toBe(false)
    expect(el.get('s:stroke')).toBe('#000')
    expect(el.get('p:geo')).toBe('rect')
    expect(el.get('customData')).toEqual({ kind: 'sketch', id: 's1' })
    expect(readElement(map, 'r')).toEqual(rect('r'))
  })

  it('a write sets only what changed, and drops what went', () => {
    const doc = new Y.Doc()
    const map = elementsMap(doc)
    doc.transact(() => writeElement(map, rect('r')))
    let written: string[] = []
    doc.transact(() => {
      written = writeElement(map, { ...rect('r'), x: 5, style: { stroke: '#000' } })
    })
    expect(written.sort()).toEqual(['s:width', 'xy'])
  })

  it('points are written once', () => {
    const doc = new Y.Doc()
    const map = elementsMap(doc)
    const pts = encodePoints([{ x: 1, y: 1, pressure: 0.5 }], { x: 0, y: 0 })
    doc.transact(() => writePoints(map, 's', pts))
    expect(readPoints(map, 's')).toEqual(pts)
    expect(() => doc.transact(() => writePoints(map, 's', pts))).toThrow(/never rewritten/)
  })
})

describe('SceneStore', () => {
  it('stamps meta with schemaVersion 1 on its first write', () => {
    const doc = new Y.Doc()
    const s = new SceneStore(doc)
    s.seed([rect('r')])
    expect(metaMap(doc).get('schemaVersion')).toBe(1)
    expect(metaMap(doc).get('sequence')).toBe(0)
  })

  it('a local change goes to Y as LOCAL (undoable) or SYSTEM, and reports a field-level step', () => {
    const doc = new Y.Doc()
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin))
    const s = new SceneStore(doc)
    const steps: Step[] = []
    s.onStep((st) => steps.push(st))
    s.seed([rect('r')])
    const step = s.change((tx) => tx.put([{ ...tx.get('r')!, x: 40, y: 7 }]))
    expect(origins).toEqual([SYSTEM, LOCAL])
    expect(step?.changes).toEqual([{ id: 'r', field: 'xy', before: [0, 0], after: [40, 7] }])
    expect(steps).toEqual([step])
    expect(Object.keys(s).some((k) => /undo|history|stack/i.test(k))).toBe(false)
  })

  it('a move is a small update: x and y only, at most 200 B', () => {
    const doc = new Y.Doc()
    const s = new SceneStore(doc)
    s.seed([rect('r')])
    const sv = Y.encodeStateVector(doc)
    s.change((tx) => tx.put([{ ...tx.get('r')!, x: 1234.5, y: -987.25 }]))
    const update = Y.encodeStateAsUpdate(doc, sv)
    expect(update.byteLength).toBeLessThanOrEqual(200)
  })

  it('a stroke keeps its points beside the record; a removal carries them for undo', () => {
    const doc = new Y.Doc()
    const s = new SceneStore(doc)
    const pts = encodePoints([{ x: 0, y: 0, pressure: 0.5 }, { x: 10, y: 4, pressure: 0.7 }], { x: 0, y: 0 })
    const create = s.change((tx) => {
      tx.put([element({ id: 'k', kind: 'stroke', z: 'a0', w: 10, h: 4 })])
      tx.setPoints('k', pts)
    })
    expect(create?.changes.map((c) => c.field)).toEqual(['$record', '$pts'])
    expect(s.points('k')).toEqual(pts)
    expect(() => s.change((tx) => tx.setPoints('k', pts))).toThrow(/never rewritten/)
    const gone = s.change((tx) => tx.remove(['k']))
    expect(gone?.changes.map((c) => [c.field, c.after])).toEqual([['$record', null], ['$pts', null]])
    expect(s.points('k')).toBeUndefined()
  })

  it('remote writes merge into the store without being written back', () => {
    const { a, b } = pair()
    const sa = new SceneStore(a)
    const sb = new SceneStore(b)
    let echoed = 0
    a.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin !== 'b' && origin !== LOCAL && origin !== SYSTEM) echoed++
    })
    const seen: [string[], boolean][] = []
    sb.onChange((ids, remote) => seen.push([ids, remote]))
    sa.seed([rect('r')])
    expect(sb.get('r')).toEqual(rect('r'))
    expect(seen).toEqual([[['r'], true]])
    expect(echoed).toBe(0)
  })

  it('two people editing different fields of one element both keep their edit', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const sa = new SceneStore(a)
    sa.seed([rect('r')])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const sb = new SceneStore(b)
    // Offline from each other: A moves it, B restyles it.
    sa.change((tx) => tx.put([{ ...tx.get('r')!, x: 300 }]))
    sb.change((tx) => tx.put([{ ...tx.get('r')!, style: { ...tx.get('r')!.style, stroke: '#f00' } }]))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    for (const s of [sa, sb]) {
      expect(s.get('r')!.x).toBe(300)
      expect(s.get('r')!.style.stroke).toBe('#f00')
    }
  })

  it('a doc from a newer build opens read-only and refuses writes', () => {
    const doc = new Y.Doc()
    metaMap(doc).set('schemaVersion', 2)
    const s = new SceneStore(doc)
    expect(s.readOnly).toBe('napkin/2')
    expect(() => s.change((tx) => tx.put([rect('r')]))).toThrow(ReadOnlyScene)
  })

  it('a doc from an older migration sequence is migrated up as a system write', () => {
    const ids = createMigrationIds(SEQUENCE_ID, { geoDefault: 1 })
    const v2 = makeSchema(createMigrationSequence({
      sequenceId: SEQUENCE_ID, retroactive: false,
      sequence: [{ id: ids.geoDefault, scope: 'record', up: (r) => { const e = r as ElementRecord; if (e.kind === 'shape' && !e.props.geo) e.props = { ...e.props, geo: 'ellipse' } } }],
    }))
    const doc = new Y.Doc()
    new SceneStore(doc).seed([{ ...rect('r'), props: {} }])
    const s = new SceneStore(doc, { schema: v2 })
    expect(s.readOnly).toBeNull()
    expect(s.get('r')!.props.geo).toBe('ellipse')
    expect(readElement(elementsMap(doc), 'r')!.props.geo).toBe('ellipse')
    expect(metaMap(doc).get('sequence')).toBe(1)
    // And an older build meeting it goes read-only.
    expect(new SceneStore(doc).readOnly).toMatch(/migration 1/)
  })
})
