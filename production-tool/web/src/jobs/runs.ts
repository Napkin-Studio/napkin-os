// Shots made as runs that join into one film (features/connected-video.clan, design 4.3; phases A and B).
//
//   planRuns     pure: groups the shots into runs at hard breaks (a new scene, an end card or type shot, a
//                product shot, a person's cut/dissolve/dip, a refused shot, a spoken line) and picks each
//                run's mode from the model's sheet: one take (video.take.ok, 2 or more shots), else one clip
//                per shot that lands on the next frame on a continue join (video.lastFrame, fidelity not
//                loose), else each shot alone. A take longer than take.maxS or take.maxShots is split.
//   makeRuns     the driver behind Make clips "As one film": writes video.runs and the joins Dex chose, then
//                submits each run (frames and alone through makeClip, a take through makeTake).
//   takeWindows  pure: each shot's window of a landed take, from the take's cuts.
//
// A person never sees a mode's name: the UI says "One take", "Lands on the next frame" or "Cut". Phase C
// (carry: start on the last clip's out frame) is not built, so where the planner would carry it makes the
// shot alone, and a take's segments meet on a cut until take.withLast is proven (paid test P1).

import { newUlidId } from '../../../clan-store/src'
import { choiceToSend, modelChoicesFor, modelLabel, resolveQuality, type Sheets } from '../capabilities'
import { SHEETS } from '../contracts/load'
import type { CapabilitySheet, ClipQuality, Config, Id, ModelChoice, ProductionDocument, Provider, RunMode, Seam, SeamKind, Shot, VideoJoin, VideoRun } from '../contracts/types'
import { landUpdate, systemUpdate } from '../doc/store'
import { currentTake, shotSegment, shotsOf, storyboardOfVideo, takesOf } from '../model/selectors'
import { makeClip, makeTake, videoQuality } from './clips'
import type { FrameDeps } from './frames'
import { selectedFrame } from './frames'
import { joinKind, planShot, type PlanShot } from './joins'

export { takeTiming, takeWindows, type Window } from './takeTiming'

/** A clip may be retimed to its shot by at most this much (stitch fit "speed"); a longer one is not end-framed. */
export const SPEED_MAX = 1.33
/** A take's length and shot count when the sheet names none (design 4.3; T4 tested 15 s and 4 shots). */
export const TAKE_MAX_S = 15
export const TAKE_MAX_SHOTS = 6

/** What the planner reads of a model: its sheet entry for clip. */
export interface PlanModel {
  provider: Provider
  model: string
  label: string
  video: CapabilitySheet['video']
  durationsS?: number[]
  minS?: number
  maxS?: number
  refsMax: number
}

export interface PlannedRun {
  shotIds: Id[]
  mode: RunMode
  model: PlanModel
  /** frames: a shot whose clip ends on the next shot's frame → that shot. */
  lands: Record<Id, Id>
  /** A take on another model than the pick, and why ("Veo 3.1 Fast cannot make one video"). */
  switched?: string
  /** The shots after it carry on in the same scene but were too many or too long for one video. */
  splitAfter?: boolean
}

export interface RunPlan {
  runs: PlannedRun[]
  /** The join into each shot after the first. */
  joins: Record<Id, Seam>
}

/** The model a clip runs on for a pick (absent: the routed first) at a quality: its sheet entry. */
export function planModel(config: Config, choice: ModelChoice | undefined, quality: ClipQuality | undefined, sheets: Sheets = SHEETS): PlanModel | null {
  const pick = choice ?? modelChoicesFor('clip', config, sheets)[0]
  if (!pick) return null
  return modelEntry(pick.provider, resolveQuality('clip', pick.provider, pick.model, quality, sheets).model, sheets)
}

