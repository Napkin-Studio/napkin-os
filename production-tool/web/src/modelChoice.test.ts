import { describe, expect, it } from 'vitest'
import { choiceToSend, modelChoicesFor, modelLabel } from './capabilities'
import { CONFIGS } from './contracts/load'
import type { Config, DocJob, ProductionDocument } from './contracts/types'
import type { UiState } from './doc/ui'
import { fellBack, madeWith, otherModels, price, startingChoice } from './ui/modelChoice'

// features/model-choice.clan, features/runway-fallback.clan: the regenerate menu always offers
// Runway's models (the floor of every job); a config that routes more providers lists them in order.
const live: Config = CONFIGS.live
const both: Config = { ...live, routing: { ...live.routing, frame: ['mock', 'runway'], clip: ['mock', 'runway'] } }
const keys = (c: Config, op: 'frame' | 'clip') => modelChoicesFor(op, c).map((o) => `${o.provider}:${o.model}`)

describe('the regenerate menu', () => {
  it('offers Runway alone on the live config: its default, then its alternates', () => {
    expect(keys(live, 'frame')).toEqual(['runway:gemini_image3_pro', 'runway:gemini_image3.1_flash'])
    expect(keys(live, 'clip')).toEqual(['runway:veo3.1', 'runway:veo3.1_fast'])
  })

  it('lists each routed provider as its jobs run, each model then its alternates', () => {
    expect(keys(both, 'frame')).toEqual(['mock:mock', 'mock:mock-hq', 'runway:gemini_image3_pro', 'runway:gemini_image3.1_flash'])
    expect(keys(both, 'clip')).toEqual(['mock:mock', 'mock:mock-hq', 'runway:veo3.1', 'runway:veo3.1_fast'])
  })

  it('carries labels and estimates from the sheets', () => {
    expect(modelChoicesFor('frame', live).find((o) => o.model === 'gemini_image3.1_flash')).toMatchObject({ label: 'Gemini 3.1 Flash', estimateUsd: 0.07 })
    expect(modelChoicesFor('clip', live)[0]).toMatchObject({ label: 'Veo 3.1', estimateUsd: 1.2 })
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

  it('shows prices plainly', () => {
    expect(price(0.028)).toBe('~$0.028')
    expect(price(2.4)).toBe('~$2.40')
    expect(price(null)).toBe('price not published')
  })

  it('names the model a job ran on, and says when it was made on Runway instead', () => {
    const job = { id: 'job_1', op: 'clip', state: 'completed', provider: 'runway', model: 'veo3.1', parent_ids: [], input_hashes: [], created_at: '2026-10-08T00:00:00Z' } as DocJob
    const doc = { jobs: [job] } as unknown as ProductionDocument
    const request = { contractVersion: '2', jobId: 'job_1', op: 'clip', parentIds: [], input: {} }
    // no pick: the relay's fallbackFrom says the mock could not
    const ui = { jobCtx: { job_1: { for: 'clip', shotId: 's', request, fallbackFrom: { provider: 'mock', model: 'mock' } } } } as unknown as UiState
    expect(madeWith(doc, ui, 'job_1')).toEqual({
      made: { provider: 'runway', model: 'veo3.1' },
      label: 'Veo 3.1 (runway) · Made on Runway: Mock could not',
      fallback: 'Made on Runway: Mock could not',
    })
    // a pick from before fallbackFrom was kept
    const picked = { jobCtx: { job_1: { for: 'clip', shotId: 's', request: { ...request, modelChoice: { provider: 'mock', model: 'mock-hq' } } } } } as unknown as UiState
    expect(madeWith(doc, picked, 'job_1').fallback).toBe('Made on Runway: Mock could not')
    expect(madeWith(doc, { jobCtx: {} } as unknown as UiState, 'job_1')).toEqual({ made: { provider: 'runway', model: 'veo3.1' }, label: 'Veo 3.1 (runway)' })
    expect(madeWith(doc, ui, undefined)).toEqual({})
    expect(modelLabel('runway', 'gemini_image3.1_flash')).toBe('Gemini 3.1 Flash')
    expect(fellBack({ provider: 'runway', model: 'veo3.1' }, 'runway')).toBeUndefined()
  })

  it('names a job a document recorded on a provider no longer routed as it was recorded', () => {
    // madeBy is free text (common.schema.json): older projects keep the provider that made them.
    const job = { id: 'job_1', op: 'clip', state: 'completed', provider: 'oldco', model: 'old-model', parent_ids: [], input_hashes: [], created_at: '2026-10-08T00:00:00Z' } as DocJob
    const doc = { jobs: [job] } as unknown as ProductionDocument
    expect(madeWith(doc, { jobCtx: {} } as unknown as UiState, 'job_1')).toEqual({ made: { provider: 'oldco', model: 'old-model' }, label: 'old-model (oldco)' })
    expect(modelLabel('oldco', 'old-model')).toBe('old-model')
  })
})
