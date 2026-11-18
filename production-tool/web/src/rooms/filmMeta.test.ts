// The rooms' top-bar chip says the film's length now, not its target (live test 2026-11-16: a 24 s, 7-shot film
// read "16:9 · 15 s").

import { describe, expect, it } from 'vitest'
import { filmMeta } from './model'

describe('filmMeta', () => {
  it('says the length now and the target beside it when they differ', () => {
    expect(filmMeta('16:9', 24, 15)).toBe('16:9 · 24 s · target 15 s')
    expect(filmMeta('9:16', 9.04, 15)).toBe('9:16 · 9 s · target 15 s')
  })
  it('says the length alone when it is on target', () => {
    expect(filmMeta('16:9', 15, 15)).toBe('16:9 · 15 s')
    expect(filmMeta('16:9', 14.8, 15)).toBe('16:9 · 14.8 s')
  })
  it('says the target when there are no shots yet', () => {
    expect(filmMeta('16:9', 0, 15)).toBe('16:9 · target 15 s')
    expect(filmMeta('16:9', undefined, 30)).toBe('16:9 · target 30 s')
  })
})
