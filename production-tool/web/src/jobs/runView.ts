// What the editors show of runs (features/connected-video.clan; the owner's "Strips + select", 2026-10-19):
// the shots that will be one video sit together as a strip, the others as their own cards. A person splits
// a strip (✂), joins neighbours (🔗) or selects shots and makes them one video or separate; each writes the
// person's boxes (video.runs planned_by human: inside a box the shots carry on) and one History entry. Also each run's progress and the pin or
// "guide" on each storyboard frame. No mode name and no price is ever shown.

import { newUlidId } from '../../../clan-store/src'
import type { Config, Id, ModelChoice, ProductionDocument, RunMode, Seam, SeamKind, VideoJoin } from '../contracts/types'
import type { UiState } from '../doc/ui'
import { updateDoc } from '../doc/store'
import type { DocumentStore } from '../doc/types'
import { currentTake, shotNumber, shotSegment, shotsOf, storyboardOfVideo, takesOf } from '../model/selectors'
import { videoQuality } from './clips'
import { selectedFrame } from './frames'
import { joinKind, planShot, type PlanShot } from './joins'
import { isOneTake, isTakeRun, joinBlock, planModel, planRuns, shotsWords, speakerModel, takeModelFor, type PlannedRun, type PlanModel, type RunPlan } from './runs'
import { isMoving, jobAt } from './select'

/** How a video's shots join, when connected video is on (null: off, today's per-shot path). */
export function videoJoin(d: ProductionDocument, videoId: Id | undefined, config: Pick<Config, 'flags'>): VideoJoin | null {
  if (!config.flags.connectedVideo) return null
  return (videoId && d.videos[videoId]?.join) || 'film'
}

/** The model the video's clips would be made on now, as the planner reads it. */
export function videoModel(d: ProductionDocument, videoId: Id | undefined, config: Config, choice?: ModelChoice): PlanModel | null {
  return planModel(config, choice, videoQuality(d, videoId))
}

/** The planner's view of a video's shots, in order. */
export function videoShots(d: ProductionDocument, videoId: Id | undefined): PlanShot[] {
  const sb = storyboardOfVideo(d, videoId)
  return (sb ? shotsOf(d, sb.id) : []).map((s) => planShot(d, s, { hasFrame: !!selectedFrame(d, s.id), videoId }))
}

