import { describe, expect, it } from 'vitest'
import { ID_PATTERN, newId, ulid } from './ulid'

// "The first created" sorts ids: ids made in one millisecond must sort in the order they were made.
describe('ulid', () => {
  it('ids made in one millisecond sort in the order they were made, and stay unique', () => {
    const ids = Array.from({ length: 2000 }, () => ulid(1_792_000_000_000))
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('a later millisecond sorts after, and a clock that steps back never breaks the order', () => {
    const a = ulid(1_792_000_000_100), b = ulid(1_792_000_000_200), c = ulid(1_792_000_000_150)
    expect([a, b, c].sort()).toEqual([a, b, c])
  })
  it('keeps the prefixed ULID shape', () => {
    expect(newId('script')).toMatch(ID_PATTERN)
  })
})
