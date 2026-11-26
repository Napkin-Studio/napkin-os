import { describe, expect, it } from 'vitest'
import { endLineOf } from '../brief/model'
import { cardWordsChecks, END_LINE_ID, endLineIn, heardChecks, withEndLineSuper } from './endLine'
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

describe('the brief\'s end line as Brief Maker writes it (PR #306), and what Review says (UAT round 4 F34)', () => {
  it('reads the line word for word from "End line: \'…\' (word for word)"', () => {
    expect(endLineOf({ mandatories: ["End line: 'Refill. Not landfill.' (word for word)", 'Legal: Recycle the glass.'] })).toBe('Refill. Not landfill.')
  })
  const vo = { shotId: 's5', n: 5, who: 'NARRATOR', text: 'Refill. Not landfill.', voiced: false, why: 'Not in any clip: no clip voices it' }
  const other = { shotId: 's2', n: 2, who: 'MUM', text: 'Is that it?', voiced: false, why: 'Not in any clip: no clip voices it' }
  it('the end line only in an unvoiced voice-over is said plainly, with where the film shows it, and is no "Not heard"', () => {
    const lines = heardChecks({ line: 'Refill. Not landfill.', how: 'card' }, [vo, other])
    expect(lines[0]).toEqual({ text: 'The brief\u2019s end line \u201cRefill. Not landfill.\u201d is only NARRATOR\u2019s voice-over on shot 5, which no clip says yet: the end card shows it', ok: true })
    expect(lines.slice(1).map((l) => l.text)).toEqual(['Not heard: MUM\u2019s \u201cIs that it?\u201d (shot 2). Not in any clip.'])
    expect(heardChecks({ line: 'Refill. Not landfill.', how: 'super' }, [])[0].text).toBe('The brief\u2019s end line \u201cRefill. Not landfill.\u201d is not voiced: it shows as a super over the last shot')
  })
  it('without a brief end line, every unvoiced line is a "Not heard"', () => {
    expect(heardChecks(undefined, [vo]).map((l) => l.ok)).toEqual([false])
  })
})

describe('Review reads what the end card will print (UAT round 4 gate)', () => {
  it('a note for a picture or a placement in a field, and a line that repeats the headline, are said', () => {
    const bad = cardWordsChecks({ headline: 'Refill. Not landfill.', line: '@logo on a clean, quiet field. @logo on a clean, quiet field.' })
    expect(bad.map((c) => c.ok)).toEqual([false])
    expect(bad[0].text).toMatch(/line reads .*@logo.*a note on how the card looks/)
    expect(cardWordsChecks({ headline: 'Flat out good.', line: 'Flat out good.' })).toEqual([{ text: 'The end card says its headline again in its line', ok: false }])
    expect(cardWordsChecks({ headline: 'Refill. Not landfill.', line: 'Copperell Refill' })).toEqual([])
    expect(cardWordsChecks({ headline: 'Copperell', line: 'Logo top right.' })[0].text).toMatch(/line reads/)
  })
})