/** A model's clip entry on its provider's sheet; null when the sheet has no such model. */
export function modelEntry(provider: Provider, model: string, sheets: Sheets = SHEETS): PlanModel | null {
  const sheet = sheets[provider]
  const op = sheet?.ops.clip
  if (!sheet || !op) return null
  const e = [op, ...(op.alternates ?? [])].find((x) => x.model === model)
  if (!e) return null
  const cat = sheet.models[model]
  return {
    provider,
    model,
    label: modelLabel(provider, model, sheets) ?? model,
    video: ('video' in e && e.video) || sheet.video,
    ...((e.durationsS ?? cat?.durationsS) ? { durationsS: e.durationsS ?? cat?.durationsS } : {}),
    ...('minS' in e && e.minS !== undefined ? { minS: e.minS } : {}),
    ...('maxS' in e && e.maxS !== undefined ? { maxS: e.maxS } : {}),
    refsMax: (('refs' in e && e.refs) || sheet.refs).max,
  }
}

/** Spoken lines go to Veo with sound (audio Path 1, CV4): the pick when it is a Veo, else veo3.1 on its sheet. */
export function speakerModel(model: PlanModel, sheets: Sheets = SHEETS): PlanModel {
  if (model.model.startsWith('veo3.1')) return model
  return modelEntry(model.provider, 'veo3.1', sheets) ?? model
}

/** The model lands a clip on a given last frame closely enough to plan on it. */
export function canLand(model: PlanModel): boolean {
  return model.video.lastFrame && model.video.lastFrameFidelity !== 'loose'
}

/** The model makes takes of several shots. */
export function canTake(model: PlanModel): boolean {
  return !!model.video.take?.ok
}

/** The length a model bills for a shot: the next length it offers (Veo 4/6/8 s), else whole seconds in its range. */
export function billedS(durationS: number, model: Pick<PlanModel, 'durationsS' | 'minS' | 'maxS'>): number {
  const offered = [...(model.durationsS ?? [])].sort((a, b) => a - b)
  if (offered.length) return offered.find((s) => s >= durationS - 1e-6) ?? offered.at(-1)!
  return Math.min(model.maxS ?? Infinity, Math.max(model.minS ?? 1, Math.ceil(durationS - 1e-6)))
}

/** A clip of this shot can be retimed whole to its length (no more than SPEED_MAX faster). */
export function fitsBySpeed(durationS: number, model: PlanModel): boolean {
  return billedS(durationS, model) / durationS <= SPEED_MAX + 1e-6
}

/** Split a take's shots at the shot boundary nearest each cap (at most maxS long, maxShots shots). */
export function segmentRun<T extends { durationS: number }>(shots: T[], maxS = TAKE_MAX_S, maxShots = TAKE_MAX_SHOTS): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let len = 0
  for (const s of shots) {
    if (cur.length && (len + s.durationS > maxS + 1e-6 || cur.length >= maxShots)) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(s)
    len += s.durationS
  }
  if (cur.length) out.push(cur)
  return out
}

const BREAKS: SeamKind[] = ['cut', 'dissolve', 'dip']
const round1 = (s: number) => Math.round(s * 10) / 10

/** The model a run switches to when the pick cannot make it as one video: wan3 on the pick's provider. */
export function takeModelFor(model: PlanModel, sheets: Sheets = SHEETS): PlanModel | undefined {
  const m = modelEntry(model.provider, 'wan3', sheets)
  return m && m.model !== model.model ? m : undefined
}

/** Two neighbouring shots may be joined into one video: nothing but a cut keeps them apart (not a product,
 *  type or end card shot, a spoken line, a refused clip). */
export function canJoin(prev: PlanShot, next: PlanShot): boolean {
  return !hardBreak({ ...prev, made: false }, { ...next, made: false }, { kind: 'continue', by: 'human' })
}

/** Why two shots cannot be one video, in words. */
export function joinBlock(prev: PlanShot, next: PlanShot, n: number): string | undefined {
  if (canJoin(prev, next)) return undefined
  if (next.product) return `Shot ${n + 1} shows the product: it starts its own video`
  if (prev.kind === 'end_card' || next.kind === 'end_card') return 'An end card is always its own video'
  if (prev.text || next.text) return 'A shot with type on screen is always its own video'
  if (prev.spoken || next.spoken) return 'A shot where someone speaks is its own video, with sound'
  return 'These shots are made on their own'
}

