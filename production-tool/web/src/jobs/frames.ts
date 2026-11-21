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

import type { Aspect, AssetRef, Frame, JobInput, ModelChoice, ProductionDocument, Shot } from '../contracts/types'
import { updateDoc, type DocumentStore } from '../doc/store'
import type { UiState } from '../doc/ui'
import type { FrameHow, JobPurpose } from '../model/purpose'
import { purposeOf } from '../model/purpose'
import { currentFrame, jobsList, mainStoryboard, openStoryboard, scriptOfStoryboard, scriptText as wholeScript, shotsOf } from '../model/selectors'
import type { UiStore } from '../projects/uiStore'
import type { Relay } from '../relay'
import { assetRef } from './assets'
import { isActive, type JobRunner } from './runner'
import { jobShot, refsFor } from './select'
import { castRefs, castShot, keptFromFirst } from './cast'
import { liveGet } from '../model/live'

export type { FrameHow } from '../model/purpose'

export interface FrameDeps {
  relay: Relay
  doc: DocumentStore
  ui: UiStore
  runner: JobRunner
  /** The Film editor is the two rooms: a new take lands beside the others and never touches the cut. The app
   *  always says so (projects/session.ts); absent, a new take is picked in the cut, as the legacy Film editor
   *  did (owner 2026-11-18 retired it; the jobs tests still land that way, to be moved to the rooms). */
  rooms?: () => boolean
  /** A generation landed (a frame, a clip, a take, a render, a size, a draft): a save moment, so the server's copy
   *  has it (projects/session.ts; UAT 2026-11-21, B7: only the 5-minute tick, a lock and Save posted it). */
  landed?: () => void
}

/** The frame in a shot now (its pick). */
export function selectedFrame(d: ProductionDocument, shotId: string | undefined): Frame | undefined {
  return shotId ? currentFrame(d, shotId) : undefined
}

/** The storyboard a frame call is on: this one when it is in the document, else the main one. */
const boardOf = (d: ProductionDocument, storyboardId?: string) => (storyboardId && d.storyboards[storyboardId]) || mainStoryboard(d)

/** anchorFrame and previousFrame for the shot at `index` (0-based, on `storyboardId`, else the main
 *  storyboard). Shot 1 has neither. `strict`: a later shot without a frame before it cannot be drawn yet. */
