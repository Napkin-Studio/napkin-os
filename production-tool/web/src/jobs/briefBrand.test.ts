// A brief is its client's work (UAT round 4 S2-6, features/pt-canvas-r4.clan): its storyboard's plan casts only the
// pictures linked into it or named, and its pictures take a brand only once the person picks one.
import { describe, expect, it } from 'vitest'
import type { NamedRef, ProductionDocument } from '../contracts/types'
import { answerBrand, brandQuestion, castFor, NO_BRAND } from './briefBrand'

const SB = 'sb_01M7Y31MKPCGH8MWGG2JKTRRA1'
const BRIEF = 'brief_01M7Y31MKPCGH8MWGG2JKTRRA1'
const BOARD = 'board_01M7Y31MKPCGH8MWGG2JKTRRA1'
const ref = (id: string, key: string, variant = 'front'): NamedRef => ({ id, v: 1, field_v: {}, key, variant, role: 'character', asset: 'sha256:' + id.padEnd(64, '0').slice(0, 64) }) as unknown as NamedRef

/** The live repro: a Quietboil brief linked into a storyboard; @ruby and @mia from other tests; a Harbour Brand board. */
function doc(): ProductionDocument {
  return {
    storyboards: { [SB]: { id: SB, v: 1, field_v: {}, target_s: 15 } },
    briefs: { [BRIEF]: { id: BRIEF, v: 1, field_v: {}, title: 'Let Them Sleep (Quietboil)', source: { how: 'link', document_id: 'doc_x', taken: 1, data_sha256: 'sha256:x' }, spine: { proposition: 'The kettle that lets the house sleep.', audience: 'A young renter in a shared flat' } } },
    boards: { [BOARD]: { id: BOARD, v: 1, field_v: {}, title: 'Harbour', purpose: 'brand', rank: 'a' } },
    links: { link_1: { id: 'link_1', v: 1, field_v: {}, from: { kind: 'brief', id: BRIEF }, to: { kind: 'storyboard', id: SB }, role: 'brief' } },
    refs: { ref_ruby: ref('ref_ruby', 'ruby'), ref_mia: ref('ref_mia', 'mia'), ref_kettle: { ...ref('ref_kettle', 'quietboil'), role: 'product' } },
    keys: {}, shots: {}, scripts: {}, videos: {}, texts: {}, asks: {}, jobs: {},
  } as unknown as ProductionDocument
}

describe('a brief storyboard casts only what is linked or named (S2-6)', () => {
  it('leaves out @ruby and @mia, keeps the product the brief names', () => {
    const keep = castFor(doc(), SB, 'a young renter, no people from other films')!
    const d = doc()
    // The brief's title names Quietboil: its product is cast; the people from other films are not.
    expect(Object.values(d.refs).filter((r) => keep(r as NamedRef)).map((r) => r.key)).toEqual(['quietboil'])
    // Named in the person's words, or in the brief: cast.
    const named = castFor(doc(), SB, 'Ruby makes tea at midnight')!
    expect(named(d.refs.ref_ruby as NamedRef)).toBe(true)
    const briefed = structuredClone(d)
    briefed.briefs![BRIEF].spine = { ...briefed.briefs![BRIEF].spine, mandatories: ['Mia, our tester, holds the kettle'] } as never
    expect(castFor(briefed, SB, '')!(d.refs.ref_mia as NamedRef)).toBe(true)
  })
  it('a picture linked into the storyboard is cast', () => {
    const d = doc()
    d.links.link_2 = { id: 'link_2', v: 1, field_v: {}, from: { kind: 'ref', id: 'ref_mia' }, to: { kind: 'storyboard', id: SB }, role: 'character' } as never
    expect(castFor(d, SB, '')!(d.refs.ref_mia as NamedRef)).toBe(true)
  })
  it('a storyboard with no brief casts as before (no filter)', () => {
    const d = doc()
    d.links = {}
    expect(castFor(d, SB, '')).toBeUndefined()
  })
})

describe('a brief with no Brand board asks which brand, or none (S2-6, UX 4)', () => {
  function store(d: ProductionDocument) {
    let cur = d
    return {
      get: () => cur,
      change: async (fn: (x: ProductionDocument) => void) => { const n = structuredClone(cur); fn(n); cur = n; return cur },
    }
  }
  it('asks with each Brand board and No brand; a pick links the board, and it is not asked again', async () => {
    expect(brandQuestion(doc(), SB)).toEqual({ boards: [{ id: BOARD, title: 'Harbour' }] })
    const s = store(doc())
    await answerBrand(s as never, SB, BOARD, 'human:p1')
    const links = Object.values(s.get().links)
    expect(links.some((l) => l.role === 'brand' && l.from.id === BOARD && l.to.id === SB)).toBe(true)
    expect(brandQuestion(s.get(), SB)).toBeUndefined()
  })
  it('No brand is kept as the answer, links nothing, and is not asked again', async () => {
    const s = store(doc())
    await answerBrand(s as never, SB, null, 'human:p1')
    expect(Object.values(s.get().links).some((l) => l.role === 'brand')).toBe(false)
    const ask = Object.values(s.get().asks)[0]
    expect(ask).toMatchObject({ state: 'answered', node: { kind: 'storyboard', id: SB }, answers: [{ option_id: NO_BRAND, by: 'human:p1' }] })
    expect(brandQuestion(s.get(), SB)).toBeUndefined()
  })
  it('asks nothing without a brief or without a Brand board', () => {
    const d = doc()
    d.boards = {}
    expect(brandQuestion(d, SB)).toBeUndefined()
    const e = doc()
    e.links = {}
    expect(brandQuestion(e, SB)).toBeUndefined()
  })
})
