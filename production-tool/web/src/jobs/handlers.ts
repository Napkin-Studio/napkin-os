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

import { applyPatchGeneration, crewFor, newUlidId, type PatchDoc, type PatchJob } from '../../../clan-store/src'
import type { Aspect, CrewId, DirectorCard, Frame, Generation, GenerationDelta, Job, Output, PersonRef, ProductionDocument, Render } from '../contracts/types'
import { aspectOfRatio, exactRatio, reducedAspect } from '../canvas/core/sketch'
import { landUpdate } from '../doc/store'
import type { DocumentStore, WriteWhy } from '../doc/types'
import type { JobCtx } from '../doc/ui'
import { framesOf, mainVideo, rendersOf, shotName, takesOf, videoOfShot } from '../model/selectors'
import { pickInCut } from '../doc/cutWrites'
import { modelLabel } from '../capabilities'
import { landingWhy } from './landing'
import { takeTiming, takeWindows } from './takeTiming'

export { applyShotList, landShotList } from './plan'
export { landingWhy } from './landing'

type FrameCtx = Pick<Extract<JobCtx, { for: 'frame' }>, 'shotId' | 'parentFrameId'>
type ClipCtx = Pick<Extract<JobCtx, { for: 'clip' }>, 'shotId' | 'parentTakeId' | 'reviewIds' | 'endFrameId'>
type RunCtx = Pick<Extract<JobCtx, { for: 'run' }>, 'videoId' | 'runId'>
type RemakeCtx = Pick<Extract<JobCtx, { for: 'remake' }>, 'videoId' | 'parentId'>

/** Where a landing puts a new take: the Video editor puts it in the cut (as before the rooms); the rooms
 *  never do (features/make-and-edit.clan: a new take never touches the timeline). */
export interface LandOpts { inCut: boolean }
const IN_CUT: LandOpts = { inCut: true }

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
  return frame
}

/** Who asked for a job: its starter in the document, else the project's maker (a generation's `by`). */
function askedBy(d: ProductionDocument, jobId: string): PersonRef {
  const by = d.jobs[jobId]?.started_by
  return by && /^human:[A-Za-z0-9_:-]{1,128}$/.test(by) ? by : d.project.created_by
}
const madeAt = (d: ProductionDocument, jobId: string) => d.jobs[jobId]?.created_at ?? new Date().toISOString()

/** What a remake changed, as the relay answered it (Job.remake: `from` filled from the parent's request). */
export function remakeDelta(job: Pick<Job, 'remake'>): GenerationDelta[] {
  return (job.remake?.delta ?? []).map((x) => ({
    field: x.field, ...(x.shotId ? { shot_id: x.shotId } : {}), ...(x.from !== undefined ? { from: x.from } : {}), to: x.to,
  }))
}

/** The summary of what a clip was made from: the model, level and size it ran at, each shot's camera, its length. */
function inputsOf(d: ProductionDocument, job: Job, shotIds: string[], lengthS: number, parent?: Generation): Generation['inputs'] {
  const sized = job.quality ?? (job.op === 'clip_edit' && parent?.inputs?.quality ? { level: parent.inputs.quality, size: parent.inputs.size ?? '' } : undefined)
  const camera = Object.fromEntries(shotIds.filter((id) => d.shots[id]).map((id) => [id, { ...d.shots[id].camera }]))
  return {
    ...(job.model ? { model: job.model } : {}),
    ...(sized?.level ? { quality: sized.level } : {}),
    ...(sized?.size ? { size: sized.size } : {}),
    ...(Object.keys(camera).length ? { camera } : {}),
    length_s: lengthS,
  }
}

/** A clip job's result as a new generation of the shot (its parent's, when it has one); the notes it fixed are
 *  resolved. In the Video editor it is also picked in its video's cut (`opts.inCut`). Landing twice does nothing. */
