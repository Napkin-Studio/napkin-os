// Key groups on the canvas (owner, Shrey 2026-10-15; features/canvas-nodes.clan): pictures that
// share a key (samurai_front, samurai_side, samurai_back…) are one character or thing, so their
// elements sit together as one canvas group, moved and selected as one, labelled "Samurai · 3 views".
// The group is derived from the document, never kept by hand: every picture named with the key is
// in it, and naming or renaming one joins or leaves it at once. It uses the canvas's own grouping
// (groupIds, as canvas-edit-tools' Group and the ink groups do), with the group id `key:<key>`, the
// same on every screen. Engine-neutral: plain CanvasElements and the document in, fields out.

import type { NamedRef, ProductionDocument } from '../../contracts/types'
import { keyViews } from '../../lib/names'
import type { CanvasElement } from '../core/canvasAdapter'
import { isStacked, spreadPlace, stackFields } from './stack'
import { boardFrame, fitInto, tellFull } from '../boards/fitting'

export const KEY_GROUP = 'key:'
export const keyGroupId = (key: string) => `${KEY_GROUP}${key}`
export const isKeyGroupId = (g: string | undefined | null): g is string => !!g && g.startsWith(KEY_GROUP)
export const keyOfGroupId = (g: string | undefined | null): string | null => (isKeyGroupId(g) ? g.slice(KEY_GROUP.length) : null)

/** How close (scene px) a newly named view must already be to its key's views to stay where it is. */
export const NEAR = 120
/** The gap a placed view keeps from the one before it. */
export const GAP = 40

export interface KeyGroup {
  key: string
  /** The document's key entry. */
  keyId?: string
  groupId: string
  /** "Samurai". */
  title: string
  /** How many views the key has (named refs). */
  count: number
  /** Its views' elements on the canvas, in the key's order: the front first (it tops a stack). */
  members: CanvasElement[]
  stacked: boolean
}

const tagId = (e: CanvasElement) => (e.customData as { id?: unknown } | undefined)?.id

/** The element a named ref sits on, if it is on the canvas. */
export function elementOfRef(els: readonly CanvasElement[], r: Pick<NamedRef, 'node'>): CanvasElement | undefined {
  if (!r.node) return undefined
  return els.find((e) => !e.isDeleted && e.type === 'image' && (e.id === r.node || tagId(e) === r.node))
}

/** "Samurai · 3 views". */
export const groupLabel = (g: Pick<KeyGroup, 'title' | 'count'>) => `${g.title} · ${g.count} ${g.count === 1 ? 'view' : 'views'}`

/** The key groups on the canvas: each key with two or more of its views here. */
export function keyGroupsOn(els: readonly CanvasElement[], doc: ProductionDocument): KeyGroup[] {
  const live = els.filter((e) => !e.isDeleted)
  const keys = [...new Set(Object.values(doc.refs ?? {}).map((r) => r.key))].sort()
  const out: KeyGroup[] = []
  for (const key of keys) {
    const { views } = keyViews(doc, key)
    const members = views.map((r) => elementOfRef(live, r)).filter((e): e is CanvasElement => !!e)
    if (members.length < 2) continue
    const entry = Object.values(doc.keys ?? {}).find((k) => k.key === key)
    out.push({
      key, ...(entry ? { keyId: entry.id } : {}), groupId: keyGroupId(key), title: key.charAt(0).toUpperCase() + key.slice(1),
      count: views.length, members, stacked: isStacked(members),
    })
  }
  return out
}

/** The key group an element is in, by its group ids. */
export function keyGroupOf(e: CanvasElement | undefined): string | null {
  return keyOfGroupId((e?.groupIds ?? []).find(isKeyGroupId))
}

