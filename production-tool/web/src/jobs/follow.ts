// "Update what follows" (decided 2026-10-07, "Change anything later; update what
// follows on request"). Never automatic: the user sees the work and its cost and
// says yes. Then, in order:
//
//   1. out-of-date frames, one at a time, each from shot 1's frame and the one
//      before (the Draw the rest machinery in frames.ts);
//   2. a clip for every shot whose selected frame changed (or that has none);
//   3. the ad, when there was one.
//
// Every step is a new version: nothing earlier is deleted. The run is a flag in
// the UI state (snapshotted), moved on by the runner's completion hooks and at
// boot, like Draw the rest, so it resumes after a reload. Cancel stops it after
// the job running now. A failed step waits: Retry on that job moves the run on.

import type { Config, Op, ProductionDocument } from '../contracts/types'
import type { FollowRun, JobCtx } from '../doc/ui'
import { describeFollow } from '../doc/describe'
import { routedSheet, type Sheets } from '../capabilities'
import { newId } from '../lib/ulid'
import { makeClip, renderAd, selectedTake } from './clips'
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
export function planFollow(d: ProductionDocument): FollowPlan {
  const none: FollowPlan = { frames: [], clips: [], ad: false }
  if (!anythingStale(d)) return none
  const shots = d.shots ?? []
  const hasFrames = (d.frames ?? []).some((f) => shots.some((s) => s.id === f.shot_id))
  const hasTakes = (d.takes ?? []).some((t) => shots.some((s) => s.id === t.shot_id))
  const first = shots.findIndex((s) => !!frameStale(d, s.id) || (hasFrames && !selectedFrame(d, s.id)))
  const frames = first >= 0 ? shots.slice(first).map((s) => s.id) : []
  const clips = hasTakes ? shots.filter((s) => frames.includes(s.id) || !!takeStale(d, s.id) || !selectedTake(d, s.id)).map((s) => s.id) : []
  const ad = adStatus(d)
  return { frames, clips, ad: !!ad.ad && (clips.length > 0 || ad.stale) }
}

/** What one job of `op` costs on the provider routed for it (null when it does not say). */
function estimate(op: Op, config: Config, sheets?: Sheets): number | null {
  const sheet = routedSheet(op, config, sheets)
  if (!sheet) return null
  return sheet.ops[op]?.estimateUsd ?? null
}

/** The estimated cost of a plan, from the routed providers' capability sheets. The ad (ffmpeg) costs nothing. */
export function planCost(p: FollowPlan, config: Config, sheets?: Sheets): { usd: number; known: boolean } {
  const frame = estimate('frame', config, sheets)
  const clip = estimate('clip', config, sheets)
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
export function planSummary(p: FollowPlan, config: Config, sheets?: Sheets): string {
  const c = planCost(p, config, sheets)
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

/** Start a run of the plan as it stands now. */
export async function startFollow(deps: FrameDeps): Promise<FollowPlan> {
  const d = deps.doc.get()
  const plan = planFollow(d)
  if (!planSize(plan) || deps.ui.get().following) return plan
  deps.ui.update((u) => {
    u.following = { id: newId('follow'), startedAt: new Date().toISOString(), ad: plan.ad, clipShots: plan.clips, framesDone: [], clipsDone: [], adDone: false }
  })
  await continueFollow(deps)
  return plan
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
    if (jobs.some((j) => isActive(j.state))) return
    if (run.cancel) return void (await finish(deps, run, true))
    const last = jobs.at(-1)
    if (last && (last.state === 'failed' || last.state === 'cancelled')) return // waits for Retry, or Cancel
    const d = deps.doc.get()
    const shots = d.shots ?? []
    const note = (fn: (r: FollowRun) => void) => deps.ui.update((u) => { if (u.following) fn(u.following) })

    // 1. Frames, in order. A frame drawn in this run marks the next one (applyFrame), so the run walks the chain.
    const hasFrames = (d.frames ?? []).some((f) => shots.some((s) => s.id === f.shot_id))
    const i = shots.findIndex((s) => !run.framesDone.includes(s.id) && (!!frameStale(d, s.id) || (hasFrames && !selectedFrame(d, s.id))))
    if (i >= 0) {
      const shot = shots[i]
      const parent = selectedFrame(d, shot.id)
      // Keep what the user asked of this frame when it was drawn (not a region edit's words: that is for a box).
      const made = parent ? d.jobs.find((j) => j.id === parent.job_id) : undefined
      const text = made?.op === 'frame' ? made.text : undefined
      note((r) => {
        r.framesDone.push(shot.id)
        if (!r.clipShots.includes(shot.id)) r.clipShots.push(shot.id)
      })
      await drawFrame(deps, i, 'update', { followRun: run.id, ...(parent ? { parent } : {}), ...(text ? { text } : {}) })
      return
    }

    // 2. Clips, in order, for every shot whose frame changed, whose clip is out of date, or (once there are clips) that has none.
    const hasTakes = (d.takes ?? []).some((t) => shots.some((s) => s.id === t.shot_id))
    const next = shots.find((s) => !run.clipsDone.includes(s.id) && (run.clipShots.includes(s.id) || !!takeStale(d, s.id) || (hasTakes && !selectedTake(d, s.id))))
    if (next) {
      const parentTake = selectedTake(d, next.id)
      const made = parentTake ? d.jobs.find((j) => j.id === parentTake.job_id) : undefined
      const text = made?.op === 'clip' ? made.text : undefined
      note((r) => r.clipsDone.push(next.id))
      await makeClip(deps, next.id, { ...(parentTake ? { parentTake } : {}), ...(text ? { text } : {}), purpose: { followRun: run.id } })
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
