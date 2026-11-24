// UAT round 4, Production round 3: the cut plan's reasons say the pick they explain (F35), and a size that needs a
// look says why and downloads under a plain name (F36).
import { describe, expect, it } from 'vitest'
import type { Size } from '../contracts/types'
import { lookReasons } from './checks'
import { pickWords, sizeFileName } from './sizeWords'

describe('a cut plan reason says the pick it explains (F35)', () => {
  it('leads with Kept or Dropped, unless it says so already', () => {
    expect(pickWords(false, 'Filling at the tap only sets up the refill, so it goes first')).toBe('Dropped: Filling at the tap only sets up the refill, so it goes first')
    expect(pickWords(true, 'The payoff.')).toBe('Kept: The payoff.')
    expect(pickWords(true, 'Kept to fill the length.')).toBe('Kept to fill the length.')
    expect(pickWords(false, 'Dropped to fit the length.')).toBe('Dropped to fit the length.')
    expect(pickWords(false, undefined)).toBe('Dropped')
  })
})

describe('a size that needs a look says why (F36)', () => {
  it('the flags no one has ignored, in their own words', () => {
    const size = { checks: {
      end_card: { result: 'flag', note: 'The film does not end on its end card.' },
      sound_off: { result: 'flag', note: 'No supers or captions for sound off.', ignored: { by: 'human:u', at: '2026-11-24T10:00:00Z' } },
      type_size: { result: 'pass', note: 'Every word is big enough.' },
    } } as unknown as Pick<Size, 'checks'>
    expect(lookReasons(size)).toEqual(['The film does not end on its end card.'])
    expect(lookReasons({ checks: {} } as Pick<Size, 'checks'>)).toEqual([])
  })
  it('downloads as its format and size', () => {
    expect(sizeFileName({ format: { format_id: 'nope' }, delivery: { width: 1080, height: 1920 }, media: 'video' } as unknown as Size)).toBe('nope-1080x1920.mp4')
  })
})
