// A board's layout by its purpose (features/board-autolayout.clan): the lanes Tidy lines up, the
// Gather nudge for loose pictures that share a role, and Move to <Board>. Engine-neutral and pure; the
// geometry is canvas-engine's boards/arrange (tidy, tidyRows, nextSlot).
//
// - Characters, Locations, Products: one lane per key, its views in keyViews order (front first), a
//   stacked key as one unit; unnamed pictures and anything else after the keys.
// - References: one lane per role, in REF_ROLES order (no row labels in v1, BA5); the rest after.
// - Any other board: one lane, in reading order (contact-sheet rows).

import { aroundRect, BOARD_CLEAR, BOARD_PAD, nearestFree, ROW_MAX_W, tidy, tidyRows, type Rect, type SlotAsk } from '../../../../canvas-engine/src'
import { REF_ROLES, type BoardPurpose, type NamedRef, type ProductionDocument, type RefRole } from '../../contracts/types'
import { keyViews } from '../../lib/names'
import { keyNamed, refsList } from '../../model/selectors'
import type { CanvasElement } from '../core/canvasAdapter'
import { elementOfRef, keyOfGroupId } from '../nodes/keyGroups'
import { isStacked } from '../nodes/stack'
import { blockersOf, boardFrame, contentsOfUnit, fitInto, rectOf, type Fit } from './fitting'
import { boardPurposeOfRole, BRAND_ROLES } from './layout'

type Fields = Partial<CanvasElement>
const kindOf = (e: CanvasElement) => (e.customData as { kind?: string } | undefined)?.kind
const follows = (e: CanvasElement) => e.type === 'arrow' || e.type === 'line' || kindOf(e) === 'link' || kindOf(e) === 'provenance'
const isFrame = (e: CanvasElement) => !e.isDeleted && kindOf(e) === 'board'

/** The named ref a picture shows, if any. */
export function refOfElement(doc: ProductionDocument, e: CanvasElement): NamedRef | undefined {
  if (e.type !== 'image') return undefined
  return refsList(doc).find((r) => !!r.node && elementOfRef([e], r) === e)
}

/** A picture's role: its key's, else its ref's. */
export function roleOfElement(doc: ProductionDocument, e: CanvasElement): RefRole | undefined {
  const r = refOfElement(doc, e)
  return r ? ((keyNamed(doc, r.key)?.role ?? r.role) as RefRole | undefined) : undefined
}

/** Things that move together on a board: each picture alone, a stacked key or another group as one. */
export interface Unit {
  ids: string[]
  rect: Rect
}

/** The units among these elements (live, not links), in reading order. */
export function unitsOf(els: readonly CanvasElement[]): Unit[] {
  const by = new Map<string, CanvasElement[]>()
  for (const e of els) {
    if (e.isDeleted || follows(e)) continue
    const g = e.groupIds?.at(-1)
    const key = g && keyOfGroupId(g) ? (isStacked(els.filter((m) => m.groupIds?.includes(g))) ? g : `#${e.id}`) : g ?? `#${e.id}`
    by.set(key, [...(by.get(key) ?? []), e])
  }
  return [...by.values()].map((m) => ({ ids: m.map((e) => e.id), rect: rectOf(m) })).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
}

/** Which lane a unit is in on a board of this purpose: its key, its role, or the rest. */
export function laneOf(purpose: BoardPurpose, u: Unit, els: readonly CanvasElement[], doc: ProductionDocument): string {
  const byId = new Map(els.map((e) => [e.id, e]))
  const r = u.ids.map((id) => byId.get(id)).map((e) => (e ? refOfElement(doc, e) : undefined)).find(Boolean)
  if (!r) return 'rest'
  if (purpose === 'character' || purpose === 'location' || purpose === 'product') return `key:${r.key}`
  if (purpose === 'reference' || purpose === 'brand') return `role:${keyNamed(doc, r.key)?.role ?? r.role}`
  return 'rest'
}