/** The live plan for all of a video's shots (as if none were made yet): what Make all would do. */
export function videoPlan(d: ProductionDocument, videoId: Id | undefined, model: PlanModel): RunPlan {
  return planRuns(videoShots(d, videoId), model, { join: 'film', speaker: speakerModel(model), takeModel: takeModelFor(model) })
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

/** Write a person's join into each shot of `joins`, as their boxes: the shots are grouped by every join as it
 *  will be (theirs, else as it is now), and each group a changed join touches becomes one of their boxes (an
 *  earlier box of theirs over those shots that was never made goes). */
function writeJoins(x: ProductionDocument, videoId: Id, joins: [Id, SeamKind][]) {
  const v = x.videos[videoId]
  if (!v) return
  const shots = videoShots(x, videoId)
  const want = new Map(joins.filter(([id]) => x.shots[id]))
  const at = new Map(shots.map((s, i) => [s.id, i]))
  const groups: Id[][] = []
  for (const [i, s] of shots.entries()) {
    const kind = i === 0 ? 'cut' : want.get(s.id) ?? joinKind(shots[i - 1], s).kind
    if (!groups.length || kind !== 'continue') groups.push([s.id])
    else groups.at(-1)!.push(s.id)
  }
  const touched = new Set([...want.keys()].flatMap((id) => [id, shots[(at.get(id) ?? 0) - 1]?.id].filter((s): s is Id => !!s)))
  const write = groups.filter((g) => g.some((id) => touched.has(id)))
  const inWrite = new Set(write.flat())
  v.runs ??= {}
  for (const [id, r] of Object.entries(v.runs)) {
    if (r.planned_by === 'human' && r.state === 'planned' && !r.job_id && r.shot_ids.some((s) => inWrite.has(s))) delete v.runs[id]
  }
  for (const g of write) v.runs[newUlidId('run')] = { shot_ids: g, mode: g.length > 1 ? 'take' : 'alone', model: '', state: 'planned', planned_by: 'human' }
}

/** ✂ Split here: the video before `shotId` ends there (a cut, by a person; one History entry, one undo step). */
export function splitHere(store: DocumentStore, videoId: Id, shotId: Id) {
  const n = shotNumber(store.get(), shotId)
  return updateDoc(store, (x) => writeJoins(x, videoId, [[shotId, 'cut']]), `split the video between shot ${n - 1} and shot ${n}`)
}

/** 🔗 Join into one video: `shotId` carries on from the shot before it (a continue, by a person). */
export function joinHere(store: DocumentStore, videoId: Id, shotId: Id) {
  const n = shotNumber(store.get(), shotId)
  return updateDoc(store, (x) => writeJoins(x, videoId, [[shotId, 'continue']]), `join shot ${n - 1} and shot ${n} into one video`)
}

/** Whether the selected shots can be one video; why not, in words. */
export function selectionBlock(d: ProductionDocument, videoId: Id | undefined, ids: Id[]): string | undefined {
  const shots = videoShots(d, videoId)
  const at = ids.map((id) => shots.findIndex((s) => s.id === id)).filter((i) => i >= 0).sort((a, b) => a - b)
  if (at.length < 2) return 'Pick two shots or more'
  if (at.some((i, k) => k > 0 && i !== at[k - 1] + 1)) return 'Pick shots that sit next to each other'
  for (let k = 1; k < at.length; k++) {
    const why = joinBlock(shots[at[k] - 1], shots[at[k]], at[k])
    if (why) return why
  }
  return undefined
}

/** One video: the selected shots become one strip (continue between them, a cut at each end). */
export function joinSelection(store: DocumentStore, videoId: Id, ids: Id[]) {
  const d = store.get()
  const shots = videoShots(d, videoId)
  const at = ids.map((id) => shots.findIndex((s) => s.id === id)).filter((i) => i >= 0).sort((a, b) => a - b)
  const joins: [Id, SeamKind][] = at.slice(1).map((i) => [shots[i].id, 'continue'])
  if (at[0] > 0) joins.push([shots[at[0]].id, 'cut'])
  const after = shots[at.at(-1)! + 1]
  if (after) joins.push([after.id, 'cut'])
  return updateDoc(store, (x) => writeJoins(x, videoId, joins), `join ${shotsWords(d, at.map((i) => shots[i].id))} into one video`)
}

/** Separately: each selected shot is made on its own (a cut into it and after it). */
export function separateSelection(store: DocumentStore, videoId: Id, ids: Id[]) {
  const d = store.get()
  const shots = videoShots(d, videoId)
  const at = new Set(ids.map((id) => shots.findIndex((s) => s.id === id)).filter((i) => i >= 0))
  const joins: [Id, SeamKind][] = []
  for (const i of at) {
    if (i > 0) joins.push([shots[i].id, 'cut'])
    if (shots[i + 1] && !at.has(i + 1)) joins.push([shots[i + 1].id, 'cut'])
  }
  return updateDoc(store, (x) => writeJoins(x, videoId, joins), `make ${shotsWords(d, [...at].map((i) => shots[i].id))} separately`)
}

/** Every shot on its own ("Make every shot separately"): a cut at every gap. */
export function separateAll(store: DocumentStore, videoId: Id) {
  const shots = videoShots(store.get(), videoId)
  return updateDoc(store, (x) => writeJoins(x, videoId, shots.slice(1).map((s) => [s.id, 'cut'])), 'make every shot separately')
}

/** A unit of the timeline: shots that will be one video (a strip), or a shot on its own. */
export type Unit =
  | { kind: 'strip'; run: PlannedRun; shotIds: Id[]; lengthS: number; state: 'new' | 'separate' | 'making' | 'made' | 'refused'; jobId?: Id }
  | { kind: 'shot'; shotId: Id }

/** The video's shots as strips and separate shots, from the plan. A strip's state: not made, made before
 *  as separate clips, being made as one video, made as one, or refused as one: its last try failed on the
 *  provider's moderation, even once the relay had made the words plainer (features/connected-video.clan). */
export function videoUnits(d: ProductionDocument, ui: Pick<UiState, 'jobs'>, videoId: Id | undefined, plan: RunPlan | undefined): Unit[] {
  const out: Unit[] = []
  for (const s of videoShots(d, videoId)) {
    const r = plan?.runs.find((x) => x.shotIds.includes(s.id))
    if (!r || !isTakeRun(r)) {
      out.push({ kind: 'shot', shotId: s.id })
      continue
    }
    if (r.shotIds[0] !== s.id) continue
    const lengthS = r.shotIds.reduce((a, id) => a + (d.shots[id]?.duration_s ?? 0), 0)
    // The take job of exactly these shots: a refusal belongs to that set only, so a split or a join starts clean.
    const jobId = exactRunJob(d, ui, videoId, r.shotIds)
    const state = isMoving(d, jobId) ? 'making' : isOneTake(d, videoId, r.shotIds) ? 'made' : refusedJob(d, jobId) ? 'refused'
      : r.shotIds.some((id) => takesOf(d, id).length) ? 'separate' : 'new'
    out.push({ kind: 'strip', run: r, shotIds: r.shotIds, lengthS, state, ...(jobId ? { jobId } : {}) })
  }
  return out
}

/** The latest take job made for exactly `shotIds` in the video (its run's shots, the same and in order). */
export function exactRunJob(d: ProductionDocument, ui: Pick<UiState, 'jobs'>, videoId: Id | undefined, shotIds: Id[]): Id | undefined {
  return jobAt(d, ui, (c) => c.for === 'run' && c.videoId === videoId && d.videos[c.videoId]?.runs?.[c.runId]?.shot_ids.join() === shotIds.join())
}

/** One video of the ad, as a row of the timeline: several shots made as one, or one shot alone. */
export interface Row {
  shotIds: Id[]
  /** A take of several shots, a single shot, or the end card. */
  kind: 'video' | 'shot' | 'end_card'
  lengthS: number
  /** The model it runs on (a strip's own, when the pick cannot make it as one video). */
  model: PlanModel
  /** Why the model is not the pick. */
  switched?: string
  /** Not made; made before as separate clips (a video); being made; made; refused by the provider. */
  state: 'new' | 'separate' | 'making' | 'made' | 'refused'
  /** The job making or refused (a video: its take job for exactly these shots; a shot: its clip job). */
  jobId?: Id
  /** The shots after it are the same scene, but too long for one video. */
  splitAfter?: boolean
}

/** The ad as the videos it is made of, in order (features/connected-video.clan, "One row per video"). */
export function videoRows(d: ProductionDocument, ui: Pick<UiState, 'jobs'>, videoId: Id | undefined, plan: RunPlan | undefined): Row[] {
  const out: Row[] = []
  for (const s of videoShots(d, videoId)) {
    const r = plan?.runs.find((x) => x.shotIds.includes(s.id))
    if (!r) continue
    const len = (ids: Id[]) => ids.reduce((a, id) => a + (d.shots[id]?.duration_s ?? 0), 0)
    if (isTakeRun(r)) {
      if (r.shotIds[0] !== s.id) continue
      const jobId = exactRunJob(d, ui, videoId, r.shotIds)
      const state = isMoving(d, jobId) ? 'making' : isOneTake(d, videoId, r.shotIds) ? 'made' : refusedJob(d, jobId) ? 'refused'
        : r.shotIds.some((id) => takesOf(d, id).length) ? 'separate' : 'new'
      out.push({ shotIds: r.shotIds, kind: 'video', lengthS: len(r.shotIds), model: r.model, ...(r.switched ? { switched: r.switched } : {}), state,
        ...(jobId ? { jobId } : {}), ...(r.splitAfter ? { splitAfter: true } : {}) })
      continue
    }
    const jobId = jobAt(d, ui, (c) => c.for === 'clip' && c.shotId === s.id)
    const state = isMoving(d, jobId) ? 'making' : currentTake(d, s.id, videoId) ? 'made' : refusedJob(d, jobId) ? 'refused' : 'new'
    out.push({ shotIds: [s.id], kind: s.kind === 'end_card' ? 'end_card' : 'shot', lengthS: len([s.id]), model: r.model, state, ...(jobId ? { jobId } : {}) })
  }
  return out
}

/** A row's title: "One video · shots 1–5 · 8.5 s", "Shot 3 · 1.5 s", "End card · shot 6 · 1.5 s". */
export function rowTitle(d: ProductionDocument, row: Pick<Row, 'shotIds' | 'kind' | 'lengthS'>): string {
  const s = `${Math.round(row.lengthS * 10) / 10} s`
  const words = shotsWords(d, row.shotIds)
  if (row.kind === 'video') return `One video · ${words} · ${s}`
  if (row.kind === 'end_card') return `End card · ${words} · ${s}`
  return `${words[0].toUpperCase()}${words.slice(1)} · ${s}`
}

/** A row's Make in words: "Make", "Make as one video" (made before as separate clips), "Make again". */
export function rowMakeWords(row: Pick<Row, 'state'>): string {
  return row.state === 'made' ? 'Make again' : row.state === 'separate' ? 'Make as one video' : 'Make'
}

/** "0:42": how long a job has run. */
export function elapsed(createdAt: string | undefined, now = Date.now()): string {
  const s = createdAt ? Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000)) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A job that failed on the provider's moderation (Runway refused the words twice, or a picture). */
