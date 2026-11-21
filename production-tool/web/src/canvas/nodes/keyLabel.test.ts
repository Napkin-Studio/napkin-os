// UAT round 5 (rough, features/pt-canvas-r5.clan): "Ruby · 2 views" sat on an unrelated sunset picture, because the
// label went to the top-left of the box around both views, and the side view was up and to the right of the front.
import { describe, expect, it } from 'vitest'
import { labelAnchor } from './keyGroups'

describe('a key group\'s label sits on one of its views', () => {
  it('the live layout: front at (520, 487), side at (698, 330): on the side view, not the empty corner (520, 330)', () => {
    const front = { x: 520, y: 487, width: 165, height: 93 }
    const side = { x: 698, y: 330, width: 165, height: 93 }
    expect(labelAnchor([front, side])).toEqual({ x: 698, y: 330 })
  })
  it('a row of views: the leftmost', () => {
    expect(labelAnchor([{ x: 900, y: 100 }, { x: 300, y: 104 }, { x: 600, y: 100 }])).toEqual({ x: 300, y: 104 })
  })
})
