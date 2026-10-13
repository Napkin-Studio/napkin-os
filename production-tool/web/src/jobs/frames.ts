// Storyboard frames, drawn one after another (decided 2026-10-07). Every frame
// has up to three anchors: the shot's named refs (identity: the @names in its
// text, as @maya_front, @lamp_on), the picked frame of shot 1 (`anchorFrame`:
// setting, light, style) and the picked frame of the shot before
// (`previousFrame`: continuity). Frame 1 has only the refs.
//
// "Draw the rest" is a flag in the UI state (snapshotted, so it survives a
// reload): each time a frame lands, the runner's completion hook calls
// `continueDrawing`, which starts the next shot that has no frame. Nothing here
// polls; the chain only moves when a frame completes, on a click, or at boot.

import type { AssetRef, Frame, JobInput, ModelChoice, ProductionDocument } from '../contracts/types'
import { updateDoc, type DocumentStore } from '../doc/store'
import type { UiState } from '../doc/ui'
import type { FrameHow, JobPurpose } from '../model/purpose'
import { purposeOf } from '../model/purpose'
import { currentFrame, jobsList, mainStoryboard, scriptText as wholeScript, shotsOf } from '../model/selectors'
import type { UiStore } from '../projects/uiStore'
import type { Relay } from '../relay'
import { assetRef } from './assets'
import { isActive, type JobRunner } from './runner'
import { jobShot, refsFor } from './select'
import { refreshClipStale } from './stale'

export type { FrameHow } from '../model/purpose'

export interface FrameDeps {
  relay: Relay
  doc: DocumentStore
  ui: UiStore
  runner: JobRunner
}

/** The frame in a shot now (its pick). */
export function selectedFrame(d: ProductionDocument, shotId: string | undefined): Frame | undefined {
  return shotId ? currentFrame(d, shotId) : undefined
}

/** anchorFrame and previousFrame for the shot at `index` (0-based, on the main storyboard). Shot 1 has
 *  neither. `strict`: a later shot without a frame before it cannot be drawn yet. */
export async function continuity(relay: Relay, d: ProductionDocument, index: number, strict = false): Promise<Pick<JobInput, 'anchorFrame' | 'previousFrame'>> {
  if (index <= 0) return {}
  const shots = shotsOf(d)
  const first = selectedFrame(d, shots[0]?.id)
  const prev = selectedFrame(d, shots[index - 1]?.id)
  if (strict && (!first || !prev)) throw new Error(`Draw shot ${index} first.`)
  const out: { anchorFrame?: AssetRef; previousFrame?: AssetRef } = {}
  if (first) out.anchorFrame = await assetRef(relay, first.asset)
  if (prev) out.previousFrame = await assetRef(relay, prev.asset)
  return out
}

/** A script is up to SCRIPT_MAX characters (2026-10-09); a frame request carries only its first
 *  FRAME_SCRIPT_MAX, enough for the setting, so every frame's director call stays small. */
export const SCRIPT_MAX = 1500
export const FRAME_SCRIPT_MAX = 600

/** The script the shots came from (the main script's words), cut for a frame's setting. */
export function scriptText(d: ProductionDocument): string | undefined {
  const text = wholeScript(d)
  return text ? text.slice(0, FRAME_SCRIPT_MAX) : undefined
}

/** The whole frame request for the shot at `index` of the main storyboard. */
export async function frameInput(relay: Relay, d: ProductionDocument, index: number, text?: string, strict = true): Promise<JobInput> {
  const shot = shotsOf(d)[index]
  if (!shot) throw new Error('That shot is gone.')
  const refs = await refsFor(relay, d, shot, text)
  const script = scriptText(d)
  const ratio = mainStoryboard(d)?.ratio
  return {
    shot: jobShot(d, shot),
    ...(refs.length ? { refs } : {}),
    ...(ratio ? { ratio } : {}),
    ...(script ? { script } : {}),
    ...(text?.trim() ? { text: text.trim() } : {}),
    ...(await continuity(relay, d, index, strict)),
  }
}

/** Draw the frame for the shot at `index`: a first version, or a new one of `parent`. */
export async function drawFrame(deps: FrameDeps, index: number, how: FrameHow, opts: { text?: string; parent?: Frame; followRun?: string; modelChoice?: ModelChoice } = {}): Promise<string> {
  const d = deps.doc.get()
  const shot = shotsOf(d)[index]
  if (!shot) throw new Error('That shot is gone.')
  const input = await frameInput(deps.relay, d, index, opts.text, !opts.parent)
  const purpose: JobPurpose = { for: 'frame', shotId: shot.id, how, ...(opts.parent ? { parentFrameId: opts.parent.id } : {}) }
  const parents = opts.parent?.job_id ? [opts.parent.job_id] : []
  return deps.runner.submit('frame', input, parents, purpose, undefined, opts.modelChoice, opts.followRun ? { local: { followRun: opts.followRun } } : {})
}

/** Any frame (or frame region edit) job still moving. */
export function frameJobRunning(d: ProductionDocument): boolean {
  return jobsList(d).some((j) => isActive(j.state) && purposeOf(j)?.for === 'frame')
}

/** The first shot (0-based, main storyboard) with no frame yet, or -1. */
export function firstUndrawn(d: ProductionDocument): number {
  return shotsOf(d).findIndex((s) => !currentFrame(d, s))
}

/** Start "Draw the rest" (from the first shot with no frame). */
export async function drawTheRest(deps: FrameDeps): Promise<void> {
  deps.ui.update((u) => { u.drawingRest = true })
  await continueDrawing(deps, 'rest')
}

/**
 * Move the "Draw the rest" chain one step: when it is on and no frame is being
 * drawn, start the next shot with no frame. Turns itself off when every shot has
 * a frame, or when the next shot's last try failed (a retry that lands moves it on).
 */
export async function continueDrawing(deps: FrameDeps, how: FrameHow = 'chain'): Promise<void> {
  const ui: UiState = deps.ui.get()
  if (!ui.drawingRest) return
  const d = deps.doc.get()
  if (frameJobRunning(d)) return
  const stop = () => deps.ui.update((u) => { u.drawingRest = false })
  const i = firstUndrawn(d)
  if (i < 0) return stop()
  const shotId = shotsOf(d)[i].id
  const lastTry = [...jobsList(d)].reverse().find((j) => {
    const p = purposeOf(j)
    return p?.for === 'frame' && p.shotId === shotId
  })
  if (lastTry && (lastTry.state === 'failed' || lastTry.state === 'cancelled') && how === 'chain') return stop()
  try {
    await drawFrame(deps, i, i === 0 && how === 'rest' ? 'first' : how)
  } catch (e) {
    stop()
    throw e
  }
}

/** Pick a version of a shot's frame and mark this shot's clip if that changes it. The next shot's
 *  frame is never marked (features/one-to-one-updates.clan): at most it shows "drawn from an older frame". */
export function selectFrame(store: DocumentStore, shotId: string, frameId: string) {
  return updateDoc(store, (d) => {
    const s = d.shots[shotId]
    if (!s || !d.frames[frameId] || s.pick?.current === frameId) return
    const alternates = s.pick?.alternates?.filter((a) => a !== frameId)
    s.pick = { current: frameId, ...(alternates?.length ? { alternates } : {}) }
    refreshClipStale(d, shotId)
  }, 'select frame')
}
