// Deleting things from the document (contract 3: id-keyed maps).
//
// A delete is only a change of data: entities leave their maps, what points at
// them is cleared or moved on (a shot's frame pick, the cut's take pick, links,
// notes, out-of-date marks), and the chain gets one decision ("delete frame
// frame_… (shot 2, v1)"). A person's delete is one undo step of LocalUndo's
// (the deleting write itself, through updateDoc): Undo in the top bar puts it
// back. The canvas's deletes are not the person's undo steps (Excalidraw's
// Ctrl+Z brings the element back), so those come back with restoreTo.
// Bytes are never touched: the assets map and the blob stores keep every
// picture and clip until Clean up (doc/gc.ts).

import { newUlidId } from '../../../clan-store/src'
import type { MapName, ProductionDocument, StaleMark, Target } from '../contracts/types'
import { refreshClipStale } from '../jobs/stale'
import { framesOf, refsList, shotName, takesOf } from '../model/selectors'
import { describeRemoval } from './describe'
import { systemUpdate, updateDoc } from './store'
import type { DocumentStore } from './types'

type Doc = ProductionDocument
type Entity = { id: string } & Record<string, unknown>
export type RemovalKind = 'gen' | 'shot' | 'frame' | 'take' | 'note' | 'ref'

export interface Removal {
  kind: RemovalKind
  id: string
  /** The chain's words for the thing: "frame frame_… (shot 2, v1)". */
  what: string
  /** More words for the rationale ("with 2 frames and 1 clip"). */
  note?: string
  /** Ids for the rationale, so History finds the decision from the item. */
  ids: string[]
  /** Entities taken out, by map, as they were. */
  removed: { map: MapName; value: Entity }[]
  /** Entities changed on the way (a pick moved, a parent re-pointed), as they were. */
  modified: { map: MapName; before: Entity }[]
}

function blank(kind: RemovalKind, id: string, what: string): Removal {
  return { kind, id, what, ids: [], removed: [], modified: [] }
}

const mapOf = (d: Doc, map: MapName) => d[map] as unknown as Record<string, Entity>

/** Take the entity `id` out of `map`, remembering it. */
function takeOut(d: Doc, r: Removal, map: MapName, id: string) {
  const m = mapOf(d, map)
  if (!m[id]) return
  r.removed.push({ map, value: structuredClone(m[id]) })
  delete m[id]
}

/** Change an entity in place, remembering how it was (once). */
function modify<T extends { id: string }>(r: Removal, map: MapName, item: T, fn: (x: T) => void) {
  if (!r.modified.some((m) => m.map === map && m.before.id === item.id) && !r.removed.some((m) => m.map === map && m.value.id === item.id)) {
    r.modified.push({ map, before: structuredClone(item) as unknown as Entity })
  }
  fn(item)
}

const isTarget = (t: { kind: string; id: string } | undefined, kinds: string[], ids: Set<string>) => !!t && kinds.includes(t.kind) && ids.has(t.id)

