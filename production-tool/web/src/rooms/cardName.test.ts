// The end card's second line (UAT acceptance A52): the brief's or the product's short name, never the spin-off's title.
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { cardName } from './timeline'

const doc = (title: string, briefs: Record<string, { title: string }> = {}, links: unknown[] = []) =>
  ({ project: { title }, briefs, links: Object.fromEntries(links.map((l, i) => [`lnk_${i}`, l])), videos: {}, storyboards: {}, scripts: {} }) as unknown as ProductionDocument

describe('the end card\'s line starts as a short name (UAT acceptance A52)', () => {
  it('a spin-off\'s project title loses its " · Territories"', () => {
    expect(cardName(doc('Copperell Refill · Territories'))).toBe('Copperell Refill')
    expect(cardName(doc('Copperell Refill · Territories 2'))).toBe('Copperell Refill')
  })
  it('a plain title stays; an untitled one, or none, is "Your brand"', () => {
    expect(cardName(doc('SuperSamurai'))).toBe('SuperSamurai')
    expect(cardName(doc('Untitled project'))).toBe('Your brand')
    expect(cardName(doc(''))).toBe('Your brand')
  })
})
