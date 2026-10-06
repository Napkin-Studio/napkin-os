import { describe, expect, it } from 'vitest'
import { badgeFor, isValidTag, sanitizeTag, uniqueTag } from './tags'
import { rectToRegion, regionAround, regionToRect } from './region'
import { checkDurations, splitTarget, totalSeconds } from './shots'
import { ID_PATTERN, newId } from './ulid'

describe('tags', () => {
  it.each([
    ['Eyes', 'eyes'],
    ['My Hero!', 'my_hero'],
    ['  2 cool  cats ', 'cool_cats'],
    ['Café crème', 'cafe_creme'],
    ['ab', 'abx'],
    ['a', 'axx'],
    ['this is a very long tag indeed', 'this_is_a_very_l'],
    ['__x__', 'xxx'],
    ['123', ''],
    ['', ''],
  ])('sanitises %j → %j', (input, out) => {
    expect(sanitizeTag(input)).toBe(out)
    if (out) expect(isValidTag(out)).toBe(true)
  })

  it('makes unique tags inside 16 characters', () => {
    expect(uniqueTag('eyes', ['eyes'])).toBe('eyes_2')
    expect(uniqueTag('eyes', ['eyes', 'eyes_2'])).toBe('eyes_3')
    const long = uniqueTag('abcdefghijklmnop', ['abcdefghijklmnop'])
    expect(long).toBe('abcdefghijklmn_2')
    expect(isValidTag(long)).toBe(true)
    expect(uniqueTag('!!!', [])).toBe('ref')
  })

  it('default tags from badges are valid and short (@ref_a, @ref_b…)', () => {
    const tags: string[] = []
    for (let i = 0; i < 60; i++) tags.push(uniqueTag(`ref_${badgeFor(i).toLowerCase()}`, tags))
    expect(tags.slice(0, 3)).toEqual(['ref_a', 'ref_b', 'ref_c'])
    expect(tags[26]).toBe('ref_aa')
    for (const t of tags) expect(isValidTag(t)).toBe(true)
    expect(new Set(tags).size).toBe(tags.length)
  })

  it('badges run A…Z then AA', () => {
    expect([0, 1, 25, 26, 27].map(badgeFor)).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
  })
})

describe('region math', () => {
  const display = { w: 400, h: 200 }
  it('maps a drawn rect to 0-1 coordinates, origin top-left', () => {
    expect(rectToRegion({ x: 100, y: 50 }, { x: 300, y: 150 }, display)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })
  it('accepts any corner order', () => {
    expect(rectToRegion({ x: 300, y: 150 }, { x: 100, y: 50 }, display)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })
  it('clamps a box that spills outside the image', () => {
    expect(rectToRegion({ x: -50, y: -20 }, { x: 500, y: 100 }, display)).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
  })
  it('ignores a click (too small)', () => {
    expect(rectToRegion({ x: 10, y: 10 }, { x: 12, y: 11 }, display)).toBeNull()
  })
  it('round-trips through pixels', () => {
    const r = rectToRegion({ x: 40, y: 20 }, { x: 240, y: 120 }, display)!
    expect(regionToRect(r, { w: 1600, h: 800 })).toEqual({ x: 160, y: 80, w: 800, h: 400 })
  })
  it('click-select boxes stay inside the image', () => {
    const r = regionAround({ x: 395, y: 195 }, display)
    expect(r.x + r.w).toBeLessThanOrEqual(1)
    expect(r.y + r.h).toBeLessThanOrEqual(1)
    expect(r.w).toBeGreaterThan(0)
  })
})

describe('shot durations', () => {
  const shots = (...d: number[]) => d.map((duration_s) => ({ duration_s }))
  it('passes when the seconds sum to the target', () => {
    expect(checkDurations(shots(5, 5, 5), 15)).toEqual({ ok: true, total: 15 })
  })
  it('says how much to add or cut', () => {
    expect(checkDurations(shots(5, 4), 10)).toMatchObject({ ok: false, total: 9, reason: 'Add 1 s to reach 10 s.' })
    expect(checkDurations(shots(8, 8, 8), 20)).toMatchObject({ ok: false, reason: 'Cut 4 s to reach 20 s.' })
  })
  it('needs 2-8 shots of 1-10 s', () => {
    expect(checkDurations(shots(10), 10).ok).toBe(false)
    expect(checkDurations(shots(12, 3), 15).ok).toBe(false)
    expect(checkDurations(shots(...Array(9).fill(2)), 18).ok).toBe(false)
  })
  it('handles half seconds without float noise', () => {
    expect(totalSeconds(shots(2.5, 2.5, 5.1, 4.9))).toBe(15)
  })
  it('even splits always sum to the target', () => {
    for (const t of [10, 15, 20]) expect(splitTarget(t).reduce((a, b) => a + b, 0)).toBe(t)
  })
})

describe('ids', () => {
  it('are prefixed ULIDs per common.schema.json', () => {
    for (const p of ['job', 'ref', 'shot', 'frame', 'take', 'rev', 'combine', 'pin'] as const) expect(newId(p)).toMatch(ID_PATTERN)
  })
})
