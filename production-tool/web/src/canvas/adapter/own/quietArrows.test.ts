// The engine's quiet arrows on our own canvas (canvas-nodes decision 2026-10-15): the provenance
// arrow to a key's view, read off the records as the web reads it off elements (arrowHit quietArrow).

import { describe, expect, it } from 'vitest'
import { element } from '../../../../../canvas-engine/src'
import { quietRecord } from './engine'

describe('quietRecord', () => {
  const prov = { kind: 'provenance', from: 'node_a', to: 'job_b' }
  const recs = new Map([
    ['S', element({ id: 'S', kind: 'image', z: 'a0', customData: { kind: 'gen', id: 'job_b', op: 'view' } })],
    ['G', element({ id: 'G', kind: 'image', z: 'a1', customData: { kind: 'gen', id: 'job_c', op: 'generate' } })],
  ])
  const arrow = (end: string) => element({ id: `a${end}`, kind: 'arrow', z: 'b0', props: { start: { elementId: 'F' }, end: { elementId: end } }, customData: prov })

  it('an arrow to a view is quiet; one to any other generation is not', () => {
    expect(quietRecord(arrow('S'), (id) => recs.get(id))).toBe(true)
    expect(quietRecord(arrow('G'), (id) => recs.get(id))).toBe(false)
  })
})
