import { describe, expect, it, vi } from 'vitest'
import { JobRunner } from './runner'

// features/runway-fallback.clan: the relay made the job on Runway because HeyGen could not.
// The runner keeps fallbackFrom and the reason beside the job's purpose, for the card's label.
describe('a job the relay made on Runway instead', () => {
  it('keeps fallbackFrom and fallbackReason in the job context', async () => {
    vi.useFakeTimers()
    const relay = {
      kind: 'http',
      createJob: vi.fn(async (req: { jobId: string }) => ({
        contractVersion: '2', jobId: req.jobId, state: 'submitted', op: 'clip', quotaClass: 'video', inputHashes: [],
        cost: { currency: 'USD', unknown: false }, createdAt: '', updatedAt: '', participantId: 'p_x', nextPollS: 600,
        provider: 'runway', model: 'veo3.1', keySource: 'event',
        fallbackFrom: { provider: 'heygen', model: 'heygen-video-1' }, fallbackReason: 'HeyGen could not make it: credit is exhausted.',
      })),
      getJob: vi.fn(),
      cancelJob: vi.fn(),
    }
    const docValue = { jobs: [] as unknown[] }
    const doc = { get: () => docValue, patch: vi.fn(async () => docValue), onChange: () => () => {} }
    const state = { jobCtx: {} as Record<string, Record<string, unknown>> }
    const ui = { get: () => state, update: (fn: (u: typeof state) => void) => fn(state) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new JobRunner(relay as any, doc as any, ui as any)
    const id = await runner.submit('clip', { image: { sha256: 'sha256:' + '0'.repeat(64), url: 'u', mime: 'image/png' } } as never, [], { for: 'clip', shotId: 's1' } as never)
    expect(state.jobCtx[id]).toMatchObject({
      for: 'clip',
      fallbackFrom: { provider: 'heygen', model: 'heygen-video-1' },
      fallbackReason: 'HeyGen could not make it: credit is exhausted.',
    })
    vi.useRealTimers()
  })
})
