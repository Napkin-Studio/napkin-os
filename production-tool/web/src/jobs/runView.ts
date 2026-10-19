// What the editors show of runs and joins (features/connected-video.clan, design 4.5 and 4.8): the join
// between two shots in words, the joins a model allows, the run bands on the Video timeline, a run's
// progress, and the pin or "guide" on each storyboard frame. Pure reads, except setJoin and setVideoJoin
// (a person's change, one History entry each). No mode name and no price is ever shown.

import { newUlidId, rankBetween } from '../../../clan-store/src'
import type { Config, Id, ModelChoice, ProductionDocument, RunMode, Seam, SeamKind, VideoJoin } from '../contracts/types'
import type { UiState } from '../doc/ui'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { currentTake, edlItemFor, edlOf, shotNumber, shotsOf, storyboardOfVideo, takesOf } from '../model/selectors'
import { purposeOf } from '../model/purpose'
import { videoQuality } from './clips'
import { selectedFrame } from './frames'
import { joinKind, planShot } from './joins'
import { canLand, canTake, planModel, planRuns, runOf, shotsWords, type PlanModel, type RunPlan } from './runs'
import { isMoving, isRunning, jobAt } from './select'

/** How a video's shots join, when connected video is on (null: off, today's per-shot path). */
export function videoJoin(d: ProductionDocument, videoId: Id | undefined, config: Pick<Config, 'flags'>): VideoJoin | null {
  if (!config.flags.connectedVideo) return null
  return (videoId && d.videos[videoId]?.join) || 'film'
}

/** The words for "How shots join". */
export const JOIN_NAMES: Record<VideoJoin, string> = { film: 'As one film', shots: 'Shot by shot' }

/** A person picks how the video's shots join (one History entry). */
export function setVideoJoin(store: DocumentStore, videoId: Id, join: VideoJoin) {
  return updateDoc(store, (d) => { const v = d.videos[videoId]; if (v) v.join = join }, `set how shots join to ${JOIN_NAMES[join]}`)
}

/** The model the video's clips would be made on now, as the planner reads it. */
export function videoModel(d: ProductionDocument, videoId: Id | undefined, config: Config, choice?: ModelChoice): PlanModel | null {
  return planModel(config, choice, videoQuality(d, videoId))
}

/** The live plan for all of a video's shots (as if none were made yet): what Make clips would do. */
export function videoPlan(d: ProductionDocument, videoId: Id | undefined, model: PlanModel): RunPlan {
  const sb = storyboardOfVideo(d, videoId)
  const shots = sb ? shotsOf(d, sb.id) : []
  return planRuns(shots.map((s) => planShot(d, s, { hasFrame: !!selectedFrame(d, s.id), videoId })), model, { join: 'film' })
}

/** The join into a shot now: the stored person's join, else Dex's from the shots as they are now. */
export function joinBefore(d: ProductionDocument, videoId: Id | undefined, shotId: Id): Seam | undefined {
  const shot = d.shots[shotId]
  if (!shot) return undefined
  const shots = shotsOf(d, shot.storyboard_id)
  const i = shots.findIndex((s) => s.id === shotId)
  if (i <= 0) return undefined
  const fact = (id: Id) => planShot(d, d.shots[id], { hasFrame: !!selectedFrame(d, id), videoId })
  return joinKind(fact(shots[i - 1].id), fact(shotId))
}

/** The two shots sit in one take: landed from the same take job, or planned into one take. */
export function sameTake(d: ProductionDocument, videoId: Id | undefined, a: Id, b: Id, plan?: RunPlan): boolean {
  const ta = currentTake(d, a, videoId)
  const tb = currentTake(d, b, videoId)
  if (ta?.segments[0] && tb?.segments[0]) return ta.job_id === tb.job_id
  if (ta || tb) return false
  const run = plan?.runs.find((r) => r.shotIds.includes(a))
  return !!run && (run.mode === 'take' || run.mode === 'take_refs') && run.shotIds.includes(b)
}

