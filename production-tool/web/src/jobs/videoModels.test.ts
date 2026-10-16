// Clips that carry characters, and edits with pictures (features/runway-video-models.clan). The owner's
// baby never reached the video: a clip with no frame went as words. The menus list the new Runway models
// (no tiering, no prices), a pick is sent, a clip with no frame sends its shot's pictures, and Change the
// feel sends the pictures its words name with the model picked for it.

import { describe, expect, it, vi } from 'vitest'
import { choiceToSend, modelChoicesFor } from '../capabilities'
import { CONFIGS } from '../contracts/load'
import type { JobInput, ModelChoice, ProductionDocument } from '../contracts/types'
import { loadJson } from '../test/schemas'
import { changeFeel, makeClip } from './clips'

vi.mock('./assets', () => ({ assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }) }))

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const SHOT = 'shot_01K7A000000000000000000015'
const TAKE = 'take_01K7A000000000000000000024'
const KEY = 'key_01M5BABY000000000000000000'
const sha = (c: string) => `sha256:${c.repeat(64)}`
const live = CONFIGS.live
const STYLISED = 'Stylised characters only: Seedance refuses photoreal faces'

function baby(): ProductionDocument {
  const d = structuredClone(ex)
  d.keys = { ...d.keys, [KEY]: { id: KEY, v: 1, field_v: {}, key: 'baby', role: 'character' } }
  d.refs = {
    ref_baby_front: { id: 'ref_baby_front', v: 1, field_v: {}, key: 'baby', variant: 'front', role: 'character', asset: sha('1') },
    ref_hat: { id: 'ref_hat', v: 1, field_v: {}, key: 'hat', variant: 'front', role: 'prop', asset: sha('3') },
  }
  d.links = {}
  d.shots[SHOT] = { ...d.shots[SHOT], action: '@baby grabs a handful of cereal and smiles.', refs: [KEY] }
  return d
}

function deps(d: ProductionDocument) {
  const submit = vi.fn(async () => 'job_1')
  return { submit, deps: { relay: {} as never, doc: { get: () => d } as never, ui: { get: () => ({}) } as never, runner: { submit } as never } }
}

describe('the Model menu offers the new Runway models', () => {
  it('lists every clip model after Veo, with its note and no price', () => {
    const clip = modelChoicesFor('clip', live)
    // Kling O3 and Kling 3.0 once each: Quality picks Standard or Pro (features/clip-quality.clan).
    expect(clip.map((o) => o.label)).toEqual(['Veo 3.1', 'Veo 3.1 Fast', 'Kling O3', 'Kling 3.0',
      'Hailuo 3', 'Gemini Omni Flash 1.1', 'WAN 3', 'Seedance 2.5', 'Seedance 2.0 Fast'])
    expect(clip.find((o) => o.label === 'Kling O3')?.members).toEqual(['klingO3_pro', 'klingO3_standard'])
    for (const o of clip.slice(2)) expect(o.note).toBeTruthy()
    expect(JSON.stringify(clip)).not.toMatch(/\$\s?\d|credit/i)
  })

  it('lists the clip-edit models after Aleph 2', () => {
    expect(modelChoicesFor('clip_edit', live).map((o) => o.model)).toEqual(
      ['aleph2', 'klingO3_standard', 'gemini_omni_flash_1.1', 'seedance2_5'])
  })

  it('says plainly that Seedance refuses photoreal faces', () => {
    for (const op of ['clip', 'clip_edit'] as const) {
      for (const o of modelChoicesFor(op, live).filter((x) => x.model.startsWith('seedance'))) expect(o.note).toBe(STYLISED)
    }
  })

  it('sends a pick of a new model, and none for the default', () => {
    expect(choiceToSend('clip', live, { provider: 'runway', model: 'hailuo3' })).toEqual({ provider: 'runway', model: 'hailuo3' })
    expect(choiceToSend('clip_edit', live, { provider: 'runway', model: 'aleph2' })).toBeUndefined()
    expect(choiceToSend('clip_edit', live, { provider: 'runway', model: 'klingO3_pro' })).toEqual({ provider: 'runway', model: 'klingO3_pro' })
  })
})

describe('the requests', () => {
  it('a clip with no frame sends its shot’s character pictures and the pick', async () => {
    const d = baby()
    d.frames = {}
    const { submit, deps: dd } = deps(d)
    const pick: ModelChoice = { provider: 'runway', model: 'hailuo3' }
    await makeClip(dd, SHOT, { fromWords: true, modelChoice: pick })
    const [op, input, , , , choice] = submit.mock.calls[0] as unknown as [string, JobInput, unknown, unknown, unknown, ModelChoice]
    expect(op).toBe('clip')
    expect(input.image).toBeUndefined()
    expect(input.refs?.map((r) => r.name)).toEqual(['baby_front'])
    expect(choice).toEqual(pick)
  })

  it('Change the feel sends the pictures its words name and the model picked for it', async () => {
    const d = baby()
    const { submit, deps: dd } = deps(d)
    const pick: ModelChoice = { provider: 'runway', model: 'klingO3_standard' }
    await changeFeel(dd, SHOT, d.takes[TAKE], 'put @hat_front on her head', {}, pick)
    const [op, input, parents, purpose, , choice] = submit.mock.calls[0] as unknown as [string, JobInput, string[], unknown, unknown, ModelChoice]
    expect(op).toBe('clip_edit')
    expect(input.video?.sha256).toBe(d.takes[TAKE].asset)
    expect(input.refs?.map((r) => r.name)).toEqual(['hat_front'])
    expect(input.feel).toEqual({})
    expect(parents).toEqual([d.takes[TAKE].job_id])
    expect(purpose).toEqual({ for: 'clip', shotId: SHOT, parentTakeId: TAKE })
    expect(choice).toEqual(pick)
  })

  it('Change the feel with no names sends no pictures and, on the default, no pick', async () => {
    const d = baby()
    const { submit, deps: dd } = deps(d)
    await changeFeel(dd, SHOT, d.takes[TAKE], 'make it dusk', { strength: 'flex' })
    const [, input, , , , choice] = submit.mock.calls[0] as unknown as [string, JobInput, unknown, unknown, unknown, ModelChoice | undefined]
    expect(input.refs).toBeUndefined()
    expect(input.feel).toEqual({ strength: 'flex' })
    expect(choice).toBeUndefined()
  })
})
