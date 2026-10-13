// rank.ts and time.ts against the fixtures relay/rank.py and relay/time_rules.py also pass.
import { describe, expect, it } from 'vitest'
import { byRank, isValidRank, noteWindow, rankBetween, ranksBetween, RankError, windowProblem } from '../src/index'
import { example } from './fixtures'

const RANKS = example<{ between: { a: string | null; b: string | null; between?: string; error?: boolean }[]; runs: { a: string | null; b: string | null; n: number; keys: string[] }[]; invalid: string[] }>('ranks.json')
const WINDOWS = example<{ cases: { t: number; shot_s: number; window: { from_s: number; to_s: number } | null }[] }>('windows.json')

describe('rank (examples/ranks.json)', () => {
  for (const c of RANKS.between) {
    it(`between(${c.a}, ${c.b})`, () => {
      if (c.error) expect(() => rankBetween(c.a, c.b)).toThrow(RankError)
      else expect(rankBetween(c.a, c.b)).toBe(c.between)
    })
  }
  for (const r of RANKS.runs) {
    it(`${r.n} between ${r.a} and ${r.b}`, () => expect(ranksBetween(r.a, r.b, r.n)).toEqual(r.keys))
  }
  it('refuses the invalid keys', () => {
    for (const k of RANKS.invalid) expect(isValidRank(k)).toBe(false)
  })
  it('a move is one key between its new neighbours', () => {
    const [a, b, c] = ranksBetween(null, null, 3)
    const moved = rankBetween(a, b)
    expect(byRank([{ id: 'x', rank: c }, { id: 'y', rank: moved }, { id: 'z', rank: a }]).map((i) => i.id)).toEqual(['z', 'y', 'x'])
  })
})

describe('noteWindow (examples/windows.json)', () => {
  for (const c of WINDOWS.cases) {
    it(`a note at ${c.t} s of a ${c.shot_s} s shot`, () => {
      const w = noteWindow(c.t, c.shot_s)
      expect(w).toEqual(c.window)
      if (w) expect(windowProblem(w, c.shot_s)).toBeNull()
    })
  }
  it('says why a stored window is wrong', () => {
    expect(windowProblem({ from_s: 2, to_s: 3 }, 6)).toMatch(/at least 2 s/)
    expect(windowProblem({ from_s: 4, to_s: 7 }, 6)).toMatch(/crosses a cut/)
  })
})
