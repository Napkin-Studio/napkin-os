import { describe, expect, it } from 'vitest'
import type { JobRequest } from '../contracts/types'
import { sha256Of } from '../lib/hash'
import { newId } from '../lib/ulid'
import { makeAjv, SCHEMA } from '../test/schemas'
import { MockRelay, type MockRenderer } from './mock'

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

const request = (op: JobRequest['op'] = 'generate', text = 'make it'): JobRequest => ({ contractVersion: '1', jobId: newId('job'), op, parentIds: [], input: { text, script: 'Rain. Smile.', targetS: 15 } })

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
    expect(validateJob(job), JSON.stringify(validateJob.errors)).toBe(true)
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