/** A run never crosses from `prev` into `next` (design 4.3 rule 1 and the audio break, rule 2). */
function hardBreak(prev: PlanShot, next: PlanShot, join: Seam): boolean {
  if (prev.made || next.made) return true
  if (join.by === 'human') {
    if (BREAKS.includes(join.kind)) return true
  } else if ((prev.sceneId ?? null) !== (next.sceneId ?? null)) return true
  if (next.product) return true
  if (prev.kind === 'end_card' || next.kind === 'end_card' || prev.text || next.text) return true
  if (prev.moderated || next.moderated) return true
  return prev.spoken || next.spoken
}

/**
 * The runs for `shots` (in order) on `model`. join "shots" makes every shot alone, as before. Shots marked
 * made are in no run but stay as frames to land on. Pure.
 */
export function planRuns(shots: PlanShot[], model: PlanModel, opts: { join?: 'film' | 'shots'; speaker?: PlanModel; takeModel?: PlanModel } = {}): RunPlan {
  const joins: Record<Id, Seam> = {}
  for (let i = 1; i < shots.length; i++) joins[shots[i].id] = joinKind(shots[i - 1], shots[i])
  const runs: PlannedRun[] = []
  if (opts.join === 'shots') {
    for (const s of shots) if (!s.made) runs.push({ shotIds: [s.id], mode: 'alone', model, lands: {} })
    return { runs, joins }
  }
  const speaker = opts.speaker ?? model
  // One shot alone in a film: its own clip, landing on the next frame where the model can.
  const single = (s: PlanShot): PlannedRun => {
    const m = s.spoken ? speaker : model
    // Phase C would carry a model that cannot land (startFrom the last clip's out frame); until then, alone.
    return { shotIds: [s.id], mode: s.kind !== 'end_card' && canLand(m) ? 'frames' : 'alone', model: m, lands: {} }
  }
  const groups: PlanShot[][] = []
  for (const [i, s] of shots.entries()) {
    if (s.made) continue
    const prev = shots[i - 1]
    if (!groups.length || !prev || hardBreak(prev, s, joins[s.id])) groups.push([s])
    else groups.at(-1)!.push(s)
  }
  for (const g of groups) {
    if (g.length === 1) {
      runs.push(single(g[0]))
      continue
    }
    const take = model.video.take
    // A run the pick cannot make as one video (no takes, or longer than its takes) switches to a model that
    // can (opts.takeModel: wan3), for that run only; separate shots keep the pick.
    const other = opts.takeModel && opts.takeModel.model !== model.model && canTake(opts.takeModel) ? opts.takeModel : undefined
    if (take?.ok || other) {
      const lim = (m: PlanModel | undefined) => ({ s: m?.video.take?.ok ? m.video.take.maxS ?? TAKE_MAX_S : 0, n: m?.video.take?.ok ? m.video.take.maxShots ?? TAKE_MAX_SHOTS : 0 })
      const maxS = Math.max(lim(model).s, lim(other).s)
      const maxShots = Math.max(lim(model).n, lim(other).n)
      // Segments meet on a cut until take.withLast is proven (P1); phase C would carry the join instead.
      const segs = segmentRun(g, maxS, maxShots)
      for (const [k, seg] of segs.entries()) {
        if (seg.length === 1) runs.push(single(seg[0]))
        else {
          const len = seg.reduce((a, s) => a + s.durationS, 0)
          const fits = !!take?.ok && len <= lim(model).s + 1e-6 && seg.length <= lim(model).n
          const m = fits || !other ? model : other
          const why = m === model ? undefined : !take?.ok ? `${model.label} cannot make one video` : `${round1(len)} s is longer than ${model.label} makes in one go (${lim(model).s} s)`
          // The run's first frame pins the take; with none, its frames and named pictures go as references.
          runs.push({ shotIds: seg.map((s) => s.id), mode: seg[0].hasFrame ? 'take' : 'take_refs', model: m, lands: {}, ...(why ? { switched: why } : {}) })
        }
        if (k < segs.length - 1) runs.at(-1)!.splitAfter = true
      }
    } else if (canLand(model)) {
      runs.push({ shotIds: g.map((s) => s.id), mode: 'frames', model, lands: {} })
    } else {
      // Phase C would carry these (each starting on the last clip's out frame); until then each is made alone.
      runs.push({ shotIds: g.map((s) => s.id), mode: 'alone', model, lands: {} })
    }
  }
  // A frames clip ends on the next shot's frame only on a continue join (never across a cut, match, dissolve
  // or dip, which would morph), only from a frame of its own, and only when it can be retimed whole.
  const at = new Map(shots.map((s, i) => [s.id, i]))
  for (const r of runs) {
    if (r.mode !== 'frames' || !canLand(r.model)) continue
    for (const id of r.shotIds) {
      const s = shots[at.get(id)!]
      const next = shots[at.get(id)! + 1]
      if (!next || !s.hasFrame || !next.hasFrame || next.kind === 'end_card' || joins[next.id].kind !== 'continue') continue
      if (!fitsBySpeed(s.durationS, r.model)) continue
      r.lands[id] = next.id
    }
  }
  return { runs, joins }
}

