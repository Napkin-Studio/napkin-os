// The shared @ rules (ui-behaviour 3.6, item 9).

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../contracts/types'
import { closestName, editDistance, isLinked, linkForMention, linkWords, matchMentions, mentionSource } from './source'

const U = (c: string) => c.repeat(26)
function doc(): ProductionDocument {
  const ref = (id: string, key: string, variant: string, role: string, label?: string) => ({ id, v: 1, field_v: {}, key, variant, role, asset: `sha256:${'a'.repeat(64)}`, ...(label ? { label } : {}) })
  return {
    keys: {
      [`key_${U('A')}`]: { id: `key_${U('A')}`, v: 1, field_v: {}, key: 'maya', role: 'character' },
      [`key_${U('B')}`]: { id: `key_${U('B')}`, v: 1, field_v: {}, key: 'shirt', role: 'wardrobe' },
    },
    refs: {
      [`ref_${U('C')}`]: ref(`ref_${U('C')}`, 'maya', 'front', 'character'),
      [`ref_${U('D')}`]: ref(`ref_${U('D')}`, 'maya', 'laughing', 'character'),
      [`ref_${U('E')}`]: ref(`ref_${U('E')}`, 'shirt', 'linen', 'wardrobe', "Maya's beach outfit"),
      [`ref_${U('F')}`]: ref(`ref_${U('F')}`, 'beach', 'dawn', 'location'),
      [`ref_${U('G')}`]: ref(`ref_${U('G')}`, 'soda', 'can', 'product'),
      [`ref_${U('H')}`]: ref(`ref_${U('H')}`, 'brand', 'rules', 'brand_rule'),
    },
    links: {
      [`link_${U('J')}`]: { id: `link_${U('J')}`, v: 1, field_v: {}, from: { kind: 'ref', id: `ref_${U('C')}` }, to: { kind: 'script', id: 'script_x' }, role: 'character' },
    },
  } as unknown as ProductionDocument
}
const SCRIPT = { kind: 'script' as const, id: 'script_x' }

describe('mentionSource', () => {
  it('groups Characters, Locations, Products, References, then the rest, A–Z; a key with a front is the whole character', () => {
    const items = mentionSource(doc(), SCRIPT)
    expect(items.map((i) => `${i.group}:${i.name}`)).toEqual([
      'Characters:maya', 'Characters:maya_front', 'Characters:maya_laughing',
      'Locations:beach_dawn', 'Products:soda_can', 'References:shirt_linen', 'Other:brand_rules',
    ])
    expect(items.find((i) => i.name === 'maya')).toMatchObject({ kind: 'key', linked: true })
    expect(items.find((i) => i.name === 'maya_laughing')?.linked).toBe(false)
  })

  it('finds @shirt_linen by its label, and names by their start first', () => {
    const items = mentionSource(doc(), SCRIPT)
    expect(matchMentions(items, 'beach').map((i) => i.name)).toEqual(['beach_dawn', 'shirt_linen'])
    expect(matchMentions(items, 'ma').map((i) => i.name)).toEqual(['maya', 'maya_front', 'maya_laughing', 'shirt_linen'])
  })
})

describe('closestName', () => {
  it('suggests within two edits (Damerau–Levenshtein)', () => {
    expect(editDistance('maya_runing', 'maya_running')).toBe(1)
    expect(editDistance('ab', 'ba')).toBe(1)
    expect(closestName('maya_laughnig', ['maya_front', 'maya_laughing'])).toBe('maya_laughing')
    expect(closestName('jogger', ['maya_front', 'maya_laughing'])).toBeNull()
  })
})

describe('linkForMention', () => {
  it('links an unlinked lone ref to the script with its role; a linked one needs none', () => {
    const d = doc()
    const l = linkForMention(d, { id: `ref_${U('G')}`, kind: 'ref' }, SCRIPT, () => `link_${U('K')}`)
    expect(l).toMatchObject({ from: { kind: 'ref', id: `ref_${U('G')}` }, to: SCRIPT, role: 'product' })
    expect(linkForMention(d, { id: `ref_${U('C')}`, kind: 'ref' }, SCRIPT, () => 'x')).toBeNull()
    expect(isLinked(d, `ref_${U('C')}`, SCRIPT)).toBe(true)
  })

  it('a view of a key with two or more views links the whole key, once, in its role (owner 2026-10-15)', () => {
    const d = doc()
    const l = linkForMention(d, { id: `ref_${U('D')}`, kind: 'ref' }, SCRIPT, () => `link_${U('K')}`)!
    expect(l).toMatchObject({ from: { kind: 'key', id: `key_${U('A')}` }, to: SCRIPT, role: 'character' })
    expect(linkWords(d, l)).toBe('@maya · 2 views')
    d.links[l.id] = l
    // Every view of it is linked now, and the key needs no second link.
    expect(isLinked(d, `ref_${U('D')}`, SCRIPT)).toBe(true)
    expect(linkForMention(d, { id: `ref_${U('D')}`, kind: 'ref' }, SCRIPT, () => 'y')).toBeNull()
    expect(linkForMention(d, { id: `key_${U('A')}`, kind: 'key' }, SCRIPT, () => 'y')).toBeNull()
  })

  it('offers a key of two views as the group, "N views", above its views, even without a front', () => {
    const d = doc()
    d.refs[`ref_${U('C')}`].variant = 'side'
    const items = mentionSource(d, SCRIPT)
    const at = items.findIndex((i) => i.name === 'maya')
    expect(items[at]).toMatchObject({ kind: 'key', label: '2 views', linked: true })
    expect(items.slice(at + 1, at + 3).map((i) => i.name)).toEqual(['maya_laughing', 'maya_side'])
    // A key of one view without a front is not a group.
    expect(items.some((i) => i.kind === 'key' && i.name === 'soda')).toBe(false)
  })
})
