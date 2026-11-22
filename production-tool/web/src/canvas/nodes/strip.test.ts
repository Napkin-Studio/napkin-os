// The Storyboard node's strip says when there are more shots than tiles (live test: 6 of 7, no hint).
import { describe, expect, it } from 'vitest'
import { plannedLine, STRIP_TILES, stripOf } from './strip'

describe('the Storyboard node strip', () => {
  it('shows every shot up to the tiles, then the tiles less one and "+N"', () => {
    expect(STRIP_TILES).toBe(6)
    expect(stripOf(0)).toEqual({ shown: 0, more: 0 })
    expect(stripOf(6)).toEqual({ shown: 6, more: 0 })
    expect(stripOf(7)).toEqual({ shown: 5, more: 2 })
    expect(stripOf(12)).toEqual({ shown: 5, more: 7 })
  })
})

describe('the Storyboard node line', () => {
  it('counts the shots the Director agent planned, not those added by hand', () => {
    const dex = { last_writer: 'dex' }
    const hand = {}
    expect(plannedLine([dex, dex, dex, dex, hand, hand, hand])).toBe('The Director agent planned 4 of the 7 shots from the script')
    expect(plannedLine([dex, dex])).toBe('The Director agent planned 2 shots from the script')
    expect(plannedLine([hand, hand, hand])).toBe('3 shots')
    expect(plannedLine([dex])).toBe('The Director agent planned 1 shot from the script')
  })
})

describe('a storyboard planned from a brief says so (UAT round 4 S3-6)', () => {
  it('names the brief when there is no script, the script otherwise', async () => {
    const { plannedLine, planSource } = await import('./strip')
    const dex = [{ last_writer: 'dex' }, { last_writer: 'dex' }, { last_writer: 'dex' }]
    expect(plannedLine(dex, planSource('', true))).toBe('The Director agent planned 3 shots from the brief')
    expect(plannedLine(dex, planSource('INT. KITCHEN', true))).toBe('The Director agent planned 3 shots from the script')
    expect(plannedLine(dex, planSource('', false))).toBe('The Director agent planned 3 shots from the script')
  })
})
