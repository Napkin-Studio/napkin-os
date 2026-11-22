import { describe, expect, it } from 'vitest'
import { brandWords } from '../jobs/context'
import type { NamedRef } from '../contracts/types'
import { isBrandRole, payloadFor, payloadMissing, topColours } from './swatches'

const px = (rgb: [number, number, number], n: number) => Array.from({ length: n }, () => [...rgb, 255]).flat()

describe('a brand ref holds what its role needs (UAT round 2 R2-1)', () => {
  it('a picture gives its main colours, most used first, never two of nearly the same', () => {
    const data = [...px([10, 31, 68], 60), ...px([12, 33, 70], 30), ...px([232, 220, 196], 40), ...px([255, 111, 89], 10), ...[0, 0, 0, 0]]
    expect(topColours(data, 6)).toEqual(['#0A1F44', '#E8DCC4', '#FF6F59'])
  })

  it('Save waits for the payload; only the role’s own fields are kept, cleaned', () => {
    expect(payloadMissing('palette', {})).toBe('Add at least one colour.')
    expect(payloadMissing('palette', { swatches: [{ hex: '#0a1f44' }] })).toBeUndefined()
    expect(payloadMissing('typography', { font: { family: '  ' } })).toBe('Say which font.')
    expect(payloadMissing('brand_rule', { rule: { kind: 'dont', text: 'no gyms' } })).toBeUndefined()
    expect(payloadMissing('character', {})).toBeUndefined()
    expect(payloadFor('palette', { swatches: [{ hex: '#0a1f44' }, { hex: '#0A1F44' }, { hex: 'nope' }], font: { family: 'x' } })).toEqual({ swatches: [{ hex: '#0A1F44' }] })
    expect(payloadFor('typography', { font: { family: ' Inter Bold ', use: ' headlines ' } })).toEqual({ font: { family: 'Inter Bold', use: 'headlines' } })
    expect(isBrandRole('brand_rule') && !isBrandRole('logo')).toBe(true)
  })

  it('what the popover saves is what Dex reads as context', () => {
    const base = { id: 'r', v: 1, field_v: {}, key: 'brand', variant: 'main', node: 'n', named_at: '' } as unknown as NamedRef
    expect(brandWords({ ...base, role: 'palette', ...payloadFor('palette', { swatches: [{ hex: '#0a1f44' }, { hex: '#e8dcc4' }] }) })).toEqual({ kind: 'palette', text: '#0A1F44, #E8DCC4' })
    expect(brandWords({ ...base, role: 'typography', ...payloadFor('typography', { font: { family: 'Inter Bold', use: 'headlines' } }) })).toEqual({ kind: 'typography', text: 'Inter Bold (headlines)' })
    expect(brandWords({ ...base, role: 'brand_rule', ...payloadFor('brand_rule', { rule: { kind: 'dont', text: 'Never show alcohol' } }) })).toEqual({ kind: 'brand_rule', text: "Don't: Never show alcohol" })
  })
})
