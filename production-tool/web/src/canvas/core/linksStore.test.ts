// The canvas's link rules (core/links.ts canLink) and the store's (clan-store integrity.ts linkRuleFor, reading
// contracts/common.schema.json linkRule) must agree: UAT round 2 R2-5, round 3 and round 4 S2-2 (a third time), the
// canvas let a Brand board link into a note and the store refused it ("A board cannot feed a text") and undid the
// change. This runs every link a person can draw on the canvas through the store's check, so they never disagree.

import { describe, expect, it } from 'vitest'
import { linkRuleFor } from '../../../../clan-store/src'
import { canLink, type LinkEnd, type LinkKind } from './links'

/** Each canvas end as the document writes it (canvas/nodes/nodes.ts endOf): its endpoint kinds there. */
const ENDS: { end: LinkEnd; doc: string[]; purpose?: string }[] = [
  { end: { kind: 'script' }, doc: ['script'] },
  { end: { kind: 'storyboard' }, doc: ['storyboard'] },
  { end: { kind: 'video' }, doc: ['video'] },
  { end: { kind: 'sketch' }, doc: ['sketch'] },
  { end: { kind: 'format_set' }, doc: ['format_set'] },
  { end: { kind: 'shot' }, doc: ['shot'] },
  { end: { kind: 'brief' }, doc: ['brief'] },
  { end: { kind: 'document' }, doc: ['document'] },
  { end: { kind: 'note' }, doc: ['text'] },
  { end: { kind: 'ink_group' }, doc: ['ink'] },
  { end: { kind: 'group' }, doc: ['group'] },
  { end: { kind: 'board', purpose: 'brand' }, doc: ['board'], purpose: 'brand' },
  { end: { kind: 'board', purpose: 'location' }, doc: ['board'], purpose: 'location' },
  { end: { kind: 'picture', role: 'character' }, doc: ['ref', 'key'] },
  { end: { kind: 'picture', role: 'product' }, doc: ['ref', 'key'] },
  { end: { kind: 'drawing' }, doc: ['ref'] },
  { end: { kind: 'generated' }, doc: ['frame'] },
]

/** A link's role as the document writes it: a reference's own role for the rules' `reference`. */
const docRole = (role: string, from: LinkEnd) => (role === 'reference' ? from.role ?? 'other' : role)

describe('every link the canvas allows, the store accepts', () => {
  const pairs: string[] = []
  for (const a of ENDS) for (const b of ENDS) {
    const can = canLink(a.end as LinkEnd & { kind: LinkKind }, b.end as LinkEnd & { kind: LinkKind })
    if (!can.ok) continue
    for (const role of can.roles) for (const from of a.doc) for (const to of b.doc) {
      // A reference's link into a shot as frame/layout comes from a ref or a frame; a key is a whole character.
      if (from === 'key' && (role === 'frame' || role === 'layout')) continue
      if (a.end.kind === 'drawing' && role === 'reference') continue // a drawing is named before it is a reference
      pairs.push(`${from}${a.purpose ? `(${a.purpose})` : ''} -> ${to} as ${docRole(role, a.end)}`)
      it(`${from}${a.purpose ? `(${a.purpose})` : ''} -> ${to} as ${docRole(role, a.end)}`, () => {
        expect(linkRuleFor(from, to, docRole(role, a.end), a.purpose)).toHaveProperty('rule')
      })
    }
  }
  it('covers the live repro: a Brand board into a note', () => {
    expect(pairs).toContain('board(brand) -> text as brand')
    expect(linkRuleFor('board', 'text', 'brand', 'brand')).toHaveProperty('rule')
    // Only a brand board: a location board into a note stays refused, on both sides.
    expect(canLink({ kind: 'board', purpose: 'location' }, 'note').ok).toBe(false)
    expect(linkRuleFor('board', 'text', 'brand', 'location')).toHaveProperty('refused')
  })
})
