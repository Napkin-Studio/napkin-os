// Updates (decided 2026-10-07, "Change anything later; update what follows on request";
// steered since 2026-10-09; one to one since 2026-10-09, features/one-to-one-updates.clan).
// Never automatic. A run makes the items of one plan, in order:
//
//   1. frames, one at a time, each from shot 1's frame and the one before (the Draw
//      the rest machinery in frames.ts);
//   2. clips;
//   3. the ad, when there was one (free, nothing to steer: it just runs).
//
// The plan comes from a scope (FollowScope), picked at the moment of acting:
//   direct   only what is out of date now, one to one (the bar's "Update 2");
//   carry    the old chain: from a frame (the first one out of date or drawn from an
//            older frame, or the one whose "Carry the look forward" was clicked) every
//            frame after it, their clips, the ad (the bar's "Update 2 and carry forward");
//   missing  what is not made yet ("3 clips not made yet · Make them");
//   one      a card's Redraw / Remake;  after  "this and the frames (clips) after".
//
// Steered (the cards and the bar), a plan of more than one item is shown first in
// the update box (items in order, cost); then each frame and clip waits in the box
// (ui/UpdateBox.tsx) for the user's words for that request, a model (starting on
// the last that worked for that step) and "Make it". "Do the rest as they are"
// turns steering off and the run goes on with the box's models. A new version
// replaces the old one only once it has landed; if it fails, the old one stays and
// the box shows the error, to make it again on another model.
//
// The run is a flag in the UI state (snapshotted), moved on by the runner's
// completion hooks and at boot, so it resumes after a reload. Stop ends it after
// the job running now.

import type { Config, ModelChoice, Op, ProductionDocument } from '../contracts/types'
import type { FollowItem, FollowRun, JobCtx } from '../doc/ui'
import { describeFollow } from '../doc/describe'
import { choiceToSend, modelChoicesFor, routedSheet, type Sheets } from '../capabilities'
import { removeFrame, removeTake } from '../doc/remove'
import { updateDoc } from '../doc/store'
import { newId } from '../lib/ulid'
import { makeClip, renderAd, selectedTake } from './clips'
import { shotsBeingFixed } from './fix'
import { drawFrame, selectedFrame, type FrameDeps } from './frames'
import { isActive } from './runner'
import { adStatus, frameDrift, frameStale, takeStale } from './stale'

export interface FollowPlan {
  /** Shot ids whose frame will be drawn again (or for the first time), in order. */
  frames: string[]
  /** Shot ids that will get a new clip. */
  clips: string[]
  ad: boolean
}

export const planSize = (p: FollowPlan) => p.frames.length + p.clips.length + (p.ad ? 1 : 0)

/** Which items a run makes (see the top of this file). */
export type FollowScope =
  | { kind: 'direct' }
  | { kind: 'carry'; from?: string }
  | { kind: 'missing' }
  | { kind: 'one' | 'after'; item: FollowItem }

/** Shots whose clip is being made now (a fix, Make clip, a run) or whose frame is being drawn now: not
 *  behind, so the plan leaves them out (2026-10-09: four first clips in the making showed as "4 behind"). */
export function shotsInTheMaking(d: ProductionDocument, ctxOf: (id: string) => JobCtx | undefined): { clips: Set<string>; frames: Set<string> } {
  const clips = shotsBeingFixed(d, ctxOf)
  const frames = new Set<string>()
  for (const j of d.jobs) {
    if (!isActive(j.state)) continue
    const c = ctxOf(j.id)
    if (c?.for === 'clip') clips.add(c.shotId)
    if (c?.for === 'frame') frames.add(c.shotId)
  }
  return { clips, frames }
}

/** What is out of date now, one to one: each frame and clip marked out of date itself, in shot order,
 *  then the ad (it follows new clips, or is out of date itself). Not-made items are planMissing's.
 *  `fixing`: shots whose clip is being made now (a fix, or shotsInTheMaking); `drawing`: shots whose frame is. */
export function planFollow(d: ProductionDocument, fixing: ReadonlySet<string> = new Set(), drawing: ReadonlySet<string> = new Set()): FollowPlan {
  return planFor(d, { kind: 'direct' }, fixing, drawing)
}

/** What is not made yet: a shot with no frame once there are frames, or with no clip once there are clips
 *  (a new shot, or one whose last version was deleted). The ad is left to the bar, once the clips land. */
export function planMissing(d: ProductionDocument, fixing: ReadonlySet<string> = new Set(), drawing: ReadonlySet<string> = new Set()): FollowPlan {
  return planFor(d, { kind: 'missing' }, fixing, drawing)
}

