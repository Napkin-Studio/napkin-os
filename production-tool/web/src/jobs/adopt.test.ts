// A placeholder whose job the document never recorded (runner.adopt): the page closed between placing
// it and writing it down. 2026-10-15: Make the other views, a reload while the first view was being
// directed, and the side and back stayed blank boxes for good.

import { describe, expect, it, vi } from 'vitest'
import { SnapshotStore } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { RelayError } from '../relay/types'
import { snapshotDoc } from '../test/jobFixtures'
import { JobRunner } from './runner'

const JOB = 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F'

function setup(getJob: (id: string, projectId: string) => Promise<unknown>) {
  const doc = snapshotDoc()
  const relay = {
    kind: 'http',
    createJob: vi.fn(async (req: { jobId: string }) => ({ ...base(doc.get().project.id), jobId: req.jobId, state: 'submitted' })),
    getJob: vi.fn((id: string) => getJob(id, doc.get().project.id)),
    cancelJob: vi.fn(),
  }
  const ui = new SnapshotStore<UiState>(initialUi())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = new JobRunner(relay as any, doc, ui)
  return { doc, relay, runner }
}

const base = (projectId: string) => ({
  contractVersion: '3', op: 'view', quotaClass: 'image', inputHashes: ['sha256:' + 'a'.repeat(64)], cost: { currency: 'USD', unknown: true },
  createdAt: '2026-10-15T18:18:40.000Z', updatedAt: '', participantId: 'p_x', tenantId: '00000000-0000-0000-0000-000000000000', projectId,
  startedBy: 'human:p_x', crew: 'wren', node: { kind: 'group', id: JOB }, nonce: 'n1', purpose: 'canvas', nextPollS: 600,
})

describe('a placeholder the document never recorded', () => {
  it('is written in and followed when the relay has its job', async () => {
    const t = setup(async (id, projectId) => ({ ...base(projectId), jobId: id, state: 'submitted' }))
    expect(await t.runner.adopt(JOB, ['node_front'])).toBe('adopted')
    const j = t.doc.get().jobs[JOB]
    expect(j).toMatchObject({ op: 'view', state: 'submitted', parent_ids: ['node_front'], crew: 'wren', purpose: 'canvas' })
    expect(t.runner.liveInfo(JOB)?.state).toBe('submitted')
    expect(t.runner.isUnstarted(JOB)).toBe(false)
    t.runner.stop()
  })

  it('never started when the relay never got it, until it is made', async () => {
    const t = setup(async () => { throw new RelayError({ code: 'invalid_input', message: 'No such job.', retryable: false }, 404) })
    expect(await t.runner.adopt(JOB, [])).toBe('unstarted')
    expect(t.runner.isUnstarted(JOB)).toBe(true)
    expect(t.doc.get().jobs[JOB]).toBeUndefined()
    await t.runner.submit('view', { view: 'side', ratio: '4:5' }, [], { for: 'canvas' }, JOB)
    expect(t.runner.isUnstarted(JOB)).toBe(false)
    t.runner.stop()
  })

  it('is left alone offline, and never takes another project’s job', async () => {
    const off = setup(async () => { throw new TypeError('Failed to fetch') })
    expect(await off.runner.adopt(JOB, [])).toBe('unknown')
    expect(off.runner.isUnstarted(JOB)).toBe(false)
    const other = setup(async (id) => ({ ...base('proj_other'), jobId: id, state: 'submitted' }))
    expect(await other.runner.adopt(JOB, [])).toBe('unknown')
    expect(other.doc.get().jobs[JOB]).toBeUndefined()
  })

  it('a job the document has is not asked about', async () => {
    const t = setup(async (id, projectId) => ({ ...base(projectId), jobId: id, state: 'submitted' }))
    await t.runner.submit('view', { view: 'side', ratio: '4:5' }, [], { for: 'canvas' }, JOB)
    expect(await t.runner.adopt(JOB, [])).toBe('known')
    expect(t.relay.getJob).not.toHaveBeenCalled()
    t.runner.stop()
  })
})
