import { describe, expect, it, vi } from 'vitest'
import { JobRunner } from './runner'
import { RelayError } from '../relay/types'

// "You have 2 jobs running" failed the Back view when Make the other views sent 3 at once (2026-10-07).
describe('a job refused because too many are running', () => {
  it('waits and sends the same request again instead of failing', async () => {
    vi.useFakeTimers()
    let calls = 0
    const ok = { contractVersion: '2', state: 'submitted', op: 'view', quotaClass: 'image', inputHashes: [], cost: { currency: 'USD', unknown: true }, createdAt: '', updatedAt: '', participantId: 'p_x', nextPollS: 600 }
    const relay = {
      kind: 'http',
      createJob: vi.fn(async (req: { jobId: string }) => {
        calls++
        if (calls === 1) throw new RelayError({ code: 'queue_full', message: 'You have 2 jobs running; wait for one to finish.', retryable: true }, 429)
        return { ...ok, jobId: req.jobId }
      }),
      getJob: vi.fn(),
      cancelJob: vi.fn(),
    }
    const docValue = { jobs: [] as unknown[] }
    const doc = { get: () => docValue, patch: vi.fn(async () => docValue), onChange: () => () => {} }
    const ui = { get: () => ({ jobCtx: {} }), update: vi.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new JobRunner(relay as any, doc as any, ui as any)
    const id = await runner.submit('view', { view: 'back', ratio: '4:5' }, [], { for: 'canvas' } as never)
    expect(runner.liveInfo(id)?.state).toBe('queued')
    await vi.advanceTimersByTimeAsync(4500)
    expect(relay.createJob).toHaveBeenCalledTimes(2)
    expect(relay.createJob.mock.calls[1][0]).toEqual(relay.createJob.mock.calls[0][0])
    expect(runner.liveInfo(id)?.state).not.toBe('failed')
    vi.useRealTimers()
  })
})
