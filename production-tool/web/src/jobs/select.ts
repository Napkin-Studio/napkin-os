// Finding the job that belongs at a spot in the UI (pending or failed).

import type { JobInputRef, NamedRef, ProductionDocument, Ratio, Shot } from '../contracts/types'
import { mentions, nameOf, subjectRefs } from '../lib/names'
import type { JobCtx, UiState } from '../doc/ui'
import type { Relay } from '../relay'
import { assetRef } from './assets'
import { isActive } from './runner'

/** The newest job matching `match` that is still running, or failed and not cleared. */
export function jobAt(doc: ProductionDocument, ui: UiState, match: (ctx: JobCtx) => boolean): string | undefined {
  for (let i = doc.jobs.length - 1; i >= 0; i--) {
    const j = doc.jobs[i]
    const ctx = ui.jobCtx[j.id]
    if (!ctx || ctx.dismissed || !match(ctx)) continue
    if (isActive(j.state) || j.state === 'failed' || j.state === 'cancelled') return j.id
  }
  return undefined
}

export function isRunning(doc: ProductionDocument, jobId: string | undefined): boolean {
  if (!jobId) return false
  const j = doc.jobs.find((x) => x.id === jobId)
  return !!j && isActive(j.state)
}

/** Still being made by the relay: running, and not "uncertain". An uncertain job waits on the
 *  participant (Stop waiting / Try again on its card), so it holds no lock on Make clips or
 *  Render ad (it held them for ever, 2026-10-09). */
export function isMoving(doc: ProductionDocument, jobId: string | undefined): boolean {
  if (!isRunning(doc, jobId)) return false
  return doc.jobs.find((x) => x.id === jobId)?.state !== 'uncertain'
}

/** A named ref as a job input. The role is its key's; the relay makes the wire tag. */
export async function namedInput(relay: Relay, doc: ProductionDocument, r: NamedRef): Promise<JobInputRef> {
  const role = doc.keys.find((k) => k.key === r.key)?.role ?? 'other'
  const origin = doc.assets.find((a) => a.sha256 === r.asset)?.origin
  const kind = origin === 'drawn' ? 'drawing' : origin === 'generated' || origin === 'mock' ? 'generated' : 'picture'
  return { id: r.id, name: nameOf(r), role, kind, asset: await assetRef(relay, r.asset) }
}

/** The refs a shot names, as job inputs. A name with no image is an error the participant can fix. */
export async function shotRefs(relay: Relay, doc: ProductionDocument, shot: Shot): Promise<JobInputRef[]> {
  const out: JobInputRef[] = []
  for (const name of shot.refs ?? []) {
    const found = subjectRefs(doc, name) // a bare key: its front and up to 3 more (throws with no front)
    if (!found.length) throw new Error(`Shot ${shot.order} uses @${name}, but no image has that name. Name one on the canvas, or change the shot.`)
    for (const r of found) if (!out.some((x) => x.id === r.id)) out.push(await namedInput(relay, doc, r))
  }
  return out
}

/** A shot's refs plus any name written in the participant's words (the relay must have each one). */
export async function refsFor(relay: Relay, doc: ProductionDocument, shot: Shot, text?: string): Promise<JobInputRef[]> {
  const refs = await shotRefs(relay, doc, shot)
  for (const r of mentions(doc, text ?? '').found) {
    if (!refs.some((x) => x.id === r.id)) refs.push(await namedInput(relay, doc, r))
  }
  return refs
}

/** Every named ref, for the shot list: the director picks the names each shot shows. */
export async function allNamed(relay: Relay, doc: ProductionDocument): Promise<JobInputRef[]> {
  const out: JobInputRef[] = []
  for (const r of doc.refs.slice(0, 14)) out.push(await namedInput(relay, doc, r))
  return out
}

export function ratioAspect(r: Ratio): number {
  const [a, b] = r.split(':').map(Number)
  return a / b
}

/**
 * The shot as a frame or clip job sees it. A shot's `dialogue` is voice-over: it
 * stays in the document and the shot list, but never goes to a frame or a clip,
 * because a model that is told the words draws them (decided 2026-10-07, the
 * FACET ad: a "Dialogue – …" caption box in shot 4's frame and every clip from it).
 */
export function jobShot(shot: Shot): Shot {
  const { dialogue: _voiceOver, ...rest } = shot
  return rest
}