/**
 * Put these pictures (element ids, in `els`) on a board in the next free slots of its layout (BA1):
 * each lane (a key, a role) right after that lane's last member on the board, wrapping from its start;
 * a lane the board does not have yet on a new row below everything. Nothing on the board moves.
 * Returns fitInto's fields and what did not fit.
 */
export function placeOnBoard(els: readonly CanvasElement[], doc: ProductionDocument, frameId: string, ids: readonly string[]): Fit {
  const frame = boardFrame(els, frameId)
  if (!frame) return { fields: new Map(), outside: [] }
  const purpose = purposeOfFrame(frame, doc)
  const set = new Set(ids)
  const moving = unitsOf(els.filter((e) => set.has(e.id)))
  const lanes = lanesFor(purpose, moving, els, doc)
  const there = unitsOf(els.filter((e) => !e.isDeleted && e.frameId === frameId && !set.has(e.id)))
  const onBoard = new Map<string, Unit[]>()
  for (const u of there) {
    const k = laneOf(purpose, u, els, doc)
    onBoard.set(k, [...(onBoard.get(k) ?? []), u])
  }
  const units = lanes.flat()
  const asks: ((done: readonly Rect[]) => SlotAsk)[] = []
  let n = 0
  for (const l of lanes) {
    const k = laneOf(purpose, l[0], els, doc)
    const have = k === 'rest' ? [] : onBoard.get(k) ?? []
    const start = n
    const last = have.length ? [...have].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).at(-1)!.rect : undefined
    const rowStart = have.length ? Math.min(...have.map((u) => u.rect.x)) : undefined
    l.forEach((_, j) => {
      asks.push((done) => {
        if (j === 0) return last ? { after: last, rowStart } : k === 'rest' ? {} : { newRow: true }
        return { after: done[start + j - 1], rowStart: rowStart ?? done[start].x }
      })
    })
    n += l.length
  }
  return fitInto(els, frameId, units.map((u) => u.ids), undefined, (i, done) => asks[i](done))
}

/** The lanes of these units on a board of this purpose, each a list of units, in order. */
export function lanesFor(purpose: BoardPurpose, units: readonly Unit[], els: readonly CanvasElement[], doc: ProductionDocument): Unit[][] {
  const byId = new Map(els.map((e) => [e.id, e]))
  const refOf = (u: Unit) => u.ids.map((id) => byId.get(id)).map((e) => (e ? refOfElement(doc, e) : undefined)).find(Boolean)
  const rest: Unit[] = []
  if (purpose === 'character' || purpose === 'location' || purpose === 'product') {
    const keys = new Map<string, Unit[]>()
    for (const u of units) {
      const r = refOf(u)
      if (!r) rest.push(u)
      else keys.set(r.key, [...(keys.get(r.key) ?? []), u])
    }
    const lanes = [...keys.entries()].map(([key, us]) => {
      const order = keyViews(doc, key).views.map((v) => v.id)
      const rank = (u: Unit) => order.indexOf(refOf(u)?.id ?? '')
      return [...us].sort((a, b) => rank(a) - rank(b))
    })
    return [...lanes, ...(rest.length ? [rest] : [])]
  }
  if (purpose === 'reference' || purpose === 'brand') {
    const roles = new Map<string, Unit[]>()
    for (const u of units) {
      const r = refOf(u)
      const role = r ? ((keyNamed(doc, r.key)?.role ?? r.role) as RefRole | undefined) : undefined
      if (!role) rest.push(u)
      else roles.set(role, [...(roles.get(role) ?? []), u])
    }
    const lanes = REF_ROLES.filter((r) => roles.has(r)).map((r) => roles.get(r)!)
    return [...lanes, ...(rest.length ? [rest] : [])]
  }
  return units.length ? [[...units]] : []
}

const purposeOfFrame = (f: CanvasElement, doc: ProductionDocument): BoardPurpose => {
  const id = (f.customData as { id?: string } | undefined)?.id
  return (id && doc.boards?.[id]?.purpose) || ((f as CanvasElement & { purpose?: BoardPurpose }).purpose ?? 'none')
}

