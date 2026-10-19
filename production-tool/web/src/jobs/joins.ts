// How each shot joins the one before it (features/connected-video.clan, design 4.1). Dex sets the join
// quietly from the shot list: a new scene is a cut; the same camera setup carries on (continue); a new
// angle on the same moment is a match; any other new angle is a cut. Dissolve and dip are only ever asked
// for. A person's join (seam.by "human", set on the gap chip) always wins. Pure reads of the document,
// shared by the run planner (jobs/runs.ts), the clip requests (jobs/clips.ts) and the editors.

import type { Camera, Id, ProductionDocument, Seam, SeamKind, Shot } from '../contracts/types'
import { beatsOf, edlItemFor, jobsList } from '../model/selectors'
import { purposeOf } from '../model/purpose'

/** What the planner reads of a shot. */
export interface PlanShot {
  id: Id
  kind: 'shot' | 'end_card'
  sceneId?: Id
  camera: Camera
  durationS: number
  /** It has a picked storyboard frame. */
  hasFrame: boolean
  /** Someone speaks on screen (a line beat): audio Path 1, made alone on Veo with sound. */
  spoken: boolean
  /** It names a product picture: it starts a run, so its frame is pinned. */
  product: boolean
  /** On-screen type (a logo or typography picture): it stands alone. */
  text: boolean
  /** Its last clip was refused by the safety check: it stands alone. */
  moderated: boolean
  /** It already has a clip, or one is being made: in no run, but still a frame the shot before may land on. */
  made?: boolean
  /** The moments its beats belong to (a match join shares one). */
  moments?: Id[]
  /** The join into it a person chose. */
  human?: Seam
}

/** The join into a shot as stored on its edl item in the video (absent: none stored). */
export function storedSeam(d: ProductionDocument, shotId: Id, videoId?: Id): Seam | undefined {
  return edlItemFor(d, shotId, videoId)?.seam
}

const ROLES = (d: ProductionDocument, shot: Shot) => (shot.refs ?? []).map((id) => d.refs[id]?.role).filter(Boolean)

/** A shot's last clip was refused by the safety check. */
function refused(d: ProductionDocument, shotId: Id): boolean {
  const jobs = jobsList(d)
  for (let i = jobs.length - 1; i >= 0; i--) {
    const p = purposeOf(jobs[i])
    if (jobs[i].op !== 'clip' || p?.for !== 'clip' || p.shotId !== shotId) continue
    return jobs[i].state === 'failed' && jobs[i].error?.code === 'moderated'
  }
  return false
}

/** The planner's view of a shot in `videoId`. */
export function planShot(d: ProductionDocument, shot: Shot, opts: { hasFrame: boolean; made?: boolean; videoId?: Id }): PlanShot {
  const roles = ROLES(d, shot)
  const beats = beatsOf(d, shot.id)
  const human = storedSeam(d, shot.id, opts.videoId)
  return {
    id: shot.id,
    kind: shot.kind,
    ...(shot.scene_id ? { sceneId: shot.scene_id } : {}),
    camera: shot.camera,
    durationS: shot.duration_s,
    hasFrame: opts.hasFrame,
    spoken: beats.some((b) => b.kind === 'line'),
    product: roles.includes('product'),
    text: roles.includes('typography') || roles.includes('logo'),
    moderated: refused(d, shot.id),
    ...(opts.made ? { made: true } : {}),
    moments: beats.map((b) => b.moment_id).filter((m): m is Id => !!m),
    ...(human?.by === 'human' ? { human } : {}),
  }
}

const sameSetup = (a: Camera, b: Camera) => a.size === b.size && (a.angle ?? 'eye_level') === (b.angle ?? 'eye_level')
  && (a.lens_mm ?? null) === (b.lens_mm ?? null) && !!a.macro === !!b.macro

/** The join from `prev` into `next`: the person's, else Dex's from scene, camera and moment. */
export function joinKind(prev: PlanShot, next: PlanShot): Seam {
  if (next.human) return next.human
  const crew = (kind: SeamKind): Seam => ({ kind, by: 'crew' })
  if ((prev.sceneId ?? null) !== (next.sceneId ?? null)) return crew('cut')
  if (prev.kind === 'end_card' || next.kind === 'end_card') return crew('cut')
  if (sameSetup(prev.camera, next.camera)) return crew('continue')
  if (next.moments?.some((m) => prev.moments?.includes(m))) return crew('match')
  return crew('cut')
}
