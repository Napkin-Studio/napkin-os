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

describe("a film size's tile says the file's real length (R4-F8)", () => {
  it('"Film 9:16 · 4.5 s" for the 4.52 s file of a 6 s size; the asked length until it is made', async () => {
    const { sizeSeconds } = await import('./make')
    const sha = `sha256:${'c'.repeat(64)}`
    expect(sizeSeconds({ assets: {} }, { length_s: 6 })).toBe(6)
    expect(sizeSeconds({ assets: { [sha]: { duration_s: 4.52 } } } as never, { asset: sha, length_s: 6 })).toBe(4.5)
  })
})
