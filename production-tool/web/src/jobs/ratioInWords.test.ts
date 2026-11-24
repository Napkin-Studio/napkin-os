// The ratio a person names in their words (UAT round 3 and round 4 F15).
import { describe, expect, it } from 'vitest'
import { ratioInWords, sketchShapeLine } from './ratioInWords'

describe('ratioInWords', () => {
  it('finds the first ratio named, also before a colon or a full stop', () => {
    expect(ratioInWords('Key visual, portrait 4:5: the bottle')).toBe('4:5')
    expect(ratioInWords('a poster, 4:5.')).toBe('4:5')
    expect(ratioInWords('1:1 then 16:9')).toBe('1:1')
  })
  it('a time or a longer number is not a ratio', () => {
    expect(ratioInWords('at 16:9:30')).toBeUndefined()
    expect(ratioInWords('14:5')).toBeUndefined()
    expect(ratioInWords('4:55')).toBeUndefined()
  })
})

describe('the Generate footer’s shape line', () => {
  it('names the ratio from the words when it differs from the area', () => {
    expect(sketchShapeLine({ w: 16, h: 9 }, '16:9 · 1920×1080', 'Key visual, portrait 4:5')).toMatch(/^4:5 · \d+×\d+ · from your words$/)
  })
  it('keeps the area’s line otherwise', () => {
    expect(sketchShapeLine({ w: 16, h: 9 }, '16:9 · 1920×1080', 'a 16:9 banner')).toBe('16:9 · 1920×1080')
    expect(sketchShapeLine({ w: 16, h: 9 }, '16:9 · 1920×1080', 'no ratio here')).toBe('16:9 · 1920×1080')
  })
})
