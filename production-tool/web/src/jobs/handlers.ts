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
import type { Aspect, CrewId, DirectorCard, Frame, Job, Output, ProductionDocument, Render, Take } from '../contracts/types'
import { aspectOfRatio, exactRatio, reducedAspect } from '../canvas/core/sketch'
import { landUpdate } from '../doc/store'
import type { DocumentStore, WriteWhy } from '../doc/types'
import type { JobCtx } from '../doc/ui'
import { edlItemFor, edlOf, framesOf, mainVideo, rendersOf, shotName, takesOf, videoOfShot } from '../model/selectors'
import { modelLabel } from '../capabilities'
import { landingWhy } from './landing'
import { refreshClipStale } from './stale'
import { takeTiming, takeWindows } from './takeTiming'

export { applyShotList, landShotList } from './plan'
export { landingWhy } from './landing'

type FrameCtx = Pick<Extract<JobCtx, { for: 'frame' }>, 'shotId' | 'parentFrameId'>
type ClipCtx = Pick<Extract<JobCtx, { for: 'clip' }>, 'shotId' | 'parentTakeId' | 'reviewIds' | 'endFrameId'>
type RunCtx = Pick<Extract<JobCtx, { for: 'run' }>, 'videoId' | 'runId'>

/** The cards the director was given, for the rationale: the relay's block, else what this browser kept. */
const cardsOf = (job: Job, ctx?: { cards?: DirectorCard[] }) => job.director?.cards ?? ctx?.cards

const crewOf = (d: ProductionDocument, job: Job): CrewId => (d.jobs[job.jobId]?.crew ?? job.crew ?? crewFor(job.op)) as CrewId
const nextVersion = (versions: { version: number }[]) => Math.max(0, ...versions.map((x) => x.version)) + 1

/**
 * The frame's crop, when the relay centre-cropped the model's size to the job's shape
 * (features/frame-aspect.clan): from the model's size to `to` (the sketch's aspect, else the
 * output's own shape, one of the four ratios when it is one).
 */
export function croppedTo(out: Output, to?: Aspect): Frame['cropped_to'] | undefined {
  if (!out.croppedFrom || !out.w || !out.h) return undefined
  const own = { w: out.w, h: out.h }
  const r = exactRatio(own)
  return { from: { ...out.croppedFrom }, to: to ? { ...to } : r ? aspectOfRatio(r) : reducedAspect(own) }
}

/** A Generate on a sketch area as a frame made from it (features/frame-aspect.clan). Landing twice does nothing. */
export function applySketchFrame(d: ProductionDocument, job: Job, sketchId: string): Frame | undefined {
  const out = job.outputs?.[0]
  if (!out) return undefined
  if (Object.values(d.frames).some((f) => f.job_id === job.jobId)) return undefined
  const sketch = d.sketches[sketchId]
  // "cropped to 16:9": the sketch's ratio, else its exact shape in lowest terms.
  const crop = croppedTo(out, sketch ? (sketch.ratio ? aspectOfRatio(sketch.ratio) : reducedAspect(sketch.aspect)) : undefined)
  const frame: Frame = {
    id: newUlidId('frame'),
    v: 1,
    field_v: {},
    // The area may have gone while the job ran: the frame stays, without its sketch_id.
    ...(sketch ? { sketch_id: sketchId } : {}),
    version: nextVersion(Object.values(d.frames).filter((f) => sketch && f.sketch_id === sketchId)),
    kind: job.kind === 'mock' ? 'mock' : 'generated',
    asset: out.sha256,
    job_id: job.jobId,
    crew: crewOf(d, job),
    ...(job.model ? { model: job.model } : {}),
    ...(job.provider ? { provider: job.provider } : {}),
    ...(crop ? { cropped_to: crop } : {}),
  }
  d.frames[frame.id] = frame
  return frame
}

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
  const crop = croppedTo(out)
  if (crop) frame.cropped_to = crop
  d.frames[frame.id] = frame
  // The new version is the frame in the shot (Keep both, which keeps the earlier one as an alternate, is the panel's).
  shot.pick = { current: frame.id }
  if (shot.status === 'locked') shot.status = 'needs_review'
  // A new frame puts its own clip out of date, never the next frame (features/one-to-one-updates.clan).
  refreshClipStale(d, shot.id)
  return frame
}

/** A clip job's result as the shot's new take, picked in its video's cut (selectors videoOfShot) (its edl item is made, after
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
    // It ends on the next shot's frame (features/connected-video.clan): stitch retimes it whole.
    ...(ctx.endFrameId ? { end: { kind: 'next_storyboard' as const, frame_id: ctx.endFrameId } } : {}),
  }
  // Where it really reached its last frame (the relay's landS): models get there early and carry on past it, so
  // the take is used up to that frame. A take's window of its own take (Remake just this shot) lands the same way.
  if (job.landS !== undefined) {
    take.end = { ...(take.end ?? { kind: 'none' as const }), at_s: job.landS, ...(job.landScore !== undefined ? { score: job.landScore } : {}) }
  }
  // Its level and size (features/clip-quality.clan): what the relay ran, or for an edit that keeps the clip's
  // size, its source take's.
  const parent = ctx.parentTakeId ? d.takes[ctx.parentTakeId] : undefined
  const sized = job.quality ?? (job.op === 'clip_edit' && parent?.quality ? { level: parent.quality, size: parent.size } : undefined)
  if (sized?.level) take.quality = sized.level
  if (sized?.size) take.size = sized.size
  d.takes[take.id] = take
  const video = videoOfShot(d, shot.id)
  if (video) {
    pickInCut(d, video.id, shot.id, take.id)
    // The last clip of a run of single clips finishes it.
    for (const r of Object.values(video.runs ?? {})) {
      if (r.state === 'running' && !r.job_id && r.shot_ids.includes(shot.id) && r.shot_ids.every((id) => takesOf(d, id).length)) r.state = 'done'
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

/** Pick `takeId` in the video's cut for its shot (its edl item is made, after the others, when it has none). */
function pickInCut(d: ProductionDocument, videoId: string, shotId: string, takeId: string) {
  const video = d.videos[videoId]
  const item = edlItemFor(d, shotId, videoId)
  if (item) video.edl[item.id].pick = { current: takeId }
  else {
    const last = edlOf(d, videoId).at(-1)
    video.edl[newUlidId('edl')] = { rank: rankBetween(last?.rank ?? null, null), kind: 'shot', shot_id: shotId, pick: { current: takeId } }
  }
}

