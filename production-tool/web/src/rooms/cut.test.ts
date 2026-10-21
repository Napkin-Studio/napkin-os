// The Edit room's cut arithmetic (features/make-and-edit.clan): trims, split, ripple delete, fades, joins, and the
// swap rule (Use this take keeps the slot; a shorter take holds its last frame up to 0.5 s, else asks).
import { describe, expect, it } from 'vitest'
import {
  applySwap, clipEnd, clipLen, cutLength, fitWords, handleShort, mapWindow, moveV1, pack, planSwap, removeClip, setFades, setTransition, split, trimHead, trimTail,
  type Cut, type CutClip,
} from './cut'

const clip = (id: string, startS: number, inS: number, outS: number, extra: Partial<CutClip> = {}): CutClip =>
  ({ id, genId: `g_${id}`, inS, outS, startS, speed: 1, holdS: 0, fadeInS: 0, fadeOutS: 0, ...extra })
/** Three clips end to end: 0-2, 2-3.5, 3.5-5. */
const three = (): Cut => ({ v1: [clip('a', 0, 0, 2), clip('b', 2, 0, 1.5), clip('c', 3.5, 1.5, 3)], v2: [], text: [] })
const starts = (c: Cut) => c.v1.map((x) => [x.id, x.startS, clipLen(x)])

describe('the cut', () => {
  it('a clip lasts its window at its speed plus its held frame; the film ends at the last end plus the card', () => {
    expect(clipLen(clip('x', 0, 1, 3, { speed: 1.25, holdS: 0.4 }))).toBe(2)
    expect(cutLength({ ...three(), endCard: { headline: 'H', line: 'L', bg: '#000000', durS: 1.5 } })).toBe(6.5)
    expect(pack([clip('a', 4, 0, 1), clip('b', 9, 0, 2)]).map((x) => x.startS)).toEqual([0, 1])
  })

  it('trims the head with ripple: the clip keeps its start and what follows moves', () => {
    const { cut } = trimHead(three(), 'b', 0.2, true)
    expect(starts(cut)).toEqual([['a', 0, 2], ['b', 2, 1.3], ['c', 3.3, 1.5]])
  })

  it('trims without ripple: a gap opens, and a clip never runs into its neighbour', () => {
    const { cut } = trimHead(three(), 'b', 0.2, false)
    expect(starts(cut)).toEqual([['a', 0, 2], ['b', 2.2, 1.3], ['c', 3.5, 1.5]])
    const back = trimHead(cut, 'b', 0, false).cut
    expect(starts(back)[1]).toEqual(['b', 2, 1.5])
    // Pulled further than the gap: it stops at the clip before.
    const c2 = trimHead({ ...three(), v1: [clip('a', 0, 0, 2), clip('b', 2, 1, 2)] }, 'b', 0, false).cut
    expect(c2.v1[1].startS).toBeGreaterThanOrEqual(clipEnd(c2.v1[0]) - 1e-9)
    const tail = trimTail(three(), 'a', 3, 5, false).cut
    expect(clipEnd(tail.v1[0])).toBeLessThanOrEqual(tail.v1[1].startS + 1e-9)
  })

  it('says when a tail is dragged past the footage (Make more?)', () => {
    expect(trimTail(three(), 'a', 6, 4, true)).toMatchObject({ short: true })
    expect(trimTail(three(), 'a', 6, 4, true).cut.v1[0].outS).toBe(4)
  })

  it('splits at the playhead: two clips of the same take, fades kept on the outer ends', () => {
    const c = setFades(three(), 'a', { inS: 0.3, outS: 0.4 })
    const s = split(c, 'a', 1.2, 'a2')
    expect(s.v1.map((x) => [x.id, x.startS, x.inS, x.outS, x.fadeInS, x.fadeOutS])).toEqual([
      ['a', 0, 0, 1.2, 0.3, 0], ['a2', 1.2, 1.2, 2, 0, 0.4], ['b', 2, 0, 1.5, 0, 0], ['c', 3.5, 1.5, 3, 0, 0],
    ])
  })

  it('Delete closes the gap; Shift+Delete leaves it', () => {
    expect(starts(removeClip(three(), 'b', true))).toEqual([['a', 0, 2], ['c', 2, 1.5]])
    expect(starts(removeClip(three(), 'b', false))).toEqual([['a', 0, 2], ['c', 3.5, 1.5]])
  })

  it('moves a clip and V1 closes up behind it', () => {
    expect(starts(moveV1(three(), 'c', 0))).toEqual([['c', 0, 1.5], ['a', 1.5, 2], ['b', 3.5, 1.5]])
  })

  it('a dissolve or dip keeps every clip in its place; its overlap comes from the clip before\'s footage after its cut', () => {
    const c = setTransition(three(), 'b', { kind: 'dissolve', s: 0.5 })
    expect(starts(c)).toEqual(starts(three()))
    expect(c.v1[1].transition).toEqual({ kind: 'dissolve', s: 0.5 })
    // Clip a ends at 2 s of a 2 s take: no footage after it, so its last frame holds for the whole overlap.
    expect(handleShort(c, 'b', () => 2)).toBe(0.5)
    expect(handleShort(c, 'b', () => 4)).toBe(0)
    expect(setTransition(three(), 'a', { kind: 'dip_black', s: 0.5 }).v1[0].transition).toBeUndefined() // nothing before the first
    expect(setTransition(c, 'b', undefined).v1[1].transition).toBeUndefined()
  })

  it('fades are kept inside the clip', () => {
    const c = setFades(three(), 'b', { inS: 9, outS: 9 })
    expect([c.v1[1].fadeInS, c.v1[1].fadeOutS]).toEqual([1.5, 0])
  })

  it('the fit badge says it plainly', () => {
    expect(fitWords(10, 10)).toEqual({ words: 'Fits 10 s', ok: true })
    expect(fitWords(10.4, 10)).toEqual({ words: 'Over by 0.4 s', ok: false })
    expect(fitWords(8, 10)).toEqual({ words: '8 s · 2 s short', ok: false })
  })
})

