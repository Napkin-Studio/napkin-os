// A job that finishes after the tab closed lands once (features/production-jobs-via-host.clan, S3-3): napkin-web keeps
// its outcome in the project's inbox, and the runner lands each entry through the landing a polled job uses, then
// acknowledges it. The relay here is the host's two inbox calls on top of a job table; the store is the real snapshot store.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '../contracts/types'
import { SnapshotStore } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import type { InboxEntry } from '../relay/types'
import { snapshotDoc } from '../test/jobFixtures'
import { JobRunner } from './runner'

const SHA = 'sha256:' + 'cd'.repeat(32)

function job(jobId: string, state: Job['state'], extra: Partial<Job> = {}): Job {
  return {
    contractVersion: '3', jobId, state, op: 'clip', quotaClass: 'video', inputHashes: [], participantId: 'p_x',
    cost: { currency: 'USD', unknown: true }, createdAt: '', updatedAt: '', nextPollS: 5, ...extra,
  } as Job
}

const done = (jobId: string) => job(jobId, 'completed', {
  kind: 'generated',
  outputs: [{ sha256: SHA, url: 'https://cdn.test/out/x', mime: 'video/mp4', bytes: 3 }],
})

const entry = (j: Job): InboxEntry => ({ job: j.jobId, state: j.state as InboxEntry['state'], outcome: j, at: '2026-11-23T10:00:00Z' })

function setup() {
  const waiting: InboxEntry[] = []
  const acked: string[] = []
  const relay = {
    kind: 'http',
    createJob: vi.fn(async (req: { jobId: string }): Promise<Job> => job(req.jobId, 'submitted')),
    getJob: vi.fn(async (id: string): Promise<Job> => job(id, 'submitted')),
    cancelJob: vi.fn(async (id: string): Promise<Job> => job(id, 'cancelled')),
    fetchOutput: vi.fn(async () => new Blob(['mp4'], { type: 'video/mp4' })),
    // the host's side: what is waiting, and the acknowledgement that takes it away
    inbox: vi.fn(async () => waiting.filter((e) => !acked.includes(e.job))),
    ackJob: vi.fn(async (id: string) => { acked.push(id) }),
  }
  const doc = snapshotDoc()
  const ui = new SnapshotStore<UiState>(initialUi())
  const open = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new JobRunner(relay as any, doc, ui)
    const landed: string[] = []
    runner.onComplete('clip', (j) => landed.push(j.jobId))
    return { runner, landed }
  }
  const submit = (runner: JobRunner) => runner.submit('clip', { text: 'a clip' }, [], { for: 'clip', shotId: 'shot_01K6XA7Q3M9V2D4R8T0B5C1E6F' })
  const state = (id: string) => doc.get().jobs[id]?.state
  return { relay, doc, ui, open, submit, state, waiting, acked }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('a job that finished while the tab was closed', () => {
  it('lands from the inbox once, and is acknowledged', async () => {
    const s = setup()
    const first = s.open()
    const id = await s.submit(first.runner)
    expect(['queued', 'submitted']).toContain(s.state(id))
    first.runner.stop() // the tab is closed with the job at the relay
    s.waiting.push(entry(done(id))) // the host settled it meanwhile

    const second = s.open() // the project is opened again
    second.runner.resume()
    expect(await second.runner.landInbox()).toBe(1)
    await vi.advanceTimersByTimeAsync(50)
    expect(s.state(id)).toBe('completed')
    expect(Object.keys(s.doc.get().assets)).toEqual([SHA])
    expect(second.landed).toEqual([id])
    expect(s.relay.ackJob).toHaveBeenCalledWith(id)
    expect(s.acked).toContain(id)
    second.runner.stop()
  })

  it('lands once when the inbox is read twice and the tool polls the same job (watcher plus reopen)', async () => {
    const s = setup()
    const first = s.open()
    const id = await s.submit(first.runner)
    first.runner.stop()
    const second = s.open()
    second.runner.resume()
    s.relay.getJob.mockImplementation(async (jid: string) => done(jid)) // its own poll finds it done too
    s.waiting.push(entry(done(id)))
    await Promise.all([second.runner.landInbox(), second.runner.landInbox()])
    await vi.advanceTimersByTimeAsync(2000)
    await second.runner.landInbox() // the event arrives after it is landed
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.state(id)).toBe('completed')
    expect(Object.keys(s.doc.get().assets)).toHaveLength(1)
    expect(second.landed).toEqual([id])
    second.runner.stop()
  })

  it('a failed or cancelled outcome is shown as such and acknowledged', async () => {
    const s = setup()
    const first = s.open()
    const a = await s.submit(first.runner)
    const b = await s.submit(first.runner)
    first.runner.stop()
    const second = s.open()
    second.runner.resume()
    s.waiting.push(
      entry(job(a, 'failed', { error: { code: 'moderated', message: 'The provider declined it.', retryable: false } } as Partial<Job>)),
      entry(job(b, 'cancelled')),
    )
    expect(await second.runner.landInbox()).toBe(2)
    await vi.advanceTimersByTimeAsync(50)
    expect(s.state(a)).toBe('failed')
    expect(s.state(b)).toBe('cancelled')
    expect(s.acked.sort()).toEqual([a, b].sort())
    expect(second.landed).toEqual([])
    second.runner.stop()
  })

  it('an entry for a job this document never had, or already landed, is acknowledged and writes nothing', async () => {
    const s = setup()
    const first = s.open()
    const id = await s.submit(first.runner)
    s.relay.getJob.mockImplementation(async (jid: string) => done(jid))
    await first.runner.pollNow()
    await vi.advanceTimersByTimeAsync(50)
    expect(s.state(id)).toBe('completed')
    const assets = { ...s.doc.get().assets }
    s.waiting.push(entry(done(id)), entry(done('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')))
    expect(await first.runner.landInbox()).toBe(0)
    expect(s.acked).toContain(id)
    expect(s.acked).toContain('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')
    expect(s.doc.get().assets).toEqual(assets)
    expect(first.landed).toEqual([id])
    first.runner.stop()
  })

  it('a job the open tab polled to its end is acknowledged too, so the host never offers it again', async () => {
    const s = setup()
    const { runner, landed } = s.open()
    const id = await s.submit(runner)
    s.relay.getJob.mockImplementation(async (jid: string) => done(jid))
    await vi.advanceTimersByTimeAsync(6000)
    expect(landed).toEqual([id])
    expect(s.relay.ackJob).toHaveBeenCalledWith(id)
    runner.stop()
  })

  it('an unreadable inbox lands nothing and is not an error; there is no inbox on the mock', async () => {
    const s = setup()
    const { runner } = s.open()
    s.relay.inbox.mockRejectedValueOnce(new Error('offline'))
    expect(await runner.landInbox()).toBe(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bare = new JobRunner({ kind: 'mock' } as any, s.doc, s.ui)
    expect(await bare.landInbox()).toBe(0)
    runner.stop()
    bare.stop()
  })
})
