// The Edit room preview's sound (owner 2026-11-18): what soundAt says plays at a moment of the plan, as
// stitch/timeline.py mixes the render: each clip's own sound in its window at its speed, its fades, a linear
// crossfade over a transition with the outgoing clip's footage after its cut, silence under a held frame,
// a gap and the end card.
import { describe, expect, it } from 'vitest'
import { loadPreviewMuted, savePreviewMuted } from './media'
import { soundAt, type Plan, type PlanClip } from './timeline'

const c = (item_id: string, startS: number, inS: number, outS: number, extra: Partial<PlanClip> = {}): PlanClip => {
  const speed = extra.speed ?? 1
  return { item_id, generation_id: `g_${item_id}`, sha256: `sha_${item_id}`, startS, inS, outS, durS: (outS - inS) / speed + (extra.holdS ?? 0), takeS: 5, ...extra }
}
const plan = (clips: PlanClip[], endAt?: number): Plan => ({
  clips, texts: [], lengthS: endAt ? endAt + 1.5 : (clips.at(-1)!.startS + clips.at(-1)!.durS),
  ...(endAt !== undefined ? { endCard: { line: 'SuperSamurai', bg: '#14161B', s: 1.5, startS: endAt } } : {}), missing: [],
})
const heard = (p: Plan, t: number) => soundAt(p, t).map((x) => [x.clip.item_id, x.srcS, x.gain])

describe('the preview hears what the render mixes', () => {
  it('a clip sounds in its window at full level, faded in and out with its picture', () => {
    const p = plan([c('a', 0, 1, 3, { fadeInS: 0.5, fadeOutS: 0.5 })])
    expect(heard(p, 0.25)).toEqual([['a', 1.25, 0.5]])
    expect(heard(p, 1)).toEqual([['a', 2, 1]])
    expect(heard(p, 1.75)).toEqual([['a', 2.75, 0.5]])
  })

  it('at speed, the window runs faster; under a held last frame it is silent', () => {
    const p = plan([c('a', 0, 0, 2, { speed: 1.25, holdS: 1 })])
    expect(heard(p, 0.8)).toEqual([['a', 1, 1]])
    expect(heard(p, 2)).toEqual([]) // 1.6 s of window, then the held frame
  })

  it('a transition crossfades linearly, the outgoing clip running on into its footage after its cut', () => {
    for (const kind of ['dissolve', 'dip_black', 'dip_white'] as const) {
      const p = plan([c('a', 0, 0, 2), c('b', 2, 1, 3, { transitionIn: { kind, s: 1 } })])
      expect(heard(p, 2.25)).toEqual([['a', 2.25, 0.75], ['b', 1.25, 0.25]])
      expect(heard(p, 2.75)).toEqual([['a', 2.75, 0.25], ['b', 1.75, 0.75]]) // a dip has hidden a's picture by now
      expect(heard(p, 3.5)).toEqual([['b', 2.5, 1]])
    }
  })

  it('the outgoing clip is silent in a transition when it holds, has faded out or has no footage left', () => {
    const into = (a: PlanClip) => heard(plan([a, c('b', a.durS, 0, 2, { transitionIn: { kind: 'dissolve', s: 1 } })]), a.durS + 0.5)
    expect(into(c('a', 0, 0, 2, { holdS: 0.5 }))).toEqual([['b', 0.5, 0.5]])
    expect(into(c('a', 0, 0, 2, { fadeOutS: 0.5 }))).toEqual([['b', 0.5, 0.5]])
    expect(into(c('a', 0, 0, 5))).toEqual([['b', 0.5, 0.5]])
  })

  it('a gap and the end card are silent', () => {
    const p = plan([c('a', 0, 0, 2), c('b', 3, 0, 1)], 4)
    expect(heard(p, 2.5)).toEqual([])
    expect(heard(p, 4.5)).toEqual([])
  })
})

describe('the preview mute is remembered in this browser', () => {
  it('is off unless chosen, and survives storage that throws', () => {
    expect(loadPreviewMuted(() => null)).toBe(false)
    expect(loadPreviewMuted(() => '1')).toBe(true)
    expect(loadPreviewMuted(() => { throw new Error('private') })).toBe(false)
    let kept = ''
    savePreviewMuted(true, (v) => { kept = v })
    expect(kept).toBe('1')
    expect(() => savePreviewMuted(false, () => { throw new Error('private') })).not.toThrow()
  })
})