/** The fields that move `unit` (and what lies in it) to `to`, onto `frameId`. */
function moveUnit(els: readonly CanvasElement[], unit: Unit, to: Rect, frameId: string, out: Map<string, Fields>) {
  const byId = new Map(els.map((e) => [e.id, e]))
  const dx = to.x - unit.rect.x
  const dy = to.y - unit.rect.y
  for (const id of unit.ids) {
    const e = byId.get(id)
    if (e) out.set(id, { x: e.x + dx, y: e.y + dy, frameId })
  }
  for (const m of contentsOfUnit(els, unit.ids)) if (!out.has(m.id)) out.set(m.id, { x: m.x + dx, y: m.y + dy })
}

/**
 * Tidy (one undo step, the one time members move): the board's units lined up as its purpose's rows.
 * Locked things stay where they are and count as blockers. Element id → fields; empty when nothing moves.
 */
export function tidyFields(els: readonly CanvasElement[], doc: ProductionDocument, frameId: string): Map<string, Fields> {
  const out = new Map<string, Fields>()
  const frame = boardFrame(els, frameId)
  if (!frame) return out
  const on = els.filter((e) => !e.isDeleted && e.frameId === frameId)
  const isLocked = (e: CanvasElement) => !!(e as CanvasElement & { locked?: boolean }).locked
  const locked = on.filter(isLocked)
  const units = unitsOf(on.filter((e) => !isLocked(e)))
  const lanes = lanesFor(purposeOfFrame(frame, doc), units, els, doc)
  const board = { x: frame.x, y: frame.y, w: frame.width, h: frame.height }
  const moving = new Set(units.flatMap((u) => [...u.ids, ...contentsOfUnit(els, u.ids).map((m) => m.id)]))
  const t = tidy(board, lanes.map((l) => l.map((u) => ({ w: u.rect.w, h: u.rect.h }))), [...blockersOf(els, frameId, moving), ...locked.map((e) => rectOf([e]))])
  lanes.forEach((l, i) => l.forEach((u, j) => {
    const to = t.boxes[i][j]
    if (to.x !== u.rect.x || to.y !== u.rect.y) moveUnit(els, u, to, frameId, out)
  }))
  if (t.board.x !== board.x || t.board.y !== board.y || t.board.w !== board.w || t.board.h !== board.h) out.set(frameId, { x: t.board.x, y: t.board.y, width: t.board.w, height: t.board.h })
  return out
}

const TITLE: Partial<Record<BoardPurpose, string>> = { character: 'Characters', location: 'Locations', product: 'Products', reference: 'References', brand: 'Brand' }

/** What the Gather nudge offers for a selection of pictures: a new board of their role, or the one there is. */
export interface GatherOffer {
  purpose: BoardPurpose
  /** "Characters": the new board's title, or the existing board's. */
  title: string
  /** The board of that purpose already on the canvas (its frame id): Move to <Board> instead. */
  existing?: string
  /** The selected pictures (element ids) that move. */
  ids: string[]
}

/** The first board frame (by rank) of a purpose, for a picture's role. Brand roles: a Brand board, else References. */
export function boardForRole(els: readonly CanvasElement[], doc: ProductionDocument, role: RefRole | undefined): CanvasElement | undefined {
  const frames = els.filter(isFrame)
  const rankOf = (f: CanvasElement) => doc.boards?.[(f.customData as { id?: string } | undefined)?.id ?? '']?.rank ?? '~'
  const ranked = [...frames].sort((a, b) => (rankOf(a) < rankOf(b) ? -1 : rankOf(a) > rankOf(b) ? 1 : 0))
  if (role && BRAND_ROLES.includes(role)) {
    const brand = ranked.find((f) => purposeOfFrame(f, doc) === 'brand')
    if (brand) return brand
  }
  const want = boardPurposeOfRole(role)
  return ranked.find((f) => purposeOfFrame(f, doc) === want)
}

/**
 * The nudge (owner BA2 = c; ui-behaviour 3.9): two or more loose pictures (on no board) that share a role
 * get "Gather into a <Role> board", or "Move to <Board>" when a board of that purpose exists; one named
 * picture on a board of another purpose gets "Move to <Board>" for its role's board (BA3). Else null.
 */
