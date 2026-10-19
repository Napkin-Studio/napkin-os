// Deleting things from the document, and putting them back.
//
// A delete is only a change of data: items leave
// their arrays, references to them are cleared or moved on, and the chain gets
// one entry ("deleted frame frame_… (shot 2)"). Each delete returns a Removal
// that says exactly what it took out and what it changed, so Undo can put it
// all back with one patch ("restored …"). Bytes are never touched: the assets
// list and the blob stores keep every picture and clip.

import type { DocJob, ProductionDocument, StaleMark, Target } from '../contracts/types'
import { describeRemoval } from './describe'
import { createMergePatch, deepEqual } from './mergePatch'
import type { DocumentStore } from './types'
import { noteStep } from './undo'
import { refreshClipStale } from '../jobs/stale'

type Doc = ProductionDocument
export type ListName = 'shots' | 'frames' | 'takes' | 'reviews' | 'stale'
export type RemovalKind = 'gen' | 'shot' | 'frame' | 'take' | 'note'

export interface Removal {
  kind: RemovalKind
  id: string
  /** The chain's words for the thing: "frame frame_… (shot 2)". */
  what: string
  /** More words for the rationale ("with 2 frames and 1 clip"). */
  note?: string
  /** Ids for the rationale, so History finds the entry from the item. */
  ids: string[]
  /** Items taken out, with where they were. */
  removed: { list: ListName; index: number; value: unknown }[]
  /** Items changed on the way (selection moved, order renumbered), as they were. */
  modified: { list: ListName; id: string; before: unknown }[]
  /** Out-of-date marks this delete added. */
  staleAdded: StaleMark[]
}

function blank(kind: RemovalKind, id: string, what: string): Removal {
  return { kind, id, what, ids: [], removed: [], modified: [], staleAdded: [] }
}

function list(d: Doc, name: ListName): { id?: string }[] {
  d[name] ??= []
  return d[name] as { id?: string }[]
}

/** Take every matching item out of a list, remembering where each was. */
function takeOut(d: Doc, r: Removal, name: ListName, match: (x: never) => boolean) {
  const arr = list(d, name)
  const keep: unknown[] = []
  arr.forEach((x, index) => {
    if (match(x as never)) r.removed.push({ list: name, index, value: structuredClone(x) })
    else keep.push(x)
  })
  ;(d as unknown as Record<string, unknown>)[name] = keep
}

/** Change an item in place, remembering how it was (once). */
function modify<T extends { id: string }>(r: Removal, name: ListName, item: T, fn: (x: T) => void) {
  if (!r.modified.some((m) => m.list === name && m.id === item.id)) r.modified.push({ list: name, id: item.id, before: structuredClone(item) })
  fn(item)
}

const isTarget = (t: Target, kind: Target['kind'], ids: Set<string>) => t.kind === kind && ids.has(t.id)

function shotNo(d: Doc, shotId: string): string {
  const s = (d.shots ?? []).find((x) => x.id === shotId)
  return s ? `shot ${s.order}` : 'a shot'
}

