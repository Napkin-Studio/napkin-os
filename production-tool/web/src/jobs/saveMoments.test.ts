// B7 (features/pt-film-r1.clan, UAT 2026-11-21): every landing is a save moment. wireJobs tells deps.landed after
// each landed job, whatever its purpose; projects/session.ts posts the server's copy soon after.

import { describe, expect, it, vi } from 'vitest'
import { wireJobs } from './wire'
import type { FrameDeps } from './frames'

describe('save moments', () => {
  it('each landing, of any purpose, says so once', () => {
    const handlers = new Map<string, (job: unknown, ctx: unknown) => void>()
    const runner = { onComplete: (p: string, h: (job: unknown, ctx: unknown) => void) => { handlers.set(p, h); return () => {} } }
    const landed = vi.fn()
    const doc = { get: () => ({ jobs: {}, generations: {}, videos: {} }) }
    wireJobs({ relay: {} as never, doc: doc as never, ui: { get: () => ({ jobs: {} }) } as never, runner: runner as never, landed } as FrameDeps)
    expect([...handlers.keys()]).toEqual(expect.arrayContaining(['frame', 'clip', 'run', 'stitch', 'write', 'size']))
    // A purpose its handler ignores (the ctx is another's) still counts: the job landed.
    handlers.get('image_edit')!({ jobId: 'job_1', op: 'image_edit' }, { for: 'image_edit' })
    handlers.get('frame')!({ jobId: 'job_2', op: 'frame' }, { for: 'clip' })
    expect(landed).toHaveBeenCalledTimes(2)
  })
})