/** A join in words, as the gap chip says it. */
export function joinLabel(kind: SeamKind, opts: { inTake: boolean; model: PlanModel | null }): string {
  if (opts.inTake) return 'One take'
  switch (kind) {
    case 'continue':
      return opts.model && canLand(opts.model) ? 'Lands on the next frame' : 'Cut'
    case 'dissolve':
      return 'Dissolve'
    case 'dip':
      return 'Dip'
    default:
      // A match is a plain cut for now (design open question 6).
      return 'Cut'
  }
}

/** The joins a person may pick on this model, in words: carrying on only where the model can make a take
 *  or land on a frame. */
export function joinChoices(model: PlanModel | null): { kind: SeamKind; label: string; hint: string }[] {
  const out: { kind: SeamKind; label: string; hint: string }[] = []
  if (model && canTake(model)) out.push({ kind: 'continue', label: 'One take', hint: 'Made together in one go' })
  else if (model && canLand(model)) out.push({ kind: 'continue', label: 'Lands on the next frame', hint: 'The clip ends on the next frame' })
  out.push({ kind: 'cut', label: 'Cut', hint: 'A clean cut to the next shot' })
  out.push({ kind: 'dissolve', label: 'Dissolve', hint: 'One shot fades into the next' })
  out.push({ kind: 'dip', label: 'Dip', hint: 'Out to black, then in' })
  return out
}

/** A person sets the join into `shotId` (seam.by human; one History entry, one undo step). The shot's cut
 *  item is made when it has none yet. */
export function setJoin(store: DocumentStore, videoId: Id, shotId: Id, kind: SeamKind, label: string) {
  const d = store.get()
  return updateDoc(store, (x) => {
    const v = x.videos[videoId]
    if (!v || !x.shots[shotId]) return
    const seam: Seam = { kind, by: 'human' }
    const item = edlItemFor(x, shotId, videoId)
    if (item) v.edl[item.id].seam = seam
    else {
      const last = edlOf(x, videoId).at(-1)
      v.edl[newUlidId('edl')] = { rank: rankBetween(last?.rank ?? null, null), kind: 'shot', shot_id: shotId, seam }
    }
  }, `set the join into shot ${shotNumber(d, shotId)} to ${label}`)
}

export interface Band { shotIds: Id[]; planned: boolean; jobId?: Id }

/**
 * The One take bands on the timeline: shots whose clips are windows of one take (landed), and shots not
 * made yet that Make clips would make as one take (planned). A frames run has no band: its gaps say
 * "Lands on the next frame".
 */
export function takeBands(d: ProductionDocument, videoId: Id | undefined, plan?: RunPlan): Band[] {
  const sb = storyboardOfVideo(d, videoId)
  const shots = sb ? shotsOf(d, sb.id) : []
  const bands: Band[] = []
  for (const s of shots) {
    const t = currentTake(d, s.id, videoId)
    const last = bands.at(-1)
    if (t?.segments[0]) {
      if (last && !last.planned && last.jobId === t.job_id) last.shotIds.push(s.id)
      else bands.push({ shotIds: [s.id], planned: false, jobId: t.job_id })
      continue
    }
    if (t || takesOf(d, s.id).length) continue
    const run = plan?.runs.find((r) => r.shotIds.includes(s.id) && (r.mode === 'take' || r.mode === 'take_refs'))
    if (!run) continue
    if (last?.planned && run.shotIds.includes(last.shotIds[0])) last.shotIds.push(s.id)
    else bands.push({ shotIds: [s.id], planned: true })
  }
  return bands.filter((b) => b.shotIds.length > 1)
}

