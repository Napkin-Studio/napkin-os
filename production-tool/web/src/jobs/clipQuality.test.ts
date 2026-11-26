// Clip quality: Draft, Standard and Final (features/clip-quality.clan). The web resolves a level the way the
// relay does (contracts/examples/quality-cases.json), greys what a model cannot make and says why, sends the
// video's default or the pick with every clip and clip edit, records the level and size on the take, and
// Remake as Final asks the relay to remake a draft from its own request.

import { describe, expect, it, vi } from 'vitest'
import { qualityLabel, qualityOptions, resolveQuality, sizeLabel } from '../capabilities'
import { CONFIGS } from '../contracts/load'
import type { ClipQuality, Config, Job, ProductionDocument, Provider } from '../contracts/types'
import { SnapshotStore } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { loadJson } from '../test/schemas'
import { snapshotDoc } from '../test/jobFixtures'
import { changeFeel, editQuality, makeClip, remakeAsFinal, shotQuality, videoQuality } from './clips'
import { applyTake } from './handlers'
import { JobRunner } from './runner'

vi.mock('./assets', () => ({ assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }) }))

interface Case { sheet: Provider; op: 'clip' | 'clip_edit'; model: string | null; level: string | null; want: { model: string; level: ClipQuality | null; tier: string | null } }
const CASES = loadJson<{ cases: Case[] }>('examples/quality-cases.json').cases
const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const SHOT = 'shot_01K7A000000000000000000015'
const TAKE = 'gen_01K7A000000000000000000024'
const VIDEO = 'video_01K7A000000000000000000027'
const live: Config = CONFIGS.live
const mockClip: Config = { ...live, routing: { ...live.routing, clip: ['mock', 'runway'], clip_edit: ['mock', 'runway'] } }

function doc(): ProductionDocument {
  const d = structuredClone(ex)
  d.frames = {}
  d.refs = {}
  d.links = {}
  d.shots[SHOT] = { ...d.shots[SHOT], action: 'The bottle opens.', refs: [] }
  return d
}

function deps(d: ProductionDocument, jobs: UiState['jobs'] = {}) {
  const submit = vi.fn(async () => 'job_1')
  return { submit, deps: { relay: {} as never, doc: { get: () => d } as never, ui: { get: () => ({ jobs }) } as never, runner: { submit } as never } }
}

describe('the resolver, as the relay answers', () => {
  for (const c of CASES) {
    it(`${c.sheet} ${c.op} ${c.model} at ${c.level}`, () => {
      const got = resolveQuality(c.op, c.sheet, c.model ?? undefined, c.level)
      expect({ model: got.model, level: got.level ?? null, tier: got.tier ?? null }).toEqual(c.want)
    })
  }

  it('says sizes as people read them', () => {
    expect(sizeLabel('2k')).toBe('2K')
    expect(qualityLabel('final', '2k')).toBe('Final 2K')
    expect(qualityLabel('draft', '360p')).toBe('Draft 360p')
    expect(qualityLabel(undefined, '720p')).toBeUndefined()
  })
})

describe('the Quality choice beside Model', () => {
  const on = (op: 'clip' | 'clip_edit', model: string, provider: Provider = 'runway', config = live) =>
    qualityOptions(op, { provider, model }, config).map((o) => (o.on ? `${o.level} ${o.size}` : `${o.level}: ${o.why}`))

  it('gives each level the size the model makes', () => {
    expect(on('clip', 'gemini_omni_flash_1.1')).toEqual(['draft 360p', 'standard 720p', 'final 1080p'])
    expect(on('clip', 'hailuo3')).toEqual(['draft 768p', 'standard 768p', 'final 2K'])
    expect(on('clip', 'seedance2_fast')).toEqual(['draft 480p', 'standard 720p', 'final 720p'])
  })

  it('treats a Kling family as one model whose Final is Pro', () => {
    expect(on('clip', 'klingO3_standard')).toEqual(['draft 720p', 'standard 720p', 'final 1080p'])
    expect(resolveQuality('clip', 'runway', 'klingO3_standard', 'final').model).toBe('klingO3_pro')
    expect(on('clip_edit', 'klingO3_standard')).toEqual(['draft 720p', 'standard 720p', 'final 1080p'])
  })

  it('greys what a model cannot make, and says why', () => {
    expect(on('clip', 'mock-hq', 'mock', mockClip)).toEqual([
      'draft: Mock HQ makes one size, 1080p', 'standard: Mock HQ makes one size, 1080p', 'final 1080p'])
    expect(on('clip_edit', 'aleph2')).toEqual(["draft: Aleph 2 keeps the clip's own size", "standard: Aleph 2 keeps the clip's own size",
      "final: Aleph 2 keeps the clip's own size"])
    expect(on('clip_edit', 'seedance2_5')[2]).toBe("final: Seedance 2.5 keeps the clip's own size")
  })

  it('never says a price', () => {
    const all = JSON.stringify(['clip', 'clip_edit'].flatMap((op) => ['veo3.1', 'klingO3_standard', 'hailuo3', 'aleph2', 'seedance2_5']
      .map((m) => qualityOptions(op as 'clip', { provider: 'runway', model: m }, live))))
    expect(all).not.toMatch(/\$|credit|USD/i)
  })
})

