import { describe, expect, it } from 'vitest'
import { failedActions } from './jobActions'

// A quota error card offered "Try another model" and "Report", and neither could help (2026-10-09).
describe('what a failed job offers', () => {
  it.each(['quota_exhausted', 'spend_stop', 'flag_off', 'unauthorised', 'blocked'] as const)('%s: no other model, no report', (code) => {
    const a = failedActions({ code })
    expect(a.otherModel).toBe(false)
    expect(a.report).toBe(false)
  })

  it('says when the daily quota starts again', () => {
    expect(failedActions({ code: 'quota_exhausted' }).note).toMatch(/midnight UTC/)
    expect(failedActions({ code: 'spend_stop' }).note).toBeUndefined()
  })

  it.each(['provider_failed', 'provider_unavailable', 'timeout', 'invalid_input', 'capability_missing'] as const)('%s: another model and a report', (code) => {
    expect(failedActions({ code })).toEqual({ otherModel: true, report: true })
  })

  it('an error with no code offers both', () => {
    expect(failedActions(undefined)).toEqual({ otherModel: true, report: true })
  })
})

describe('a stepped job says its step (pt-canvas-r4, S1-1)', () => {
  it('says step N of M only for more than one call', async () => {
    const { stepWords } = await import('./jobActions')
    expect(stepWords({ step: 2, steps: 3 })).toBe(' · step 2 of 3')
    expect(stepWords({ step: 1, steps: 1 })).toBe('')
    expect(stepWords(undefined)).toBe('')
  })
})
