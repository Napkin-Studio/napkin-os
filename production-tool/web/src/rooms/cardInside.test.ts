import { describe, expect, it } from 'vitest'
import { fitCardInside } from './cardInside'
import type { Plan, PlanClip } from './timeline'

const clip = (id: string, startS: number, len: number, over: Partial<PlanClip> = {}): PlanClip =>
  ({ item_id: id, sha256: 'sha256:' + id, startS, inS: 0, outS: len, durS: len, takeS: len + 2, ...over }) as PlanClip
const plan = (clips: PlanClip[], extra: Partial<Plan> = {}): Plan => {
  const end = Math.max(...clips.map((c) => c.startS + c.durS))
  return { clips, texts: [], lengthS: end, missing: [], ...extra }
}
const lengthOf = (p: Plan) => Math.max(...p.clips.map((c) => c.startS + c.durS / 1)) + (p.endCard?.s ?? 0)

describe('the studio card sits inside the length', () => {
  it('a 15 s film becomes 12.5 s of film so the file is 15 s with the 2.5 s card', () => {
    const p = plan([clip('a', 0, 5), clip('b', 5, 5), clip('c', 10, 5)])
    const r = fitCardInside(p, 15)!
    expect(r.renderS).toBe(15)
    expect(r.plan.lengthS).toBe(12.5)
    expect(r.shortOfS).toBe(0)
    // the relay checks (end of last clip + own card) against lengthS: they must agree
    const c = r.plan.clips
    const end = Math.max(...c.map((x) => x.startS + (x.outS - x.inS) / (x.speed ?? 1) + (x.holdS ?? 0)))
    expect(Math.abs(end - r.plan.lengthS)).toBeLessThan(0.02)
    expect(c.every((x) => (x.speed ?? 1) <= 1.33)).toBe(true)
    expect(lengthOf(r.plan)).toBeCloseTo(12.5, 3)
  })

  it('texts and fades scale with the clips, and the person\'s end card keeps its length', () => {
    const p = plan([clip('a', 0, 6, { fadeOutS: 1 }), clip('b', 6, 6)], {
      texts: [{ item_id: 't', words: 'x', style: 'caption', fromS: 6, toS: 9 }], endCard: { line: 'l', bg: '#000000', s: 2, startS: 12 } as Plan['endCard'], lengthS: 14,
    })
    const r = fitCardInside(p, 14.5)!
    expect(r.plan.endCard!.s).toBe(2)
    expect(r.plan.texts[0].fromS).toBeLessThan(6)
    expect(r.plan.clips[0].fadeOutS).toBeLessThan(1)
    expect(r.renderS).toBeCloseTo(14.5, 2)
  })

  it('leaves a film alone when it has no target, is far from it, or already leaves room for the card', () => {
    const p = plan([clip('a', 0, 5), clip('b', 5, 5), clip('c', 10, 5)])
    expect(fitCardInside(p, undefined)).toBeUndefined()
    expect(fitCardInside(p, 30)).toBeUndefined()
    expect(fitCardInside(p, 8)).toBeUndefined()
    expect(fitCardInside(plan([clip('a', 0, 12.5)]), 15)).toBeUndefined()
  })

  it('never asks the relay for more than 1.33 times faster: a tight film is as fit as it can be, and says by how much it is over', () => {
    const p = plan([clip('a', 0, 3, { speed: 1.2 }), clip('b', 3, 3, { speed: 1.2 })])
    const r = fitCardInside(p, 6)!
    expect(Math.max(...r.plan.clips.map((c) => c.speed ?? 1))).toBeLessThanOrEqual(1.33)
    expect(r.shortOfS).toBeGreaterThan(0)
  })
})
