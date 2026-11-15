// Phase 3 test 79, the unit half (features/production-platform-rules.clan, done_when 7): refusals show no figure.
// The line's limit_reached and spend_stop messages, the relay's and the web's own, hold no digit and no currency
// word. app/tests/shellRules.test.ts runs the same rule (refusalWords.ts) from the shell's tests.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { failedActions } from './jobActions'
import { RELAY_REFUSAL_FILES, REFUSAL_CODES, figureIn, relayRefusals } from './refusalWords'

const TOOL = join(__dirname, '..', '..', '..')
const read = () => Object.fromEntries(RELAY_REFUSAL_FILES.map((p) => [p, readFileSync(join(TOOL, p), 'utf8')]))

describe('79 refusals show no figure (unit)', () => {
  it('the rule catches a figure and a money word, and passes a plain line', () => {
    expect(figureIn('the daily spend cap for napkin-staging is 5 euro')).toMatch(/figure/)
    expect(figureIn('Over the cap in USD.')).toMatch(/money word/)
    expect(figureIn('Paid runs are off here. Nothing was sent.')).toBeNull()
  })

  it('finds the relay lines for both codes (the walk is not empty)', () => {
    const lines = relayRefusals(read())
    expect(lines.some((l) => l.code === 'limit_reached')).toBe(true)
    expect(lines.some((l) => l.code === 'spend_stop')).toBe(true)
    expect(lines.some((l) => l.code === 'guard')).toBe(true)
  })

  it("every limit_reached and spend_stop line the relay can send holds no digit and no currency word", () => {
    const bad = relayRefusals(read()).flatMap((l) => {
      const why = figureIn(l.text)
      return why ? [`${l.where}: ${why} in "${l.text}"`] : []
    })
    expect(bad).toEqual([])
  })

  it('the web adds nothing to those refusals but the relay line', () => {
    for (const code of REFUSAL_CODES) {
      const offer = failedActions({ code })
      expect(offer.note).toBeUndefined()
      expect(offer.otherModel).toBe(false)
    }
  })
})