type Box = { x: number; y: number; w: number; h: number }
const boxOf = (e: CanvasElement, at = spreadPlace(e)): Box => ({ x: at.x, y: at.y, w: e.width, h: e.height })
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const near = (a: Box, b: Box, d: number) => a.x < b.x + b.w + d && b.x < a.x + a.w + d && a.y < b.y + b.h + d && b.y < a.y + a.h + d

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * What the canvas must change so its groups follow the keys (a system write, nobody's undo step):
 * - each picture of a key with two or more views here carries `key:<key>` as a group id, and no other
 *   key group; one that left its key (renamed, unnamed) loses it, and leaves a stack laid back out;
 * - a view newly in its group that is not already beside the others is placed next to them, to the
 *   right, top-aligned, on their board (on the pile, when the group is stacked).
 * Pure: element id → the fields to change.
 */
export function keyGroupFields(els: readonly CanvasElement[], doc: ProductionDocument): Map<string, Partial<CanvasElement>> {
  const groups = keyGroupsOn(els, doc)
  const want = new Map<string, string>()
  for (const g of groups) for (const m of g.members) want.set(m.id, g.groupId)
  const out = new Map<string, Partial<CanvasElement>>()
  const put = (id: string, f: Partial<CanvasElement>) => out.set(id, { ...out.get(id), ...f })
  for (const e of els) {
    if (e.isDeleted) continue
    const ids = e.groupIds ?? []
    const w = want.get(e.id)
    let next = ids.filter((g) => !isKeyGroupId(g) || g === w)
    if (w && !next.includes(w)) next = [...next, w]
    if (!same(next, ids)) put(e.id, { groupIds: next })
    // Out of its group while stacked: laid back where it came from.
    if (!w && (e as CanvasElement & { stack?: unknown }).stack) {
      const p = spreadPlace(e)
      put(e.id, { x: p.x, y: p.y, angle: p.angle, stack: undefined } as Partial<CanvasElement>)
    }
  }
  for (const g of groups) {
    const settled = g.members.filter((m) => (m.groupIds ?? []).includes(g.groupId))
    const fresh = g.members.filter((m) => !settled.includes(m))
    if (!fresh.length) continue
    // A new group starts from the view named first; the others come to it.
    const namedAt = (m: CanvasElement) => Object.values(doc.refs).find((r) => elementOfRef([m], r))?.named_at ?? ''
    const base = settled.length ? settled : [[...fresh].sort((a, b) => (namedAt(a) < namedAt(b) ? -1 : namedAt(a) > namedAt(b) ? 1 : 0))[0]]
    let box = base.map((m) => boxOf(m)).reduce(union)
    const placed = new Map<string, { x: number; y: number }>()
    for (const f of fresh) {
      if (base.includes(f)) continue
      const own = boxOf(f)
      if (!g.stacked && near(own, box, NEAR)) {
        box = union(box, own)
        continue
      }
      // Right of the group, past anything already there: a sibling view still being drawn (views land
      // out of order, so the side view landed on the 3/4's place, owner 2026-10-15) or anything else.
      const at = { x: box.x + box.w + GAP, y: box.y }
      const taken = els.filter((e) => !e.isDeleted && e.id !== f.id && e.type !== 'arrow' && e.type !== 'frame' && !placed.has(e.id))
      for (let hit = taken.find((e) => overlaps({ ...own, ...at }, boxOf(e))); hit; hit = taken.find((e) => overlaps({ ...own, ...at }, boxOf(e)))) {
        at.x = Math.max(at.x, boxOf(hit).x + hit.width + GAP)
      }
      for (const [id, q] of placed) if (overlaps({ ...own, ...at }, { ...boxOf(els.find((e) => e.id === id)!), ...q })) at.x = q.x + els.find((e) => e.id === id)!.width + GAP
      placed.set(f.id, at)
      box = union(box, { ...own, ...at })
    }
    // A placed view joins the board its group sits on (membership is the container: art-boards).
    const frameId = base[0].frameId ?? null
    if (g.stacked) {
      // On the pile: the whole stack laid again, the newcomer's spread place beside the others.
      const members = g.members.map((m) => {
        const at = placed.get(m.id)
        return at ? { ...m, x: at.x, y: at.y, angle: 0, stack: undefined } as CanvasElement : m
      })
      for (const [id, f] of stackFields(members)) put(id, f as Partial<CanvasElement>)
      for (const id of placed.keys()) put(id, { frameId })
    } else if (frameId && boardFrame(els, frameId) && placed.size) {
      // On a board: next to the group when that is clear, the board growing toward it, else the board's
      // next free slot (owner decision 2026-10-15; boards/fitting).
      const view = els.map((e) => (out.has(e.id) ? { ...e, ...out.get(e.id) } as CanvasElement : e))
      const ids = [...placed.keys()]
      // Each new view right after the last of its key's row, wrapping below the row from its start (BA4).
      const boxes = base.map((m) => boxOf(m))
      const last = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x).at(-1)!
      const rowStart = Math.min(...boxes.map((b) => b.x))
      const fit = fitInto(view, frameId, ids.map((id) => [id]), undefined, (i, done) => ({ after: i ? done[i - 1] : last, rowStart }))
      for (const [id, f] of fit.fields) put(id, f)
      tellFull(frameId, fit)
    } else for (const [id, at] of placed) put(id, { ...at, frameId })
  }
  return out
}