// ── Reading runs ────────────────────────────────────────────────────────────

/** The run a shot was last made in, in `videoId`. */
export function runOf(d: ProductionDocument, videoId: Id | undefined, shotId: Id): (VideoRun & { id: Id }) | undefined {
  const runs = (videoId && d.videos[videoId]?.runs) || {}
  const hit = Object.entries(runs).filter(([, r]) => r.shot_ids.includes(shotId)).sort(([a], [b]) => (a < b ? -1 : 1)).at(-1)
  return hit ? { ...hit[1], id: hit[0] } : undefined
}

/** "shot 3", "shots 2-5": the shots' numbers in the storyboard. */
export function shotsWords(d: ProductionDocument, shotIds: Id[]): string {
  const all = shotsOf(d, d.shots[shotIds[0]]?.storyboard_id).map((s) => s.id)
  const n = shotIds.map((id) => all.indexOf(id) + 1).filter((x) => x > 0).sort((a, b) => a - b)
  if (!n.length) return 'no shots'
  if (n.length === 1) return `shot ${n[0]}`
  const runOn = n.every((x, i) => i === 0 || x === n[i - 1] + 1)
  return runOn ? `shots ${n[0]}–${n.at(-1)}` : `shots ${n.join(', ')}`
}

/** How a run is made, in words for History ("as one take"). */
export function modeWords(mode: RunMode): string {
  return mode === 'take' || mode === 'take_refs' ? 'as one video' : 'one at a time'
}

// ── The driver ──────────────────────────────────────────────────────────────

/** The run the live plan puts a shot in. */
export function planRunOf(plan: RunPlan | undefined, shotId: Id): PlannedRun | undefined {
  return plan?.runs.find((r) => r.shotIds.includes(shotId))
}

/** A take run of the plan: one generation over its shots. */
export function isTakeRun(r: PlannedRun | undefined): boolean {
  return !!r && (r.mode === 'take' || r.mode === 'take_refs') && r.shotIds.length > 1
}

/** These shots' clips in the cut are already exactly one take: windows of one job, and no other shot's. A
 *  shot with a separate clip (or none) does not count, so a take is made over it. */
export function isOneTake(d: ProductionDocument, videoId: Id | undefined, shotIds: Id[]): boolean {
  const takes = shotIds.map((id) => currentTake(d, id, videoId))
  const jobId = takes[0]?.job_id
  if (!jobId || !takes.every((t, i) => !!shotSegment(t, shotIds[i]) && t?.job_id === jobId)) return false
  const sb = storyboardOfVideo(d, videoId)
  const all = sb ? shotsOf(d, sb.id).filter((s) => currentTake(d, s.id, videoId)?.job_id === jobId).map((s) => s.id) : []
  return all.length === shotIds.length
}

