import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '../contracts/types'
import { emptyDocument, SnapshotDocumentStore, SnapshotStore } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { getBlob } from '../lib/blobs'
import { RelayError } from '../relay/types'
import { FETCH_AGAIN_S, FETCH_BACKOFF_S, JobRunner, LOST_RESENDS } from './runner'

// The Video stage test (2026-10-09, features/video-stage-findings.clan): a lost POST /jobs answer
// failed a clip the relay went on making; a relay restart left "No such job." with no Retry; an
// uncertain job was asked about every 2 s for ever; one failed download failed a paid clip; and a
// cancel while it downloaded landed it twice.

const SHA = 'sha256:' + 'ab'.repeat(32)

function job(jobId: string, state: Job['state'], extra: Partial<Job> = {}): Job {
  return {
    contractVersion: '2', jobId, state, op: 'clip', quotaClass: 'video', inputHashes: [], participantId: 'p_x',
    cost: { currency: 'USD', unknown: true }, createdAt: '', updatedAt: '', nextPollS: 5, ...extra,
  } as Job
}

const done = (jobId: string) => job(jobId, 'completed', {
  kind: 'generated',
  outputs: [{ sha256: SHA, url: 'https://cdn.test/out/x', mime: 'video/mp4', bytes: 3 }],
})

const lost = () => new RelayError({ code: 'provider_unavailable', message: 'Could not reach the server. Check your connection.', retryable: true })
const gone = () => new RelayError({ code: 'invalid_input', message: 'No such job.', retryable: false }, 404)

function setup() {
  const relay = {
    kind: 'http',
    createJob: vi.fn(async (req: { jobId: string }): Promise<Job> => job(req.jobId, 'submitted')),
    getJob: vi.fn(async (id: string): Promise<Job> => job(id, 'submitted')),
    cancelJob: vi.fn(async (id: string): Promise<Job> => job(id, 'cancelled')),
    fetchOutput: vi.fn(async () => new Blob(['mp4'], { type: 'video/mp4' })),
  }
  const doc = new SnapshotDocumentStore(emptyDocument({ id: 'p_x', handle: 'maya' }), null, 0)
  const ui = new SnapshotStore<UiState>(initialUi())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = new JobRunner(relay as any, doc, ui)
  const landed: string[] = []
  runner.onComplete('clip', (j) => landed.push(j.jobId))
  const submit = () => runner.submit('clip', { text: 'a clip' }, [], { for: 'clip', shotId: 'shot_1' } as never)
  const state = (id: string) => doc.get().jobs.find((j) => j.id === id)?.state
  return { relay, doc, ui, runner, landed, submit, state }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('a POST /jobs whose answer was lost', () => {
  it('stays queued and adopts the job the relay already had', async () => {
    const s = setup()
    s.relay.createJob.mockRejectedValueOnce(lost())
    const id = await s.submit()
    expect(s.state(id)).toBe('queued')
    await vi.advanceTimersByTimeAsync(3500)
    expect(s.relay.getJob).toHaveBeenCalledWith(id)
    expect(s.state(id)).toBe('submitted')
    expect(s.relay.createJob).toHaveBeenCalledTimes(1) // never paid twice
  })

  it('a gateway 504 sends the same request again when the relay never got it', async () => {
    const s = setup()
    s.relay.createJob.mockRejectedValueOnce(new RelayError({ code: 'internal', message: 'The server answered 504.', retryable: true }, 504))
    s.relay.getJob.mockRejectedValueOnce(gone())
    const id = await s.submit()
    await vi.advanceTimersByTimeAsync(3500)
    expect(s.relay.createJob).toHaveBeenCalledTimes(2)
    expect(s.relay.createJob.mock.calls[1][0]).toEqual(s.relay.createJob.mock.calls[0][0]) // same jobId
    expect(s.state(id)).toBe('submitted')
  })

  it('a refusal is final: the spend stop fails the job', async () => {
    const s = setup()
    s.relay.createJob.mockRejectedValueOnce(new RelayError({ code: 'spend_stop', message: "The event's generation budget is used up.", retryable: false }, 503))
    const id = await s.submit()
    expect(s.state(id)).toBe('failed')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(s.relay.getJob).not.toHaveBeenCalled()
  })

  it('gives up after a few resends to a relay that always errors, and offers Retry', async () => {
    const s = setup()
    s.relay.createJob.mockRejectedValue(lost())
    s.relay.getJob.mockRejectedValue(gone())
    const id = await s.submit()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.relay.createJob).toHaveBeenCalledTimes(1 + LOST_RESENDS)
    expect(s.state(id)).toBe('failed')
    expect(s.doc.get().jobs[0].error?.retryable).toBe(true)
  })
})

