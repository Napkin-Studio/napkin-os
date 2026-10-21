// Change this frame (ui-behaviour 3.11, review item 5; features/frame-change-edit.clan). The relay's
// frame_edit job carries Dex's reading of the words (job.director.output.frameEdit) and, unless only the
// camera's movement changed, a new picture. Here are the pure pieces the storyboard editor and the
// Image editor mount inside the send tray (no UI on today's Storyboard stage):
//
//   frameEditInput   the request: the current frame, the shot with its camera, the words, a box or mask
//   cameraDiff       "angle: eye level → overhead" rows and the "Movement and lens stay" line
//   landFrameEdit    the result as a new version of the frame, unpicked (the proposal lives in the
//                    document, so a reload or another person sees it), once only
//   applyFrameEdit   the camera fields, then the new frame picked, then the clip's mark, in that order
//   keepBoth         the new frame kept as an alternate, the fields untouched
//   discard          the new frame deleted (the job, its cost and Dex's reading stay in History)
//   frameEditCopy    the spec's words, pinned by a test
//
// Each mutation runs inside one updateDoc, so each is one undo step (the *Step wrappers); the landing is
// the crew's (landUpdate), never an undo step. No price is shown anywhere (owner decision 2026-10-13).

import { crewFor, newUlidId } from '../../../clan-store/src'
import { CAMERA_WORDS } from '../contracts/load'
import type {
  Camera, CameraPatch, CameraWordField, CrewId, DocJob, Frame, FrameEditOutput, FrameReading, Job, JobInput, ProductionDocument, Region,
} from '../contracts/types'
import { landUpdate, updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { currentFrame, currentTake, framesOf, shotName, shotNumber } from '../model/selectors'
import type { JobPurpose } from '../model/purpose'
import { assetRef } from './assets'
import { croppedTo, landingWhy } from './handlers'
import { ownAspect, type FrameDeps } from './frames'
import { jobShot, refsFor } from './select'
import { editShot } from './stale'
import { liveGet } from '../model/live'

// ── the words (ui-behaviour 3.11) ──────────────────────────────────────────────────────────────

export const frameEditCopy = {
  reading: {
    camera: 'Dex read this as a camera change',
    local: 'Dex read this as a local change',
    both: 'Dex read this as a camera change and a local change',
  } satisfies Record<FrameReading, string>,
  /** Laurence's step 4: a box or mask with a camera change. */
  maskUnused: 'A camera change redraws the whole frame, so the area you marked was not used.',
  /** job.director.model is passthrough. */
  passthrough: 'Dex sent your words as they are.',
  /** Only the camera's movement changed: nothing was drawn. */
  movementOnly: 'Only the camera move changes, so the frame stays as it is.',
  apply: 'Apply',
  keepBoth: 'Keep both',
  discard: 'Discard',
  redo: 'Redo',
  applyMarksClip: (clip: number) => `Apply puts clip ${clip} out of date`,
  stay: (chips: string[]) => `${sentence(chips)} stay`,
  newVersion: (version: number) => `v${version} new`,
} as const

function sentence(words: string[]): string {
  const [first, ...rest] = words
  const head = first ? first[0].toUpperCase() + first.slice(1) : ''
  if (!rest.length) return head
  return `${[head, ...rest.slice(0, -1)].join(', ')} and ${rest.at(-1)}`
}

// ── the reading ────────────────────────────────────────────────────────────────────────────────

/** Dex's reading of a frame_edit job (director.schema.json frameEdit), when it has one. */
export function frameEditOf(job: Pick<DocJob | Job, 'director'> | undefined): FrameEditOutput | undefined {
  const out = job?.director?.output as { frameEdit?: FrameEditOutput } | undefined
  return out?.frameEdit
}

/** The lines the result shows under the thumbnail: the reading, then what the passthrough or the mask means. */
export function frameEditLines(job: Pick<DocJob | Job, 'director'>): string[] {
  const edit = frameEditOf(job)
  if (!edit) return []
  const lines: string[] = [frameEditCopy.reading[edit.reading]]
  if (edit.runAs === 'none') lines.push(frameEditCopy.movementOnly)
  if (edit.maskUnused) lines.push(frameEditCopy.maskUnused)
  if (job.director?.model === 'passthrough' || edit.words_as_given) lines.push(frameEditCopy.passthrough)
  return lines
}

// ── the diff (camera chips: size, angle, movement, lens) ──────────────────────────────────────

const FIELD_WORD: Record<keyof Camera, string> = {
  size: 'size', angle: 'angle', movement: 'movement', movement_speed: 'speed', lens_mm: 'lens', macro: 'macro',
}
const ORDER: (keyof Camera)[] = ['size', 'angle', 'movement', 'movement_speed', 'lens_mm', 'macro']
/** The four chips on a shot card, and the camera leaves each one shows. */
const CHIPS: { chip: string; leaves: (keyof Camera)[] }[] = [
  { chip: 'size', leaves: ['size'] },
  { chip: 'angle', leaves: ['angle'] },
  { chip: 'movement', leaves: ['movement', 'movement_speed'] },
  { chip: 'lens', leaves: ['lens_mm', 'macro'] },
]

/** How a camera value is said on a chip (common cameraWords' label; a lens in mm). */
export function cameraLabel(field: keyof Camera, value: unknown): string {
  if (value === undefined || value === null) return 'none'
  if (field === 'lens_mm') return `${value} mm`
  if (field === 'macro') return value ? 'macro' : 'no macro'
  return CAMERA_WORDS[field as CameraWordField]?.[String(value)]?.label ?? String(value).replace(/_/g, ' ')
}

export interface DiffRow { field: keyof Camera; from: string; to: string; line: string }

/** The field-by-field diff of a camera change ("angle: eye level → overhead"), and the line naming the chips
 *  that keep their value ("Movement and lens stay"; undefined when every chip changes). */
export function cameraDiff(camera: Camera, patch: CameraPatch | undefined): { rows: DiffRow[]; stay?: string } {
  const was = camera as unknown as Record<string, unknown>
  const now = (patch ?? {}) as Record<string, unknown>
  const rows: DiffRow[] = []
  for (const field of ORDER) {
    if (!(field in now) || JSON.stringify(now[field]) === JSON.stringify(was[field])) continue
    const from = cameraLabel(field, was[field])
    const to = cameraLabel(field, now[field])
    rows.push({ field, from, to, line: `${FIELD_WORD[field]}: ${from} → ${to}` })
  }
  const changed = new Set(rows.map((r) => r.field))
  const stay = CHIPS.filter((c) => !c.leaves.some((l) => changed.has(l))).map((c) => c.chip)
  return { rows, ...(stay.length && stay.length < CHIPS.length ? { stay: frameEditCopy.stay(stay) } : {}) }
}

// ── the request ────────────────────────────────────────────────────────────────────────────────

/** The frame_edit request for shot `shotId`: its picked frame (with its own shape), the shot as a job sends
 *  it, the refs it names, the words, and a box or mask when one was marked. No anchor or previous frame:
 *  the old framing must not come back. */
export async function frameEditInput(relay: FrameDeps['relay'], d: ProductionDocument, shotId: string, text: string,
  marked: { region?: Region; mask?: string } = {}): Promise<JobInput> {
  const shot = d.shots[shotId]
  if (!shot) throw new Error('That shot is gone.')
  const frame = currentFrame(d, shotId)
  if (!frame) throw new Error('This shot has no frame to change yet.')
  const words = text.trim()
  if (!words) throw new Error('Say what to change.')
  const refs = await refsFor(relay, d, shot, words)
  const aspect = ownAspect(d, frame.asset)
  return {
    text: words.slice(0, 1000),
    image: await assetRef(relay, frame.asset, d),
    ...(aspect ? { aspect } : {}),
    shot: jobShot(d, shot),
    ...(refs.length ? { refs } : {}),
    ...(marked.region ? { region: { ...marked.region } } : {}),
    ...(marked.mask ? { mask: await assetRef(relay, marked.mask, d) } : {}),
  }
}

/** Send Change this frame (or a Redo of `redoOf`, the earlier frame_edit job, with the reworded text). */
export async function changeFrame(deps: FrameDeps, shotId: string, text: string,
  opts: { region?: Region; mask?: string; redoOf?: string } = {}): Promise<string> {
  const d = liveGet(deps.doc)
  const input = await frameEditInput(deps.relay, d, shotId, text, opts)
  const frame = currentFrame(d, shotId)
  const purpose: JobPurpose = { for: 'frame_edit', shotId, ...(frame ? { parentFrameId: frame.id } : {}) }
  return deps.runner.submit('frame_edit', input, opts.redoOf ? [opts.redoOf] : [], purpose)
}

// ── the result ─────────────────────────────────────────────────────────────────────────────────

const nextVersion = (versions: { version: number }[]) => Math.max(0, ...versions.map((x) => x.version)) + 1

/** The new frame a frame_edit job made, when it landed. */
export function proposalOf(d: ProductionDocument, jobId: string): Frame | undefined {
  return Object.values(d.frames).find((f) => f.job_id === jobId)
}

/** A frame_edit's picture as a new version of the shot's frame, left unpicked: the card shows it with Apply,
 *  Keep both and Discard. Nothing lands for a change of movement only (no picture), and landing twice does nothing. */
export function landFrameEdit(d: ProductionDocument, job: Pick<Job, 'jobId' | 'outputs' | 'model' | 'provider' | 'crew' | 'op' | 'director'>,
  ctx: { shotId: string; parentFrameId?: string }): Frame | undefined {
  const out = job.outputs?.[0]
  const shot = d.shots[ctx.shotId]
  if (!out || !shot || proposalOf(d, job.jobId)) return undefined
  const edit = frameEditOf(job)
  const frame: Frame = {
    id: newUlidId('frame'),
    v: 1,
    field_v: {},
    shot_id: shot.id,
    version: nextVersion(framesOf(d, shot.id)),
    ...(ctx.parentFrameId ? { parent_id: ctx.parentFrameId } : {}),
    kind: 'edited',
    asset: out.sha256,
    job_id: job.jobId,
    crew: (d.jobs[job.jobId]?.crew ?? job.crew ?? crewFor(job.op)) as CrewId,
    ...(job.model ? { model: job.model } : {}),
    ...(job.provider ? { provider: job.provider } : {}),
    edits: [{ op: 'frame_edit', ...(edit ? { params: { reading: edit.reading, ...(edit.camera ? { camera: { ...edit.camera } } : {}) } } : {}) }],
  }
  const crop = croppedTo(out)
  if (crop) frame.cropped_to = crop
  d.frames[frame.id] = frame
  return frame
}

export interface Applied {
  /** The frame now picked (the new one), when the change made a picture. */
  frameId?: string
  /** The camera leaves written to the shot. */
  fields: string[]
  /** The shot's clip is now out of date. */
  clipStale: boolean
}

/**
 * Apply, as one step: the camera leaves through editShot while the old frame is still picked (so its marks go
 * on the old frame and the clip, never on the new one), then the new frame picked, then the clip's frame
 * mark. A change of movement only writes the fields and marks the clip; no frame changes.
 */
export function applyFrameEdit(d: ProductionDocument, jobId: string, shotId: string): Applied {
  const shot = d.shots[shotId]
  const job = d.jobs[jobId]
  const edit = frameEditOf(job)
  const frame = proposalOf(d, jobId)
  const fields: string[] = []
  if (!shot || !edit) return { fields, clipStale: false }
  if (edit.camera && edit.reading !== 'local') {
    const camera = { ...shot.camera, ...edit.camera } as Camera
    for (const k of ORDER) if (k in edit.camera && JSON.stringify(shot.camera[k]) !== JSON.stringify(camera[k])) fields.push(`camera/${k}`)
    if (fields.length) editShot(d, shotId, { camera })
  }
  if (frame) {
    const alternates = shot.pick?.alternates?.filter((a) => a !== frame.id)
    shot.pick = { current: frame.id, ...(alternates?.length ? { alternates } : {}) }
    if (shot.status === 'locked') shot.status = 'needs_review'
  }
  // Its clip in the cut was made from another frame: said, never marked (features/make-and-edit.clan).
  const take = currentTake(d, shotId)
  const picked = frame ?? currentFrame(d, shotId)
  const clipStale = !!take && !!picked && !(take.job_id && d.jobs[take.job_id]?.input_hashes?.includes(picked.asset))
  return { ...(frame ? { frameId: frame.id } : {}), fields, clipStale }
}

/** Keep both: the new frame stays as an alternate of the shot's frame; the camera fields do not change. */
export function keepBoth(d: ProductionDocument, jobId: string, shotId: string): Frame | undefined {
  const shot = d.shots[shotId]
  const frame = proposalOf(d, jobId)
  if (!shot || !frame || !shot.pick || shot.pick.current === frame.id) return undefined
  const alternates = [...(shot.pick.alternates ?? []).filter((a) => a !== frame.id), frame.id]
  shot.pick = { current: shot.pick.current, alternates }
  return frame
}

/** Discard: the new frame goes (unless it was picked meanwhile). The job, its cost and Dex's reading stay. */
export function discard(d: ProductionDocument, jobId: string): boolean {
  const frame = proposalOf(d, jobId)
  if (!frame) return false
  const shot = frame.shot_id ? d.shots[frame.shot_id] : undefined
  if (shot?.pick?.current === frame.id) return false
  if (shot?.pick?.alternates?.includes(frame.id)) {
    const alternates = shot.pick.alternates.filter((a) => a !== frame.id)
    shot.pick = { current: shot.pick.current, ...(alternates.length ? { alternates } : {}) }
  }
  delete d.frames[frame.id]
  for (const [id, m] of Object.entries(d.stale)) if ((m.target.kind === 'frame' && m.target.id === frame.id) || (m.caused_by.kind === 'frame' && m.caused_by.id === frame.id)) delete d.stale[id]
  return true
}

// ── one step each (the person's), and the crew's landing ──────────────────────────────────────

export function applyFrameEditStep(store: DocumentStore, jobId: string, shotId: string) {
  return updateDoc(store, (d) => { applyFrameEdit(d, jobId, shotId) }, `apply frame change ${shotName(store.get(), shotId)}`)
}

export function keepBothStep(store: DocumentStore, jobId: string, shotId: string) {
  return updateDoc(store, (d) => { keepBoth(d, jobId, shotId) }, `keep both frames ${shotName(store.get(), shotId)}`)
}

export function discardStep(store: DocumentStore, jobId: string) {
  return updateDoc(store, (d) => { discard(d, jobId) }, 'discard frame change')
}

/** Dex's landing: "render frame v3 for shot 4", unpicked (one decision by the crew, not an undo step). */
export function landFrameEditIn(store: DocumentStore, job: Job, ctx: { shotId: string; parentFrameId?: string }) {
  const d = store.get()
  if (!job.outputs?.length) return Promise.resolve(d)
  const what = `frame v${nextVersion(framesOf(d, ctx.shotId))} for ${shotName(d, ctx.shotId)}`
  return landUpdate(store, (x) => { landFrameEdit(x, job, ctx) }, landingWhy(store, job.jobId, what))
}

/** "Apply puts clip 4 out of date", when the shot has a clip in the cut. */
export function applyClipLine(d: ProductionDocument, shotId: string): string | undefined {
  return currentTake(d, shotId) ? frameEditCopy.applyMarksClip(shotNumber(d, shotId)) : undefined
}