describe('what is sent', () => {
  it("a clip goes at its video's default, and a pick overrides it", async () => {
    const d = doc()
    expect(videoQuality(d, VIDEO)).toBe('standard')
    d.videos[VIDEO].quality = 'draft'
    expect(shotQuality(d, SHOT)).toBe('draft')
    const { submit, deps: dd } = deps(d)
    await makeClip(dd, SHOT, { fromWords: true })
    await makeClip(dd, SHOT, { fromWords: true, quality: 'final' })
    const extras = submit.mock.calls.map((c) => (c as unknown[])[6] as { quality?: ClipQuality })
    expect(extras.map((e) => e.quality)).toEqual(['draft', 'final'])
  })

  it('a video with no default makes Standard, today\'s size', async () => {
    const d = doc()
    delete d.videos[VIDEO].quality
    const { submit, deps: dd } = deps(d)
    await makeClip(dd, SHOT, { fromWords: true })
    expect(((submit.mock.calls[0] as unknown[])[6] as { quality: ClipQuality }).quality).toBe('standard')
  })

  it('Change the feel sends the clip\'s shape and the level; on a model that keeps the size, the clip\'s own', async () => {
    const d = doc()
    const take = { ...d.generations[TAKE], inputs: { ...d.generations[TAKE].inputs, quality: 'final' as const, size: '1080p' } }
    const { submit, deps: dd } = deps(d)
    await changeFeel(dd, SHOT, take, 'make it dusk', {}, { provider: 'runway', model: 'gemini_omni_flash_1.1' }, 'draft')
    const [, input, , , , , extras] = submit.mock.calls[0] as unknown as [string, { ratio?: string }, unknown, unknown, unknown, unknown, { quality: ClipQuality }]
    expect(input.ratio).toBe('16:9')
    expect(extras.quality).toBe('draft')
    expect(editQuality(take, { provider: 'runway', model: 'seedance2_5' }, 'draft')).toBe('final')
    expect(editQuality(take, { provider: 'runway', model: 'aleph2' }, 'draft')).toBe('final')
    expect(editQuality(take, { provider: 'runway', model: 'klingO3_standard' }, 'draft')).toBe('draft')
  })

  it('Remake as Final asks the relay to remake the draft from its own request', async () => {
    const d = doc()
    const take = { ...d.generations[TAKE], inputs: { ...d.generations[TAKE].inputs, quality: 'draft' as const, size: '480p' } }
    const held = { request: { input: { text: 'the bottle opens' }, modelChoice: { provider: 'runway', model: 'seedance2_5' } } }
    const { submit, deps: dd } = deps(d, { [take.job_id!]: held } as never)
    await remakeAsFinal(dd, take)
    const [op, input, parents, purpose, , choice, extras] = submit.mock.calls[0] as unknown as unknown[]
    expect(op).toBe('clip')
    expect(input).toEqual({ text: 'the bottle opens' })
    expect(parents).toEqual([take.job_id])
    expect(purpose).toEqual({ for: 'clip', shotId: SHOT, parentTakeId: TAKE })
    expect(choice).toEqual({ provider: 'runway', model: 'seedance2_5' })
    expect(extras).toEqual({ quality: 'final', promoteFrom: take.job_id })
  })
})

describe('the request and the take', () => {
  function runner() {
    const ok = { contractVersion: '3', state: 'submitted', quotaClass: 'video', inputHashes: [], cost: { currency: 'USD', unknown: true }, createdAt: '', updatedAt: '', participantId: 'p_x', nextPollS: 600 }
    const relay = { kind: 'http', createJob: vi.fn(async (req: { jobId: string; op: string }) => ({ ...ok, op: req.op, jobId: req.jobId })), getJob: vi.fn(), cancelJob: vi.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { relay, run: new JobRunner(relay as any, snapshotDoc(), new SnapshotStore<UiState>(initialUi())) }
  }

  it('carries quality and promoteFrom on clips only, and Retry keeps them', async () => {
    const { relay, run } = runner()
    await run.submit('clip', { text: 'x' }, [], { for: 'canvas' }, undefined, undefined, { quality: 'draft' })
    await run.submit('view', { view: 'back' }, [], { for: 'canvas' }, undefined, undefined, { quality: 'final', promoteFrom: 'job_x' })
    const sent = relay.createJob.mock.calls.map((c) => c[0] as unknown as { quality?: string; promoteFrom?: string })
    expect(sent[0].quality).toBe('draft')
    expect(sent[1].quality).toBeUndefined()
    expect(sent[1].promoteFrom).toBeUndefined()
  })

  it('a take says what the relay made, and an edit that keeps the size says its source\'s', () => {
    const d = doc()
    const job = { jobId: 'job_01K7A0000000000000000000ZZ', op: 'clip', model: 'gemini_omni_flash_1.1', provider: 'runway', kind: 'generated',
      quality: { level: 'draft', size: '360p' }, outputs: [{ sha256: `sha256:${'a'.repeat(64)}`, url: 'https://x/y.mp4', mime: 'video/mp4', durationS: 5 }] } as unknown as Job
    const take = applyTake(d, job, { shotId: SHOT })!
    expect([take.inputs?.quality, take.inputs?.size, qualityLabel(take.inputs?.quality, take.inputs?.size)]).toEqual(['draft', '360p', 'Draft 360p'])
    const edit = { ...job, jobId: 'job_01K7A0000000000000000000ZY', op: 'clip_edit', model: 'aleph2', quality: undefined,
      outputs: [{ ...job.outputs![0], sha256: `sha256:${'b'.repeat(64)}` }] } as unknown as Job
    const edited = applyTake(d, edit, { shotId: SHOT, parentTakeId: take.id })!
    expect([edited.inputs?.quality, edited.inputs?.size]).toEqual(['draft', '360p'])
  })
})