export async function continuity(relay: Relay, d: ProductionDocument, index: number, strict = false, storyboardId?: string): Promise<Pick<JobInput, 'anchorFrame' | 'previousFrame'>> {
  if (index <= 0) return {}
  const shots = shotsOf(d, boardOf(d, storyboardId)?.id)
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

/** The script the shots came from (the words of the script driving the storyboard; the main script's by
 *  default), cut for a frame's setting. */
export function scriptText(d: ProductionDocument, storyboardId?: string): string | undefined {
  const sb = boardOf(d, storyboardId)
  const script = sb ? scriptOfStoryboard(d, sb.id) : undefined
  const text = script ? wholeScript(d, script.id) : ''
  return text ? text.slice(0, FRAME_SCRIPT_MAX) : undefined
}

/** How much of shot 1 a later frame carries as @anchor's place (FRAME_ANCHOR_MAX characters). */
export const FRAME_ANCHOR_MAX = 300

/**
 * What a frame reads besides its own shot (UAT round 3 R3-12: every frame carried the whole 4-beat note, and frame 4
 * kept the rainy street of @anchor for a café). A shot with words of its own is its own beat: the first frame reads
 * nothing more; a later one reads shot 1's beat, labelled, so the Director agent keeps @anchor's setting only when this
 * shot is in that place (director.v17). A shot with no words of its own reads the script's opening, as before.
 */
export function frameScript(d: ProductionDocument, storyboardId: string | undefined, index: number): string | undefined {
  const shots = shotsOf(d, boardOf(d, storyboardId)?.id)
  const shot = shots[index]
  if (!shot?.action?.trim()) return scriptText(d, storyboardId)
  if (index <= 0) return undefined
  const first = shots[0]
  const heading = first?.scene_id ? d.scenes?.[first.scene_id]?.heading?.trim() : undefined
  const beat = [heading, first?.action?.trim()].filter(Boolean).join('. ')
  if (!beat) return undefined
  const line = `Shot 1 (@anchor): ${beat}`
  return line.length <= FRAME_ANCHOR_MAX ? line : `${line.slice(0, FRAME_ANCHOR_MAX - 1).replace(/\s+\S*$/, '')}…`
}

/** The whole frame request for the shot at `index` of a storyboard (absent: the main one). */
export async function frameInput(relay: Relay, d: ProductionDocument, index: number, text?: string, strict = true, storyboardId?: string, declined: readonly string[] = []): Promise<JobInput> {
  const sb = boardOf(d, storyboardId)
  const shot = shotsOf(d, sb?.id)[index]
  if (!shot) throw new Error('That shot is gone.')
  // The shot's named and linked refs, required; the storyboard's others, offered (features/canvas-nodes.clan).
  const own = await refsFor(relay, d, shot, text, { offer: true, declined })
  // Who is seen: a character only when the shot's words name or imply a person (jobs/cast.ts; UAT round 3 R3-F1).
  const refs = await castRefs(relay, d, sb?.id, index, shot, own)
  const script = frameScript(d, sb?.id, index)
  const ratio = sb?.ratio
  // No picture goes twice in one job (R3-F1: frame 5 sent frame 1 as in_1 and as anchor): a ref that is the anchor
  // or the previous frame (a person kept from frame 1 is frame 1's picture) drops that continuity frame.
  const sent = new Set(refs.map((r) => r.asset.sha256))
  const cont = await continuity(relay, d, index, strict, sb?.id)
  if (cont.anchorFrame && sent.has(cont.anchorFrame.sha256)) delete cont.anchorFrame
  if (cont.previousFrame && sent.has(cont.previousFrame.sha256)) delete cont.previousFrame
  return {
    // An unnamed person ("a flatmate") is someone else: the offered character's name in a Cast line (R4-F2).
    shot: castShot(d, shot, jobShot(d, shot), own),
    ...(refs.length ? { refs } : {}),
    ...(ratio ? { ratio } : {}),
    ...(script ? { script } : {}),
    ...(text?.trim() ? { text: text.trim() } : {}),
    ...cont,
  }
}

/** Draw the frame for the shot at `index` (of `opts.storyboardId`, else the main storyboard): a first
 *  version, or a new one of `parent`. */
export async function drawFrame(deps: FrameDeps, index: number, how: FrameHow, opts: { text?: string; parent?: Frame; followRun?: string; modelChoice?: ModelChoice; storyboardId?: string; clipAfter?: { videoId?: string; modelChoice?: ModelChoice }; loose?: boolean } = {}): Promise<string> {
  const d = liveGet(deps.doc)
  const sb = boardOf(d, opts.storyboardId)
  const shot = shotsOf(d, sb?.id)[index]
  if (!shot) throw new Error('That shot is gone.')
  // `loose`: drawn beside others (Draw the rest in parallel), with the frame before only when it is there already.
  const input = await frameInput(deps.relay, d, index, opts.text, !opts.parent && !opts.loose, sb?.id, deps.ui.get().declinedAdds?.[shot.id])
  const purpose: JobPurpose = { for: 'frame', shotId: shot.id, how, ...(opts.parent ? { parentFrameId: opts.parent.id } : {}) }
  const parents = opts.parent?.job_id ? [opts.parent.job_id] : []
  const local = { ...(opts.followRun ? { followRun: opts.followRun } : {}), ...(opts.clipAfter ? { clipAfter: opts.clipAfter } : {}) }
  return deps.runner.submit('frame', input, parents, purpose, undefined, opts.modelChoice, Object.keys(local).length ? { local } : {})
}

/** A picture's own shape (its measured size), for a region edit: the relay asks for the nearest size and
 *  crops back to it, so an edit of a 1344x756 frame comes back 1344x756 (features/frame-aspect.clan). An old
 *  asset without a size sends none, and nothing is cropped, as before. */
export function ownAspect(d: Pick<ProductionDocument, 'assets'>, sha: string): Aspect | undefined {
  const a = d.assets[sha]
  return a?.w && a?.h ? { w: a.w, h: a.h } : undefined
}

/** Any frame (or frame region edit) job still moving. */
export function frameJobRunning(d: ProductionDocument): boolean {
  return jobsList(d).some((j) => isActive(j.state) && purposeOf(j)?.for === 'frame')
}

/** The first shot (0-based, on `storyboardId`, else the main storyboard) with no frame yet, or -1. */
export function firstUndrawn(d: ProductionDocument, storyboardId?: string): number {
  return shotsOf(d, boardOf(d, storyboardId)?.id).findIndex((s) => needsFrame(s) && !currentFrame(d, s))
}

/**
 * Whether a shot wants a drawn frame. The end card does not (live test 2026-11-18: frame 6 was a paid photo
 * nearly the same as frame 5): the render typesets it from its words (rooms/timeline.ts endCardFrom), and no
 * clip is made of it. Draw the rest and "N frames not made yet" pass it by; the person can still draw one.
 */
export const needsFrame = (s: Pick<Shot, 'kind'>): boolean => s.kind !== 'end_card'

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
  const d = liveGet(deps.doc)
  const stop = () => deps.ui.update((u) => { u.drawingRest = false })
  // The storyboard open in the Storyboard panel (the node opened on the canvas), else the main one.
  const sbId = openStoryboard(d, ui.openNode)?.id
  // Once frame 1 is drawn and its person kept, every later frame carries that person, so the rest are drawn side by
  // side (UAT round 3, UX 10: two frames one after another took 108 s).
  if (keptFromFirst(d, sbId)) return drawSideBySide(deps, d, sbId, how, stop)
  if (frameJobRunning(d)) return
  const i = firstUndrawn(d, sbId)
  if (i < 0) return stop()
  const shotId = shotsOf(d, sbId)[i].id
  const lastTry = [...jobsList(d)].reverse().find((j) => {
    const p = purposeOf(j)
    return p?.for === 'frame' && p.shotId === shotId
  })
  if (lastTry && (lastTry.state === 'failed' || lastTry.state === 'cancelled') && how === 'chain') return stop()
  try {
    await drawFrame(deps, i, i === 0 && how === 'rest' ? 'first' : how, { storyboardId: sbId })
  } catch (e) {
    stop()
    throw e
  }
}

