import { describe, expect, it } from 'vitest'
import { choiceToSend, modelChoicesFor, modelLabel } from './capabilities'
import { CONFIGS } from './contracts/load'
import type { Config } from './contracts/types'
import { fellBack, otherModels } from './ui/modelChoice'

// features/model-choice.clan, features/runway-fallback.clan: the regenerate menu always offers
// Runway's models (the floor of every job); a config that routes more providers lists them in order.
const live: Config = CONFIGS.live
const both: Config = { ...live, routing: { ...live.routing, frame: ['mock', 'runway'], clip: ['mock', 'runway'] } }
// features/runway-video-models.clan: clips that carry characters, after Veo. Kling O3 and Kling 3.0 show once
// each, as their Standard id; Quality picks Pro (features/clip-quality.clan).
const NEW_CLIPS = ['klingO3_standard', 'kling3.0_standard', 'hailuo3', 'gemini_omni_flash_1.1',
  'wan3', 'seedance2_5', 'seedance2_fast'].map((m) => `runway:${m}`)
const keys = (c: Config, op: 'frame' | 'clip') => modelChoicesFor(op, c).map((o) => `${o.provider}:${o.model}`)

describe('the regenerate menu', () => {
  it('offers Runway alone on the live config: its default, then its alternates', () => {
    expect(keys(live, 'frame')).toEqual(['runway:gemini_image3_pro', 'runway:gemini_image3.1_flash'])
    expect(keys(live, 'clip')).toEqual(['runway:veo3.1', 'runway:veo3.1_fast', ...NEW_CLIPS])
  })

  it('lists each routed provider as its jobs run, each model then its alternates', () => {
    expect(keys(both, 'frame')).toEqual(['mock:mock', 'mock:mock-hq', 'runway:gemini_image3_pro', 'runway:gemini_image3.1_flash'])
    expect(keys(both, 'clip')).toEqual(['mock:mock', 'mock:mock-hq', 'runway:veo3.1', 'runway:veo3.1_fast', ...NEW_CLIPS])
  })

  it('carries labels and notes from the sheets, and no price (owner, 2026-10-13)', () => {
    expect(modelChoicesFor('frame', live).find((o) => o.model === 'gemini_image3.1_flash')).toEqual(
      { provider: 'runway', model: 'gemini_image3.1_flash', label: 'Gemini 3.1 Flash', note: 'Faster and cheaper; the previous default' })
    expect(modelChoicesFor('clip', live)[0]).toEqual({ provider: 'runway', model: 'veo3.1', label: 'Veo 3.1', note: undefined })
  })

  it('sends no pick for the routing default, so the job routes as before', () => {
    expect(choiceToSend('clip', live, { provider: 'runway', model: 'veo3.1' })).toBeUndefined()
    expect(choiceToSend('clip', live, undefined)).toBeUndefined()
    expect(choiceToSend('clip', live, { provider: 'runway', model: 'veo3.1_fast' })).toEqual({ provider: 'runway', model: 'veo3.1_fast' })
    expect(choiceToSend('clip', both, { provider: 'mock', model: 'mock' })).toBeUndefined()
    expect(choiceToSend('clip', both, { provider: 'runway', model: 'veo3.1' })).toEqual({ provider: 'runway', model: 'veo3.1' })
  })

  it('offers a failed job every other model, another provider first, the failed one left out', () => {
    const options = modelChoicesFor('frame', both)
    const failed = { provider: 'runway', model: 'gemini_image3_pro' } as const
    const others = otherModels(options, failed).map((o) => `${o.provider}:${o.model}`)
    expect(others).toEqual(['mock:mock', 'mock:mock-hq', 'runway:gemini_image3.1_flash'])
  })

  it('names a model, and says when a job was made on Runway instead', () => {
    expect(modelLabel('runway', 'gemini_image3.1_flash')).toBe('Gemini 3.1 Flash')
    expect(modelLabel('oldco', 'old-model')).toBe('old-model')
    expect(fellBack({ provider: 'mock', model: 'mock' }, 'runway')).toBe('Made on Runway: Mock could not')
    expect(fellBack({ provider: 'runway', model: 'veo3.1' }, 'runway')).toBeUndefined()
  })
})
