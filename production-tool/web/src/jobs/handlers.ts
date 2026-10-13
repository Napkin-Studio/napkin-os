// What a finished job does to the document, for the Storyboard and Video
// stages (the Character canvas registers its own handler). Contract 3: a
// landing is the crew's (contracts/collab.md §8): one batch, one decision by
// the crew member (the job's `crew`), citing <doc>#jobs[<jobId>], whose
// rationale says what the director decided and what the provider made
// (clan-store jobRationale). Never an undo step of anyone's.
//
// The apply* functions are the pure draft edits (they also run for jobs that
// finish after a reload, or in another browser: they read only the job and
// its purpose); the land* functions write them with the crew's why.

import { crewFor, newUlidId, rankBetween } from '../../../clan-store/src'
import type { CrewId, DirectorCard, Frame, Job, ProductionDocument, Render, Take } from '../contracts/types'
import { landUpdate } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import type { JobCtx } from '../doc/ui'
import { edlItemFor, edlOf, framesOf, mainVideo, rendersOf, shotName, takesOf } from '../model/selectors'
import { landingWhy } from './landing'
import { refreshClipStale } from './stale'

export { applyShotList, landShotList } from './plan'
export { landingWhy } from './landing'

type FrameCtx = Pick<Extract<JobCtx, { for: 'frame' }>, 'shotId' | 'parentFrameId'>
type ClipCtx = Pick<Extract<JobCtx, { for: 'clip' }>, 'shotId' | 'parentTakeId' | 'reviewIds'>

/** The cards the director was given, for the rationale: the relay's block, else what this browser kept. */
const cardsOf = (job: Job, ctx?: { cards?: DirectorCard[] }) => job.director?.cards ?? ctx?.cards

const crewOf = (d: ProductionDocument, job: Job): CrewId => (d.jobs[job.jobId]?.crew ?? job.crew ?? crewFor(job.op)) as CrewId
const nextVersion = (versions: { version: number }[]) => Math.max(0, ...versions.map((x) => x.version)) + 1

/** A frame job's result as the shot's new frame version, picked now. Landing twice does nothing. */
export function applyFrame(d: ProductionDocument, job: Job, ctx: FrameCtx): Frame | undefined {
  const out = job.outputs?.[0]
  const shot = d.shots[ctx.shotId]
  if (!out || !shot) return undefined
  if (Object.values(d.frames).some((f) => f.job_id === job.jobId)) return undefined
  const frame: Frame = {
    id: newUlidId('frame'),
    v: 1,
    field_v: {},
    shot_id: shot.id,
    version: nextVersion(framesOf(d, shot.id)),
    ...(ctx.parentFrameId ? { parent_id: ctx.parentFrameId } : {}),
    kind: job.kind === 'mock' ? 'mock' : 'generated',
    asset: out.sha256,
    job_id: job.jobId,
    crew: crewOf(d, job),
    ...(job.model ? { model: job.model } : {}),
    ...(job.provider ? { provider: job.provider } : {}),
  }
  d.frames[frame.id] = frame
  // The new version is the frame in the shot (Keep both, which keeps the earlier one as an alternate, is the panel's).
  shot.pick = { current: frame.id }
  if (shot.status === 'locked') shot.status = 'needs_review'
  // A new frame puts its own clip out of date, never the next frame (features/one-to-one-updates.clan).
  refreshClipStale(d, shot.id)
  return frame
}

/** A clip job's result as the shot's new take, picked in the main video's cut (its edl item is made, after
 *  the others, when the shot has none yet); the notes it fixed are resolved. Landing twice does nothing. */
export function applyTake(d: ProductionDocument, job: Job, ctx: ClipCtx): Take | undefined {
  const out = job.outputs?.[0]
  const shot = d.shots[ctx.shotId]
  if (!out || !shot) return undefined
  if (Object.values(d.takes).some((t) => t.job_id === job.jobId)) return undefined
  const take: Take = {
    id: newUlidId('take'),
    v: 1,
    field_v: {},
    shot_id: shot.id,
    version: nextVersion(takesOf(d, shot.id)),
    ...(ctx.parentTakeId ? { parent_id: ctx.parentTakeId } : {}),
    asset: out.sha256,
    job_id: job.jobId,
    crew: crewOf(d, job),
    kind: job.kind === 'mock' ? 'mock' : 'generated',
    model: job.model ?? 'mock',
    provider: job.provider ?? 'mock',
    duration_s: out.durationS ?? shot.duration_s,
    segments: [],
  }
  d.takes[take.id] = take
  const video = mainVideo(d)
  if (video) {
    const item = edlItemFor(d, shot.id, video.id)
    if (item) video.edl[item.id].pick = { current: take.id }
    else {
      const last = edlOf(d, video.id).at(-1)
      video.edl[newUlidId('edl')] = { rank: rankBetween(last?.rank ?? null, null), kind: 'shot', shot_id: shot.id, pick: { current: take.id } }
    }
  }
  // A clip made from a frame that has since changed lands out of date; one from the frame picked now lifts the mark.
  refreshClipStale(d, shot.id)
  for (const id of ctx.reviewIds ?? []) {
    const r = d.reviews[id]
    if (!r) continue
    r.state = 'resolved'
    r.resolved_by_job = job.jobId
  }
  return take
}

/** A stitch job's result as the main video's new render, picked now. Landing twice does nothing. */
export function applyStitch(d: ProductionDocument, job: Job): Render | undefined {
  const out = job.outputs?.[0]
  const video = mainVideo(d)
  if (!out || !video) return undefined
  if (Object.values(d.renders).some((r) => r.job_id === job.jobId)) return undefined
  const render: Render = {
    id: newUlidId('render'),
    v: 1,
    field_v: {},
    video_id: video.id,
    version: nextVersion(rendersOf(d, video.id)),
    ...(video.pick?.current ? { parent_id: video.pick.current } : {}),
    asset: out.sha256,
    job_id: job.jobId,
  }
  d.renders[render.id] = render
  video.pick = { current: render.id }
  return render
}

// ── landings ────────────────────────────────────────────────────────────────

/** Wren's (or, for a region edit, Rhea's) frame: "render frame v2 for shot 3". */
export function landFrame(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'frame' }>) {
  const d = store.get()
  const what = `frame v${nextVersion(framesOf(d, ctx.shotId))} for ${shotName(d, ctx.shotId)}`
  return landUpdate(store, (x) => { applyFrame(x, job, ctx) }, landingWhy(store, job.jobId, what, cardsOf(job, ctx)))
}

/** Wren's clip, picked in the cut: "render take v2 for shot 3". */
export function landTake(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'clip' }>) {
  const d = store.get()
  const what = `take v${nextVersion(takesOf(d, ctx.shotId))} for ${shotName(d, ctx.shotId)}`
  return landUpdate(store, (x) => { applyTake(x, job, ctx) }, landingWhy(store, job.jobId, what, cardsOf(job, ctx)))
}

/** Edie's ad, picked as the video's render: "edit the ad v2". */
export function landRender(store: DocumentStore, job: Job, ctx?: Extract<JobCtx, { for: 'stitch' }>) {
  const d = store.get()
  const what = `the ad v${nextVersion(rendersOf(d))}`
  return landUpdate(store, (x) => { applyStitch(x, job) }, landingWhy(store, job.jobId, what, cardsOf(job, ctx)))
}
