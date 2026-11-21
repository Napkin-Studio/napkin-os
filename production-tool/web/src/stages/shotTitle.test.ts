import { describe, expect, it } from 'vitest'
import { titleOf, withoutAsides } from './shotTitle'
import { shotTitle } from '../rooms/model'

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

describe("a shot's name in the Make and Edit rooms", () => {
  it('keeps the @name and leaves its description in brackets out', () => {
    expect(shotTitle({ action: '@mira (30s, short silver hair, bright red raincoat) steps off a green tram into the rain.' }, 1))
      .toBe('@mira steps off a green tram into the rain.')
    expect(shotTitle({ action: '@mira (30s, short silver hair' }, 2)).toBe('@mira')
    expect(shotTitle({ action: '(wide) ', direction: 'Slow push in (handheld)' }, 3)).toBe('Slow push in')
    expect(shotTitle({ action: '' }, 4)).toBe('Shot 4')
    expect(shotTitle(undefined, 5)).toBe('Shot 5')
  })
  it('withoutAsides tidies the gap a removed aside leaves', () => {
    expect(withoutAsides('She waves (smiling) , then goes.')).toBe('She waves, then goes.')
  })
})

describe("a shot's short title (UAT 2026-11-21)", () => {
  it('never cuts inside a time, a number or a hyphenated word', () => {
    expect(titleOf({ action: 'At 1:04, she tiptoes into the dark kitchen.', camera: { size: 'wide' } })).toBe('At 1:04')
    expect(titleOf({ action: 'A close-up of the kettle. It glows.', camera: { size: 'close' } })).toBe('A close-up of the kettle')
    expect(titleOf({ action: 'She waits — then pours.', camera: { size: 'medium' } })).toBe('She waits')
  })
})

describe('a title that starts with a name\u2019s possessive (UAT 2026-11-21, S3)', () => {
  it('keeps the name', () => {
    expect(titleOf({ action: "@maya's trembling finger presses the kettle's switch.", camera: { size: 'insert' } } as never)).toBe("Maya's trembling finger…")
    expect(titleOf({ action: '@maya_front\u2019s hand. Then more.', camera: { size: 'insert' } } as never)).toBe('Maya\u2019s hand')
  })
})
