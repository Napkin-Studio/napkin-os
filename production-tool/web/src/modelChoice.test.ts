import { describe, expect, it } from 'vitest'
import { choiceToSend, modelChoicesFor, modelLabel } from './capabilities'
import { CONFIGS, SHEETS } from './contracts/load'
import type { Config, DocJob, ProductionDocument } from './contracts/types'
import type { UiState } from './doc/ui'
import { withOwnKeys } from './keys/ownKeys'
import { fellBack, madeWith, otherModels, price, startingChoice } from './ui/modelChoice'

// features/model-choice.clan, features/runway-fallback.clan (2026-10-09): the regenerate menu always
// offers Runway's models (the event's only provider, the floor of every job), and the key providers'
// models first when the participant gave a fal or HeyGen key.
const event: Config = CONFIGS.event
const withKeys = (keys: { fal?: string; heygen?: string }) => withOwnKeys(event, keys, SHEETS)
const keys = (c: Config, op: 'frame' | 'clip') => modelChoicesFor(op, c).map((o) => `${o.provider}:${o.model}`)

describe('the regenerate menu', () => {
  it('with no keys offers Runway alone: its default, then its alternates', () => {
    expect(keys(event, 'frame')).toEqual(['runway:gemini_image3_pro', 'runway:gemini_image3.1_flash'])
    expect(keys(event, 'clip')).toEqual(['runway:veo3.1', 'runway:veo3.1_fast'])
  })

  it('with keys puts the key providers first, as they run, and keeps Runway', () => {
    expect(keys(withKeys({ fal: 'k' }), 'frame')).toEqual([
      'fal:nano-banana-pro-edit', 'fal:kling-image-o3', 'fal:nano-banana-2-edit', 'runway:gemini_image3_pro', 'runway:gemini_image3.1_flash'])
    expect(keys(withKeys({ heygen: 'k', fal: 'k' }), 'clip')).toEqual([
      'heygen:heygen-video-1', 'fal:veo3.1-fast-i2v', 'fal:kling-v3-pro-i2v', 'fal:veo3.1-i2v', 'runway:veo3.1', 'runway:veo3.1_fast'])
    // a fal key alone makes clips too (Veo 3.1 Fast first since 2026-10-09), Runway behind it
    expect(keys(withKeys({ fal: 'k' }), 'clip')).toEqual(['fal:veo3.1-fast-i2v', 'fal:kling-v3-pro-i2v', 'fal:veo3.1-i2v', 'runway:veo3.1', 'runway:veo3.1_fast'])
  })

  it('carries labels, notes and estimates from the sheets', () => {
    const pro = modelChoicesFor('frame', withKeys({ fal: 'k' })).find((o) => o.model === 'nano-banana-pro-edit')!
    expect(pro).toMatchObject({ label: 'Nano Banana Pro', estimateUsd: 0.15 })
    expect(pro.note).toBeTruthy()
    expect(modelChoicesFor('clip', withKeys({ heygen: 'k' })).find((o) => o.provider === 'heygen')!.estimateUsd).toBeNull()
    expect(modelChoicesFor('clip', event)[0]).toMatchObject({ label: 'Veo 3.1', estimateUsd: 1.2 })
  })

  it('sends no pick for the routing default, so the job routes as before', () => {
    expect(choiceToSend('clip', event, { provider: 'runway', model: 'veo3.1' })).toBeUndefined()
    expect(choiceToSend('clip', event, undefined)).toBeUndefined()
    expect(choiceToSend('clip', event, { provider: 'runway', model: 'veo3.1_fast' })).toEqual({ provider: 'runway', model: 'veo3.1_fast' })
    const both = withKeys({ heygen: 'k' })
    expect(choiceToSend('clip', both, { provider: 'heygen', model: 'heygen-video-1' })).toBeUndefined()
    expect(choiceToSend('clip', both, { provider: 'runway', model: 'veo3.1' })).toEqual({ provider: 'runway', model: 'veo3.1' })
  })

  it('starts on the model that made the version, else the default', () => {
    const options = modelChoicesFor('clip', withKeys({ heygen: 'k', fal: 'k' }))
    expect(startingChoice(options, { provider: 'fal', model: 'veo3.1-i2v' })).toEqual({ provider: 'fal', model: 'veo3.1-i2v' })
    // a take made on Runway is offered now: start there
    expect(startingChoice(options, { provider: 'runway', model: 'veo3.1_fast' })).toEqual({ provider: 'runway', model: 'veo3.1_fast' })
    // a take made with a key no longer given: start on the default
    expect(startingChoice(modelChoicesFor('clip', event), { provider: 'fal', model: 'veo3.1-i2v' })).toEqual({ provider: 'runway', model: 'veo3.1' })
  })

  it('offers a failed job every other model, another provider first, the failed one left out', () => {
    const options = modelChoicesFor('frame', withKeys({ fal: 'k' }))
    const failed = { provider: 'fal', model: 'nano-banana-pro-edit' } as const
    const others = otherModels(options, failed).map((o) => `${o.provider}:${o.model}`)
    expect(others).not.toContain('fal:nano-banana-pro-edit')
    expect(others[0].startsWith('fal:')).toBe(false)
    expect(others.filter((k) => k.startsWith('fal:'))).toEqual(['fal:kling-image-o3', 'fal:nano-banana-2-edit'])
    expect(others).toHaveLength(options.length - 1)
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
    // no pick: the relay's fallbackFrom says HeyGen could not
    const ui = { jobCtx: { job_1: { for: 'clip', shotId: 's', request, fallbackFrom: { provider: 'heygen', model: 'heygen-video-1' } } } } as unknown as UiState
    expect(madeWith(doc, ui, 'job_1')).toEqual({
      made: { provider: 'runway', model: 'veo3.1' },
      label: 'Veo 3.1 (runway) · Made on Runway: HeyGen could not',
      fallback: 'Made on Runway: HeyGen could not',
    })
    // a pick from before fallbackFrom was kept
    const picked = { jobCtx: { job_1: { for: 'clip', shotId: 's', request: { ...request, modelChoice: { provider: 'fal', model: 'veo3.1-i2v' } } } } } as unknown as UiState
    expect(madeWith(doc, picked, 'job_1').fallback).toBe('Made on Runway: fal could not')
    expect(madeWith(doc, { jobCtx: {} } as unknown as UiState, 'job_1')).toEqual({ made: { provider: 'runway', model: 'veo3.1' }, label: 'Veo 3.1 (runway)' })
    expect(madeWith(doc, ui, undefined)).toEqual({})
    expect(modelLabel('fal', 'nano-banana-2-edit')).toBe('Nano Banana 2')
    expect(fellBack({ provider: 'runway', model: 'veo3.1' }, 'runway')).toBeUndefined()
  })
})
