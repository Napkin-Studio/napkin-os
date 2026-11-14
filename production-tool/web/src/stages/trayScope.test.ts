// What a sketch area's links add to the send tray (ui-behaviour 3.16, item 1), over the example ad.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { loadJson } from '../test/schemas'
import { linkedRows, sketchOf, unknownTyped } from './trayScope'

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const SKETCH = 'sketch_01K7A000000000000000000021'
const GOLDEN = 'ref_01K7A00000000000000000000R'
const el = (id: string, customData: unknown) => ({ id, type: 'rectangle', isDeleted: false, customData })

describe('the send tray reads the sketch area\'s links', () => {
  it('finds the sketch area in a selection', () => {
    const els = [el('e1', { kind: 'note', id: 'n1' }), el('e2', { kind: 'sketch', id: SKETCH })]
    expect(sketchOf(els, ['e1', 'e2'])).toBe(SKETCH)
    expect(sketchOf(els, ['e1'])).toBeUndefined()
  })

  it('a linked reference whose picture is on the canvas is sent with the sketch; ink is listed, not sent', () => {
    const d = structuredClone(ex)
    d.refs[GOLDEN].node = 'gen_golden'
    const els = [el('e2', { kind: 'sketch', id: SKETCH }), el('pic', { kind: 'pic', id: 'gen_golden', asset: d.refs[GOLDEN].asset })]
    const rows = linkedRows(d, SKETCH, els, ['e2'])
    expect(rows.map((r) => [r.label, r.elIds, r.off])).toEqual([
      ['@ref_golden-hour · lighting (linked)', ['pic'], undefined],
      ['Ink · note (linked)', [], 'not sent with a sketch yet'],
    ])
  })

  it('a reference already in the selection is not listed twice; one off the canvas cannot be sent', () => {
    const d = structuredClone(ex)
    d.refs[GOLDEN].node = 'gen_golden'
    const els = [el('e2', { kind: 'sketch', id: SKETCH }), el('pic', { kind: 'pic', id: 'gen_golden' })]
    expect(linkedRows(d, SKETCH, els, ['e2', 'pic']).map((r) => r.item.kind)).toEqual(['ink'])
    expect(linkedRows(d, SKETCH, [els[0]], ['e2'])[0]).toMatchObject({ elIds: [], off: 'its picture is not on the canvas' })
  })

  it('a linked key is one row naming the views that go, each picture on the canvas sent (owner 2026-10-15)', () => {
    const d = structuredClone(ex)
    const MAYA = 'key_01K7A00000000000000000000K'
    for (const l of Object.values(d.links)) if (l.to.id === SKETCH) delete d.links[l.id]
    d.links.link_k = { id: 'link_k', v: 1, field_v: {}, from: { kind: 'key', id: MAYA }, to: { kind: 'sketch', id: SKETCH }, role: 'character' }
    const views = Object.values(d.refs).filter((r) => r.key === 'maya')
    views.forEach((r, i) => { r.node = `node_v${i}` })
    for (const v of ['back', 'three-quarter', 'laughing']) d.refs[`ref_${v}`] = { ...structuredClone(views[1]), id: `ref_${v}`, variant: v, node: `node_${v}` }
    const els = [el('e2', { kind: 'sketch', id: SKETCH }), el('p0', { kind: 'pic', id: 'node_v0' }), el('p1', { kind: 'pic', id: 'node_v1' }), el('p3', { kind: 'pic', id: 'node_three-quarter' })]
    const rows = linkedRows(d, SKETCH, els, ['e2'])
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('@maya · 5 views · character (linked) · sends front, three-quarter, side, back (1 more stays out: 4 views at most)')
    // The back is not on the canvas: the three that are go with the sketch.
    expect(rows[0].elIds).toEqual(['p0', 'p3', 'p1'])
  })

  it('names typed in the words that match nothing', () => {
    expect(unknownTyped(ex, 'A @jogger runs past @maya_front and @maya, then @jogger again')).toEqual(['jogger'])
  })
})
