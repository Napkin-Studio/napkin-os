// A generation arrow inside a closed pile on the own engine (owner screenshot 2026-10-15): served with
// no line, so its card is never hovered at the spread place it had when it was made, and selecting it
// draws no handles there. Laid out again, it is served along its live line.

import { describe, expect, it } from 'vitest'
import { hitArrow } from '../../arrowHit'
import { setStacked } from '../../nodes/stack'
import { OwnAdapter } from './adapter'

describe('a pile’s hidden arrow', () => {
  it('has no ghost: no hover at its old place while stacked, no handles; back on its line when spread', () => {
    const a = new OwnAdapter()
    const pic = (x: number, id: string) => a.patch(a.imageNode({ x, y: 0, width: 300, height: 400, assetSha: null, status: 'saved', customData: { kind: 'pic', id, asset: 'sha256:' + '0'.repeat(64) } }), { groupIds: ['key:samurai'] })
    const front = pic(0, 'n_front')
    const back = pic(700, 'n_back')
    const arrow = a.provenanceArrow({ origin: { x: 308, y: 200 }, points: [[0, 0], [384, 0]], fromElId: front.id, toElId: back.id, color: '#FF4F2E', customData: { kind: 'provenance', from: 'n_front', to: 'n_back' } })
    a.transact(() => [front, back, arrow], { undoable: false })
    expect(hitArrow(a.elements() as never, { x: 500, y: 200 }, 1)?.id).toBe(arrow.id)
    setStacked(a, a.elements().filter((e) => e.type === 'image'), true)
    // Stacked: the arrow's old line (between the spread views) is empty canvas now.
    expect(hitArrow(a.elements() as never, { x: 500, y: 200 }, 1)).toBeUndefined()
    a.select([arrow.id])
    expect(a.selectionFrame()).toBeNull()
    setStacked(a, a.elements().filter((e) => e.type === 'image'), false)
    expect(hitArrow(a.elements() as never, { x: 500, y: 200 }, 1)?.id).toBe(arrow.id)
  })
})
