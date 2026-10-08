// Storyboard frames, drawn one after another (decided 2026-10-07). Every frame
// has up to three anchors: the shot's named refs (identity: `shot.refs`, as
// @maya_front, @lamp_on), the selected frame of shot 1 (`anchorFrame`: setting,
// light, style) and the selected frame of the shot before (`previousFrame`:
// continuity). Frame 1 has only the refs.
//
// "Draw the rest" is a flag in the UI state (snapshotted, so it survives a
// reload): each time a frame lands, the runner's completion hook calls
// `continueDrawing`, which starts the next shot that has no frame. Nothing here
// polls; the chain only moves when a frame completes, on a click, or at boot.

import type { AssetRef, Frame, JobInput, ProductionDocument, StaleMark } from '../contracts/types'
import { updateDoc, type DocumentStore, type SnapshotStore } from '../doc/store'
import type { JobPurpose, UiState } from '../doc/ui'
import type { Relay } from '../relay'
import { assetRef } from './assets'
import { isActive, type JobRunner } from './runner'
import { refsFor } from './select'

export interface FrameDeps {
  relay: Relay
  doc: DocumentStore
  ui: SnapshotStore<UiState>
  runner: JobRunner
}

export type FrameHow = NonNullable<Extract<JobPurpose, { for: 'frame' }>['how']>

/** The selected frame of a shot (or its newest, if none is marked). */
export function selectedFrame(d: ProductionDocument, shotId: string | undefined): Frame | undefined {
  if (!shotId) return undefined
  const frames = (d.frames ?? []).filter((f) => f.shot_id === shotId)
  return frames.find((f) => f.selected) ?? frames[frames.length - 1]
}

/** anchorFrame and previousFrame for the shot at `index` (0-based). Shot 1 has neither.
 *  `strict`: a later shot without a frame before it cannot be drawn yet. */
export async function continuity(relay: Relay, d: ProductionDocument, index: number, strict = false): Promise<Pick<JobInput, 'anchorFrame' | 'previousFrame'>> {
  if (index <= 0) return {}
  const shots = d.shots ?? []
  const first = selectedFrame(d, shots[0]?.id)
  const prev = selectedFrame(d, shots[index - 1]?.id)
  if (strict && (!first || !prev)) throw new Error(`Draw shot ${index} first.`)
  const out: { anchorFrame?: AssetRef; previousFrame?: AssetRef } = {}
  if (first) out.anchorFrame = await assetRef(relay, first.asset)
  if (prev) out.previousFrame = await assetRef(relay, prev.asset)
  return out
}

/** The script the shots came from, for the frame's setting. */
export function scriptText(d: ProductionDocument): string | undefined {
  const rev = d.script?.revisions.find((r) => r.id === d.script?.current)
  return rev?.imported_text ? rev.imported_text.slice(0, 600) : undefined
}

/** The whole frame request for the shot at `index`. */
export async function frameInput(relay: Relay, d: ProductionDocument, ui: UiState, index: number, text?: string, strict = true): Promise<JobInput> {
  const shot = (d.shots ?? [])[index]
  if (!shot) throw new Error('That shot is gone.')
  const refs = await refsFor(relay, d, shot, text)
  const script = scriptText(d)
  return {
    shot,
    ...(refs.length ? { refs } : {}),
    ratio: ui.ratio,
    ...(script ? { script } : {}),
    ...(text?.trim() ? { text: text.trim() } : {}),
    ...(await continuity(relay, d, index, strict)),
  }
}

/** Draw the frame for the shot at `index`: a first version, or a new one of `parent`. */
export async function drawFrame(deps: FrameDeps, index: number, how: FrameHow, opts: { text?: string; parent?: Frame } = {}): Promise<string> {
  const d = deps.doc.get()
  const shot = (d.shots ?? [])[index]
  if (!shot) throw new Error('That shot is gone.')
  const input = await frameInput(deps.relay, d, deps.ui.get(), index, opts.text, !opts.parent)
  const purpose: JobPurpose = { for: 'frame', shotId: shot.id, how, ...(opts.parent ? { parentFrameId: opts.parent.id } : {}) }
  return deps.runner.submit('frame', input, opts.parent ? [opts.parent.job_id] : [], purpose)
}

/** Any frame (or frame region edit) job still moving. */
export function frameJobRunning(d: ProductionDocument, ui: UiState): boolean {
  return d.jobs.some((j) => isActive(j.state) && ui.jobCtx[j.id]?.for === 'frame')
}

/** The first shot (0-based) with no frame yet, or -1. */
export function firstUndrawn(d: ProductionDocument): number {
  return (d.shots ?? []).findIndex((s) => !(d.frames ?? []).some((f) => f.shot_id === s.id))
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
  const ui = deps.ui.get()
  if (!ui.drawingRest) return
  const d = deps.doc.get()
  if (frameJobRunning(d, ui)) return
  const stop = () => deps.ui.update((u) => { u.drawingRest = false })
  const i = firstUndrawn(d)
  if (i < 0) return stop()
  const shotId = d.shots![i].id
  const lastTry = [...d.jobs].reverse().find((j) => ui.jobCtx[j.id]?.for === 'frame' && (ui.jobCtx[j.id] as { shotId?: string }).shotId === shotId)
  if (lastTry && (lastTry.state === 'failed' || lastTry.state === 'cancelled') && how === 'chain') return stop()
  try {
    await drawFrame(deps, i, i === 0 && how === 'rest' ? 'first' : how)
  } catch (e) {
    stop()
    throw e
  }
}

/**
 * Shot `shotId`'s selected frame changed: the next shot's selected frame is out
 * of date unless it was drawn from this very picture (then any earlier mark from
 * this shot is lifted). Never regenerates anything.
 */
export function markNextStale(d: ProductionDocument, shotId: string, now = new Date().toISOString()) {
  const shots = d.shots ?? []
  const i = shots.findIndex((s) => s.id === shotId)
  const next = shots[i + 1]
  if (i < 0 || !next) return
  const sel = selectedFrame(d, shotId)
  const target = selectedFrame(d, next.id)
  if (!sel || !target) return
  const fromHere = new Set((d.frames ?? []).filter((f) => f.shot_id === shotId).map((f) => f.id))
  const job = d.jobs.find((j) => j.id === target.job_id)
  d.stale = (d.stale ?? []).filter((s) => !(s.target.kind === 'frame' && s.target.id === target.id && s.caused_by.kind === 'frame' && fromHere.has(s.caused_by.id)))
  if (job?.input_hashes?.includes(sel.asset)) return
  const mark: StaleMark = { target: { kind: 'frame', id: target.id }, caused_by: { kind: 'frame', id: sel.id }, reason: `Shot ${i + 1} changed`, marked_at: now }
  d.stale.push(mark)
}

/** Select a version of a shot's frame and mark the next shot's frame if that changes it. */
export function selectFrame(store: DocumentStore, shotId: string, frameId: string) {
  return updateDoc(store, (d) => {
    let sha: string | undefined
    for (const f of d.frames ?? []) if (f.shot_id === shotId) {
      f.selected = f.id === frameId
      if (f.selected) sha = f.asset
    }
    const s = d.shots?.find((x) => x.id === shotId)
    if (s && sha) s.storyboard_frame = sha
    markNextStale(d, shotId)
  }, 'select frame')
}
