import { describe, expect, it, vi } from 'vitest'
import { snapshotDoc } from '../test/jobFixtures'
import { JobRunner } from './runner'

// features/runway-fallback.clan: the relay made the job on Runway because its pick could not.
// The runner keeps fallbackFrom and the reason beside the job's request (ProjectUi.jobs), for the card's label.
describe('a job the relay made on Runway instead', () => {
  it('keeps fallbackFrom and fallbackReason in the job context', async () => {
    vi.useFakeTimers()
    const relay = {
      kind: 'http',
      createJob: vi.fn(async (req: { jobId: string }) => ({
        contractVersion: '3', jobId: req.jobId, state: 'submitted', op: 'clip', quotaClass: 'video', inputHashes: [],
        cost: { currency: 'USD', unknown: false }, createdAt: '', updatedAt: '', participantId: 'p_x', nextPollS: 600,
        provider: 'runway', model: 'veo3.1',
        fallbackFrom: { provider: 'mock', model: 'mock-hq' }, fallbackReason: 'Mock could not make it: it is busy.',
      })),
      getJob: vi.fn(),
      cancelJob: vi.fn(),
    }
    const doc = snapshotDoc()
    const state = { jobs: {} as Record<string, Record<string, unknown>> }
    const ui = { get: () => state, update: (fn: (u: typeof state) => void) => fn(state) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new JobRunner(relay as any, doc, ui as any)
    const id = await runner.submit('clip', { image: { sha256: 'sha256:' + '0'.repeat(64), url: 'u', mime: 'image/png' } }, [], { for: 'clip', shotId: 'shot_01K6XA7Q3M9V2D4R8T0B5C1E6F' })
    expect(state.jobs[id]).toMatchObject({
      fallbackFrom: { provider: 'mock', model: 'mock-hq' },
      fallbackReason: 'Mock could not make it: it is busy.',
    })
    expect(runner.ctx(id)).toMatchObject({ for: 'clip', fallbackFrom: { provider: 'mock' } })
    vi.useRealTimers()
  })
})
