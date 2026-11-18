import { describe, expect, it } from 'vitest'
import type { Size } from '../contracts/types'
import { campaignFold, isFolded, STACK_OVER } from './fold'
import { boardLayout, STACK_H } from './board'
import { groupSizes, shapeOf, statusWord } from './overview'

const size = (id: string, format_id: string, w: number, h: number, status?: Size['status']): Size => ({
  id, format: { format_id }, delivery: { width: w, height: h }, media: 'image', method: 'crop', status,
} as unknown as Size)

describe('shapeOf', () => {
  it('names a size by its ratio', () => {
    expect(shapeOf(728, 90)).toBe('Banner')
    expect(shapeOf(1600, 900)).toBe('Wide')
    expect(shapeOf(1080, 1080)).toBe('Square')
    expect(shapeOf(1080, 1350)).toBe('Portrait')
    expect(shapeOf(160, 600)).toBe('Tall')
  })
})

describe('groupSizes', () => {
  const sizes = [size('a', 'x', 1080, 1350, 'ready'), size('b', 'x', 160, 600, 'look'), size('c', 'x', 728, 90, 'making'), size('d', 'x', 1080, 1080)]
  it('groups by shape in a fixed order, counting what needs a look and what is making', () => {
    const g = groupSizes(sizes, 'shape')
    expect(g.map((x) => x.key)).toEqual(['Banner', 'Square', 'Portrait', 'Tall'])
    expect(g.find((x) => x.key === 'Tall')!.look).toBe(1)
    expect(g.find((x) => x.key === 'Banner')!.making).toBe(1)
  })
  it('groups by status, an out-of-date size apart from a ready one', () => {
    const g = groupSizes(sizes, 'status', new Set(['a']))
    expect(g.map((x) => x.key)).toEqual(['Needs a look', 'Making', 'Out of date', 'Not made yet'])
    expect(statusWord(sizes[0]!, true)).toBe('Out of date')
  })
  it('shows only the sizes that need a look when asked', () => {
    expect(groupSizes(sizes, 'shape', new Set(), true).flatMap((g) => g.sizes.map((s) => s.id))).toEqual(['b'])
  })
})

describe('folding', () => {
  it('starts folded above the threshold and open below it; a choice wins', () => {
    campaignFold.reset()
    expect(isFolded('s', 'social', STACK_OVER + 1)).toBe(true)
    expect(isFolded('s', 'social', STACK_OVER)).toBe(false)
    campaignFold.set('s', 'social', false)
    expect(isFolded('s', 'social', STACK_OVER + 5)).toBe(false)
    campaignFold.reset()
  })
})

describe('boardLayout with folded lanes', () => {
  const tiles = [
    { id: 'a', channel: 'social' as const, aspect: { w: 4, h: 5 } }, { id: 'b', channel: 'social' as const, aspect: { w: 1, h: 1 } },
    { id: 'c', channel: 'display' as const, aspect: { w: 300, h: 250 } },
  ]
  it('gives a folded lane one stack and no tiles, and a shorter board', () => {
    const open = boardLayout(tiles)
    const folded = boardLayout(tiles, new Set(['social']))
    const lane = folded.lanes.find((l) => l.channel === 'social')!
    expect(lane.stack?.ids).toEqual(['a', 'b'])
    expect(lane.stack?.h).toBe(STACK_H)
    expect(folded.tiles.a).toBeUndefined()
    expect(folded.tiles.c).toBeDefined()
    expect(folded.h).toBeLessThan(open.h)
  })
})