export function refusedJob(d: ProductionDocument, jobId: Id | undefined): boolean {
  const j = jobId ? d.jobs[jobId] : undefined
  return !!j && j.state === 'failed' && j.error?.code === 'moderated'
}

/** About how long a video takes to make, said quietly beside its model ("~5 min"; phase 0 T4 and T7). */
export function waitWords(model: Pick<PlanModel, 'model' | 'provider'>, lengthS: number): string {
  if (model.provider === 'mock') return '~1 min'
  const perFifteen: Record<string, number> = { wan3: 5.5, seedance2_5: 9, 'gemini_omni_flash_1.1': 1 }
  const m = Math.max(1, Math.round((perFifteen[model.model] ?? 1) * Math.max(lengthS, 5) / 15))
  return ['~', m, ' min'].join('') // a wait, not money
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
  return !!shotSegment(currentTake(d, shotId, videoId), shotId)
}

export type FrameMark = 'pin' | 'guide'

/** The pin (the video must hit this frame) or "guide" (the video takes it as a guide, inside a take) on each
 *  storyboard frame: from the take a shot's clip is a window of, else from what Make clips would do. */
export function frameMarks(d: ProductionDocument, videoId: Id | undefined, plan: RunPlan | undefined): Record<Id, FrameMark> {
  const sb = storyboardOfVideo(d, videoId)
  const out: Record<Id, FrameMark> = {}
  for (const s of sb ? shotsOf(d, sb.id) : []) {
    if (!selectedFrame(d, s.id)) continue
    const take = currentTake(d, s.id, videoId)
    const seg = shotSegment(take, s.id)
    if (seg) {
      // The box's first shot pins the take on its frame; the others guide it.
      out[s.id] = take!.segments![0].shot_id === s.id ? 'pin' : 'guide'
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

/** The shots between two cards (inclusive), in order. */
export function shotRange(order: Id[], a: Id, b: Id): Id[] {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0) return [b]
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}