describe('a job the relay no longer knows', () => {
  it('fails as retryable after it was submitted (a relay restart)', async () => {
    const s = setup()
    const id = await s.submit()
    s.relay.getJob.mockRejectedValue(gone())
    await vi.advanceTimersByTimeAsync(6000)
    expect(s.state(id)).toBe('failed')
    const err = s.doc.get().jobs[0].error!
    expect(err.retryable).toBe(true)
    expect(err.message).toMatch(/lost track/)
    expect(s.relay.createJob).toHaveBeenCalledTimes(1)
  })
})

describe('an uncertain job', () => {
  it('is not asked about again: the relay never moves it', async () => {
    const s = setup()
    s.relay.createJob.mockImplementationOnce(async (req: { jobId: string }) => job(req.jobId, 'uncertain'))
    const id = await s.submit()
    expect(s.state(id)).toBe('uncertain')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.relay.getJob).not.toHaveBeenCalled()
  })

  it('is not polled after a reload either', async () => {
    const s = setup()
    s.relay.createJob.mockImplementationOnce(async (req: { jobId: string }) => job(req.jobId, 'uncertain'))
    await s.submit()
    s.runner.resume()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(s.relay.getJob).not.toHaveBeenCalled()
  })
})

describe('downloading a finished job', () => {
  it('tries again after a blip instead of failing the paid clip', async () => {
    const s = setup()
    s.relay.createJob.mockImplementationOnce(async (req: { jobId: string }) => done(req.jobId))
    s.relay.fetchOutput.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network'))
    const id = await s.submit()
    expect(s.state(id)).toBe('fetching')
    await vi.advanceTimersByTimeAsync((FETCH_BACKOFF_S[0] + FETCH_BACKOFF_S[1]) * 1000 + 100)
    expect(s.state(id)).toBe('completed')
    expect(s.landed).toEqual([id])
    expect(await getBlob(SHA)).toBeTruthy()
  })

  it('keeps it fetching after the last try, and downloads it on the next poll', async () => {
    const s = setup()
    s.relay.createJob.mockImplementationOnce(async (req: { jobId: string }) => done(req.jobId))
    s.relay.getJob.mockImplementation(async (id: string) => done(id))
    s.relay.fetchOutput.mockRejectedValue(new Error('network'))
    const id = await s.submit()
    const backoff = FETCH_BACKOFF_S.reduce((a, b) => a + b, 0)
    await vi.advanceTimersByTimeAsync(backoff * 1000 + 100)
    expect(s.state(id)).toBe('fetching')
    expect(s.runner.liveInfo(id)?.note).toMatch(/trying again/)
    s.relay.fetchOutput.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }))
    await vi.advanceTimersByTimeAsync(FETCH_AGAIN_S * 1000 + 100)
    expect(s.state(id)).toBe('completed')
    expect(s.landed).toEqual([id])
  })

  it('a cancel while it downloads does not land it twice', async () => {
    const s = setup()
    s.relay.createJob.mockImplementationOnce(async (req: { jobId: string }) => done(req.jobId))
    s.relay.cancelJob.mockImplementation(async (id: string) => done(id)) // the relay: already completed
    s.relay.fetchOutput.mockRejectedValueOnce(new Error('network'))
    const id = await s.submit()
    await s.runner.cancel(id)
    await vi.advanceTimersByTimeAsync(FETCH_BACKOFF_S[0] * 1000 + 100)
    expect(s.state(id)).toBe('completed')
    expect(s.landed).toEqual([id])
    expect(s.relay.cancelJob).not.toHaveBeenCalled()
  })
})
