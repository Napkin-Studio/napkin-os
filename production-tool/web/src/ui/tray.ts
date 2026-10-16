// What the job tray lists (ui/JobTray.tsx): the jobs at work now, and the failed ones
// still waiting for the user, read from the same jobs and live states the cards read,
// so the tray's counts and the cards always agree. A job waiting for an answer
// (needs_input) is not at work: it waits for the person. Pure, for the tests.

import type { DocJob, JobState } from '../contracts/types'
import type { JobCtx, StageName } from '../doc/ui'
import { isActive } from '../jobs/runner'

/** What the tray says of a job waiting for an answer (ui-behaviour 5.2). */
export const WAITING = 'Waiting for you'

export interface TrayRow {
  job: DocJob
  state: JobState
  ctx?: JobCtx
  queuePosition?: number
}

export interface TrayGroups {
  working: TrayRow[]
  queued: number
  /** Jobs waiting for the person's answer to a question (needs_input): "Waiting for you". */
  waiting: TrayRow[]
  needsYou: TrayRow[]
}

export function trayGroups(jobs: DocJob[], ctxOf: (id: string) => JobCtx | undefined, liveOf: (id: string) => { state?: JobState; queuePosition?: number } | undefined): TrayGroups {
  const working: TrayRow[] = []
  const waiting: TrayRow[] = []
  const needsYou: TrayRow[] = []
  for (const job of jobs) {
    const live = liveOf(job.id)
    const state = live?.state ?? job.state
    const ctx = ctxOf(job.id)
    const row = { job, state, ctx, queuePosition: live?.queuePosition }
    if (state === 'needs_input') waiting.push(row)
    else if (isActive(state)) working.push(row)
    // A failure the user has not cleared or sent again (Retry and Try another model set dismissed).
    else if (state === 'failed' && ctx && !ctx.dismissed) needsYou.push(row)
  }
  return { working, queued: working.filter((r) => r.state === 'queued').length, waiting, needsYou }
}

/** The tray chip's words: '2 running · 1 queued · Waiting for you', 'Nothing running'. Failures are counted apart. */
export function trayLabel(g: TrayGroups): string {
  const running = g.working.length - g.queued
  const parts = [running && `${running} running`, g.queued && `${g.queued} queued`, g.waiting.length && WAITING].filter(Boolean)
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
    case 'sketch': return { stage: 'character' }
  }
  return { stage: job.op === 'clip' || job.op === 'clip_edit' || job.op === 'stitch' ? 'video' : job.op === 'frame' || job.op === 'shot_list' ? 'storyboard' : 'character' }
}

/** What the job button says, in words (its tooltip, its screen-reader label, the popover's first row):
 *  the lead job's line, then the counts ("Wren is making frame 3 · 3 running · 1 queued"), then failures. */
export function jobLine(g: TrayGroups, leadLine: string | undefined): string {
  const counts = g.working.length + g.waiting.length > 1 || !leadLine ? trayLabel(g) : ''
  const failed = g.needsYou.length ? `${g.needsYou.length} failed` : ''
  const parts = [leadLine, counts === 'Nothing running' && failed ? '' : counts, failed].filter(Boolean)
  return parts.join(' · ')
}

/** The job button's look (owner 2026-10-15: "just the icon rotating"; ui-behaviour 6.5): no words and
 *  no count in the bar. Running: the turning logo, led by the lead job's department (still when it is
 *  queued). A question waiting for you or a failure, with nothing running: the still logo. Either way
 *  a needs-you mark on its corner: brand orange for a question (the figure's "!" colour, 5.2), red for
 *  a failure. Nothing running, waiting or failed: no button at all. */
export function jobLook(g: TrayGroups): { spin: 'run' | 'queued' | 'still'; mark?: 'ask' | 'failed' } | null {
  const first = g.working[0]
  const mark = g.waiting.length ? 'ask' as const : g.needsYou.length ? 'failed' as const : undefined
  if (!first && !mark) return null
  return { spin: !first ? 'still' : first.state === 'queued' ? 'queued' : 'run', mark }
}