/** The plan's take runs whose shots are not one take yet: what "Make shots 1–5 as one take" makes. */
export function pendingTakes(d: ProductionDocument, videoId: Id | undefined, plan: RunPlan | undefined): PlannedRun[] {
  return (plan?.runs ?? []).filter((r) => isTakeRun(r) && !isOneTake(d, videoId, r.shotIds))
}

/** "Make shots 1–5 as one take" (again, when they already are one). */
export function takeActionLabel(d: ProductionDocument, run: PlannedRun, again = false): string {
  return `Make ${shotsWords(d, run.shotIds)} as one take${again ? ' again' : ''}`
}

export interface MakeRunsOpts {
  videoId: Id
  /** The shots asked for: the send tray's picks, or the one shot a card or the player makes. */
  shotIds: Id[]
  config: Config
  modelChoice?: ModelChoice
  quality?: ClipQuality
  fromWords?: boolean
  sheets?: Sheets
  /** A new take of shots that have clips (a card's or the player's New take): a take run is made again, a
   *  lone shot gets a new version of its clip. Absent: only what is not made yet. */
  again?: boolean
  /** A shot being made now: it is left alone, and so is any take run it is in. */
  busy?: (shotId: Id) => boolean
  /** Words for one shot's clip only (Make clip's box). In a take, they go on that shot's line. */
  texts?: Record<Id, string>
}

/**
 * Make clips "As one film": plan every shot of the video into runs, then make the runs the asked shots are
 * in. A take run is made whole whenever its shots are not one take yet, over separate clips too (its windows
 * become each shot's new take; the old clips stay as versions): a shot in a take run never gets a clip of its
 * own. A shot alone (a cut, dissolve or dip join, a spoken line, an end card, a product or type shot, or a
 * model that makes no takes) is made only when it has no clip, or `again`. Records each run made (one History
 * entry each) and the joins Dex chose. A run that cannot be sent does not stop the others; each failure comes
 * back as "Shot 3: …" or "Shots 2–5: …".
 */
