// The Campaign board's fixes from the live test of 2026-11-17 (~/Documents/napkin-design-mocks/
// tool-test-2026-11-17/report.html): the header's counts and words, and type kept off what must stay.

import { describe, expect, it } from 'vitest'
import type { FormatSet, Region, Size } from '../contracts/types'
import { boardCounts, countLine, sheetLine } from './boardWords'
import { shortName } from './formats'
import { keepOf, keepOff, type Laid } from './layout'

const size = (status?: Size['status'], extra: Partial<Size> = {}) => ({ id: Math.random().toString(36), status, ...extra }) as Size

describe('the board header', () => {
  it('a failed size counts as failed, never making; one format is "1 format"', () => {
    const failed = size('making', { job_id: 'job_f' })
    const c = boardCounts([size('ready'), size('look'), failed, size('making')], (s) => s.job_id === 'job_f')
    expect(c).toEqual({ ready: 1, look: 1, making: 1, failed: 1, notMade: 0 })
    expect(countLine(4, c)).toBe('4 formats · 1 ready · 1 needs a look · 1 making · 1 failed')
    expect(countLine(1, boardCounts([size('ready')], () => false))).toBe('1 format · 1 ready')
  })
})

describe('type keeps off what must stay', () => {
  const S: Region = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }
  const line: Laid = { kind: 'line', box: { x: 0.05, y: 0.8, w: 0.9, h: 0.1 }, text: 'Every colour has a story' } as Laid
  it('a line the rule put over the subject moves to the clear band', () => {
    const [moved] = keepOff([line], S, [{ x: 0.3, y: 0.6, w: 0.4, h: 0.35 }])
    expect(moved.box.y).toBeCloseTo(0.1)
  })
  it('a line a person placed stays; nothing moves when nothing is kept', () => {
    expect(keepOff([line], S, [{ x: 0.3, y: 0.6, w: 0.4, h: 0.35 }], { line: { box: line.box } })[0].box.y).toBe(0.8)
    expect(keepOff([line], S, undefined)[0]).toBe(line)
  })
  it('the protect boxes of a cropped size are in that size\'s 0-1', () => {
    const set = { protect: { boxes: [{ x: 500, y: 200, w: 100, h: 300, role: 'subject' }] } } as unknown as FormatSet
    const sz = { method: 'crop', crop: { x: 400, y: 0, w: 400, h: 600 } } as unknown as Size
    expect(keepOf(set, sz)).toEqual([{ x: 0.25, y: 200 / 600, w: 0.25, h: 0.5 }])
    expect(keepOf(set, { ...sz, method: 'extend' } as Size)).toEqual([])
  })
})

describe('smaller words', () => {
  it('the sizes sheet counts what is left out apart from what cannot be made', () => {
    expect(sheetLine(11, 6, 0, 2)).toBe('11 sizes to make · 6 left out · 2 on a model')
    expect(sheetLine(1, 0, 3, 0)).toBe('1 size to make · 3 cannot be made now')
  })
  it('a format name with a bracket before a comma reads cleanly', () => {
    expect(shortName({ name: 'Digital 48-sheet (D48), JCDecaux UK roadside Drive' })).toBe('Digital 48-sheet, JCDecaux UK roadside Drive')
  })
})
