// "Update what follows" (decided 2026-10-07, "Change anything later; update what
// follows on request"; steered since 2026-10-09). Never automatic. In order:
//
//   1. out-of-date frames, one at a time, each from shot 1's frame and the one
//      before (the Draw the rest machinery in frames.ts);
//   2. a clip for every shot whose selected frame changed (or that has none);
//   3. the ad, when there was one (free, nothing to steer: it just runs).
//
// Steered (the Update button), each frame and clip waits in the update box
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
import { adStatus, anythingStale, frameStale, takeStale } from './stale'

export interface FollowPlan {
  /** Shot ids whose frame will be drawn again (or for the first time), in order. */
  frames: string[]
  /** Shot ids that will get a new clip. */
  clips: string[]
  ad: boolean
}

export const planSize = (p: FollowPlan) => p.frames.length + p.clips.length + (p.ad ? 1 : 0)

/**
 * The work, worked out from what is out of date now. Once a frame is drawn again,
 * every frame after it follows it, so the frames run from the first one that needs
 * drawing to the last shot. Empty when nothing is out of date.
 */
/** `fixing`: shots a fix is redoing now (shotsBeingFixed); their clip is left to the fix. */
export function planFollow(d: ProductionDocument, fixing: ReadonlySet<string> = new Set()): FollowPlan {
  const none: FollowPlan = { frames: [], clips: [], ad: false }
  const shots = d.shots ?? []
  const hasFrames = (d.frames ?? []).some((f) => shots.some((s) => s.id === f.shot_id))
  const hasTakes = (d.takes ?? []).some((t) => shots.some((s) => s.id === t.shot_id))
  // A shot whose last frame or clip was deleted is owed one, like an out-of-date one.
  const missing = shots.some((s) => (hasFrames && !selectedFrame(d, s.id)) || (hasTakes && !selectedTake(d, s.id)))
  if (!anythingStale(d) && !missing) return none
  const first = shots.findIndex((s) => !!frameStale(d, s.id) || (hasFrames && !selectedFrame(d, s.id)))
  const frames = first >= 0 ? shots.slice(first).map((s) => s.id) : []
  const clips = hasTakes ? shots.filter((s) => !fixing.has(s.id) && (frames.includes(s.id) || !!takeStale(d, s.id) || !selectedTake(d, s.id))).map((s) => s.id) : []
  const ad = adStatus(d)
  return { frames, clips, ad: !!ad.ad && (clips.length > 0 || ad.stale) }
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
  for (let i = d.jobs.length - 1; i >= 0; i--) {
    const j = d.jobs[i]
    if (j.op !== op || j.state !== 'completed' || !j.provider || !j.model) continue
    const o = offered.find((x) => x.provider === j.provider && x.model === j.model)
    if (o) return { provider: o.provider, model: o.model }
  }
  return offered[0] && { provider: offered[0].provider, model: offered[0].model }
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

/** Start a run of the plan as it stands now. `config`: the routing this participant sees (the models
 *  to start on). `steer`: wait for the update box on each frame and clip (the Update button). */
export async function startFollow(deps: FrameDeps, config?: Config, opts: { steer?: boolean } = {}): Promise<FollowPlan> {
  const d = deps.doc.get()
  const plan = planFollow(d, shotsBeingFixed(d, (id) => ctxOf(deps, id)))
  if (!planSize(plan) || deps.ui.get().following) return plan
  const models = config ? startModels(d, config) : {}
  deps.ui.update((u) => {
    u.following = {
      id: newId('follow'), startedAt: new Date().toISOString(), ad: plan.ad, clipShots: plan.clips, framesDone: [], clipsDone: [], adDone: false,
      total: planSize(plan), ...(opts.steer ? { steer: true } : {}), ...(Object.keys(models).length ? { models } : {}),
    }
  })
  await continueFollow(deps)
  return plan
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
    if (item.kind === 'frame' && !r.clipShots.includes(item.shotId)) r.clipShots.push(item.shotId)
    if (item.kind === 'clip' && !r.clipsDone.includes(item.shotId)) r.clipsDone.push(item.shotId)
  })
  return send(deps, deps.ui.get().following ?? run, item, opts.text?.trim() || undefined)
}

/** The update box's "Do the rest as they are": this item and every one after it on the box's models, no words. */
export async function restAsTheyAre(deps: FrameDeps, modelChoice?: ModelChoice | null) {
  deps.ui.update((u) => { if (u.following) u.following.steer = false })
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
  if (!deps.ui.get().following) return
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
    if (run.awaiting) return // the box is waiting for the user
    const d = deps.doc.get()
    const shots = d.shots ?? []
    const note = (fn: (r: FollowRun) => void) => deps.ui.update((u) => { if (u.following) fn(u.following) })

    // 1. Frames, in order. A frame drawn in this run marks the next one (applyFrame), so the run walks the chain.
    const hasFrames = (d.frames ?? []).some((f) => shots.some((s) => s.id === f.shot_id))
    const i = shots.findIndex((s) => !run.framesDone.includes(s.id) && (!!frameStale(d, s.id) || (hasFrames && !selectedFrame(d, s.id))))
    if (i >= 0) {
      const shot = shots[i]
      if (run.steer) return void note((r) => { r.awaiting = { kind: 'frame', shotId: shot.id } })
      note((r) => {
        r.framesDone.push(shot.id)
        if (!r.clipShots.includes(shot.id)) r.clipShots.push(shot.id)
      })
      await send(deps, run, { kind: 'frame', shotId: shot.id })
      return
    }

    // 2. Clips, in order, for every shot whose frame changed, whose clip is out of date, or (once there are clips) that has none.
    const hasTakes = (d.takes ?? []).some((t) => shots.some((s) => s.id === t.shot_id))
    const fixing = shotsBeingFixed(d, (id) => ctxOf(deps, id))
    const next = shots.find((s) => !run.clipsDone.includes(s.id) && !fixing.has(s.id) && (run.clipShots.includes(s.id) || !!takeStale(d, s.id) || (hasTakes && !selectedTake(d, s.id))))
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
