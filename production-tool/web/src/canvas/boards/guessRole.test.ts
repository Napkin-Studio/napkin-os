// A new name's starting role (UAT round 4 F19: @logo on the Brand board became a character).
import { describe, expect, it } from 'vitest'
import { guessRole } from './layout'

describe('the role a new name starts on', () => {
  it('a name that says logo is a logo, on any board', () => {
    expect(guessRole('logo', 'brand')).toBe('logo')
    expect(guessRole('logo', undefined)).toBe('logo')
    expect(guessRole('copperell_logo', 'reference')).toBe('logo')
  })
  it('a product word is a product: bottle, pack, packshot', () => {
    expect(guessRole('bottle', undefined)).toBe('product')
    expect(guessRole('pack', 'brand')).toBe('product')
    expect(guessRole('packshot', 'character')).toBe('product')
  })
  it('otherwise the board says: Brand → logo, never a character; Products, Locations', () => {
    expect(guessRole('copperell', 'brand')).toBe('logo')
    expect(guessRole('hero', 'product')).toBe('product')
    expect(guessRole('kitchen', 'location')).toBe('location')
  })
  it('anywhere else, a character as before', () => {
    expect(guessRole('maya', undefined)).toBe('character')
    expect(guessRole('maya', 'character')).toBe('character')
    expect(guessRole('logan', undefined)).toBe('character') // a word, not a name containing "logo"
  })
})
