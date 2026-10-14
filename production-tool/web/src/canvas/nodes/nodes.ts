// The document's nodes on the canvas (features/canvas-nodes.clan; overhaul plan
// 2.2, 2.3, 2.5; ui-behaviour 3.3, 3.4). Engine-neutral: everything goes through
// CanvasAdapter v2, so the own engine runs it and nothing here imports an engine.
//
// - seedNodes: a canvas with no node yet gets the project's Script, Storyboard and
//   Video nodes, where production-ui's overlay drew them (mock Main, boards/layout.ts), and a link
//   element for each of the document's links between them.
// - linkNodes: a person's link from one node to another, checked against the link
//   rules (core/links.ts), written to the scene and to the document's links.
// - reconcileLinks: a link element a person deleted takes its document entry
//   with it; one brought back by undo puts it back.

import { currentRender, mainScript, mainStoryboard, mainVideo, scenesOf, shotsOf, storyboardOfScript, storyboardOfVideo } from '../../model/selectors'
import type { Link, LinkRole, ProductionDocument, Script, Storyboard, Video } from '../../contracts/types'
import { newId } from '../../lib/ulid'
import { systemUpdate } from '../../doc/store'
import type { DocumentStore } from '../../doc/types'
import type { CanvasAdapter, CanvasElement, Pt } from '../core/canvasAdapter'
import { canLink, checkLink, type LinkGraph, type LinkKind, type LinkRole as CoreRole } from '../core/links'
import type { CardKind } from './cardChrome'
import { adLayout, CARD_SIZE } from '../boards/layout'

export const CARD_KINDS: readonly CardKind[] = ['script', 'storyboard', 'video']

const tag = (e: Pick<CanvasElement, 'customData'> | undefined): { kind?: string; id?: string } => {
  const c = e?.customData as { kind?: unknown; id?: unknown } | undefined
  return { kind: typeof c?.kind === 'string' ? c.kind : undefined, id: typeof c?.id === 'string' ? c.id : undefined }
}

/** The card a node element shows, if it is one of the document's nodes. */
export function cardOf(e: CanvasElement): { kind: CardKind; id: string } | null {
  const t = tag(e)
  return t.kind && (CARD_KINDS as readonly string[]).includes(t.kind) && t.id && !e.isDeleted ? { kind: t.kind as CardKind, id: t.id } : null
}

/** A link element's document link id. */
export function linkIdOf(e: CanvasElement): string | null {
  const t = tag(e)
  return t.kind === 'link' && t.id ? t.id : null
}

/**
 * The elements to add so the canvas shows the document's nodes and their links; [] when it already
 * does. The nodes go where production-ui's overlay drew them (mock Main; boards/layout.ts): left of
 * the named pictures, the Storyboard below, the Video beside it.
 */
export function seedNodes(canvas: CanvasAdapter, doc: ProductionDocument): CanvasElement[] {
  const els = canvas.elements()
  if (els.some((e) => cardOf(e))) return []
  const boxes = adLayout(els, doc).nodes
  const entities: [CardKind, { id: string } | undefined][] = [['script', mainScript(doc)], ['storyboard', mainStoryboard(doc)], ['video', mainVideo(doc)]]
  const made = new Map<string, CanvasElement>()
  const out: CanvasElement[] = []
  for (const [kind, ent] of entities) {
    if (!ent) continue
    const b = boxes[kind]
    const el = canvas.node({ x: b.x, y: b.y, width: b.w, height: b.h, customData: { kind, id: ent.id } })
    made.set(ent.id, el)
    out.push(el)
  }
  let all = [...out]
  for (const l of Object.values(doc.links ?? {})) {
    const from = made.get(l.from.id)
    const to = made.get(l.to.id)
    if (!from || !to) continue
    const link = canvas.link({ fromElId: from.id, toElId: to.id, role: l.role, linkId: l.id })
    all = canvas.bindArrow([...all, link], link)
  }
  return all
}

/** The link rules' view of what is on the canvas: its nodes and the document's links between them. */
export function linkGraph(els: readonly CanvasElement[], doc: ProductionDocument): LinkGraph {
  const nodes = els.map(cardOf).filter((c): c is NonNullable<ReturnType<typeof cardOf>> => !!c).map((c) => ({ id: c.id, kind: c.kind as LinkKind }))
  const links = Object.values(doc.links ?? {}).map((l) => ({ from: l.from.id, to: l.to.id, role: l.role as unknown as CoreRole }))
  return { nodes, links }
}