/** A take of a run (features/connected-video.clan) as one take per shot, each a window of the same file
 *  (segments[0]: from the job's cuts, found else planned), picked in the cut. Shots deleted while it ran
 *  are skipped. Landing twice does nothing. */
export function applyRunTake(d: ProductionDocument, job: Job, ctx: RunCtx): Take[] {
  const out = job.outputs?.[0]
  const video = d.videos[ctx.videoId]
  const run = video?.runs?.[ctx.runId]
  if (!out || !run) return []
  if (Object.values(d.takes).some((t) => t.job_id === job.jobId)) return []
  const durations = run.shot_ids.map((id) => d.shots[id]?.duration_s ?? 0)
  const { totalS, starts } = takeTiming(durations)
  const windows = takeWindows(durations, starts, job.cuts, out.durationS ?? totalS)
  const made: Take[] = []
  for (const [i, shotId] of run.shot_ids.entries()) {
    if (!d.shots[shotId]) continue
    const id = newUlidId('take')
    const take: Take = {
      id, v: 1, field_v: {},
      shot_id: shotId,
      version: nextVersion(takesOf(d, shotId)),
      asset: out.sha256,
      job_id: job.jobId,
      crew: crewOf(d, job),
      kind: job.kind === 'mock' ? 'mock' : 'generated',
      model: job.model ?? 'mock',
      provider: job.provider ?? 'mock',
      duration_s: out.durationS ?? totalS,
      segments: [{ source_take: made[0]?.id ?? id, in_s: windows[i].in_s, out_s: windows[i].out_s, job_id: job.jobId, by: windows[i].by }],
      ...(job.quality?.level ? { quality: job.quality.level } : {}),
      ...(job.quality?.size ? { size: job.quality.size } : {}),
    }
    d.takes[id] = take
    pickInCut(d, video.id, shotId, id)
    refreshClipStale(d, shotId)
    made.push(take)
  }
  run.state = 'done'
  return made
}

/** A stitch job's result as its video's new render (ctx.videoId, else the main video), picked now.
 *  Landing twice does nothing. */
export function applyStitch(d: ProductionDocument, job: Job, ctx?: { videoId?: string }): Render | undefined {
  const out = job.outputs?.[0]
  const video = (ctx?.videoId && d.videos[ctx.videoId]) || mainVideo(d)
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

/** Dex's History line when Runway refused a clip's first words and the relay sent them plainer
 *  (features/connected-video.clan): said once, before the rest of the job's account. */
export const SOFTENED_NOTE = 'Runway refused the first wording; I made it plainer.'
export function softenedWhy(job: Pick<Job, 'softened'>, why: WriteWhy): WriteWhy {
  if (!job.softened || why.rationale?.includes(SOFTENED_NOTE)) return why
  return { ...why, rationale: `${SOFTENED_NOTE} ${why.rationale ?? ''}`.trim() }
}

/** Fin's (or, for a region edit, Rhea's) frame: "render frame v2 for shot 3". */
export function landFrame(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'frame' }>) {
  const d = store.get()
  const what = `frame v${nextVersion(framesOf(d, ctx.shotId))} for ${shotName(d, ctx.shotId)}`
  return landUpdate(store, (x) => { applyFrame(x, job, ctx) }, landingWhy(store, job.jobId, what, cardsOf(job, ctx)))
}

/** Fin's clip, picked in the cut: "render take v2 for shot 3". */
export function landTake(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'clip' }>) {
  const d = store.get()
  const what = `take v${nextVersion(takesOf(d, ctx.shotId))} for ${shotName(d, ctx.shotId)}`
  return landUpdate(store, (x) => { applyTake(x, job, ctx) }, softenedWhy(job, landingWhy(store, job.jobId, what, cardsOf(job, ctx))))
}

/** Wren's take of a run: "render one take of shots 2-5 on WAN 3", citing the job (its credits show in History). */
export function landRunTake(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'run' }>) {
  const d = store.get()
  const run = d.videos[ctx.videoId]?.runs?.[ctx.runId]
  const n = run ? run.shot_ids.map((id) => shotName(d, id)) : []
  const what = `one take of ${n.length ? `${n[0]} to ${n.at(-1)}` : 'a run'}${job.model ? ` on ${modelLabel(job.provider, job.model) ?? job.model}` : ''}`
  return landUpdate(store, (x) => { applyRunTake(x, job, ctx) }, softenedWhy(job, landingWhy(store, job.jobId, what, cardsOf(job, ctx))))
}

/** Edie's ad, picked as the video's render: "edit the ad v2". */
export function landRender(store: DocumentStore, job: Job, ctx?: Extract<JobCtx, { for: 'stitch' }>) {
  const d = store.get()
  const what = `the ad v${nextVersion(rendersOf(d, ctx?.videoId ?? mainVideo(d)?.id))}`
  return landUpdate(store, (x) => { applyStitch(x, job, ctx) }, landingWhy(store, job.jobId, what, cardsOf(job, ctx)))
}
