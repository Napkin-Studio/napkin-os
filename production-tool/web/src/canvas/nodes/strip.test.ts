// The Storyboard node's strip says when there are more shots than tiles (live test: 6 of 7, no hint).
import { describe, expect, it } from 'vitest'
import { STRIP_TILES, stripOf } from './strip'

describe('the Storyboard node strip', () => {
  it('shows every shot up to the tiles, then the tiles less one and "+N"', () => {
    expect(STRIP_TILES).toBe(6)
    expect(stripOf(0)).toEqual({ shown: 0, more: 0 })
    expect(stripOf(6)).toEqual({ shown: 6, more: 0 })
    expect(stripOf(7)).toEqual({ shown: 5, more: 2 })
    expect(stripOf(12)).toEqual({ shown: 5, more: 7 })
  })
})