/** At most this many frames at once: the relay's in-flight limit per person (config inFlightPerParticipant, 2 live). */
export const PARALLEL_FRAMES = 2

/** The shots Draw the rest has picked and not yet submitted, per runner (UAT round 5 S2-D: frames 2 and 3 landed 1 s
 *  apart, both completions saw shot 4 open with no job yet, and shot 4 was started, and paid for, twice in the same
 *  ms). A shot is claimed synchronously, before the first await, and let go once its job is in the document. */
const claimed = new WeakMap<object, Set<string>>()
const claimsOf = (runner: object): Set<string> => {
  let set = claimed.get(runner)
  if (!set) claimed.set(runner, (set = new Set()))
  return set
}

/** Draw the rest side by side: up to PARALLEL_FRAMES frame jobs at once, each a shot with no frame and none on its way;
 *  a shot whose last try failed is left for a retry. Each landing starts the next (the runner's completion hook). */
async function drawSideBySide(deps: FrameDeps, d: ProductionDocument, sbId: string | undefined, how: FrameHow, stop: () => void): Promise<void> {
  const shots = shotsOf(d, sbId)
  const mine = claimsOf(deps.runner)
  const tries = (shotId: string) => jobsList(d).filter((j) => { const p = purposeOf(j); return p?.for === 'frame' && p.shotId === shotId })
  // A claimed shot whose job is already in the document is counted once, as that job.
  const running = jobsList(d).filter((j) => isActive(j.state) && purposeOf(j)?.for === 'frame').length
    + [...mine].filter((id) => !tries(id).some((j) => isActive(j.state))).length
  const open = shots.map((s, i) => ({ s, i })).filter(({ s }) => needsFrame(s) && !currentFrame(d, s) && !mine.has(s.id)
    && !tries(s.id).some((j) => isActive(j.state))
    && !(how === 'chain' && ['failed', 'cancelled'].includes(tries(s.id).at(-1)?.state ?? '')))
  if (!open.length) {
    if (!running) stop()
    return
  }
  const room = Math.max(0, PARALLEL_FRAMES - running)
  const picked = open.slice(0, room)
  for (const { s } of picked) mine.add(s.id) // synchronously: a second completion landing now sees them taken
  try {
    for (const { s, i } of picked) {
      try {
        await drawFrame(deps, i, how === 'rest' ? 'next' : how, { storyboardId: sbId, loose: true })
      } finally {
        mine.delete(s.id)
      }
    }
  } catch (e) {
    for (const { s } of picked) mine.delete(s.id)
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
  }, 'select frame')
}
