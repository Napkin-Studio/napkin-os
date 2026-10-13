// Finding the job that belongs at a spot in the UI (pending or failed), and
// what a job sends about a shot and its names (contract 3).

import type { JobInputRef, JobShot, NamedRef, ProductionDocument, Ratio, Shot } from '../contracts/types'
import type { JobCtx, UiState } from '../doc/ui'
import { KEY_EXTRAS, MENTION, NoFrontError } from '../lib/names'
import { beatsOf, jobsList, refName, refNamed, refsList, shotName, shotSubjects } from '../model/selectors'
import type { Relay } from '../relay'
import { assetRef } from './assets'
import { isActive, jobCtx } from './runner'

/** The newest job matching `match` that is still running, or failed and not cleared. */
export function jobAt(doc: ProductionDocument, ui: Pick<UiState, 'jobs'>, match: (ctx: JobCtx) => boolean): string | undefined {
  const jobs = jobsList(doc)
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i]
    const ctx = jobCtx(doc, ui, j.id)
    if (!ctx || ctx.dismissed || !match(ctx)) continue
    if (isActive(j.state) || j.state === 'failed' || j.state === 'cancelled') return j.id
  }
  return undefined
}

export function isRunning(doc: ProductionDocument, jobId: string | undefined): boolean {
  if (!jobId) return false
  const j = doc.jobs[jobId]
  return !!j && isActive(j.state)
}

/** Still being made by the relay: running, and not "uncertain". An uncertain job waits on the
 *  participant (Stop waiting / Try again on its card), so it holds no lock on Make clips or
 *  Render ad (it held them for ever, 2026-10-09). */
export function isMoving(doc: ProductionDocument, jobId: string | undefined): boolean {
  if (!isRunning(doc, jobId)) return false
  return doc.jobs[jobId!].state !== 'uncertain'
}

/** The views a whole character sends after its front, in this order; then its other variants as named. */
const VIEW_ORDER = ['three-quarter', 'side', 'back']

/** The pictures a bare @key sends: its front, then three-quarter, side, back, then the rest as named
 *  (up to KEY_EXTRAS more). Throws NoFrontError when the key has no front. */
function keyPictures(doc: ProductionDocument, key: string): NamedRef[] {
  const mine = refsList(doc).filter((r) => r.key === key && r.asset)
  const front = mine.find((r) => r.variant === 'front')
  if (!front) throw new NoFrontError(key)
  const rank = (r: NamedRef) => (VIEW_ORDER.includes(r.variant) ? VIEW_ORDER.indexOf(r.variant) : VIEW_ORDER.length + mine.indexOf(r))
  return [front, ...mine.filter((r) => r !== front).sort((a, b) => rank(a) - rank(b)).slice(0, KEY_EXTRAS)]
}

/** The pictures a subject (bare key or key_variant) sends; [] for a name no picture has. */
export function subjectPictures(doc: ProductionDocument, subject: string): NamedRef[] {
  if (!subject.includes('_')) return refsList(doc).some((r) => r.key === subject && r.asset) ? keyPictures(doc, subject) : []
  const r = refNamed(doc, subject)
  return r?.asset ? [r] : []
}

/** The named pictures someone's words mention (@maya_front, or a bare @maya), in order, once each. */
export function mentionedPictures(doc: ProductionDocument, text: string): NamedRef[] {
  const found: NamedRef[] = []
  for (const m of text.matchAll(MENTION)) {
    let name = m[1]
    // "@maya_front-on" may be @maya_front followed by "-on": take the longest known name.
    while (name.includes('_') && !refNamed(doc, name) && name.includes('-')) name = name.slice(0, name.lastIndexOf('-'))
    for (const r of subjectPictures(doc, name)) if (!found.includes(r)) found.push(r)
  }
  return found
}

/** A named ref as a job input. Its role is its own; the relay makes the wire tag. */
export async function namedInput(relay: Relay, doc: ProductionDocument, r: NamedRef): Promise<JobInputRef> {
  if (!r.asset) throw new Error(`@${refName(r)} has no picture.`)
  const origin = doc.assets[r.asset]?.origin
  const kind = origin === 'drawn' ? 'drawing' : origin === 'generated' || origin === 'mock' ? 'generated' : 'picture'
  return { id: r.id, name: refName(r), role: r.role, ...(r.label ? { label: r.label } : {}), kind, asset: await assetRef(relay, r.asset) }
}

/** The refs a shot names, as job inputs. A name with no picture is an error the participant can fix. */
export async function shotRefs(relay: Relay, doc: ProductionDocument, shot: Shot): Promise<JobInputRef[]> {
  const out: JobInputRef[] = []
  for (const name of shotSubjects(doc, shot)) {
    const found = subjectPictures(doc, name) // a bare key: its front and up to 3 more (throws with no front)
    if (!found.length) throw new Error(`${capital(shotName(doc, shot.id))} uses @${name}, but no picture has that name. Name one on the canvas, or change the shot.`)
    for (const r of found) if (!out.some((x) => x.id === r.id)) out.push(await namedInput(relay, doc, r))
  }
  return out
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A shot's refs plus any name written in the participant's words (the relay must have each one). */
export async function refsFor(relay: Relay, doc: ProductionDocument, shot: Shot, text?: string): Promise<JobInputRef[]> {
  const refs = await shotRefs(relay, doc, shot)
  for (const r of mentionedPictures(doc, text ?? '')) {
    if (!refs.some((x) => x.id === r.id)) refs.push(await namedInput(relay, doc, r))
  }
  return refs.slice(0, 14)
}

/** Every named picture, for the shot list: the director picks the names each shot shows. */
export async function allNamed(relay: Relay, doc: ProductionDocument): Promise<JobInputRef[]> {
  const out: JobInputRef[] = []
  for (const r of refsList(doc).filter((x) => x.asset).slice(0, 14)) out.push(await namedInput(relay, doc, r))
  return out
}

export function ratioAspect(r: Ratio): number {
  const [a, b] = r.split(':').map(Number)
  return a / b
}

/** Beats that are words spoken: never sent to a frame or a clip. */
const SPOKEN = new Set(['line', 'vo'])

/**
 * The shot as a job sends it (relay-api JobShot): its flat text, its names as @subjects, its beats.
 * `forPicture` (a frame or a clip): the spoken beats stay out, because a model that is told the words
 * draws them (decided 2026-10-07, the FACET ad: a "Dialogue – …" caption box in shot 4's frame and every
 * clip from it). The shot list gets every beat.
 */
export function jobShot(doc: ProductionDocument, shot: Shot, forPicture = true): JobShot {
  const beats = beatsOf(doc, shot.id)
    .filter((b) => !forPicture || !SPOKEN.has(b.kind))
    .slice(0, 24)
    .map((b) => ({
      kind: b.kind, at_s: b.at_s, text: (b.text ?? '').slice(0, 500),
      ...(b.speaker ? { speaker: b.speaker } : {}), ...(b.parenthetical ? { parenthetical: b.parenthetical } : {}),
    }))
  return {
    id: shot.id,
    kind: shot.kind,
    duration_s: shot.duration_s,
    camera: shot.camera,
    action: (shot.action ?? '').slice(0, 600),
    ...(shot.direction ? { direction: shot.direction.slice(0, 4000) } : {}),
    ...(shot.direction_condensed ? { direction_condensed: shot.direction_condensed.text.slice(0, 1000) } : {}),
    refs: shotSubjects(doc, shot).slice(0, 14),
    ...(beats.length ? { beats } : {}),
  }
}
