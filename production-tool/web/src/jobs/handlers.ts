// What a finished job does to the document, for the Storyboard and Video
// stages (the Character canvas registers its own handler). Pure document
// edits, so they also run for jobs that finish after a reload.

import type { Job, ProductionDocument } from '../contracts/types'
import type { JobCtx } from '../doc/ui'
import { newId } from '../lib/ulid'

export function applyShotList(d: ProductionDocument, job: Job, ctx: Extract<JobCtx, { for: 'shot_list' }>) {
  const shots = (job.shots ?? []).map((s, i) => ({ ...s, order: i + 1, status: 'planned' as const }))
  d.shots = shots
  d.frames = []
  d.takes = []
  const rev = d.script?.revisions.find((r) => r.id === ctx.revId)
  if (rev) rev.status = 'draft'
  d.stage.next_action = 'Check the shots, then draw the frames.'
}

export function applyFrame(d: ProductionDocument, job: Job, ctx: Extract<JobCtx, { for: 'frame' }>) {
  const out = job.outputs?.[0]
  if (!out) return
  d.frames ??= []
  for (const f of d.frames) if (f.shot_id === ctx.shotId) f.selected = false
  const frame = {
    id: newId('frame'),
    shot_id: ctx.shotId,
    asset: out.sha256,
    job_id: job.jobId,
    selected: true,
    kind: job.kind === 'mock' ? ('mock' as const) : ('generated' as const),
    ...(ctx.parentFrameId ? { parent: ctx.parentFrameId } : {}),
  }
  d.frames.push(frame)
  const shot = d.shots?.find((s) => s.id === ctx.shotId)
  if (shot) {
    shot.storyboard_frame = out.sha256
    if (shot.status === 'locked') shot.status = 'needs_review'
  }
}

export function applyTake(d: ProductionDocument, job: Job, ctx: Extract<JobCtx, { for: 'clip' }>) {
  const out = job.outputs?.[0]
  if (!out) return
  d.takes ??= []
  for (const t of d.takes) if (t.shot_id === ctx.shotId) t.selected = false
  const take = {
    id: newId('take'),
    shot_id: ctx.shotId,
    asset: out.sha256,
    job_id: job.jobId,
    kind: job.kind === 'mock' ? ('mock' as const) : ('generated' as const),
    provider: job.provider ?? 'mock',
    selected: true,
    ...(job.model ? { model: job.model } : {}),
    ...(out.durationS ? { duration_s: out.durationS } : {}),
    ...(ctx.parentTakeId ? { parent: ctx.parentTakeId } : {}),
  }
  d.takes.push(take)
  const shot = d.shots?.find((s) => s.id === ctx.shotId)
  if (shot) shot.selected_take = take.id
  for (const r of d.reviews ?? []) {
    if (ctx.reviewIds?.includes(r.id)) {
      r.resolved = true
      r.resolved_by_job = job.jobId
    }
  }
}

export function applyStitch(d: ProductionDocument, job: Job) {
  const out = job.outputs?.[0]
  if (!out) return
  d.exports ??= []
  d.exports.push({ id: newId('exp'), kind: 'ad_mp4', asset: out.sha256, job_id: job.jobId, created_at: new Date().toISOString() })
}
