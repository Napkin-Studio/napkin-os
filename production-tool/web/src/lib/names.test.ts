import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../doc/store'
import { cleanKey, cleanVariant, mentions, nameOf, nameProblem, parseName } from './names'

const SHA = (c: string) => `sha256:${c.repeat(64)}`

describe('names: key_variant with free variants', () => {
  it('a key has no underscore, so the first one splits key from variant', () => {
    expect(parseName('maya_three-quarter')).toEqual({ key: 'maya', variant: 'three-quarter' })
    expect(parseName('maya_red-coat')).toEqual({ key: 'maya', variant: 'red-coat' })
    expect(parseName('maya')).toBeNull()
    expect(parseName('Maya_front')).toBeNull()
    expect(nameOf({ key: 'lamp', variant: 'on' })).toBe('lamp_on')
  })

  it('what people type becomes a valid key and variant', () => {
    expect(cleanKey('Maya Rose!')).toBe('mayarose')
    expect(cleanKey('2pac')).toBe('pac')
    expect(cleanVariant('Laughing  Hard_now')).toBe('laughing-hard-now')
    expect(nameProblem('m', 'front')).toMatch(/2 to 24/)
    expect(nameProblem('maya', '')).toMatch(/what this one shows/)
    expect(nameProblem('maya', 'front')).toBeNull()
  })

  it('finds the names written in words, the longest known one first, and the ones that match nothing', () => {
    const d = emptyDocument()
    d.refs.push({ id: 'ref_a', key: 'maya', variant: 'front', asset: SHA('a') }, { id: 'ref_b', key: 'lamp', variant: 'on', asset: SHA('b') })
    const { found, unknown } = mentions(d, '@maya_front-facing holds @lamp_on and @maya_front, not @maya_sad; mail me@lamp_on.ie')
    expect(found.map(nameOf)).toEqual(['maya_front', 'lamp_on'])
    expect(unknown).toEqual(['maya_sad'])
  })
})