/** Everything about things that are going: notes on them, out-of-date marks, links, checks, suggestions. */
function takeOutAbout(d: Doc, r: Removal, kind: Target['kind'], ids: Set<string>) {
  if (!ids.size) return
  const kinds = [kind]
  for (const x of Object.values(d.reviews)) if (isTarget(x.target, kinds, ids) || (kind === 'shot' && x.shot_id && ids.has(x.shot_id))) takeOut(d, r, 'reviews', x.id)
  for (const x of Object.values(d.stale)) if (isTarget(x.target, kinds, ids) || isTarget(x.caused_by, kinds, ids)) takeOut(d, r, 'stale', x.id)
  for (const x of Object.values(d.links)) if (isTarget(x.from, kinds, ids) || isTarget(x.to, kinds, ids)) takeOut(d, r, 'links', x.id)
  for (const x of Object.values(d.checks)) if (isTarget(x.target, kinds, ids)) takeOut(d, r, 'checks', x.id)
  for (const x of Object.values(d.suggestions)) if (isTarget(x.target, kinds, ids)) takeOut(d, r, 'suggestions', x.id)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A shot, with its frames, clips, beats, its place in the cut, and the notes and marks on them. The
 *  shots after it are numbered by rank, so nothing renumbers. */
export function removeShot(d: Doc, shotId: string): Removal {
  const shot = d.shots[shotId]
  if (!shot) throw new Error('That shot is already gone.')
  const r = blank('shot', shotId, shotName(d, shotId))
  const frameIds = new Set(framesOf(d, shotId).map((f) => f.id))
  const takeIds = new Set(takesOf(d, shotId).map((t) => t.id))
  takeOut(d, r, 'shots', shotId)
  for (const id of frameIds) takeOut(d, r, 'frames', id)
  for (const id of takeIds) takeOut(d, r, 'takes', id)
  for (const b of Object.values(d.beats)) if (b.shot_id === shotId) takeOut(d, r, 'beats', b.id)
  for (const v of Object.values(d.videos)) {
    const items = Object.entries(v.edl).filter(([, item]) => item.shot_id === shotId)
    if (items.length) modify(r, 'videos', v, (x) => { for (const [itemId] of items) delete x.edl[itemId] })
  }
  takeOutAbout(d, r, 'shot', new Set([shotId]))
  takeOutAbout(d, r, 'frame', frameIds)
  takeOutAbout(d, r, 'take', takeIds)
  r.note = `with ${plural(frameIds.size, 'frame')} and ${plural(takeIds.size, 'clip')}`
  r.ids = [shotId, ...frameIds, ...takeIds]
  return r
}

/** Versions made from `goneId` now come from its parent. */
function reparent(d: Doc, r: Removal, map: 'frames' | 'takes', goneId: string, parent: string | undefined) {
  for (const x of Object.values(mapOf(d, map)) as unknown as { id: string; parent_id?: string }[]) {
    if (x.parent_id === goneId) modify(r, map, x, (y) => { if (parent) y.parent_id = parent; else delete y.parent_id })
  }
}

/** One frame version. If it was the shot's frame, the pick moves to the version it came from (or the newest
 *  left); the last one may go too: the shot then has no pick, and "Update what follows" draws it again. */
export function removeFrame(d: Doc, frameId: string): Removal {
  const frame = d.frames[frameId]
  if (!frame) throw new Error('That frame is already gone.')
  const shot = frame.shot_id ? d.shots[frame.shot_id] : undefined
  const r = blank('frame', frameId, `frame ${frameId} (${shotName(d, frame.shot_id)}, v${frame.version})`)
  takeOut(d, r, 'frames', frameId)
  reparent(d, r, 'frames', frameId, frame.parent_id)
  const wasCurrent = shot?.pick?.current === frameId
  if (shot?.pick && (wasCurrent || shot.pick.alternates?.includes(frameId))) {
    modify(r, 'shots', shot, (s) => {
      const alternates = (s.pick!.alternates ?? []).filter((x) => x !== frameId)
      if (!wasCurrent) {
        s.pick = { ...s.pick!, alternates }
        return
      }
      const left = framesOf(d, s.id)
      const next = (frame.parent_id && d.frames[frame.parent_id]) || left.at(-1)
      if (next) s.pick = { current: next.id, alternates: alternates.filter((x) => x !== next.id) }
      else delete s.pick
    })
  }
  takeOutAbout(d, r, 'frame', new Set([frameId]))
  if (wasCurrent && shot) refreshClipStale(d, shot.id)
  r.ids = [frame.shot_id, frameId, frame.job_id].filter((x): x is string => !!x)
  return r
}

/** One clip version, with the notes on it. If it was the shot's take in the cut, the cut moves to the clip it
 *  came from (or the newest left); the last one may go too: the cut's item then has no pick. */
export function removeTake(d: Doc, takeId: string): Removal {
  const take = d.takes[takeId]
  if (!take) throw new Error('That clip is already gone.')
  const r = blank('take', takeId, `clip ${takeId} (${shotName(d, take.shot_id)}, v${take.version})`)
  takeOut(d, r, 'takes', takeId)
  reparent(d, r, 'takes', takeId, take.parent_id)
  let wasCurrent = false
  for (const v of Object.values(d.videos)) {
    for (const [itemId, item] of Object.entries(v.edl)) {
      if (!item.pick || (item.pick.current !== takeId && !item.pick.alternates?.includes(takeId))) continue
      const current = item.pick.current === takeId
      wasCurrent ||= current
      modify(r, 'videos', v, (x) => {
        const it = x.edl[itemId]
        const alternates = (it.pick!.alternates ?? []).filter((t) => t !== takeId)
        if (!current) {
          it.pick = { ...it.pick!, alternates }
          return
        }
        const next = (take.parent_id && d.takes[take.parent_id]) || (it.shot_id ? takesOf(d, it.shot_id).at(-1) : undefined)
        if (next) it.pick = { current: next.id, alternates: alternates.filter((t) => t !== next.id) }
        else delete it.pick
      })
    }
  }
  takeOutAbout(d, r, 'take', new Set([takeId]))
  if (wasCurrent) refreshClipStale(d, take.shot_id)
  r.ids = [take.shot_id, takeId, take.job_id]
  return r
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`
}

/** A note (and with it, its timeline marker). */
export function removeNote(d: Doc, reviewId: string): Removal {
  const note = d.reviews[reviewId]
  if (!note) throw new Error('That note is already gone.')
  const shotId = note.shot_id
    ?? (note.target.kind === 'take' ? d.takes[note.target.id]?.shot_id : note.target.kind === 'frame' ? d.frames[note.target.id]?.shot_id : undefined)
  const where = shotId && d.shots[shotId] ? ` (${shotName(d, shotId)})` : ''
  const r = blank('note', reviewId, `note at ${fmtTime(note.at_s ?? 0)}${where}`)
  takeOut(d, r, 'reviews', reviewId)
  const c = (note.text ?? '').replace(/\s+/g, ' ').trim()
  if (c) r.note = `"${c.length > 120 ? `${c.slice(0, 119)}…` : c}"`
  r.ids = [note.target.id, reviewId]
  return r
}

/** A name (key_variant): the picture stays in the project until Clean up finds nothing using it. Its links,
 *  the notes on it and the marks it caused go with it. */
export function removeRef(d: Doc, refId: string): Removal {
  const ref = d.refs[refId]
  if (!ref) throw new Error('That name is already gone.')
  const r = blank('ref', refId, `the name @${ref.key}_${ref.variant}`)
  takeOut(d, r, 'refs', refId)
  takeOutAbout(d, r, 'ref', new Set([refId]))
  r.ids = [refId]
  return r
}

/** The frames and clips whose job took this picture in. */
export function usersOf(d: Doc, asset: string): Target[] {
  const used = (jobId: string | undefined) => !!jobId && !!d.jobs[jobId]?.input_hashes?.includes(asset)
  return [
    ...Object.values(d.frames).filter((f) => used(f.job_id)).map((f) => ({ kind: 'frame' as const, id: f.id })),
    ...Object.values(d.takes).filter((t) => used(t.job_id)).map((t) => ({ kind: 'take' as const, id: t.id })),
  ]
}

/**
 * A generated image left the canvas. Nothing about its job changes (the job is
 * the record of what was made and paid for), and a name on it stays: a named
 * image is a solid reference and lives on in References until Clean up finds
 * nothing using it. Excalidraw's Ctrl+Z brings the node back (restoreTo).
 */
export function removeGen(d: Doc, jobId: string): Removal {
  const r = blank('gen', jobId, `generated image ${jobId}`)
  const named = refsList(d).filter((x) => x.node === jobId)
  if (named.length) r.note = `its name ${named.map((x) => `@${x.key}_${x.variant}`).join(', ')} stays in References`
  r.ids = [jobId]
  return r
}

/** Frames and clips made from `asset` are out of date because the ref `refId` now shows another image. Once each. */
export function markStale(d: Doc, asset: string, refId: string, reason: string, now = new Date().toISOString()): StaleMark[] {
  const added: StaleMark[] = []
  for (const target of usersOf(d, asset)) {
    const had = Object.values(d.stale).some((s) => s.target.kind === target.kind && s.target.id === target.id && s.caused_by.kind === 'ref' && s.caused_by.id === refId)
    if (had) continue
    const id = newUlidId('stale')
    const mark: StaleMark = { id, v: 1, field_v: {}, target, caused_by: { kind: 'ref', id: refId }, reason, marked_at: now }
    d.stale[id] = mark
    added.push(mark)
  }
  return added
}

/** Put back what a removal took out and changed (the canvas's restore; a person's delete is undone by LocalUndo). */
export function restore(d: Doc, r: Removal) {
  for (const { map, value } of r.removed) {
    const m = mapOf(d, map)
    if (!m[value.id]) m[value.id] = structuredClone(value)
  }
  for (const { map, before } of r.modified) {
    const m = mapOf(d, map)
    if (m[before.id]) m[before.id] = structuredClone(before)
  }
}

/** A delete or restore written to the store: one decision (a bare record when no data changes, e.g. an
 *  unnamed image leaving the canvas). A person's is one undo step; `system` (the canvas) is not. */
async function commit(store: DocumentStore, change: (d: Doc) => void, r: Removal, restoring: boolean, system: boolean) {
  const said = describeRemoval(r, restoring)
  const before = store.get()
  const after = await (system ? systemUpdate : updateDoc)(store, change, said.action, said.rationale)
  if (after === before) await store.record?.(said.action, said.rationale)
}

/** Delete with `remove`, write it, and hand back the Removal. A person's delete is an undo step
 *  (LocalUndo); `system` (the canvas, whose Excalidraw undo puts it back) is not. */
export async function deleteFrom(store: DocumentStore, remove: (d: Doc) => Removal, opts: { system?: boolean } = {}): Promise<Removal> {
  // Run once against a copy first, so an error leaves the store untouched.
  let r = remove(structuredClone(store.get()))
  await commit(store, (d) => { r = remove(d) }, r, false, !!opts.system)
  return r
}

/** Put back what the canvas deleted (Excalidraw's Ctrl+Z): one "create again …" decision, not an undo step. */
export async function restoreTo(store: DocumentStore, r: Removal): Promise<void> {
  await commit(store, (d) => restore(d, r), r, true, true)
}

/** A removal that changes no data (an image that filled no slot), for its decision. */
export function bareRemoval(kind: RemovalKind, id: string, what: string): Removal {
  const r = blank(kind, id, what)
  r.ids = [id]
  return r
}

/** The inline confirm on a shot's ×. */
export function shotDeleteText(n: number, frames: number, clips: number): string {
  const parts = [frames && `${frames} frame${frames === 1 ? '' : 's'}`, clips && `${clips} clip${clips === 1 ? '' : 's'}`].filter(Boolean)
  return `Delete shot ${n}${parts.length ? ` and its ${parts.join(' and ')}` : ''}?`
}