export type LinkOutcome = { ok: true; link: Link; element: CanvasElement } | { ok: false; reason: string }

/** Can `from` feed `to`, and with which role (the first the rules give)? */
export function linkCheck(els: readonly CanvasElement[], doc: ProductionDocument, from: CanvasElement, to: CanvasElement): { ok: true; role: CoreRole } | { ok: false; reason: string } {
  const a = cardOf(from)
  const b = cardOf(to)
  if (!a || !b) return { ok: false, reason: 'Link a script, a storyboard or a video.' }
  if (a.id === b.id) return { ok: false, reason: 'That would make a loop.' }
  const can = canLink(a.kind as LinkKind, b.kind as LinkKind)
  if (!can.ok) return can
  const role = can.roles[0]
  const checked = checkLink(linkGraph(els, doc), a.id, b.id, role)
  return checked.ok ? { ok: true, role } : checked
}

/**
 * Link two nodes: the link element (one undoable step) and the document's links entry. Returns
 * what was made, or why not. `write` writes the document (updateDoc with a 'link' action).
 */
export async function linkNodes(canvas: CanvasAdapter, doc: ProductionDocument, from: CanvasElement, to: CanvasElement, write: (link: Link) => Promise<void>): Promise<LinkOutcome> {
  const check = linkCheck(canvas.elements(), doc, from, to)
  if (!check.ok) return check
  const a = cardOf(from)!
  const b = cardOf(to)!
  const link: Link = { id: newId('link'), v: 1, field_v: {}, from: { kind: a.kind, id: a.id }, to: { kind: b.kind, id: b.id }, role: check.role as unknown as LinkRole }
  await write(link)
  const element = canvas.link({ fromElId: from.id, toElId: to.id, role: check.role, linkId: link.id })
  canvas.transact((els) => canvas.bindArrow([...els, element], element), { undoable: true })
  return { ok: true, link, element }
}

/**
 * Keep the document's links in step with the link elements: `seen` is every link id this session
 * has had on the canvas. Returns the ids to unlink (seen before, gone now, still in the document)
 * and the links to put back (on the canvas, missing from the document, both ends there).
 */
export function reconcileLinks(els: readonly CanvasElement[], doc: ProductionDocument, seen: Set<string>): { unlink: string[]; relink: Link[] } {
  const live = new Map<string, CanvasElement>()
  for (const e of els) {
    const id = linkIdOf(e)
    if (id && !e.isDeleted) live.set(id, e)
  }
  const byEl = new Map(els.filter((e) => !e.isDeleted).map((e) => [e.id, e]))
  const unlink = [...seen].filter((id) => !live.has(id) && doc.links?.[id])
  const relink: Link[] = []
  for (const [id, e] of live) {
    seen.add(id)
    if (doc.links?.[id]) continue
    const ends = e as CanvasElement & { startBinding?: { elementId?: string } | null; endBinding?: { elementId?: string } | null; role?: string }
    const a = cardOf(byEl.get(ends.startBinding?.elementId ?? '') ?? ({} as CanvasElement))
    const b = cardOf(byEl.get(ends.endBinding?.elementId ?? '') ?? ({} as CanvasElement))
    if (a && b && ends.role) relink.push({ id, v: 1, field_v: {}, from: { kind: a.kind, id: a.id }, to: { kind: b.kind, id: b.id }, role: ends.role as LinkRole })
  }
  return { unlink, relink }
}

// ── New nodes (+ Node; ui-behaviour 3.3 Creating nodes) ─────────────────────

const WORD: Record<CardKind, string> = { script: 'Script', storyboard: 'Storyboard', video: 'Video' }

/** A new, empty document entity for a node of this kind: "Script 2", at the project's ratio and length. */
export function newEntity(doc: ProductionDocument, kind: CardKind): { kind: CardKind; entity: Script | Storyboard | Video } {
  const n = Object.keys(kind === 'script' ? doc.scripts ?? {} : kind === 'storyboard' ? doc.storyboards ?? {} : doc.videos ?? {}).length
  const title = n ? `${WORD[kind]} ${n + 1}` : WORD[kind]
  const sb = mainStoryboard(doc)
  const target_s = sb?.target_s ?? mainScript(doc)?.target_s ?? 15
  const ratio = sb?.ratio ?? '16:9'
  const base = { id: newId(kind), v: 1, field_v: {}, title }
  if (kind === 'script') return { kind, entity: { ...base, target_s } }
  if (kind === 'storyboard') return { kind, entity: { ...base, ratio, target_s } }
  return { kind, entity: { ...base, ratio, target_s, edl: {} } }
}