describe('the swap rule (Use this take)', () => {
  // Shot 2 sat at 2-3.5 s of the old take (a box made together); its clip plays 2.2-3.5 of it.
  const old = { inS: 2, outS: 3.5 }

  it('maps the window through the shot\'s place in the new take: the same offset, the same length where it fits', () => {
    expect(mapWindow({ inS: 2.2, outS: 3.5 }, old, { inS: 2.1, outS: 3.8 })).toEqual({ inS: 2.3, outS: 3.6, shortBy: 0 })
    expect(mapWindow({ inS: 2.2, outS: 3.5 }, old, { inS: 2.1, outS: 3.2 })).toEqual({ inS: 2.3, outS: 3.2, shortBy: 0.4 })
  })

  it('keeps the start, fades and join; a shorter take holds its last frame up to 0.5 s without asking', () => {
    const cut: Cut = { v1: [clip('a', 0, 0, 2), clip('s2', 2, 2.2, 3.5, { fadeOutS: 0.3, transition: { kind: 'dissolve', s: 0.5 } }), clip('c', 3.3, 0, 1)], v2: [], text: [] }
    const plan = planSwap([{ clip: cut.v1[1], oldSeg: old, newSeg: { inS: 2.1, outS: 3.2 } }])
    expect(plan).toMatchObject({ shortBy: 0.4, ask: false })
    const after = applySwap(cut, 'g_new', plan)
    const s2 = after.v1[1]
    expect(s2).toMatchObject({ genId: 'g_new', startS: 2, inS: 2.3, outS: 3.2, holdS: 0.4, fadeOutS: 0.3, transition: { kind: 'dissolve', s: 0.5 } })
    expect(clipLen(s2)).toBe(clipLen(cut.v1[1]))
    expect(after.v1[2].startS).toBe(3.3) // nothing moved
  })

  it('asks when the new take is more than 0.5 s shorter, and never ripples unless Shorten the slot is chosen', () => {
    const cut: Cut = { v1: [clip('s2', 0, 0, 3), clip('c', 3, 0, 1)], v2: [], text: [] }
    const plan = planSwap([{ clip: cut.v1[0], oldSeg: { inS: 0, outS: 3 }, newSeg: { inS: 0, outS: 2.4 } }])
    expect(plan).toMatchObject({ shortBy: 0.6, ask: true, fitSpeed: 0.8 })
    expect(applySwap(cut, 'n', plan, 'hold').v1[1].startS).toBe(3)
    const fit = applySwap(cut, 'n', plan, 'fit')
    expect([fit.v1[0].speed, clipLen(fit.v1[0]), fit.v1[1].startS]).toEqual([0.8, 3, 3])
    const short = applySwap(cut, 'n', plan, 'shorten')
    expect([clipLen(short.v1[0]), short.v1[1].startS]).toEqual([2.4, 2.4])
  })

  it('a longer new take keeps the old length: nothing in the cut moves', () => {
    const cut: Cut = { v1: [clip('s', 0, 0, 1.5)], v2: [], text: [] }
    const after = applySwap(cut, 'n', planSwap([{ clip: cut.v1[0], oldSeg: { inS: 0, outS: 1.5 }, newSeg: { inS: 0, outS: 4 } }]))
    expect(after.v1[0]).toMatchObject({ inS: 0, outS: 1.5, holdS: 0, startS: 0 })
  })
})
