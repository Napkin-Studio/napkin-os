import { describe, expect, it } from 'vitest'
import { newUlidId } from '../src/store'

// "The first created" (web selectors' first(), mainScript) sorts ids; ids made in the same
// millisecond must sort in the order they were made, or a fresh empty node can win.
describe('newUlidId', () => {
  it('ids made in one millisecond sort in the order they were made', () => {
    const ids = Array.from({ length: 2000 }, () => newUlidId('script', 1_792_000_000_000))
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('a later millisecond sorts after, and a clock that steps back never breaks the order', () => {
    const a = newUlidId('x', 1_792_000_000_100)
    const b = newUlidId('x', 1_792_000_000_200)
    const c = newUlidId('x', 1_792_000_000_150)
    expect([a, b, c].sort()).toEqual([a, b, c])
  })

  it('keeps the ULID shape: prefix, 10 time digits, 16 random digits', () => {
    expect(newUlidId('job')).toMatch(/^job_[0-9A-HJKMNP-TV-Z]{26}$/)
  })
})
