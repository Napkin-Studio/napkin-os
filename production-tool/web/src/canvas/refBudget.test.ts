import { describe, expect, it } from 'vitest'
import { CONFIGS, SHEETS } from '../contracts/load'
import { countLine, countRefs, kindOfRole, refLimits, type RefKind } from './refBudget'

const runway = { ...CONFIGS.live, routing: { ...CONFIGS.live.routing, generate: ['runway' as const] } }

describe('refLimits: the picked model’s picture budget (pt-canvas-r1 IMG-6/7/8)', () => {
  it('reads Runway images: 14 in all, 5 people, 9 things', () => {
    const l = refLimits('generate', { provider: 'runway', model: 'gemini_image3_pro' }, runway)
    expect(l).toEqual({ max: 14, characters: 5, objects: 9 })
  })
  it('reads an alternate’s own refs over the op’s and the sheet’s', () => {
    const sheet = structuredClone(SHEETS.runway!)
    const alt = sheet.ops.generate!.alternates![0]
    alt.refs = { max: 3, maxCharacter: 1, maxObject: 2 }
    expect(refLimits('generate', { provider: 'runway', model: alt.model }, runway, { runway: sheet })).toEqual({ max: 3, characters: 1, objects: 2 })
  })
  it('is empty where the op is not routed', () => {
    expect(refLimits('generate', { provider: 'runway', model: 'x' }, runway, {})).toEqual({ max: 0, characters: 0 })
  })
})

describe('countRefs', () => {
  const limits = { max: 14, characters: 5, objects: 9 }
  const kinds = (people: number, things: number): RefKind[] => [...Array(people).fill('person'), ...Array(things).fill('thing')]

  it('fits', () => {
    expect(countRefs(kinds(2, 3), limits)).toEqual({ people: 2, things: 3, total: 5 })
    expect(countLine(countRefs(kinds(1, 3), limits), limits)).toBe('1 person, 3 things · up to 5 people, 9 things, 14 in all')
  })
  it('says the total first, with how many to untick', () => {
    expect(countRefs(kinds(1, 15), limits).problem).toBe('This model takes at most 14 pictures at once; 16 are ticked. Untick 2.')
  })
  it('says people over, and that they can be marked as things', () => {
    expect(countRefs(kinds(7, 1), limits).problem).toMatch(/at most 5 people \(characters\); 7 are ticked as people\. Untick 2, or mark some as things\./)
  })
  it('says things over (Runway takes 9 object pictures)', () => {
    expect(countRefs(kinds(1, 11), limits).problem).toMatch(/at most 9 things .*11 are ticked as things\. Untick 2\./)
  })
  it('maps roles: only a character is a person', () => {
    expect(kindOfRole('character')).toBe('person')
    for (const r of ['other', 'product', 'layout', 'location', undefined]) expect(kindOfRole(r)).toBe('thing')
  })
})
