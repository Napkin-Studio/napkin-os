import { describe, expect, it } from 'vitest'
import { choiceToSend, modelChoicesFor, modelLabel } from './capabilities'
import { CONFIGS } from './contracts/load'
import type { Config, DocJob, ProductionDocument } from './contracts/types'
import type { UiState } from './doc/ui'
import { madeWith, otherModels, price, startingChoice } from './ui/modelChoice'

// features/model-choice.clan: the regenerate menu offers fal and HeyGen models; Runway is fallback only.
const event: Config = CONFIGS.event
const keys = (c: Config, op: 'frame' | 'clip') => modelChoicesFor(op, c).map((o) => `${o.provider}:${o.model}`)

describe('the regenerate menu', () => {
  it('lists each routed provider that is not fallback-only, own model first, then alternates', () => {
    expect(keys(event, 'frame')).toEqual(['fal:nano-banana-pro-edit', 'fal:kling-image-o3', 'fal:nano-banana-2-edit'])
    expect(keys(event, 'clip')).toEqual(['fal:kling-v3-pro-i2v', 'fal:veo3.1-fast-i2v', 'fal:veo3.1-i2v', 'heygen:heygen-video-1'])
  })

  it('offers Runway when the config does not name it fallback-only', () => {
    const open = { ...event, fallbackOnly: undefined }
    expect(keys(open, 'frame')).toContain('runway:gemini_image3_pro')
  })

  it('carries labels, notes and estimates from the sheets', () => {
    const pro = modelChoicesFor('frame', event).find((o) => o.model === 'nano-banana-pro-edit')!
    expect(pro).toMatchObject({ label: 'Nano Banana Pro', estimateUsd: 0.15 })
    expect(pro.note).toBeTruthy()
    expect(modelChoicesFor('clip', event).find((o) => o.provider === 'heygen')!.estimateUsd).toBeNull()
  })

  it('sends no pick for the routing default, so the job routes as before', () => {
    expect(choiceToSend('clip', event, { provider: 'fal', model: 'kling-v3-pro-i2v' })).toBeUndefined()
    expect(choiceToSend('clip', event, undefined)).toBeUndefined()
    expect(choiceToSend('clip', event, { provider: 'fal', model: 'veo3.1-i2v' })).toEqual({ provider: 'fal', model: 'veo3.1-i2v' })
  })

  it('starts on the model that made the version, else the default', () => {
    const options = modelChoicesFor('clip', event)
    expect(startingChoice(options, { provider: 'fal', model: 'veo3.1-i2v' })).toEqual({ provider: 'fal', model: 'veo3.1-i2v' })
    // a take made on Runway (a fallback) is not offered: start on the default
    expect(startingChoice(options, { provider: 'runway', model: 'veo3.1_fast' })).toEqual({ provider: 'fal', model: 'kling-v3-pro-i2v' })
  })

  it('offers a failed job every other model, another provider first, the failed one left out', () => {
    const open = { ...event, fallbackOnly: undefined }
    const options = modelChoicesFor('frame', open)
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

  it('names the model a job ran on, and says when it fell back', () => {
    const job = { id: 'job_1', op: 'clip', state: 'completed', provider: 'runway', model: 'veo3.1_fast', parent_ids: [], input_hashes: [], created_at: '2026-10-08T00:00:00Z' } as DocJob
    const doc = { jobs: [job] } as unknown as ProductionDocument
    const ui = { jobCtx: { job_1: { for: 'clip', shotId: 's', request: { contractVersion: '2', jobId: 'job_1', op: 'clip', parentIds: [], input: {}, modelChoice: { provider: 'fal', model: 'veo3.1-i2v' } } } } } as unknown as UiState
    expect(madeWith(doc, ui, 'job_1')).toEqual({
      made: { provider: 'runway', model: 'veo3.1_fast' },
      label: 'Veo 3.1 Fast (runway), because fal could not take Veo 3.1',
    })
    expect(madeWith(doc, { jobCtx: {} } as unknown as UiState, 'job_1').label).toBe('Veo 3.1 Fast (runway)')
    expect(madeWith(doc, ui, undefined)).toEqual({})
    expect(modelLabel('fal', 'nano-banana-2-edit')).toBe('Nano Banana 2')
  })
})