type Box = { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const PAD = { x: 16, top: 22, bottom: 16 }

/**
 * Where a new node of this kind goes (ui-behaviour 3.3): centred on `at`, else on the middle of the
 * view, nudged clear of the nodes already there. When that spot is on a board whose purpose fits the
 * kind (the board in view, the one the rail jumped to), the node joins it and the board grows to hold
 * it. Pure: returns the box, the board it joins and the board's grown box.
 */
export function placeNode(canvas: CanvasAdapter, doc: ProductionDocument, kind: CardKind, at?: Pt): { box: Box; board: CanvasElement | null; grow: Box | null } {
  const els = canvas.elements()
  const size = CARD_SIZE[kind]
  const v = canvas.visibleBounds()
  const c = at ?? { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 }
  const purposeOf = (e: CanvasElement) => {
    const id = (e.customData as { id?: string } | undefined)?.id
    return (id && doc.boards?.[id]?.purpose) || (e as CanvasElement & { purpose?: string }).purpose
  }
  const boards = els.filter((e) => !e.isDeleted && (e.customData as { kind?: string } | undefined)?.kind === 'board')
  const board = boards.filter((b) => c.x >= b.x && c.y >= b.y && c.x <= b.x + b.width && c.y <= b.y + b.height && purposeOf(b) === kind).at(-1) ?? null
  const nodes = els.filter((e) => cardOf(e)).map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height }))
  let box: Box = { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2), ...size }
  if (board) box = { ...box, x: Math.max(box.x, board.x + PAD.x), y: Math.max(box.y, board.y + PAD.top) }
  for (let i = 0; i < 24 && nodes.some((n) => overlaps(n, box)); i++) box = { ...box, x: box.x + 40, y: box.y + 40 }
  let grow: Box | null = null
  if (board) {
    const right = Math.max(board.x + board.width, box.x + box.w + PAD.x)
    const bottom = Math.max(board.y + board.height, box.y + box.h + PAD.bottom)
    if (right > board.x + board.width || bottom > board.y + board.height) grow = { x: board.x, y: board.y, w: right - board.x, h: bottom - board.y }
  }
  return { box, board, grow }
}

/** What createNode needs: the canvas and the document. */
export interface NodeEnv {
  canvas: CanvasAdapter
  doc: DocumentStore
}

/**
 * Make a new, empty node of this kind (+ Node; ui-behaviour 3.3): its document entity (a system
 * write, so the person's one undo step is the node on the canvas), then the node, on the board in view
 * when its purpose fits, else in the middle of the view (or centred on `at`), selected. Undo takes the
 * node away; the empty entity stays unlinked until it is used again or collected.
 */
export async function createNode(env: NodeEnv, kind: CardKind, at?: Pt): Promise<CanvasElement> {
  const { canvas } = env
  const made = newEntity(env.doc.get(), kind)
  await systemUpdate(env.doc, (d) => {
    if (made.kind === 'script') d.scripts[made.entity.id] = made.entity as Script
    else if (made.kind === 'storyboard') d.storyboards[made.entity.id] = made.entity as Storyboard
    else d.videos[made.entity.id] = made.entity as Video
  }, `add a ${kind}`)
  const { box, board, grow } = placeNode(canvas, env.doc.get(), kind, at)
  const el = canvas.node({ x: box.x, y: box.y, width: box.w, height: box.h, customData: { kind, id: made.entity.id } })
  const placed = board ? canvas.patch(el, { frameId: board.id }) : el
  canvas.transact((all) => [
    ...all.map((e) => (grow && board && e.id === board.id ? canvas.patch(e, { width: grow.w, height: grow.h }) : e)),
    placed,
  ], { undoable: true })
  canvas.select([placed.id])
  return placed
}

/**
 * Is this node still empty, so its card offers a start (ui-behaviour 3.3 Empty; the chrome's PromptStart
 * slot): a script with no words and no shots, a storyboard with no shots, a video with no shots to cut
 * and no render.
 */
export function isEmptyNode(doc: ProductionDocument, kind: CardKind, id: string): boolean {
  if (kind === 'script') {
    const words = scenesOf(doc, id).map((s) => s.text ?? '').join('').trim()
    const sb = storyboardOfScript(doc, id)
    return !words && !(sb && shotsOf(doc, sb.id).length)
  }
  if (kind === 'storyboard') return shotsOf(doc, id).length === 0
  const sb = storyboardOfVideo(doc, id)
  return !(sb && shotsOf(doc, sb.id).length) && !currentRender(doc, id)
}
