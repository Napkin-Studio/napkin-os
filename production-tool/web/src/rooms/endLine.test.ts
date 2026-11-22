import { describe, expect, it } from 'vitest'
import { endLineOf } from '../brief/model'
import { END_LINE_ID, endLineIn, withEndLineSuper } from './endLine'
import type { Plan } from './timeline'

// UAT round 4, R4-F6: the brief's mandatory end line was a voice-over on shot 5 that no model voiced, with no card and
// no super: the film had it nowhere and ended on the studio card.
const clip = (startS: number, durS: number) => ({ item_id: `i${startS}`, sha256: 'sha256:x', startS, inS: 0, outS: durS, durS, takeS: 4 }) as unknown as Plan['clips'][number]
const round4: Plan = { clips: [clip(0, 3), clip(3, 2), clip(5, 1.5), clip(6.5, 3.5)], texts: [], lengthS: 10, missing: [] }

describe("the brief's end line in the film (R4-F6)", () => {
  const line = endLineOf({ mandatories: ['End line must be "Quietboil. Let them sleep."', 'Deliver in 16:9, 9:16 and 1:1'] })!
  it('reads the round 4 mandatory', () => expect(line).toBe('Quietboil. Let them sleep.'))

  it('unvoiced and unshown: a super over the last shot, its last 2.5 s', () => {
    const end = endLineIn(round4, line, ['Good boy.'])
    expect(end.how).toBe('super')
    const plan = withEndLineSuper(round4, end)
    expect(plan.texts).toEqual([{ item_id: END_LINE_ID, words: 'Quietboil. Let them sleep.', style: 'super', fromS: 7.5, toS: 10, fadeInS: 0.3 }])
    expect(plan.lengthS).toBe(10)
  })

  it('voiced in a clip, on the end card or in a text already: no super', () => {
    expect(endLineIn(round4, line, ['Quietboil. Let them sleep.']).how).toBe('voiced')
    expect(endLineIn({ ...round4, endCard: { line: 'Quietboil. Let them sleep.', bg: '#000', s: 2.5, startS: 10 } }, line, []).how).toBe('card')
    expect(endLineIn({ ...round4, texts: [{ item_id: 't', words: 'Quietboil — let them sleep', style: 'title', fromS: 8, toS: 10 }] }, line, []).how).toBe('text')
    expect(withEndLineSuper(round4, endLineIn(round4, line, [line])).texts).toEqual([])
  })
})
