import { describe, expect, it } from 'vitest'
import type { JobRequest } from '../contracts/types'
import { sha256Of } from '../lib/hash'
import { newId } from '../lib/ulid'
import { makeAjv, SCHEMA } from '../test/schemas'
import { MOCK_TENANT, MockRelay, mockShotList, type MockRenderer } from './mock'

function setup() {
  let t = 1_000_000
  const blobs = new Map<string, Blob>()
  let renders = 0
  const renderer: MockRenderer = {
    async render() {
      renders++
      return [{ blob: new Blob([`img-${renders}`], { type: 'image/png' }), mime: 'image/png', w: 10, h: 10 }]
    },
  }
  const relay = new MockRelay({
    renderer,
    now: () => t,
    delayMs: 2000,
    persistKey: null,
    putOutput: async (b) => {
      const sha = await sha256Of(b)
      blobs.set(sha, b)
      return sha
    },
    getInput: async (sha) => blobs.get(sha),
  })
  return { relay, advance: (ms: number) => (t += ms), renders: () => renders }
}

const PROJECT = 'proj_01K6XA7Q3M9V2D4R8T0B5C1E6F'
const request = (op: JobRequest['op'] = 'generate', text = 'make it', input: JobRequest['input'] = {}): JobRequest => {
  const jobId = newId('job')
  return {
    contractVersion: '3', jobId, op, projectId: PROJECT, nonce: `n${jobId.slice(-12)}`, purpose: op, node: { kind: 'group', id: jobId },
    parentIds: [], input: { text, script: 'Rain. Smile.', targetS: 15, ...input },
  }
}