/** Notes and out-of-date marks about things that are going. */
function takeOutAbout(d: Doc, r: Removal, kind: Target['kind'], ids: Set<string>) {
  if (!ids.size) return
  takeOut(d, r, 'reviews', (x: { target: Target }) => isTarget(x.target, kind, ids))
  takeOut(d, r, 'stale', (x: StaleMark) => isTarget(x.target, kind, ids) || isTarget(x.caused_by, kind, ids))
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Re-check out-of-date marks after a delete (jobs/stale.ts), remembering what changed so Undo puts it back. */
function restale(d: Doc, r: Removal, check: (d: Doc) => void) {
  const before = structuredClone(d.stale ?? [])
  check(d)
  const after = d.stale ?? []
  before.forEach((m, index) => {
    if (!after.some((x) => deepEqual(x, m))) r.removed.push({ list: 'stale', index, value: m })
  })
  for (const m of after) if (!before.some((x) => deepEqual(x, m))) r.staleAdded.push(m)
}

/** A shot, with its frames, clips and the notes on them. The rest renumber. */
export function removeShot(d: Doc, shotId: string): Removal {
  const shot = (d.shots ?? []).find((s) => s.id === shotId)
  if (!shot) throw new Error('That shot is already gone.')
  const r = blank('shot', shotId, `shot ${shot.order}`)
  const frameIds = new Set((d.frames ?? []).filter((f) => f.shot_id === shotId).map((f) => f.id))
  const takeIds = new Set((d.takes ?? []).filter((t) => t.shot_id === shotId).map((t) => t.id))
  takeOut(d, r, 'shots', (x: { id: string }) => x.id === shotId)
  takeOut(d, r, 'frames', (x: { id: string }) => frameIds.has(x.id))
  takeOut(d, r, 'takes', (x: { id: string }) => takeIds.has(x.id))
  takeOutAbout(d, r, 'shot', new Set([shotId]))
  takeOutAbout(d, r, 'frame', frameIds)
  takeOutAbout(d, r, 'take', takeIds)
  ;(d.shots ?? []).forEach((s, i) => {
    if (s.order !== i + 1) modify(r, 'shots', s, (x) => { x.order = i + 1 })
  })
  // The shot after it now follows another frame, but its own shot did not change: not out of date
  // (features/one-to-one-updates.clan). Its card says "drawn from an older frame" (jobs/stale.ts frameDrift).
  r.note = `with ${plural(frameIds.size, 'frame')} and ${plural(takeIds.size, 'clip')}`
  r.ids = [shotId, ...frameIds, ...takeIds]
  return r
}

/** One frame version. Its shot moves to the version it came from (or the newest left). The last one may go
 *  too: the shot then has no frame, and "Update what follows" draws it again, then its clip. */
export function removeFrame(d: Doc, frameId: string): Removal {
  const frame = (d.frames ?? []).find((f) => f.id === frameId)
  if (!frame) throw new Error('That frame is already gone.')
  const siblings = (d.frames ?? []).filter((f) => f.shot_id === frame.shot_id)
  const v = siblings.indexOf(frame) + 1
  const r = blank('frame', frameId, `frame ${frameId} (${shotNo(d, frame.shot_id)}, v${v})`)
  takeOut(d, r, 'frames', (x: { id: string }) => x.id === frameId)
  // Versions edited from this one now come from its parent.
  for (const f of d.frames ?? []) {
    if (f.parent === frameId) modify(r, 'frames', f, (x) => { if (frame.parent) x.parent = frame.parent; else delete x.parent })
  }
  if (frame.selected) {
    const left = (d.frames ?? []).filter((f) => f.shot_id === frame.shot_id)
    const next = left.find((f) => f.id === frame.parent) ?? left[left.length - 1]
    if (next) modify(r, 'frames', next, (x) => { x.selected = true })
    const shot = (d.shots ?? []).find((s) => s.id === frame.shot_id)
    if (shot) modify(r, 'shots', shot, (x) => { if (next) x.storyboard_frame = next.asset; else delete x.storyboard_frame })
  }
  takeOutAbout(d, r, 'frame', new Set([frameId]))
  if (frame.selected) restale(d, r, (x) => refreshClipStale(x, frame.shot_id))
  r.ids = [frame.shot_id, frameId, frame.job_id]
  return r
}

/** One clip version, with the notes on it. Its shot moves to the clip it came from (or the newest left). The last
 *  one may go too: the shot then has no clip, and "Update what follows" makes it again. */
export function removeTake(d: Doc, takeId: string): Removal {
  const take = (d.takes ?? []).find((t) => t.id === takeId)
  if (!take) throw new Error('That clip is already gone.')
  const siblings = (d.takes ?? []).filter((t) => t.shot_id === take.shot_id)
  const v = siblings.indexOf(take) + 1
  const r = blank('take', takeId, `clip ${takeId} (${shotNo(d, take.shot_id)}, v${v})`)
  takeOut(d, r, 'takes', (x: { id: string }) => x.id === takeId)
  for (const t of d.takes ?? []) {
    if (t.parent === takeId) modify(r, 'takes', t, (x) => { if (take.parent) x.parent = take.parent; else delete x.parent })
  }
  if (take.selected) {
    const left = (d.takes ?? []).filter((t) => t.shot_id === take.shot_id)
    const next = left.find((t) => t.id === take.parent) ?? left[left.length - 1]
    if (next) modify(r, 'takes', next, (x) => { x.selected = true })
    const shot = (d.shots ?? []).find((s) => s.id === take.shot_id)
    if (shot) modify(r, 'shots', shot, (x) => { if (next) x.selected_take = next.id; else delete x.selected_take })
  }
  takeOutAbout(d, r, 'take', new Set([takeId]))
  if (take.selected) restale(d, r, (x) => refreshClipStale(x, take.shot_id))
  r.ids = [take.shot_id, takeId, take.job_id]
  return r
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`
}

/** A note on a clip (its timeline marker goes with it). */
export function removeNote(d: Doc, reviewId: string): Removal {
  const note = (d.reviews ?? []).find((x) => x.id === reviewId)
  if (!note) throw new Error('That note is already gone.')
  const take = note.target.kind === 'take' ? (d.takes ?? []).find((t) => t.id === note.target.id) : undefined
  const where = take ? ` (${shotNo(d, take.shot_id)})` : ''
  const r = blank('note', reviewId, `note at ${fmtTime(note.at_s ?? 0)}${where}`)
  takeOut(d, r, 'reviews', (x: { id: string }) => x.id === reviewId)
  const c = note.comment.replace(/\s+/g, ' ').trim()
  r.note = `"${c.length > 120 ? `${c.slice(0, 119)}…` : c}"`
  r.ids = [note.target.id, reviewId]
  return r
}

/** The frames and clips whose job took this picture in. */
export function usersOf(d: Doc, asset: string): Target[] {
  const jobs = new Map<string, DocJob>(d.jobs.map((j) => [j.id, j]))
  const used = (jobId: string) => !!jobs.get(jobId)?.input_hashes?.includes(asset)
  return [
    ...(d.frames ?? []).filter((f) => used(f.job_id)).map((f) => ({ kind: 'frame' as const, id: f.id })),
    ...(d.takes ?? []).filter((t) => used(t.job_id)).map((t) => ({ kind: 'take' as const, id: t.id })),
  ]
}

/**
 * A generated image left the canvas. Nothing about its job changes (the job is
 * the record of what was made and paid for), and a name on it stays: a named
 * image is a solid reference and lives on in References until Clean up finds
 * nothing using it. Undo brings the node back.
 */
export function removeGen(d: Doc, jobId: string): Removal {
  const r = blank('gen', jobId, `generated image ${jobId}`)
  const named = d.refs.filter((x) => x.node === jobId)
  if (named.length) r.note = `its name ${named.map((x) => `@${x.key}_${x.variant}`).join(', ')} stays in References`
  r.ids = [jobId]
  return r
}

/** Frames and clips made from `asset` are out of date because the ref `name` now shows another image. */
export function markStale(d: Doc, asset: string, refId: string, reason: string, now = new Date().toISOString()): StaleMark[] {
  const added: StaleMark[] = []
  d.stale ??= []
  for (const target of usersOf(d, asset)) {
    const mark: StaleMark = { target, caused_by: { kind: 'ref', id: refId }, reason, marked_at: now }
    if (d.stale.some((s) => deepEqual(s.target, target) && deepEqual(s.caused_by, mark.caused_by))) continue
    d.stale.push(mark)
    added.push(mark)
  }
  return added
}

/** Put back exactly what a removal took out and changed. */
export function restore(d: Doc, r: Removal) {
  if (r.staleAdded.length) d.stale = (d.stale ?? []).filter((s) => !r.staleAdded.some((m) => deepEqual(m, s)))
  for (const { list: name, index, value } of [...r.removed].sort((a, b) => a.index - b.index)) {
    const arr = list(d, name)
    const id = (value as { id?: string }).id
    if (id ? arr.some((x) => x.id === id) : arr.some((x) => deepEqual(x, value))) continue
    arr.splice(Math.min(index, arr.length), 0, structuredClone(value) as { id?: string })
  }
  for (const { list: name, id, before } of r.modified) {
    const arr = list(d, name)
    const i = arr.findIndex((x) => x.id === id)
    if (i >= 0) arr[i] = structuredClone(before) as { id?: string }
  }
}

/** A delete or restore written to the store: one patch and one chain entry
 * (a record when the data does not change, e.g. an unpicked image). */
async function commit(store: DocumentStore, change: (d: Doc) => void, r: Removal, restoring: boolean, system = restoring) {
  const before = store.get()
  const draft = structuredClone(before)
  change(draft)
  const said = describeRemoval(r, restoring)
  const mp = createMergePatch(before, draft)
  if (!system) noteStep(store, before, draft, said.action) // the canvas's deletes and restores are its own undo
  if (mp !== undefined) await store.patch(mp as object, { action: said.action, ...(said.rationale ? { rationale: said.rationale } : {}) })
  else await store.record?.(said.action, said.rationale)
}

/** Delete with `remove`, write it, and hand back the Removal. A person's delete is an undo step
 *  (doc/undo.ts); `system` (the canvas, whose Excalidraw undo puts it back) is not. */
export async function deleteFrom(store: DocumentStore, remove: (d: Doc) => Removal, opts: { system?: boolean } = {}): Promise<Removal> {
  let r: Removal | undefined
  // Run once against a copy first, so an error leaves the store untouched.
  r = remove(structuredClone(store.get()))
  await commit(store, (d) => { r = remove(d) }, r, false, !!opts.system)
  return r
}

/** Undo a delete: one patch, one "restored …" entry. */
export async function restoreTo(store: DocumentStore, r: Removal): Promise<void> {
  await commit(store, (d) => restore(d, r), r, true)
}

/** A removal that changes no data (an image that filled no slot), for its entry. */
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
