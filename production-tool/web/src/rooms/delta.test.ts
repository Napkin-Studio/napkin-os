// The Change drawer's words (features/make-and-edit.clan): a take's one-line label, the diff, the Keeps line; and
// what the preview draws at a moment of the plan (one plan for the preview and the render).
import { describe, expect, it } from 'vitest'
import { cameraDelta, changeLabel, changesSomething, diffLines, keepsWords, shortWords } from './delta'
import { frameAt, sourceTime, type Plan, type PlanClip } from './timeline'

const no = (id: string) => ({ s3: 3, s4: 4 } as Record<string, number>)[id] ?? 0

describe('what a new take changes, in words', () => {
  it('labels a take by its change', () => {
    expect(changeLabel([], no)).toBe('First take')
    expect(changeLabel([{ field: 'camera.movement', from: 'static', to: 'handheld', shot_id: 's3' }], no)).toBe('Camera: handheld (shot 3)')
    expect(changeLabel([{ field: 'words', to: 'folds the shirt in one swift move', shot_id: 's4' }], no)).toBe('Words: folds the shirt in one… (shot 4)')
    expect(changeLabel([{ field: 'moment', to: 'shirt red', window: { from_s: 0, to_s: 2 } }], no)).toBe('Shirt red 0:00-0:02')
    expect(changeLabel([{ field: 'feel', to: 'golden hour' }], no)).toBe('Feel: golden hour')
  })

  it('says the diff as was → now, and only what really changes goes', () => {
    const d = cameraDelta('s3', { size: 'medium', movement: 'static' }, { movement: 'handheld', size: 'medium' })
    expect(d).toEqual([{ field: 'camera.movement', from: 'static', to: 'handheld', shot_id: 's3' }])
    expect(diffLines(d, no)).toEqual(['Shot 3 camera movement: Static → Handheld'])
    expect(changesSomething(d)).toBe(true)
    expect(changesSomething(cameraDelta('s3', { movement: 'pan' }, { movement: 'pan' }))).toBe(false)
  })

  it('says what is kept, and the seed only where the model repeats a take', () => {
    expect(keepsWords('camera', { refs: ['Samurai', 'Apron'], lengthS: 5, seed: true })).toBe('Start frame · References @Samurai @Apron · Words · Length 5 s · Seed')
    expect(keepsWords('words', { refs: [], lengthS: 3.5, seed: false })).toBe('Start frame · References · Length 3.5 s')
    expect(keepsWords('moment', { refs: [], lengthS: 3.5, seed: false, window: { from_s: 0, to_s: 2 } })).toBe('Everything outside 0:00-0:02 · Sound · Length 3.5 s')
  })

  it('never names a mode, a price or a credit', () => {
    const all = [changeLabel([{ field: 'feel', to: 'dusk' }], no), keepsWords('feel', { refs: [], lengthS: 3, seed: false }), shortWords('a'.repeat(40))].join(' ')
    expect(all).not.toMatch(/\$|credit|price|take_refs|clip_patch|clip_edit/i)
  })
})

describe('the preview draws the plan', () => {
  const c = (item_id: string, startS: number, inS: number, outS: number, extra: Partial<PlanClip> = {}): PlanClip =>
    ({ item_id, generation_id: `g_${item_id}`, sha256: `sha_${item_id}`, startS, inS, outS, durS: outS - inS, takeS: 5, ...extra })
  const plan: Plan = {
    clips: [c('a', 0, 0, 2, { fadeInS: 0.5 }), c('b', 2, 1, 3, { transitionIn: { kind: 'dissolve', s: 0.5 } })],
    texts: [{ item_id: 't', words: 'Clean like a samurai.', style: 'super', fromS: 1, toS: 3, fadeInS: 0.5 }],
    endCard: { line: 'SuperSamurai', bg: '#14161B', s: 1.5, startS: 4 },
    lengthS: 5.5, missing: [],
  }

  it('fades in from black, and a dissolve shows the outgoing clip\'s footage after its cut under the incoming one', () => {
    expect(frameAt(plan, 0.25).layers.map((l) => [l.clip.item_id, l.alpha])).toEqual([['a', 0.5]])
    const mid = frameAt(plan, 2.25)
    expect(mid.layers.map((l) => [l.clip.item_id, l.srcS, l.alpha])).toEqual([['a', 2.25, 1], ['b', 1.25, 0.5]])
    expect(frameAt(plan, 2.75).layers.map((l) => l.clip.item_id)).toEqual(['b'])
  })

  it('shows text at its times with its fade, and the end card after the last clip', () => {
    expect(frameAt(plan, 1.25).text.map((x) => [x.t.words, x.alpha])).toEqual([['Clean like a samurai.', 0.5]])
    expect(frameAt(plan, 4.5).endCard?.card.line).toBe('SuperSamurai')
    expect(sourceTime(plan.clips[1], 2.5)).toBe(1.5)
  })
})
