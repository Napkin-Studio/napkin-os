// A planned end card's labelled copy (UAT acceptance A54): the Super is the headline, what is beneath it the line, the
// small line the legal; the card's colour and where the wordmark sits are direction, never copy.
import { describe, expect, it } from 'vitest'
import { labelledCard } from './timeline'

describe('the end card read from its labels (UAT acceptance A54)', () => {
  it('Script 2\'s card: Super, Beneath it and Small line, the wordmark\'s place dropped', () => {
    expect(labelledCard('Charcoal card. COPPERELL wordmark top right. Super: A little nicer, every 500 ml. Beneath it: Refill. Not landfill. Small line: Keep out of reach of children. Read the label before use.'))
      .toEqual({ headline: 'A little nicer, every 500 ml.', line: 'Refill. Not landfill.', legal: 'Keep out of reach of children. Read the label before use.' })
  })
  it('Script 3\'s card: the Super, the wordmark sentence between it and the small print gone', () => {
    expect(labelledCard('Charcoal card. Super: The last spray bottle you will buy. COPPERELL wordmark sits top right. Small print: Keep out of reach of children. Read the label before use.'))
      .toEqual({ headline: 'The last spray bottle you will buy.', line: '', legal: 'Keep out of reach of children. Read the label before use.' })
  })
  it('no Super or Headline: not a labelled card', () => {
    expect(labelledCard('SuperSamurai. Clean in one wipe.')).toBeUndefined()
    expect(labelledCard('Charcoal card. COPPERELL wordmark top right.')).toBeUndefined()
  })
})