/** The plan for a scope (see the top of this file). Empty when there is nothing to make. */
export function planFor(d: ProductionDocument, scope: FollowScope, fixing: ReadonlySet<string> = new Set(), drawing: ReadonlySet<string> = new Set()): FollowPlan {
  const shots = d.shots ?? []
  const ids = (list: typeof shots) => list.map((s) => s.id)
  const hasFrames = (d.frames ?? []).some((f) => shots.some((s) => s.id === f.shot_id))
  const hasTakes = (d.takes ?? []).some((t) => shots.some((s) => s.id === t.shot_id))
  const ad = adStatus(d)
  const from = (shotId: string | undefined) => Math.max(0, shots.findIndex((s) => s.id === shotId))
  switch (scope.kind) {
    case 'direct': {
      const clips = ids(shots.filter((s) => !fixing.has(s.id) && !!takeStale(d, s.id)))
      return { frames: ids(shots.filter((s) => !drawing.has(s.id) && !!frameStale(d, s.id))), clips, ad: !!ad.ad && (clips.length > 0 || ad.stale) }
    }
    case 'missing':
      return {
        frames: hasFrames ? ids(shots.filter((s) => !drawing.has(s.id) && !selectedFrame(d, s.id))) : [],
        clips: hasTakes ? ids(shots.filter((s) => !fixing.has(s.id) && !selectedTake(d, s.id))) : [],
        ad: false,
      }
    case 'carry': {
      // The old chain: once a frame is drawn again every frame after it follows it, then their clips and
      // every clip out of date or missing, then the ad. From the bar: from the first frame that is out of
      // date or drawn from an older frame.
      const first = scope.from ? from(scope.from) : shots.findIndex((s) => !drawing.has(s.id) && (!!frameStale(d, s.id) || frameDrift(d, s.id) !== undefined))
      const frames = first >= 0 ? ids(shots.slice(first).filter((s) => !drawing.has(s.id))) : []
      const clips = hasTakes ? ids(shots.filter((s) => !fixing.has(s.id) && (frames.includes(s.id) || !!takeStale(d, s.id) || !selectedTake(d, s.id)))) : []
      return { frames, clips, ad: !!ad.ad && (clips.length > 0 || ad.stale) }
    }
    case 'one':
      return scope.item.kind === 'frame'
        ? { frames: drawing.has(scope.item.shotId) ? [] : [scope.item.shotId], clips: [], ad: false }
        : { frames: [], clips: fixing.has(scope.item.shotId) ? [] : [scope.item.shotId], ad: false }
    case 'after': {
      const rest = shots.slice(from(scope.item.shotId))
      if (scope.item.kind === 'frame') return { frames: ids(rest.filter((s) => !drawing.has(s.id))), clips: [], ad: false }
      // A clip is made from its shot's frame: a shot with none is left out.
      const clips = ids(rest.filter((s) => !fixing.has(s.id) && !!selectedFrame(d, s.id)))
      return { frames: [], clips, ad: !!ad.ad && clips.length > 0 }
    }
  }
}

/** What one job of `op` costs on the provider routed for it (null when it does not say). */
function estimate(op: Op, config: Config, sheets?: Sheets): number | null {
  const sheet = routedSheet(op, config, sheets)
  if (!sheet) return null
  return sheet.ops[op]?.estimateUsd ?? null
}

/** The estimated cost of a plan, from the capability sheets: each step at its model (`models`, what
 *  the run sends; absent, the routed default). The ad (ffmpeg) costs nothing. */
