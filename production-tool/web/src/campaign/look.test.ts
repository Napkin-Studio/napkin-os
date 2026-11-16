import { describe, expect, it } from 'vitest'
import { lookDistance, LOOK_FLAG, statsOf } from './look'

/** RGBA data of n pixels of one colour. */
const flat = (r: number, g: number, b: number, n = 100) => Uint8ClampedArray.from(Array.from({ length: n }, () => [r, g, b, 255]).flat())

describe('how far a size looks from its master', () => {
  it('the same picture is no distance apart', () => {
    expect(lookDistance(statsOf(flat(120, 100, 80)), statsOf(flat(120, 100, 80)))).toBe(0)
  })
  it('a lighter or cooler picture is further away, and a small drift stays under the flag', () => {
    const base = statsOf(flat(120, 100, 80))
    expect(lookDistance(base, statsOf(flat(122, 101, 83)))).toBeLessThan(LOOK_FLAG)
    expect(lookDistance(base, statsOf(flat(200, 190, 180)))).toBeGreaterThan(LOOK_FLAG)
    expect(lookDistance(base, statsOf(flat(80, 100, 130)))).toBeGreaterThan(LOOK_FLAG)
  })
  it('a flatter picture of the same average colour counts: contrast is part of the look', () => {
    const contrasty = Uint8ClampedArray.from([0, 0, 0, 255, 240, 240, 240, 255, 0, 0, 0, 255, 240, 240, 240, 255])
    expect(lookDistance(statsOf(contrasty), statsOf(flat(120, 120, 120, 4)))).toBeGreaterThan(0.2)
  })
  it('nothing to read is nothing', () => {
    expect(statsOf([])).toEqual({ r: 0, g: 0, b: 0, sd: 0 })
  })
})