export function applyTake(d: ProductionDocument, job: Job, ctx: ClipCtx, opts: LandOpts = IN_CUT): Generation | undefined {
  const out = job.outputs?.[0]
  const shot = d.shots[ctx.shotId]
  if (!out || !shot) return undefined
  if (Object.values(d.generations).some((g) => g.job_id === job.jobId)) return undefined
  const parent = ctx.parentTakeId ? d.generations[ctx.parentTakeId] : undefined
  const durationS = out.durationS ?? shot.duration_s
  const g: Generation = {
    id: newUlidId('gen'),
    v: 1,
    field_v: {},
    kind: parent ? (job.op === 'clip_edit' ? 'feel' : 'change') : 'clip',
    ...(parent ? { parent_id: parent.id } : {}),
    inputs: inputsOf(d, job, [shot.id], durationS, parent),
    shot_ids: [shot.id],
    asset: out.sha256,
    duration_s: durationS,
    state: 'ready',
    job_id: job.jobId,
    provider: job.provider ?? 'mock',
    crew: crewOf(d, job),
    ...(job.kind === 'mock' ? { mock: true as const } : {}),
    // It ends on the next shot's frame (features/connected-video.clan): stitch retimes it whole.
    ...(ctx.endFrameId ? { end: { kind: 'next_storyboard' as const, frame_id: ctx.endFrameId } } : {}),
    created_at: madeAt(d, job.jobId),
    by: askedBy(d, job.jobId),
  }
  // Where it really reached its last frame (the relay's landS): models get there early and carry on past it, so
  // the take is used up to that frame. A take's window of its own take (Remake just this shot) lands the same way.
  if (job.landS !== undefined) {
    g.end = { ...(g.end ?? { kind: 'none' as const }), at_s: job.landS, ...(job.landScore !== undefined ? { score: job.landScore } : {}) }
  }
  d.generations[g.id] = g
  const video = videoOfShot(d, shot.id)
  if (video) {
    if (opts.inCut) pickInCut(d, video.id, shot.id, g.id)
    // The last clip of a run of single clips finishes it.
    for (const r of Object.values(video.runs ?? {})) {
      if (r.state === 'running' && !r.job_id && r.shot_ids.includes(shot.id) && r.shot_ids.every((id) => takesOf(d, id).length)) r.state = 'done'
    }
  }
  for (const id of ctx.reviewIds ?? []) {
    const r = d.reviews[id]
    if (!r) continue
    r.state = 'resolved'
    r.resolved_by_job = job.jobId
  }
  return g
}

/** A take of a run (features/connected-video.clan) as ONE generation of its box (box_id the run), with a window
 *  per shot (its segments: from the job's cuts, found else planned). In the Video editor each shot's clip in the
 *  cut becomes its window (`opts.inCut`). Shots deleted while it ran are left out. Landing twice does nothing. */
export function applyRunTake(d: ProductionDocument, job: Job, ctx: RunCtx, opts: LandOpts = IN_CUT): Generation | undefined {
  const out = job.outputs?.[0]
  const video = d.videos[ctx.videoId]
  const run = video?.runs?.[ctx.runId]
  if (!out || !run) return undefined
  if (Object.values(d.generations).some((g) => g.job_id === job.jobId)) return undefined
  const durations = run.shot_ids.map((id) => d.shots[id]?.duration_s ?? 0)
  const { totalS, starts } = takeTiming(durations)
  const durationS = out.durationS ?? totalS
  const windows = takeWindows(durations, starts, job.cuts, durationS)
  const shots = run.shot_ids.map((id, i) => ({ id, w: windows[i] })).filter((x) => d.shots[x.id])
  const g: Generation = {
    id: newUlidId('gen'), v: 1, field_v: {},
    kind: 'together',
    inputs: inputsOf(d, job, shots.map((x) => x.id), durationS),
    box_id: ctx.runId,
    shot_ids: shots.map((x) => x.id),
    segments: shots.map((x) => ({ shot_id: x.id, in_s: x.w.in_s, out_s: Math.min(x.w.out_s, durationS), by: x.w.by })),
    asset: out.sha256,
    duration_s: durationS,
    state: 'ready',
    job_id: job.jobId,
    provider: job.provider ?? 'mock',
    crew: crewOf(d, job),
    ...(job.kind === 'mock' ? { mock: true as const } : {}),
    created_at: madeAt(d, job.jobId),
    by: askedBy(d, job.jobId),
  }
  d.generations[g.id] = g
  if (opts.inCut) for (const x of shots) pickInCut(d, video.id, x.id, g.id)
  run.state = 'done'
  return g
}

/**
 * A remake (Change this…, features/make-and-edit.clan) as a new generation beside its parent: the parent's shots,
 * box and windows (a box made together keeps its cuts, from the job's when it found them), with the relay's
 * delta. Never put into the cut: the Edit room offers it on the parent's clips (New take ready). A moment is a
 * patch (clan-store applyPatchGeneration). Landing twice does nothing.
 */
