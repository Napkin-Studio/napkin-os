// The element view of napkin/1 (features/engine-ink.clan): records to elements and
// back are the same records, and an insert or a move writes only its own z.

import { describe, expect, it } from 'vitest'
import { elementFromRecord, recordsFromElements } from '../src/model/elements'
import { encodePoints } from '../src/model/points'
import { element, type ElementRecord } from '../src/model/records'

const SHA = 'sha256:' + 'a'.repeat(64)
const RECORDS: ElementRecord[] = [
  element({ id: 'b', kind: 'board', z: 'a0', x: 0, y: 0, w: 3000, h: 1800, props: { name: 'Board 1' }, customData: { kind: 'board', id: 'board_1' } }),
  element({ id: 's', kind: 'stroke', z: 'a1', x: 10, y: 20, w: 30, h: 5, parentId: 'b', groupIds: ['g1'], style: { stroke: '#a33b2b', width: 3 }, props: { tool: 'highlighter' }, opacity: 0.35 }),
  element({ id: 'i', kind: 'image', z: 'a2', x: 100, y: 0, w: 300, h: 400, props: { assetSha: SHA, status: 'saved' }, customData: { kind: 'pic', id: 'node_1', asset: SHA } }),
  element({ id: 'p', kind: 'image', z: 'a3', x: 500, y: 0, w: 300, h: 400, props: { assetSha: null, status: 'pending' }, customData: { kind: 'gen', id: 'job_1' } }),
  element({ id: 'a', kind: 'arrow', z: 'a4', x: 400, y: 200, w: 100, h: 0, style: { stroke: '#FF4F2E', width: 2, dash: 'dashed', arrowheadEnd: 'arrow' }, props: { route: [0, 0, 50, -10, 100, 0], start: { elementId: 'i' }, end: { elementId: 'p' } }, customData: { kind: 'provenance', from: 'node_1', to: 'job_1' } }),
  element({ id: 't', kind: 'text', z: 'a5', x: 0, y: 500, w: 80, h: 24, style: { stroke: '#1e1e1e', fontFamily: 'Geist', fontSize: 24, align: 'center' }, props: { plain: 'When happy', boundTo: null } }),
  element({ id: 'k', kind: 'sketch', z: 'a6', x: 0, y: 600, w: 320, h: 180, style: { fill: '#ffffff' }, customData: { kind: 'sketch', id: 'sketch_1' } }),
  element({ id: 'f', kind: 'frame', z: 'a7', x: 0, y: 900, w: 100, h: 100, props: { name: 'Drawing' }, customData: { kind: 'drawn', id: 'node_d' } }),
  element({ id: 'e', kind: 'shape', z: 'a8', x: 300, y: 900, w: 50, h: 50, style: { stroke: '#000', width: 2 }, props: { geo: 'ellipse' } }),
]
const PTS = { s: encodePoints([{ x: 0, y: 5, pressure: 0.5 }, { x: 30, y: 0, pressure: 0.8 }], { x: 0, y: 0 }) }

const els = () => RECORDS.map((r) => elementFromRecord(r, PTS[r.id as 's']))
const current = (id: string) => RECORDS.find((r) => r.id === id)

describe('the element view', () => {
  it('reads as the tool expects', () => {
    const [b, s, i, p, a, t, k, f, e] = els()
    expect([b.type, s.type, i.type, p.type, a.type, t.type, k.type, f.type, e.type]).toEqual(['frame', 'freedraw', 'image', 'image', 'arrow', 'text', 'rectangle', 'frame', 'ellipse'])
    expect(s.frameId).toBe('b')
    expect(s.opacity).toBe(35)
    expect(p.status).toBe('pending')
    expect(a.startBinding).toEqual({ elementId: 'i' })
    expect(t.text).toBe('When happy')
    expect(k.backgroundColor).toBe('#ffffff')
  })

  it('round-trips to the same records, keeping every z', () => {
    const { records } = recordsFromElements(els(), current)
    for (const r of RECORDS) {
      const back = records.find((x) => x.id === r.id)!
      expect(back.z).toBe(r.z)
      expect(back).toMatchObject({ kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h, parentId: r.parentId, groupIds: r.groupIds, opacity: r.opacity, customData: r.customData })
      for (const [key, value] of Object.entries(r.props)) expect(back.props[key], `${r.id}.${key}`).toEqual(value)
    }
  })

  it('an element put in the middle gets a key between its neighbours; the others keep theirs', () => {
    const list = els()
    const extra = elementFromRecord(element({ id: 'n', kind: 'shape', z: 'zz', props: { geo: 'rect' } }))
    list.splice(3, 0, extra)
    const { records } = recordsFromElements(list, current)
    const n = records.find((r) => r.id === 'n')!
    expect(n.z > 'a2' && n.z < 'a3').toBe(true)
    expect(records.filter((r) => r.id !== 'n').map((r) => r.z)).toEqual(RECORDS.map((r) => r.z))
  })

  it('a frame moved to the bottom gets a key below the first', () => {
    const list = els()
    const f = list.splice(7, 1)[0]
    list.unshift(f)
    const { records } = recordsFromElements(list, current)
    expect(records[0].id).toBe('f')
    expect(records[0].z < 'a0').toBe(true)
    expect(records.slice(1).map((r) => r.z)).toEqual(RECORDS.filter((r) => r.id !== 'f').map((r) => r.z))
  })
})