describe('mock relay', () => {
  const validateJob = makeAjv().compile({ $ref: SCHEMA('relay-api') + '#/$defs/Job' })

  it('is idempotent on jobId: the same id returns the same job and renders once', async () => {
    const { relay, advance, renders } = setup()
    const req = request()
    const a = await relay.createJob(req)
    const b = await relay.createJob({ ...req, input: { text: 'something else' } })
    expect(b.jobId).toBe(a.jobId)
    expect(b.createdAt).toBe(a.createdAt)
    expect(a.state).toBe('queued')
    expect(a.queuePosition).toBeGreaterThanOrEqual(1)
    advance(2100)
    await relay.getJob(req.jobId)
    await relay.settled()
    const done = await relay.createJob(req)
    expect(done.state).toBe('completed')
    expect(done.kind).toBe('mock')
    expect(done.outputs).toHaveLength(1)
    await relay.createJob(req)
    await relay.getJob(req.jobId)
    expect(renders()).toBe(1)
    expect(validateJob(done), JSON.stringify(validateJob.errors)).toBe(true)
    expect(validateJob(a), JSON.stringify(validateJob.errors)).toBe(true)
  })

  it('returns a shot list that sums to the target', async () => {
    const { relay, advance } = setup()
    const req = request('shot_list')
    await relay.createJob(req)
    advance(5000)
    await relay.getJob(req.jobId)
    await relay.settled()
    const job = await relay.getJob(req.jobId)
    expect(job.state).toBe('completed')
    expect(job.shots!.reduce((s, x) => s + x.duration_s, 0)).toBe(15)
    expect(job.shots![0]).toMatchObject({ kind: 'shot', camera: { size: 'wide' }, action: 'Rain.', refs: [] })
    expect(job.crew).toBe('dex')
    expect(validateJob(job), JSON.stringify(validateJob.errors)).toBe(true)
  })

  it('names the project, tenant, starter, crew, node, nonce and purpose of every job', async () => {
    const { relay } = setup()
    const req = request('frame')
    const job = await relay.createJob(req)
    expect(job).toMatchObject({
      contractVersion: '3', projectId: PROJECT, tenantId: MOCK_TENANT.id, startedBy: 'human:p_mock000', crew: 'wren',
      node: req.node, nonce: req.nonce, purpose: 'frame',
    })
  })

  it('refuses a request of another contract', async () => {
    const { relay } = setup()
    const old = { ...request(), contractVersion: '2' } as unknown as JobRequest
    await expect(relay.createJob(old)).rejects.toMatchObject({ status: 400, error: { code: 'invalid_input', message: 'This build reads contract 3; reload the page.' } })
  })

  it('[ask] stops the job at needs_input with a nudge; the answer resumes the same job; a second answer gets the winner', async () => {
    const { relay, advance } = setup()
    const req = request('shot_list', 'plan it [ask]')
    await relay.createJob(req)
    advance(1000)
    const asking = await relay.getJob(req.jobId)
    expect(asking.state).toBe('needs_input')
    const q = asking.question!
    expect(q).toMatchObject({ kind: 'nudge', recommended_option_id: 'wide' })
    expect(q.options).toHaveLength(2)
    expect(q.id).toMatch(/^q_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(validateJob(asking), JSON.stringify(validateJob.errors)).toBe(true)
    advance(10_000)
    expect((await relay.getJob(req.jobId)).state).toBe('needs_input') // it waits for a person

    const r = await relay.answerJob(req.jobId, { contractVersion: '3', questionId: q.id, optionId: 'close' })
    expect('job' in r && r.job).toMatchObject({ jobId: req.jobId, answeredBy: 'human:p_mock000', answer: { option_id: 'close' } })
    advance(5000)
    await relay.getJob(req.jobId)
    await relay.settled()
    const done = await relay.getJob(req.jobId)
    expect(done.state).toBe('completed')
    expect(done.shots!.length).toBeGreaterThan(0)

    const again = await relay.answerJob(req.jobId, { contractVersion: '3', questionId: q.id, text: 'Neither' }, 'human:p_sai0001')
    expect(again).toEqual({ conflict: { error: expect.objectContaining({ code: 'conflict' }), answeredBy: 'human:p_mock000', answer: { option_id: 'close' } } })
    if ('conflict' in again) expect(makeAjv().compile({ $ref: SCHEMA('relay-api') + '#/$defs/AnswerConflict' })(again.conflict)).toBe(true)
  })

  it("[ask] in a write's lines stops Skye's draft at needs_input, as the relay's passthrough does", async () => {
    const { relay, advance } = setup()
    const target = { kind: 'scene' as const, id: newId('scene') }
    const write = { intent: 'draft' as const, target, base_hash: `sha256:${'d'.repeat(64)}`, lines: [{ type: 'action' as const, text: 'A jogger [ask]' }], context: { target_s: 15, neighbours: '', refs: [] } }
    const req = { ...request('write', '', { write }), node: { kind: 'script' as const, id: newId('script') }, input: { write } }
    await relay.createJob(req)
    advance(1000)
    const asking = await relay.getJob(req.jobId)
    expect(asking.state).toBe('needs_input')
    expect(validateJob(asking), JSON.stringify(validateJob.errors)).toBe(true)
  })

  it('a re-plan keeps the ids of the shots it was sent', async () => {
    const { relay, advance } = setup()
    const shots = [{ id: 'shot_01K6XA7Q3M9V2D4R8T0B5C1E6F', kind: 'shot' as const, duration_s: 5, camera: { size: 'wide' as const }, action: 'Rain.', refs: [] }]
    const req = request('shot_list', 'again', { shots })
    await relay.createJob(req)
    advance(5000)
    await relay.getJob(req.jobId)
    await relay.settled()
    const job = await relay.getJob(req.jobId)
    expect(job.shots![0].id).toBe(shots[0].id)
    expect(job.shots![1].id).toBeUndefined()
  })

  it('uses each sentence once: fewer sentences make fewer shots, one sentence splits at a clause, more share shots', () => {
    const two = mockShotList('@maya_front walks into a sunny kitchen and smiles. She tastes the soup and nods.', 15)
    expect(two.map((s) => s.action)).toEqual(['@maya_front walks into a sunny kitchen and smiles.', 'She tastes the soup and nods.'])
    expect(two.reduce((a, s) => a + s.duration_s, 0)).toBe(15)
    expect(mockShotList('She tastes the soup and nods.', 15).map((s) => s.action)).toEqual(['She tastes the soup', 'Nods.'])
    expect(mockShotList('One. Two. Three. Four. Five.', 10).map((s) => s.action)).toEqual(['One. Two. Three.', 'Four. Five.'])
  })

  it('a re-plan with new words keeps the shots whose words are still there, in order, and adds the new ones after', () => {
    const first = mockShotList('A. B. B.', 15).map((s, i) => ({ ...s, id: `shot_01K6XA7Q3M9V2D4R8T0B5C1E6${i}` }))
    expect(first.map((s) => s.action)).toEqual(['A.', 'B.', 'B.'])
    const script = ['She waves goodbye at the door.', ...first.map((s) => s.action)].join('\n')
    const again = mockShotList(script, 15, [], first.map((s) => ({ id: s.id!, action: s.action, camera: s.camera, kind: s.kind, refs: [] })))
    expect(again.slice(0, 3).map((s) => [s.id, s.action, s.camera])).toEqual(first.map((s) => [s.id, s.action, s.camera]))
    expect(again[3]).toMatchObject({ action: 'She waves goodbye at the door.' })
    expect(again[3].id).toBeUndefined()
    expect(again.reduce((a, s) => a + s.duration_s, 0)).toBe(15)
  })

  it('the stitch leaves out clips marked endCard', async () => {
    let seen: JobRequest | null = null
    const relay = new MockRelay({
      renderer: { async render(r) { seen = r; return [{ blob: new Blob(['ad'], { type: 'video/mp4' }), mime: 'video/mp4' }] } },
      now: () => 10_000_000, delayMs: 0, persistKey: null, putOutput: sha256Of, getInput: async () => undefined,
    })
    const clip = (c: string, endCard = false) => ({ asset: { sha256: `sha256:${c.repeat(64)}`, url: 'https://x.invalid/c', mime: 'video/mp4' as const }, trimS: 2, ...(endCard ? { endCard } : {}) })
    const req = request('stitch', '', { clips: [clip('a'), clip('b'), clip('c', true)] })
    await relay.createJob(req)
    await relay.getJob(req.jobId)
    await relay.settled()
    expect(seen!.input.clips!.map((c) => c.asset.sha256)).toEqual([clip('a').asset.sha256, clip('b').asset.sha256])
  })

  it('fails on #fail (retryable) and #moderate (not retryable)', async () => {
    const { relay, advance } = setup()
    const a = request('generate', 'go #fail')
    const b = request('generate', 'go #moderate')
    await relay.createJob(a)
    await relay.createJob(b)
    advance(3000)
    await relay.getJob(a.jobId)
    await relay.getJob(b.jobId)
    await relay.settled()
    const ja = await relay.getJob(a.jobId)
    const jb = await relay.getJob(b.jobId)
    expect(ja.state).toBe('failed')
    expect(ja.error?.retryable).toBe(true)
    expect(jb.error?.code).toBe('moderated')
    expect(jb.error?.retryable).toBe(false)
  })

  it('cancels', async () => {
    const { relay } = setup()
    const req = request()
    await relay.createJob(req)
    const job = await relay.cancelJob(req.jobId)
    expect(job.state).toBe('cancelled')
  })
})

describe('the mock workspace library', () => {
  const sha = (c: string) => `sha256:${c.repeat(64)}`
  const ref = (variant: string, c: string) => ({ variant, asset: { sha256: sha(c), url: `https://mock.napkin.invalid/in/${sha(c)}`, mime: 'image/png' as const } })
  const validate = (def: string) => makeAjv().compile({ $ref: SCHEMA('relay-api') + `#/$defs/${def}` })

  it('publishes versions, lists the latest with its front as cover, and refuses an out-of-date publish', async () => {
    const { relay } = setup()
    expect(validate('Me')(await relay.me())).toBe(true)
    const v1 = await relay.publish('maya', { kind: 'key', role: 'character', baseVer: 0, refs: [ref('side', 'b'), ref('front', 'a')] })
    expect(validate('LibraryEntry')(v1)).toBe(true)
    const v2 = await relay.publish('maya', { kind: 'key', role: 'character', baseVer: 1, refs: [ref('front', 'c')] })
    expect(v2.ver).toBe(2)
    const index = await relay.library()
    expect(validate('LibraryIndex')(index)).toBe(true)
    expect(index.keys).toEqual([expect.objectContaining({ key: 'maya', ver: 2, variants: ['front'], cover: ref('front', 'c').asset })])
    expect((await relay.libraryEntry('maya', 1)).refs!.map((r) => r.variant)).toEqual(['side', 'front'])
    await expect(relay.publish('maya', { kind: 'key', role: 'character', baseVer: 1, refs: [ref('front', 'd')] })).rejects.toMatchObject({ error: { code: 'conflict' } })
    await expect(relay.libraryEntry('lamp')).rejects.toMatchObject({ status: 404 })
  })
})
