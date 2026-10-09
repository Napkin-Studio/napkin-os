import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../doc/store'
import { cleanKey, cleanVariant, keyRefs, mentions, nameOf, nameProblem, NoFrontError, parseName, subjectRefs, wholeKeys } from './names'

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

describe('a bare key is the whole character', () => {
  const doc = () => {
    const d = emptyDocument()
    const add = (variant: string, c: string) => d.refs.push({ id: `ref_${variant}`, key: 'goremon', variant, asset: SHA(c) })
    add('laughing', 'a'); add('back', 'b'); add('front', 'c'); add('angry', 'd'); add('side', 'e'); add('three-quarter', 'f')
    d.keys.push({ key: 'goremon', role: 'character' })
    return d
  }

  it('sends its front, then three-quarter, side and back: at most 4 pictures', () => {
    expect(keyRefs(doc(), 'goremon').map((r) => r.variant)).toEqual(['front', 'three-quarter', 'side', 'back'])
  })

  it('then the other variants as named, when it has fewer views', () => {
    const d = doc()
    d.refs = d.refs.filter((r) => r.variant !== 'side' && r.variant !== 'back')
    expect(keyRefs(d, 'goremon').map((r) => r.variant)).toEqual(['front', 'three-quarter', 'laughing', 'angry'])
  })

  it('without a front, @goremon asks for one (the owner chose this, 2026-10-07)', () => {
    const d = doc()
    d.refs = d.refs.filter((r) => r.variant !== 'front')
    expect(() => keyRefs(d, 'goremon')).toThrow(NoFrontError)
    expect(() => mentions(d, '@goremon dances')).toThrow(/Set a front for goremon first/)
    expect(wholeKeys(d)).toEqual([])
  })

  it('words can name the whole character and one look in the same line, each picture once', () => {
    const { found, unknown } = mentions(doc(), '@goremon walks in, then @goremon_laughing; @goremon again; @nobody')
    expect(found.map((r) => r.variant)).toEqual(['front', 'three-quarter', 'side', 'back', 'laughing'])
    expect(unknown).toEqual(['nobody'])
    expect(subjectRefs(doc(), 'goremon_angry').map((r) => r.variant)).toEqual(['angry'])
    expect(subjectRefs(doc(), 'lamp')).toEqual([])
  })
})