export function planCost(p: FollowPlan, config: Config, sheets?: Sheets, models: FollowRun['models'] = {}): { usd: number; known: boolean } {
  const price = (op: 'frame' | 'clip', pick?: ModelChoice) =>
    pick ? modelChoicesFor(op, config, sheets).find((o) => o.provider === pick.provider && o.model === pick.model)?.estimateUsd ?? null : estimate(op, config, sheets)
  const frame = price('frame', models.frame)
  const clip = price('clip', models.clip)
  const known = (!p.frames.length || frame !== null) && (!p.clips.length || clip !== null)
  return { usd: p.frames.length * (frame ?? 0) + p.clips.length * (clip ?? 0), known }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** "3 frames, 3 clips, 1 ad". */
export function planWords(p: FollowPlan): string {
  return [p.frames.length && plural(p.frames.length, 'frame'), p.clips.length && plural(p.clips.length, 'clip'), p.ad && '1 ad']
    .filter(Boolean).join(', ')
}

/** A plan's cost, short, for a menu item's hint: "~$0.60". */
export function planCostShort(p: FollowPlan, config: Config, sheets?: Sheets, models?: FollowRun['models']): string {
  const c = planCost(p, config, sheets, models)
  return `${c.known ? '~' : '≥ '}$${c.usd.toFixed(2)}`
}

/** "3 frames, 3 clips, 1 ad · about $2.01". */
export function planSummary(p: FollowPlan, config: Config, sheets?: Sheets, models?: FollowRun['models']): string {
  const c = planCost(p, config, sheets, models)
  return `${planWords(p)} · ${c.known ? `about $${c.usd.toFixed(2)}` : `at least $${c.usd.toFixed(2)}`}`
}

// ── running it ──────────────────────────────────────────────────────────────

const busy = new WeakSet<object>()
const again = new WeakSet<object>()

const ctxOf = (deps: FrameDeps, id: string): JobCtx | undefined => deps.ui.get().jobCtx[id]

/** The jobs this run started (a retried one counts in place of its first try). */
function runJobs(deps: FrameDeps, run: FollowRun) {
  return deps.doc.get().jobs.filter((j) => {
    const c = ctxOf(deps, j.id)
    return !!c && !c.dismissed && 'followRun' in c && c.followRun === run.id
  })
}

/** Where a run is, for the UI. */
export function followState(d: ProductionDocument, ctx: (id: string) => JobCtx | undefined, run: FollowRun | undefined) {
  if (!run) return undefined
  const jobs = d.jobs.filter((j) => {
    const c = ctx(j.id)
    return !!c && !c.dismissed && 'followRun' in c && c.followRun === run.id
  })
  const running = jobs.find((j) => isActive(j.state))
  const last = jobs.at(-1)
  const failed = !running && last && (last.state === 'failed' || last.state === 'cancelled') ? last : undefined
  return { running, failed, done: run.framesDone.length + run.clipsDone.length + (run.adDone ? 1 : 0) }
}

/** The last model that made a `op` job that worked, where the menu offers it: where the update box
 *  starts, so a provider that just failed (out of credit) is not tried again by default. */
export function lastWorkedModel(d: ProductionDocument, op: Op, config: Config, sheets?: Sheets): ModelChoice | undefined {
  const offered = modelChoicesFor(op, config, sheets)
  // A mock result "worked" only as a stand-in: a real provider on offer goes first (2026-10-09:
  // an update run sent clips to mock again after mock stills, with a fal key there).
  const real = offered.some((o) => o.provider !== 'mock')
  for (let i = d.jobs.length - 1; i >= 0; i--) {
    const j = d.jobs[i]
    if (j.op !== op || j.state !== 'completed' || !j.provider || !j.model || (real && j.provider === 'mock')) continue
    const o = offered.find((x) => x.provider === j.provider && x.model === j.model)
    if (o) return { provider: o.provider, model: o.model }
  }
  const first = offered.find((o) => !real || o.provider !== 'mock')
  return first && { provider: first.provider, model: first.model }
}

/** What a run sends per step at the start: the last model that worked (none: the routed default). */
export function startModels(d: ProductionDocument, config: Config, sheets?: Sheets): NonNullable<FollowRun['models']> {
  const out: NonNullable<FollowRun['models']> = {}
  for (const op of ['frame', 'clip'] as const) {
    const send = choiceToSend(op, config, lastWorkedModel(d, op, config, sheets), sheets)
    if (send) out[op] = send
  }
  return out
}

/** Start a run of a scope's plan as it stands now (default: what is out of date, one to one). `config`:
 *  the routing this participant sees (the models to start on). `steer`: wait for the update box on each
 *  frame and clip; a plan of more than one item is shown in the box first, until beginFollow. */
export async function startFollow(deps: FrameDeps, config?: Config, opts: { steer?: boolean; scope?: FollowScope } = {}): Promise<FollowPlan> {
  const d = deps.doc.get()
  const busy = shotsInTheMaking(d, (id) => ctxOf(deps, id))
  const plan = planFor(d, opts.scope ?? { kind: 'direct' }, busy.clips, busy.frames)
  if (!planSize(plan) || deps.ui.get().following) return plan
  const models = config ? startModels(d, config) : {}
  deps.ui.update((u) => {
    u.following = {
      id: newId('follow'), startedAt: new Date().toISOString(), ad: plan.ad, frameShots: plan.frames, clipShots: plan.clips, framesDone: [], clipsDone: [], adDone: false,
      total: planSize(plan), ...(opts.steer ? { steer: true } : {}), ...(opts.steer && planSize(plan) > 1 ? { reviewing: true } : {}),
      ...(Object.keys(models).length ? { models } : {}),
    }
  })
  await continueFollow(deps)
  return plan
}

/** The update box's "Start" on a plan shown first: the run goes on to its first item. */
export async function beginFollow(deps: FrameDeps) {
  if (!deps.ui.get().following?.reviewing) return
  deps.ui.update((u) => { if (u.following) u.following.reviewing = false })
  await continueFollow(deps)
}

/** The update box's "Make it": the awaited item, with the user's words for this request only (never the
 *  script) and the model picked (null: the routed default). A failed try of it is put aside first. */
export async function makeAwaited(deps: FrameDeps, opts: { text?: string; modelChoice?: ModelChoice | null } = {}): Promise<string | null> {
  const run = deps.ui.get().following
  const item = run?.awaiting
  if (!run || !item) return null
  for (const j of runJobs(deps, run)) {
    const c = ctxOf(deps, j.id)
    if (c && itemOf(c)?.shotId === item.shotId && itemOf(c)?.kind === item.kind && (j.state === 'failed' || j.state === 'cancelled')) {
      deps.ui.update((u) => { const x = u.jobCtx[j.id]; if (x) x.dismissed = true })
    }
  }
  deps.ui.update((u) => {
    const r = u.following
    if (!r) return
    r.awaiting = undefined
    if (opts.modelChoice !== undefined) {
      r.models = { ...r.models }
      if (opts.modelChoice) r.models[item.kind] = opts.modelChoice
      else delete r.models[item.kind]
    }
    if (item.kind === 'frame' && !r.framesDone.includes(item.shotId)) r.framesDone.push(item.shotId)
    if (item.kind === 'clip' && !r.clipsDone.includes(item.shotId)) r.clipsDone.push(item.shotId)
  })
  return send(deps, deps.ui.get().following ?? run, item, opts.text?.trim() || undefined)
}

/** The update box's "Do the rest as they are" (on a plan shown first: "Do them as they are"): this item and
 *  every one after it on the box's models, no words. */
export async function restAsTheyAre(deps: FrameDeps, modelChoice?: ModelChoice | null) {
  deps.ui.update((u) => {
    if (!u.following) return
    u.following.steer = false
    u.following.reviewing = false
  })
  if (deps.ui.get().following?.awaiting) await makeAwaited(deps, { modelChoice })
  else await continueFollow(deps)
}

const itemOf = (c: JobCtx): FollowItem | undefined =>
  c.for === 'frame' ? { kind: 'frame', shotId: c.shotId } : c.for === 'clip' ? { kind: 'clip', shotId: c.shotId } : undefined

/** Send one item: a frame again from the one before (keeping what was asked of it, unless the box has
 *  words), or a clip from the shot's frame; on the run's model for that step. */
async function send(deps: FrameDeps, run: FollowRun, item: FollowItem, words?: string): Promise<string | null> {
  const d = deps.doc.get()
  const shots = d.shots ?? []
  const i = shots.findIndex((s) => s.id === item.shotId)
  if (i < 0) return null
  const modelChoice = run.models?.[item.kind]
  if (item.kind === 'frame') {
    const parent = selectedFrame(d, item.shotId)
    // Keep what the user asked of this frame when it was drawn (not a region edit's words: that is for a box).
    const made = parent ? d.jobs.find((j) => j.id === parent.job_id) : undefined
    const text = words ?? (made?.op === 'frame' ? made.text : undefined)
    return drawFrame(deps, i, 'update', { followRun: run.id, ...(parent ? { parent } : {}), ...(text ? { text } : {}), ...(modelChoice ? { modelChoice } : {}) })
  }
  const parentTake = selectedTake(d, item.shotId)
  const made = parentTake ? d.jobs.find((j) => j.id === parentTake.job_id) : undefined
  const text = words ?? (made?.op === 'clip' ? made.text : undefined)
  return makeClip(deps, item.shotId, { ...(parentTake ? { parentTake } : {}), ...(text ? { text } : {}), purpose: { followRun: run.id }, ...(modelChoice ? { modelChoice } : {}) })
}

/** A replacement that landed takes its old version out (once). Only versions this run replaced. */
async function replaceLanded(deps: FrameDeps, run: FollowRun) {
  const d = deps.doc.get()
  const gone: string[] = []
  for (const j of runJobs(deps, run)) {
    if (j.state !== 'completed') continue
    const c = ctxOf(deps, j.id)
    const old = c?.for === 'frame' ? c.parentFrameId : c?.for === 'clip' ? c.parentTakeId : undefined
    if (!old || run.replaced?.includes(old)) continue
    const landed = c?.for === 'frame' ? (d.frames ?? []).some((f) => f.job_id === j.id) : (d.takes ?? []).some((t) => t.job_id === j.id)
    if (!landed) continue
    gone.push(old)
  }
  if (!gone.length) return
  deps.ui.update((u) => { if (u.following) u.following.replaced = [...(u.following.replaced ?? []), ...gone] })
  await updateDoc(deps.doc, (x) => {
    for (const id of gone) {
      if ((x.frames ?? []).some((f) => f.id === id && !f.selected)) removeFrame(x, id)
      else if ((x.takes ?? []).some((t) => t.id === id && !t.selected)) removeTake(x, id)
    }
  }, 'replaced by its update')
}

/** Stop after the job running now (or at once, when nothing is running). */
export async function cancelFollow(deps: FrameDeps) {
  const run = deps.ui.get().following
  if (!run) return
  // A plan shown first and never started: nothing was made, so nothing goes in the chain.
  if (run.reviewing && !runJobs(deps, run).length) return void deps.ui.update((u) => { u.following = undefined })
  deps.ui.update((u) => { if (u.following) u.following.cancel = true })
  await continueFollow(deps)
}

async function finish(deps: FrameDeps, run: FollowRun, stopped: boolean) {
  deps.ui.update((u) => { u.following = undefined })
  const said = describeFollow(run, stopped)
  await deps.doc.record?.(said.action, said.rationale)
}

/**
 * Move a run one step: when one is on and none of its jobs is moving, start the
 * next piece of work, or finish. Called by the completion hooks, at boot, and on
 * a click; safe to call any number of times.
 */
export async function continueFollow(deps: FrameDeps): Promise<void> {
  if (busy.has(deps.ui)) {
    again.add(deps.ui) // a hook fired while a step was being sent: look again after it
    return
  }
  busy.add(deps.ui)
  try {
    await step(deps)
  } catch (e) {
    // The step could not even be sent (an upload failed): stop, so nothing is skipped silently.
    const run = deps.ui.get().following
    if (run) await finish(deps, run, true)
    throw e
  } finally {
    busy.delete(deps.ui)
  }
  if (again.delete(deps.ui)) await continueFollow(deps)
}

async function step(deps: FrameDeps): Promise<void> {
  {
    const run = deps.ui.get().following
    if (!run) return
    const jobs = runJobs(deps, run)
    await replaceLanded(deps, run)
    if (jobs.some((j) => isActive(j.state))) return
    if (run.cancel) return void (await finish(deps, run, true))
    const last = jobs.at(-1)
    if (last && (last.state === 'failed' || last.state === 'cancelled')) {
      // Waits: the box shows the failed item to make again (on another model), or Retry on its card.
      const c = ctxOf(deps, last.id)
      const item = c ? itemOf(c) : undefined
      if (run.steer && item && !(run.awaiting?.kind === item.kind && run.awaiting.shotId === item.shotId)) {
        deps.ui.update((u) => { if (u.following) u.following.awaiting = item })
      }
      return
    }
    if (run.awaiting || run.reviewing) return // the box is waiting for the user
    const d = deps.doc.get()
    const shots = d.shots ?? []
    const note = (fn: (r: FollowRun) => void) => deps.ui.update((u) => { if (u.following) fn(u.following) })

    // 1. The plan's frames, in shot order.
    const frameShots = run.frameShots ?? []
    const shot = shots.find((s) => frameShots.includes(s.id) && !run.framesDone.includes(s.id))
    if (shot) {
      if (run.steer) return void note((r) => { r.awaiting = { kind: 'frame', shotId: shot.id } })
      note((r) => { r.framesDone.push(shot.id) })
      await send(deps, run, { kind: 'frame', shotId: shot.id })
      return
    }

    // 2. The plan's clips, in shot order (one a fix is making now is left to the fix).
    const fixing = shotsBeingFixed(d, (id) => ctxOf(deps, id))
    const next = shots.find((s) => run.clipShots.includes(s.id) && !run.clipsDone.includes(s.id) && !fixing.has(s.id))
    if (next) {
      if (run.steer) return void note((r) => { r.awaiting = { kind: 'clip', shotId: next.id } })
      note((r) => r.clipsDone.push(next.id))
      await send(deps, run, { kind: 'clip', shotId: next.id })
      return
    }

    // 3. The ad.
    if (run.ad && !run.adDone && shots.length && shots.every((s) => selectedTake(d, s.id))) {
      note((r) => { r.adDone = true })
      await renderAd(deps, { followRun: run.id })
      return
    }
    await finish(deps, deps.ui.get().following ?? run, false)
  }
}
