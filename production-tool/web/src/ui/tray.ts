// What the job tray lists (ui/JobTray.tsx): the jobs at work now, and the failed ones
// still waiting for the user, read from the same jobs and live states the cards read,
// so the tray's counts and the cards always agree. Pure, for the tests.

import type { DocJob, JobState, StageName } from '../contracts/types'
import type { JobCtx } from '../doc/ui'
import { isActive } from '../jobs/runner'

export interface TrayRow {
  job: DocJob
  state: JobState
  ctx?: JobCtx
  queuePosition?: number
}

export interface TrayGroups {
  working: TrayRow[]
  queued: number
  needsYou: TrayRow[]
}

export function trayGroups(jobs: DocJob[], ctxOf: (id: string) => JobCtx | undefined, liveOf: (id: string) => { state?: JobState; queuePosition?: number } | undefined): TrayGroups {
  const working: TrayRow[] = []
  const needsYou: TrayRow[] = []
  for (const job of jobs) {
    const live = liveOf(job.id)
    const state = live?.state ?? job.state
    const ctx = ctxOf(job.id)
    const row = { job, state, ctx, queuePosition: live?.queuePosition }
    if (isActive(state)) working.push(row)
    // A failure the user has not cleared or sent again (Retry and Try another model set dismissed).
    else if (state === 'failed' && ctx && !ctx.dismissed) needsYou.push(row)
  }
  return { working, queued: working.filter((r) => r.state === 'queued').length, needsYou }
}

/** The tray chip's words: '2 running · 1 queued', 'Nothing running'. Failures are counted apart. */
export function trayLabel(g: TrayGroups): string {
  const running = g.working.length - g.queued
  const parts = [running && `${running} running`, g.queued && `${g.queued} queued`].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing running'
}

/** Where a job's card is: the stage, and the shot it belongs to. */
export function whereIs(job: Pick<DocJob, 'op'>, ctx: JobCtx | undefined): { stage: StageName; shotId?: string } {
  switch (ctx?.for) {
    case 'frame': return { stage: 'storyboard', shotId: ctx.shotId }
    case 'shot_list': return { stage: 'storyboard' }
    case 'clip': return { stage: 'video', shotId: ctx.shotId }
    case 'stitch': return { stage: 'video' }
    case 'canvas': return { stage: 'character' }
  }
  return { stage: job.op === 'clip' || job.op === 'clip_edit' || job.op === 'stitch' ? 'video' : job.op === 'frame' || job.op === 'shot_list' ? 'storyboard' : 'character' }
}
