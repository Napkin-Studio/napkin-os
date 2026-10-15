// Finding the job that belongs at a spot in the UI (pending or failed), and
// what a job sends about a shot and its names (contract 3).

import type { Id, JobInputRef, JobShot, NamedRef, ProductionDocument, Ratio, Shot } from '../contracts/types'
import type { JobCtx, UiState } from '../doc/ui'
import { KEY_EXTRAS, MENTION, NoFrontError } from '../lib/names'
import { scopeOf, type ScopeItem } from '../model/scope'
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

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Where a shot's picture comes from (owner 2026-10-15, features/canvas-nodes.clan): its words name it
 *  (the shot's text, or the person's words for this send), it is linked into the shot, or it is only in
 *  the storyboard's scope and offered: Dex may add it only with a reason. */
export type ShotRefFrom = 'words' | 'linked' | 'offered'

export interface ShotRef { ref: NamedRef; from: ShotRefFrom }

/** The pictures of a linked key or reference, as scope items name them (a key's held views stay out). */
function scopePictures(doc: ProductionDocument, items: ScopeItem[]): NamedRef[] {
  const out: NamedRef[] = []
  for (const it of items) {
    if (it.kind === 'ref' && !it.held && doc.refs[it.id]) out.push(doc.refs[it.id])
    else if (it.kind === 'key' && it.sends) for (const id of it.sends) if (doc.refs[id]) out.push(doc.refs[id])
  }
  return out
}

/**
 * What a frame or clip of this shot sends (owner 2026-10-15: "instead of just using '@samurai' [it] used
 * different references for the frames, unless it offers a definite advantage"): first the pictures its
 * words name (a bare @samurai is that key's views, the front first, at most 4) and those linked into the
 * shot: required, never left out or swapped. Then, offered, what the storyboard's scope brings in that
 * nothing asked for, less what the person unticked (`declined`): Dex may add one only with why. At most 14,
 * the required first. A name with no picture throws, as before.
 */
export function shotRefSet(doc: ProductionDocument, shot: Shot, text = '', declined: readonly Id[] = []): ShotRef[] {
  const out: ShotRef[] = []
  const add = (ref: NamedRef, from: ShotRefFrom) => { if (ref.asset && !out.some((x) => x.ref.id === ref.id)) out.push({ ref, from }) }
  for (const name of shotSubjects(doc, shot)) {
    const found = subjectPictures(doc, name) // a bare key: its front and up to 3 more (throws with no front)
    if (!found.length) throw new Error(`${capital(shotName(doc, shot.id))} uses @${name}, but no picture has that name. Name one on the canvas, or change the shot.`)
    for (const r of found) add(r, 'words')
  }
  for (const r of mentionedPictures(doc, text)) add(r, 'words')
  const linked = scopeOf(doc, shot.id).filter((it) => it.via === 'link' || (it.via === 'board' && it.through))
  for (const r of scopePictures(doc, linked)) add(r, 'linked')
  if (shot.storyboard_id && doc.storyboards[shot.storyboard_id]) {
    const scope = scopeOf(doc, shot.storyboard_id).filter((it) => it.via !== 'mention')
    for (const r of scopePictures(doc, scope)) if (!declined.includes(r.id)) add(r, 'offered')
  }
  return out.slice(0, 14)
}

/** A shot's refs plus any name written in the participant's words (the relay must have each one).
 *  `offer` (a frame or a clip): the storyboard's other pictures go too, marked optional (shotRefSet). */
export async function refsFor(relay: Relay, doc: ProductionDocument, shot: Shot, text?: string, opts: { offer?: boolean; declined?: readonly Id[] } = {}): Promise<JobInputRef[]> {
  const set = shotRefSet(doc, shot, text ?? '', opts.declined).filter((x) => opts.offer || x.from !== 'offered')
  const out: JobInputRef[] = []
  for (const { ref, from } of set) out.push({ ...await namedInput(relay, doc, ref), ...(from === 'offered' ? { optional: true as const } : {}) })
  return out
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
