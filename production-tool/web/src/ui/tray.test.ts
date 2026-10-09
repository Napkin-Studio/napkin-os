import { describe, expect, it } from 'vitest'
import type { DocJob, JobState } from '../contracts/types'
import type { JobCtx } from '../doc/ui'
import { trayGroups, trayLabel, whereIs } from './tray'

const job = (id: string, op: DocJob['op'], state: JobState) => ({ id, op, state, parent_ids: [], input_hashes: [], created_at: '2026-10-09T00:00:00Z' }) as unknown as DocJob
const ctx = (c: Partial<JobCtx>) => ({ request: {}, ...c }) as JobCtx

describe('the job tray', () => {
  const jobs = [job('a', 'frame', 'submitted'), job('b', 'frame', 'queued'), job('c', 'clip', 'failed'), job('d', 'clip', 'failed'), job('e', 'frame', 'completed')]
  const ctxs: Record<string, JobCtx> = {
    a: ctx({ for: 'frame', shotId: 's1' }), b: ctx({ for: 'frame', shotId: 's2' }),
    c: ctx({ for: 'clip', shotId: 's3' }), d: ctx({ for: 'clip', shotId: 's4', dismissed: true }),
  }
  it('lists what is at work and the failures not yet cleared or sent again', () => {
    const g = trayGroups(jobs, (id) => ctxs[id], () => undefined)
    expect(g.working.map((r) => r.job.id)).toEqual(['a', 'b'])
    expect(g.queued).toBe(1)
    expect(g.needsYou.map((r) => r.job.id)).toEqual(['c'])
    expect(trayLabel(g)).toBe('1 running · 1 queued')
  })
  it('reads the live state first, as the cards do', () => {
    const g = trayGroups(jobs, (id) => ctxs[id], (id) => (id === 'b' ? { state: 'submitted', queuePosition: 2 } : undefined))
    expect(g.queued).toBe(0)
    expect(g.working[1].queuePosition).toBe(2)
    expect(trayLabel(g)).toBe('2 running')
    expect(trayLabel(trayGroups([], () => undefined, () => undefined))).toBe('Nothing running')
  })
  it('knows which stage and shot a job belongs to', () => {
    expect(whereIs(jobs[0], ctxs.a)).toEqual({ stage: 'storyboard', shotId: 's1' })
    expect(whereIs(jobs[2], ctxs.c)).toEqual({ stage: 'video', shotId: 's3' })
    expect(whereIs(job('g', 'generate', 'queued'), ctx({ for: 'canvas' }))).toEqual({ stage: 'character' })
    expect(whereIs(job('h', 'stitch', 'queued'), undefined)).toEqual({ stage: 'video' })
  })
})
