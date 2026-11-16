import { describe, expect, it } from 'vitest'
import { titleOf } from './shotTitle'

const shot = (action: string) => ({ action, camera: { size: 'wide' as const } })

describe('a storyboard card title', () => {
  it('skips the description in brackets after a name (live test: "(30s")', () => {
    expect(titleOf(shot('@mira (30s, short silver hair, bright red raincoat) steps off a green tram into the rain.'))).toBe('Steps off a green tram…')
    expect(titleOf(shot('@mira (30s, short silver hair'))).toBe('Wide')
  })
  it('still takes the first words, and the size with none', () => {
    expect(titleOf(shot('@mira opens a small yellow umbrella and smiles'))).toBe('Opens a small yellow…')
    expect(titleOf(shot('Rain, then sun'))).toBe('Rain')
    expect(titleOf(shot(''))).toBe('Wide')
  })
})