export function gatherOffer(els: readonly CanvasElement[], doc: ProductionDocument, selected: readonly string[]): GatherOffer | null {
  const sel = new Set(selected)
  const pics = els.filter((e) => sel.has(e.id) && !e.isDeleted && e.type === 'image')
  if (!pics.length || pics.length !== els.filter((e) => sel.has(e.id) && !e.isDeleted && !follows(e)).length) return null
  const roles = pics.map((e) => roleOfElement(doc, e))
  if (roles.some((r) => !r)) return null
  const purposes = new Set(roles.map((r) => boardPurposeOfRole(r)))
  if (purposes.size !== 1) return null
  const purpose = [...purposes][0]
  const home = boardForRole(els, doc, roles[0])
  const onBoard = (e: CanvasElement) => !!e.frameId && !!boardFrame(els, e.frameId)
  if (pics.every((e) => !onBoard(e))) {
    if (home) return { purpose, title: (home as CanvasElement & { name?: string }).name || TITLE[purpose] || 'Board', existing: home.id, ids: pics.map((e) => e.id) }
    if (pics.length < 2) return null
    return { purpose, title: TITLE[purpose] ?? 'References', ids: pics.map((e) => e.id) }
  }
  // One named picture on another purpose's board: Move to its role's board, when there is one (BA3).
  if (pics.length === 1 && home && pics[0].frameId !== home.id && purposeOfFrame(boardFrame(els, pics[0].frameId)!, doc) !== purpose) {
    return { purpose, title: (home as CanvasElement & { name?: string }).name || TITLE[purpose] || 'Board', existing: home.id, ids: pics.map((e) => e.id) }
  }
  return null
}

/**
 * Gather: where the new board goes and what moves. The pictures laid out as the purpose's rows (wrapping
 * before ROW_MAX_W), the board round them with its padding, at the nearest spot to them that is
 * BOARD_CLEAR from everything else. Pure: the board's rect and the pictures' fields (frameId `frameId`).
 */
export function gatherLayout(els: readonly CanvasElement[], doc: ProductionDocument, offer: GatherOffer, frameId: string): { rect: Rect; fields: Map<string, Fields> } {
  const byId = new Map(els.map((e) => [e.id, e]))
  const pics = offer.ids.map((id) => byId.get(id)).filter((e): e is CanvasElement => !!e)
  const units = unitsOf(pics)
  const lanes = lanesFor(offer.purpose, units, els, doc)
  const widest = Math.max(...units.map((u) => u.rect.w))
  const longest = Math.max(...lanes.map((l) => l.reduce((s, u) => s + u.rect.w, 0) + 40 * (l.length - 1)))
  const width = Math.max(widest, Math.min(ROW_MAX_W - BOARD_PAD.x * 2, longest))
  const laid = tidyRows({ x: 0, y: 0 }, lanes.map((l) => l.map((u) => ({ w: u.rect.w, h: u.rect.h }))), width)
  const size = aroundRect({ x: 0, y: 0, w: laid.w, h: laid.h })
  const from = rectOf(pics)
  const moving = new Set([...offer.ids, ...contentsOfUnit(els, offer.ids).map((m) => m.id)])
  const avoid = els.filter((e) => !e.isDeleted && !moving.has(e.id) && !follows(e) && (!e.frameId || !boardFrame(els, e.frameId))).map((e) => rectOf([e]))
  const at = nearestFree({ x: from.x + size.x, y: from.y + size.y, w: size.w, h: size.h }, avoid, { margin: BOARD_CLEAR })
  const rect = { x: Math.round(at.x), y: Math.round(at.y), w: Math.round(size.w), h: Math.round(size.h) }
  const fields = new Map<string, Fields>()
  const dx = rect.x - size.x
  const dy = rect.y - size.y
  lanes.forEach((l, i) => l.forEach((u, j) => {
    const b = laid.boxes[i][j]
    moveUnit(els, u, { ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) }, frameId, fields)
  }))
  return { rect, fields }
}
