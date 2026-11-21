import { describe, expect, it } from 'vitest'
import { planBy } from './filmJobs'

// UAT round 4, R4-F4: the cut plan failed (Dex timed out) and the sheet still said "Director agent: how I would cut it".
describe('who made a film plan', () => {
  it('a simple cut after Dex failed says so; with Claude off it is a simple cut; Dex own plan is his', () => {
    const block = (model: string, rationale: string) => ({ director: { model, promptVersion: 'cutter.v2', output: {}, rationale } })
    expect(planBy(block('passthrough', 'Dex could not plan this (ModelError), so this is a simple cut: the opening and the payoff, fitted to each length.'))).toBe('failed')
    expect(planBy(block('passthrough', 'passthrough: no model; the opening and the payoff first, the middle of each frame kept.'))).toBe('off')
    expect(planBy(block('eu.anthropic.claude-sonnet-5-5', 'The reveal, then the sip.'))).toBeUndefined()
  })
})
