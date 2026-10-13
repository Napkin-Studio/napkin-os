import { describe, expect, it, vi } from 'vitest'
import type { DocJob } from '../contracts/types'
import { SnapshotStore } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { RelayError } from '../relay/types'
import { snapshotDoc } from '../test/jobFixtures'
import { JobRunner } from './runner'

// "You have 2 jobs running" failed the Back view when Make the other views sent 3 at once (2026-10-07).
describe('a job refused because too many are running', () => {
  it('waits and sends the same request again instead of failing', async () => {
    vi.useFakeTimers()
    let calls = 0
    const ok = { contractVersion: '3', state: 'submitted', op: 'view', quotaClass: 'image', inputHashes: [], cost: { currency: 'USD', unknown: true }, createdAt: '', updatedAt: '', participantId: 'p_x', nextPollS: 600 }
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
    const doc = snapshotDoc()
    const ui = new SnapshotStore<UiState>(initialUi())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new JobRunner(relay as any, doc, ui)
    const id = await runner.submit('view', { view: 'back', ratio: '4:5' }, [], { for: 'canvas' })
    expect(runner.liveInfo(id)?.state).toBe('queued')
    await vi.advanceTimersByTimeAsync(4500)
    expect(relay.createJob).toHaveBeenCalledTimes(2)
    expect(relay.createJob.mock.calls[1][0]).toEqual(relay.createJob.mock.calls[0][0])
    expect(runner.liveInfo(id)?.state).not.toBe('failed')
    vi.useRealTimers()
  })

  it('sends it again when a reload polls it before the relay ever recorded it', async () => {
    vi.useFakeTimers()
    const JOB = 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F'
    const doc = snapshotDoc()
    const node = { kind: 'group' as const, id: JOB }
    const request = { contractVersion: '3', jobId: JOB, op: 'view', projectId: doc.get().project.id, nonce: 'nonce_waiting', purpose: 'canvas', node, parentIds: [], input: { view: 'back', ratio: '4:5' } }
    const relay = {
      kind: 'http',
      createJob: vi.fn(async (req: { jobId: string }) => ({ contractVersion: '3', state: 'submitted', op: 'view', quotaClass: 'image', inputHashes: [], cost: { currency: 'USD', unknown: true }, createdAt: '', updatedAt: '', participantId: 'p_x', nextPollS: 600, jobId: req.jobId })),
      getJob: vi.fn(async () => { throw new RelayError({ code: 'invalid_input', message: 'No such job.', retryable: false }, 404) }),
      cancelJob: vi.fn(),
    }
    const job: DocJob = {
      id: JOB, v: 1, field_v: {}, op: 'view', state: 'queued', node, purpose: 'canvas', started_by: 'human:p_local', tenant_id: '00000000-0000-0000-0000-000000000000',
      nonce: 'nonce_waiting', crew: 'wren', parent_ids: [], input_hashes: [], created_at: new Date().toISOString(),
    }
    doc.update((d) => { d.jobs[JOB] = job })
    const ui = new SnapshotStore<UiState>(initialUi())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ui.update((u) => { u.jobs[JOB] = { request: request as any } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new JobRunner(relay as any, doc, ui)
    runner.resume()
    await vi.advanceTimersByTimeAsync(500)
    expect(relay.getJob).toHaveBeenCalledWith(JOB)
    expect(relay.createJob).toHaveBeenCalledWith(request)
    expect(runner.liveInfo(JOB)?.state).not.toBe('failed')
    vi.useRealTimers()
  })
})