/** Each run being made now, in words: "Making shots 2-5 together", "Making shot 6". */
export function runProgress(d: ProductionDocument, ui: Pick<UiState, 'jobs'>, videoId: Id | undefined): string[] {
  const runs = Object.values((videoId && d.videos[videoId]?.runs) || {})
  const out: string[] = []
  for (const r of runs) {
    if (r.state !== 'running') continue
    const moving = r.job_id ? isMoving(d, r.job_id)
      : r.shot_ids.some((id) => isMoving(d, jobAt(d, ui, (c) => c.for === 'clip' && c.shotId === id)))
    if (!moving) continue
    const words = shotsWords(d, r.shot_ids)
    out.push(r.job_id ? `Making ${words} together` : r.shot_ids.length > 1 ? `Making ${words}, each landing on the next` : `Making ${words}`)
  }
  return out
}

/** The take job a shot is being made in, if it is (for its card's progress). */
export function runJobFor(d: ProductionDocument, ui: Pick<UiState, 'jobs'>, shotId: Id): Id | undefined {
  return jobAt(d, ui, (c) => c.for === 'run' && !!d.videos[c.videoId]?.runs?.[c.runId]?.shot_ids.includes(shotId))
}

/** A shot's clip in the cut is a window of a take (Remake just this shot applies). */
export function inTake(d: ProductionDocument, shotId: Id, videoId?: Id): boolean {
  return !!currentTake(d, shotId, videoId)?.segments[0]
}

/** The run a shot's clip in the cut came from, when it was a take (for Make the whole run again). */
export function takeRunOf(d: ProductionDocument, shotId: Id, videoId: Id | undefined): (ReturnType<typeof runOf>) {
  const t = currentTake(d, shotId, videoId)
  if (!t?.segments[0]) return undefined
  const p = purposeOf(d.jobs[t.job_id] ?? { purpose: '', node: { kind: 'video', id: '' } })
  if (p?.for === 'run') {
    const r = d.videos[p.videoId]?.runs?.[p.runId]
    if (r) return { ...r, id: p.runId }
  }
  return runOf(d, videoId, shotId)
}

/** The run of a take is being made again. */
export function runBusy(d: ProductionDocument, run: { job_id?: Id } | undefined): boolean {
  return !!run?.job_id && isRunning(d, run.job_id)
}

/** The frame a shot's clip lands on now (a frames clip on a continue join): the next shot, if any. */
export function landingShot(plan: RunPlan | undefined, shotId: Id): Id | undefined {
  for (const r of plan?.runs ?? []) if (r.lands[shotId]) return r.lands[shotId]
  return undefined
}

export type FrameMark = 'pin' | 'guide'

/** The pin (the video must hit this frame) or "guide" (the video takes it as a guide, inside a take) on each
 *  storyboard frame: from the take a shot's clip is a window of, else from what Make clips would do. */
export function frameMarks(d: ProductionDocument, videoId: Id | undefined, plan: RunPlan | undefined): Record<Id, FrameMark> {
  const sb = storyboardOfVideo(d, videoId)
  const out: Record<Id, FrameMark> = {}
  for (const s of sb ? shotsOf(d, sb.id) : []) {
    if (!selectedFrame(d, s.id)) continue
    const seg = currentTake(d, s.id, videoId)?.segments[0]
    if (seg) {
      out[s.id] = seg.source_take === currentTake(d, s.id, videoId)!.id ? 'pin' : 'guide'
      continue
    }
    const run = plan?.runs.find((r) => r.shotIds.includes(s.id))
    if (run?.mode === 'take_refs') out[s.id] = 'guide'
    else if (run?.mode === 'take') out[s.id] = run.shotIds[0] === s.id ? 'pin' : 'guide'
    else out[s.id] = 'pin'
  }
  return out
}

/** Run modes as the shot menu needs them. */
export function isTakeMode(mode: RunMode | undefined): boolean {
  return mode === 'take' || mode === 'take_refs'
}

/**
 * Jude's guide score for a window, below its threshold: "The video went its own way here". Jude does not
 * score guide frames yet (the scores are for tuning only until calibrated, design 4.5), so this is never
 * true and the note never shows.
 */
export function missedGuide(_d: ProductionDocument, _shotId: Id): boolean {
  return false
}