export function applyRemake(d: ProductionDocument, job: Job, ctx: RemakeCtx): Generation | undefined {
  const out = job.outputs?.[0]
  const parentId = job.remake?.parentId ?? ctx.parentId
  const parent = d.generations[parentId]
  if (!out || !parent) return undefined
  if (Object.values(d.generations).some((g) => g.job_id === job.jobId)) return undefined
  const delta = remakeDelta(job)
  if (job.op === 'clip_patch') {
    const note = delta.find((x) => x.field === 'moment')?.to as { note?: string } | undefined
    const made = applyPatchGeneration(d as unknown as PatchDoc, job as unknown as PatchJob, { parentId, by: askedBy(d, job.jobId), now: madeAt(d, job.jobId), ...(note?.note ? { note: note.note } : {}) })
    return made ? d.generations[made.id] : undefined
  }
  const durationS = out.durationS ?? parent.duration_s ?? 0
  let segments = parent.segments?.map((x) => ({ ...x }))
  if (segments?.length && job.cuts?.length) {
    const durations = segments.map((x) => x.out_s - x.in_s)
    const { starts } = takeTiming(durations)
    const w = takeWindows(durations, starts, job.cuts, durationS)
    segments = segments.map((x, i) => ({ shot_id: x.shot_id, in_s: w[i].in_s, out_s: Math.min(w[i].out_s, durationS), by: w[i].by }))
  } else if (segments?.length) {
    segments = segments.map((x) => ({ ...x, in_s: Math.min(x.in_s, durationS), out_s: Math.min(x.out_s, durationS) })).filter((x) => x.out_s > x.in_s)
  }
  const g: Generation = {
    id: newUlidId('gen'), v: 1, field_v: {},
    kind: job.op === 'clip_edit' ? 'feel' : 'change',
    parent_id: parent.id,
    ...(delta.length ? { delta } : {}),
    inputs: inputsOf(d, job, parent.shot_ids, durationS, parent),
    ...(parent.box_id ? { box_id: parent.box_id } : {}),
    shot_ids: [...parent.shot_ids],
    ...(segments?.length ? { segments } : {}),
    asset: out.sha256,
    duration_s: durationS,
    state: 'ready',
    job_id: job.jobId,
    provider: job.provider ?? 'mock',
    crew: crewOf(d, job),
    ...(job.kind === 'mock' ? { mock: true as const } : {}),
    created_at: madeAt(d, job.jobId),
    by: askedBy(d, job.jobId),
  }
  // The camera it was really made with: the parent's, with the delta's movement.
  for (const x of delta) {
    if (x.field === 'camera.movement' && x.shot_id && g.inputs?.camera?.[x.shot_id]) g.inputs.camera[x.shot_id].movement = x.to as never
  }
  d.generations[g.id] = g
  return g
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

/** Fin's clip (in the Video editor, picked in the cut): "render take v2 for shot 3". */
export function landTake(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'clip' }>, opts: LandOpts = IN_CUT) {
  const d = store.get()
  const what = `take v${takesOf(d, ctx.shotId).length + 1} for ${shotName(d, ctx.shotId)}`
  return landUpdate(store, (x) => { applyTake(x, job, ctx, opts) }, softenedWhy(job, landingWhy(store, job.jobId, what, cardsOf(job, ctx))))
}

/** A new take with one thing changed, beside its parent: "render a new take of box 2 (camera: handheld)". */
export function landRemake(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'remake' }>) {
  const d = store.get()
  const parent = d.generations[job.remake?.parentId ?? ctx.parentId]
  const shots = parent?.shot_ids.map((id) => shotName(d, id)) ?? []
  const changed = remakeDelta(job).map((x) => x.field.replace('camera.movement', 'camera movement')).join(', ')
  const what = `a new take of ${shots.length > 1 ? `${shots[0]} to ${shots.at(-1)}` : shots[0] ?? 'a take'}${changed ? ` (${changed} changed)` : ''}`
  return landUpdate(store, (x) => { applyRemake(x, job, ctx) }, softenedWhy(job, landingWhy(store, job.jobId, what, cardsOf(job))))
}

/** Wren's take of a run: "render one take of shots 2-5 on WAN 3", citing the job (its credits show in History). */
export function landRunTake(store: DocumentStore, job: Job, ctx: Extract<JobCtx, { for: 'run' }>, opts: LandOpts = IN_CUT) {
  const d = store.get()
  const run = d.videos[ctx.videoId]?.runs?.[ctx.runId]
  const n = run ? run.shot_ids.map((id) => shotName(d, id)) : []
  const what = `one take of ${n.length ? `${n[0]} to ${n.at(-1)}` : 'a run'}${job.model ? ` on ${modelLabel(job.provider, job.model) ?? job.model}` : ''}`
  return landUpdate(store, (x) => { applyRunTake(x, job, ctx, opts) }, softenedWhy(job, landingWhy(store, job.jobId, what, cardsOf(job, ctx))))
}

/** Edie's ad, picked as the video's render: "edit the ad v2". */
export function landRender(store: DocumentStore, job: Job, ctx?: Extract<JobCtx, { for: 'stitch' }>) {
  const d = store.get()
  const what = `the ad v${nextVersion(rendersOf(d, ctx?.videoId ?? mainVideo(d)?.id))}`
  return landUpdate(store, (x) => { applyStitch(x, job, ctx) }, landingWhy(store, job.jobId, what, cardsOf(job, ctx)))
}