export async function makeRuns(deps: FrameDeps, opts: MakeRunsOpts): Promise<string[]> {
  const sheets = opts.sheets ?? SHEETS
  const d = deps.doc.get()
  const video = d.videos[opts.videoId]
  const sb = storyboardOfVideo(d, opts.videoId)
  if (!video || !sb) throw new Error('This video has no shots yet.')
  const quality = opts.quality ?? videoQuality(d, opts.videoId)
  const model = planModel(opts.config, opts.modelChoice, quality, sheets)
  if (!model) throw new Error('No model can make clips right now.')
  const busy = opts.busy ?? (() => false)
  const shots = shotsOf(d, sb.id)
  const facts = shots.map((s) => planShot(d, s, { hasFrame: !!selectedFrame(d, s.id), videoId: opts.videoId }))
  const plan = planRuns(facts, model, { join: 'film', speaker: speakerModel(model, sheets), takeModel: takeModelFor(model, sheets) })
  const asked = new Set(opts.shotIds)
  // What is made: each take run an asked shot is in, unless it is one take already (or being made); each asked
  // lone shot with no clip yet (any, with again).
  const work: { run: PlannedRun; shotIds: Id[] }[] = []
  for (const r of plan.runs) {
    if (!r.shotIds.some((id) => asked.has(id))) continue
    if (isTakeRun(r)) {
      if (r.shotIds.some(busy) || (!opts.again && isOneTake(d, opts.videoId, r.shotIds))) continue
      work.push({ run: r, shotIds: r.shotIds })
      continue
    }
    const ids = r.shotIds.filter((id) => asked.has(id) && !busy(id) && (opts.again || !takesOf(d, id).length))
    if (ids.length) work.push({ run: r, shotIds: ids })
  }
  const ids = work.map(() => newUlidId('run'))
  // One entry per run: Dex's plan of it, the model and how (the credits are on each job's landing).
  for (const [i, { run: r, shotIds }] of work.entries()) {
    const lands = shotIds.filter((id) => r.lands[id]).length
    await landUpdate(deps.doc, (x) => {
      const v = x.videos[opts.videoId]
      if (!v) return
      v.runs ??= {}
      v.runs[ids[i]] = { shot_ids: shotIds, mode: r.mode, model: r.model.model, state: 'planned', planned_by: r.shotIds.some((id) => plan.joins[id]?.by === 'human') ? 'human' : 'crew' }
    }, {
      action: `plan ${shotsWords(d, shotIds)} ${modeWords(r.mode)} on ${r.model.label}`,
      agent: 'dex',
      rationale: [r.switched && `${r.switched}, so ${r.model.label} makes it.`, lands && `${lands} of ${shotIds.length} end on the next shot's frame: the action carries on in the same setup.`].filter(Boolean).join(' ') || undefined,
    })
  }
  const failed: string[] = []
  const name = (shotIds: Id[]) => { const w = shotsWords(d, shotIds); return w[0].toUpperCase() + w.slice(1) }
  for (const [i, { run: r, shotIds }] of work.entries()) {
    const pick = r.model.model === model.model && r.model.provider === model.provider ? opts.modelChoice
      : choiceToSend('clip', opts.config, { provider: r.model.provider, model: r.model.model }, sheets)
    if (isTakeRun(r)) {
      try {
        await makeTake(deps, opts.videoId, ids[i], { modelChoice: pick, quality, ...(opts.texts ? { texts: opts.texts } : {}) })
      } catch (e) {
        failed.push(`${name(shotIds)}: ${e instanceof Error ? e.message : 'that did not work.'}`)
      }
      continue
    }
    for (const id of shotIds) {
      const parent = opts.again ? currentTake(d, id, opts.videoId) : undefined
      try {
        await makeClip(deps, id, {
          modelChoice: pick, quality, videoId: opts.videoId, fromWords: opts.fromWords,
          ...(r.lands[id] ? { endShotId: r.lands[id] } : {}),
          ...(parent ? { parentTake: parent } : {}),
          ...(opts.texts?.[id] ? { text: opts.texts[id] } : {}),
        })
      } catch (e) {
        failed.push(`${name([id])}: ${e instanceof Error ? e.message : 'that did not work.'}`)
      }
    }
    await systemUpdate(deps.doc, (x) => { const run = x.videos[opts.videoId]?.runs?.[ids[i]]; if (run) run.state = 'running' }, 'sync')
  }
  return failed
}

/**
 * Make clips for the shots asked for (`ids`, in `shots` order). As one film when connected video is on and
 * the video joins as a film (makeRuns, which may make a whole take for one asked shot); otherwise, and always
 * with the flag off, each shot alone, exactly as before: skipping one that has a clip or is `busy`. A shot
 * that cannot be made does not stop the others; each failure is named.
 */
export async function makeClips(deps: FrameDeps, opts: {
  videoId?: Id; shots: Shot[]; ids: Id[]; config: Config; join: VideoJoin | null; modelChoice?: ModelChoice; quality?: ClipQuality; fromWords?: boolean
  busy: (shotId: Id) => boolean
}): Promise<string[]> {
  if (opts.join === 'film' && opts.videoId) {
    return makeRuns(deps, { videoId: opts.videoId, shotIds: opts.ids, config: opts.config, modelChoice: opts.modelChoice,
      ...(opts.quality ? { quality: opts.quality } : {}), fromWords: opts.fromWords, busy: opts.busy })
  }
  const d = deps.doc.get()
  const failed: string[] = []
  for (const [i, s] of opts.shots.entries()) {
    if (!opts.ids.includes(s.id) || takesOf(d, s.id).length || opts.busy(s.id)) continue
    try {
      await makeClip(deps, s.id, { modelChoice: opts.modelChoice, ...(opts.quality ? { quality: opts.quality } : {}), videoId: opts.videoId, fromWords: opts.fromWords })
    } catch (e) {
      failed.push(`Shot ${i + 1}: ${e instanceof Error ? e.message : 'that did not work.'}`)
    }
  }
  return failed
}
