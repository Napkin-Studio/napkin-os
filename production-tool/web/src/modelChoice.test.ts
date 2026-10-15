import { describe, expect, it } from 'vitest'
import { choiceToSend, modelChoicesFor, modelLabel } from './capabilities'
import { CONFIGS } from './contracts/load'
import type { Config, DocJob, ProductionDocument } from './contracts/types'
import type { UiState } from './doc/ui'
import { fellBack, madeWith, otherModels, startingChoice } from './ui/modelChoice'

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

  it('starts on the model that made the version, else the default', () => {
    const options = modelChoicesFor('clip', both)
    expect(startingChoice(options, { provider: 'mock', model: 'mock-hq' })).toEqual({ provider: 'mock', model: 'mock-hq' })
    expect(startingChoice(options, { provider: 'runway', model: 'veo3.1_fast' })).toEqual({ provider: 'runway', model: 'veo3.1_fast' })
    // a take made on a provider no longer offered (a project saved before features/drop-hackathon-extras.clan): the default
    expect(startingChoice(modelChoicesFor('clip', live), { provider: 'gone', model: 'old-model' })).toEqual({ provider: 'runway', model: 'veo3.1' })
  })

  it('offers a failed job every other model, another provider first, the failed one left out', () => {
    const options = modelChoicesFor('frame', both)
    const failed = { provider: 'runway', model: 'gemini_image3_pro' } as const
    const others = otherModels(options, failed).map((o) => `${o.provider}:${o.model}`)
    expect(others).toEqual(['mock:mock', 'mock:mock-hq', 'runway:gemini_image3.1_flash'])
  })



  it('names the model a job ran on, and says when it was made on Runway instead', () => {
    const job = { id: 'job_1', op: 'clip', state: 'completed', provider: 'runway', model: 'veo3.1', parent_ids: [], input_hashes: [], created_at: '2026-10-08T00:00:00Z' } as unknown as DocJob
    const doc = { jobs: { job_1: job } } as unknown as ProductionDocument
    const request = { contractVersion: '3', jobId: 'job_1', op: 'clip', parentIds: [], input: {} }
    // no pick: the relay's fallbackFrom says the mock could not
    const ui = { jobs: { job_1: { request, fallbackFrom: { provider: 'mock', model: 'mock' } } } } as unknown as UiState
    expect(madeWith(doc, ui, 'job_1')).toEqual({
      made: { provider: 'runway', model: 'veo3.1' },
      label: 'Veo 3.1 (runway) · Made on Runway: Mock could not',
      fallback: 'Made on Runway: Mock could not',
    })
    // a pick from before fallbackFrom was kept
    const picked = { jobs: { job_1: { request: { ...request, modelChoice: { provider: 'mock', model: 'mock-hq' } } } } } as unknown as UiState
    expect(madeWith(doc, picked, 'job_1').fallback).toBe('Made on Runway: Mock could not')
    expect(madeWith(doc, { jobs: {} } as unknown as UiState, 'job_1')).toEqual({ made: { provider: 'runway', model: 'veo3.1' }, label: 'Veo 3.1 (runway)' })
    expect(madeWith(doc, ui, undefined)).toEqual({})
    expect(modelLabel('runway', 'gemini_image3.1_flash')).toBe('Gemini 3.1 Flash')
    expect(fellBack({ provider: 'runway', model: 'veo3.1' }, 'runway')).toBeUndefined()
  })

  it('names a job a document recorded on a provider no longer routed as it was recorded', () => {
    // madeBy is free text (common.schema.json): older projects keep the provider that made them.
    const job = { id: 'job_1', op: 'clip', state: 'completed', provider: 'oldco', model: 'old-model', parent_ids: [], input_hashes: [], created_at: '2026-10-08T00:00:00Z' } as unknown as DocJob
    const doc = { jobs: { job_1: job } } as unknown as ProductionDocument
    expect(madeWith(doc, { jobs: {} } as unknown as UiState, 'job_1')).toEqual({ made: { provider: 'oldco', model: 'old-model' }, label: 'old-model (oldco)' })
    expect(modelLabel('oldco', 'old-model')).toBe('old-model')
  })
})
