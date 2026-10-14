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

  it('names typed in the words that match nothing', () => {
    expect(unknownTyped(ex, 'A @jogger runs past @maya_front and @maya, then @jogger again')).toEqual(['jogger'])
  })
})
