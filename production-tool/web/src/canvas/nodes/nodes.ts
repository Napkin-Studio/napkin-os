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
// - A picture that is one of a key's two or more views is the whole key as a link end
//   (owner 2026-10-15: one character, auto-grouped): a link from it, or from its group,
//   is one link from the key. `single` (⌥ while linking) links only that view.

import { currentRender, keyNamed, mainScript, mainStoryboard, mainVideo, refsList, scenesOf, shotsOf, storyboardOfScript, storyboardOfVideo } from '../../model/selectors'
import type { Link, LinkEndpoint, LinkRole, ProductionDocument, RefRole, Script, Storyboard, Video } from '../../contracts/types'
import { newId } from '../../lib/ulid'
import { systemUpdate, updateDoc } from '../../doc/store'
import type { DocumentStore } from '../../doc/types'
import type { CanvasAdapter, CanvasElement, Pt } from '../core/canvasAdapter'
import { canLink, checkLink, endName, type LinkEnd as CoreEnd, type LinkGraph, type LinkKind, type LinkRole as CoreRole } from '../core/links'
import type { CardKind } from './cardChrome'
import { adLayout, CARD_SIZE } from '../boards/layout'
import { boardAt, fitInto, tellFull, withFields } from '../boards/fitting'
import { isKeyGroup, keyViews } from '../../lib/names'
import { keyGroupId } from './keyGroups'

export const CARD_KINDS: readonly CardKind[] = ['script', 'storyboard', 'video']

const tag = (e: Pick<CanvasElement, 'customData'> | undefined): { kind?: string; id?: string } => {
  const c = e?.customData as { kind?: unknown; id?: unknown } | undefined
  return { kind: typeof c?.kind === 'string' ? c.kind : undefined, id: typeof c?.id === 'string' ? c.id : undefined }
}

const entityIn = (doc: ProductionDocument, c: { kind: CardKind; id: string }) =>
  !!(c.kind === 'script' ? doc.scripts : c.kind === 'storyboard' ? doc.storyboards : doc.videos)?.[c.id]

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

// ── Link ends: nodes, named pictures and sketch areas (ui-behaviour 3.4) ──

/** One end of a link on the canvas: its element, its document endpoint and the rules' view of it. */
export interface LinkEndOnCanvas {
  el: CanvasElement
  doc: LinkEndpoint
  core: CoreEnd
  /** A reference's own role (character, lighting…): the link's role into a generating node. */
  refRole?: RefRole
}

/** How a link end is read: `single` takes a key's view as itself, not as its whole key. */
export interface EndOptions {
  single?: boolean
}

/**
 * What a canvas element is as a link end: a Script, Storyboard or Video node, a named picture (its
 * reference, or its whole key when the key has two or more views), or a sketch area. An unnamed
 * picture is not one yet: `refuse` says so. Null: not an end.
 */
export function endOf(e: CanvasElement | undefined, doc: ProductionDocument, opts: EndOptions = {}): LinkEndOnCanvas | { refuse: string } | null {
  if (!e || e.isDeleted) return null
  const card = cardOf(e)
  if (card) return { el: e, doc: { kind: card.kind, id: card.id }, core: { kind: card.kind as LinkKind } }
  const t = tag(e)
  if (t.kind === 'sketch' && t.id) return { el: e, doc: { kind: 'sketch', id: t.id }, core: { kind: 'sketch' } }
  if (e.type === 'image') {
    const ref = refsList(doc).find((r) => r.node && (r.node === e.id || r.node === t.id))
    if (!ref) return t.kind === 'pic' || !t.kind ? { refuse: 'Name this picture first (Name… on its bar), then link it.' } : null
    const key = keyNamed(doc, ref.key)
    const role = (key?.role ?? ref.role) as RefRole
    if (key && !opts.single && isKeyGroup(doc, ref.key)) return { el: e, doc: { kind: 'key', id: key.id }, core: { kind: 'picture', role }, refRole: role }
    return { el: e, doc: { kind: 'ref', id: ref.id }, core: { kind: 'picture', role }, refRole: role }
  }
  return null
}

const isEnd = (x: ReturnType<typeof endOf>): x is LinkEndOnCanvas => !!x && !('refuse' in x)
const endInDoc = (doc: ProductionDocument, x: LinkEndOnCanvas) =>
  x.doc.kind === 'script' || x.doc.kind === 'storyboard' || x.doc.kind === 'video' ? entityIn(doc, { kind: x.doc.kind, id: x.doc.id }) : true

/** The element on the canvas that stands for a document endpoint, if it is there. */
export function elementOfEnd(els: readonly CanvasElement[], doc: ProductionDocument, end: LinkEndpoint): CanvasElement | undefined {
  const live = els.filter((e) => !e.isDeleted)
  const onCanvas = (node: string | undefined) => (node ? live.find((e) => e.id === node || tag(e).id === node) : undefined)
  if (end.kind === 'ref') return onCanvas(doc.refs?.[end.id]?.node)
  // A key: its lead view on the canvas (the front, which tops its stack), else the next.
  if (end.kind === 'key') {
    const k = doc.keys?.[end.id]
    return k ? keyViews(doc, k.key).views.map((r) => onCanvas(r.node)).find(Boolean) : undefined
  }
  return live.find((e) => {
    const t = tag(e)
    return t.id === end.id && (t.kind === end.kind || (end.kind === 'sketch' && t.kind === 'sketch'))
  })
}

/** The rules' role of a document link: a reference's (or a key's) own role is `reference` to them. */
const coreRole = (l: Pick<Link, 'from' | 'role'>): CoreRole => (l.from.kind === 'ref' || l.from.kind === 'key' ? 'reference' : (l.role as unknown as CoreRole))

/** The link rules' view of what is on the canvas: its link ends and the document's links between them. */
export function linkGraph(els: readonly CanvasElement[], doc: ProductionDocument): LinkGraph {
  // A key's view is an end both as its key and as itself.
  const ends = els.flatMap((e) => [endOf(e, doc), endOf(e, doc, { single: true })]).filter(isEnd)
  const nodes = [...new Map(ends.map((x) => [x.doc.id, { id: x.doc.id, kind: x.core.kind, ...(x.core.role ? { role: x.core.role } : {}) }])).values()]
  const links = Object.values(doc.links ?? {}).map((l) => ({ from: l.from.id, to: l.to.id, role: coreRole(l) }))
  return { nodes, links }
}

export type LinkOutcome = { ok: true; link: Link; element: CanvasElement } | { ok: false; reason: string }

/** Can `from` feed `to`, and with which role (the rules' first; a reference's own role in the document)? */
export function linkCheck(els: readonly CanvasElement[], doc: ProductionDocument, from: CanvasElement, to: CanvasElement, opts: EndOptions = {}): { ok: true; role: CoreRole; docRole: LinkRole } | { ok: false; reason: string } {
  const a = endOf(from, doc, opts)
  const b = endOf(to, doc)
  if (a && 'refuse' in a) return { ok: false, reason: a.refuse }
  if (!a || !b) return { ok: false, reason: 'Link a script, a storyboard, a video, a named picture or a sketch area.' }
  if ('refuse' in b) return { ok: false, reason: `Nothing links into ${endName({ kind: 'picture' })}: it is an input only.` }
  if (a.doc.id === b.doc.id) return { ok: false, reason: 'That would make a loop.' }
  const can = canLink(a.core, b.core)
  if (!can.ok) return can
  const role = can.roles[0]
  const checked = checkLink(linkGraph(els, doc), a.doc.id, b.doc.id, role)
  if (!checked.ok) return checked
  return { ok: true, role, docRole: (role === 'reference' && a.refRole ? a.refRole : role) as LinkRole }
}

/**
 * Link two ends: the document's links entry (written first by `write`, updateDoc with a 'link'
 * action), then the link element as one undoable step. Returns what was made, or why not.
 */
export async function linkNodes(canvas: CanvasAdapter, doc: ProductionDocument, from: CanvasElement, to: CanvasElement, write: (link: Link) => Promise<void>, opts: EndOptions = {}): Promise<LinkOutcome> {
  const check = linkCheck(canvas.elements(), doc, from, to, opts)
  if (!check.ok) return check
  const a = endOf(from, doc, opts) as LinkEndOnCanvas
  const b = endOf(to, doc) as LinkEndOnCanvas
  const link: Link = { id: newId('link'), v: 1, field_v: {}, from: a.doc, to: b.doc, role: check.docRole }
  await write(link)
  const element = canvas.link({ fromElId: from.id, toElId: to.id, role: check.docRole, linkId: link.id, ...groupOf(doc, link.from) })
  canvas.transact((els) => canvas.bindArrow([...els, element], element), { undoable: true })
  return { ok: true, link, element }
}

/** The group a link leaves from on the canvas: a key's views (`key:<key>`), so it attaches at their bounds. */
export function groupOf(doc: ProductionDocument, from: LinkEndpoint): { fromGroup?: string } {
  if (from.kind !== 'key') return {}
  const k = doc.keys?.[from.id]
  return k ? { fromGroup: keyGroupId(k.key) } : {}
}

/** What reconcileLinks remembers across calls in one session. */
export interface LinkMemory {
  /** Link ids that have had an element on this canvas. */
  seen: Set<string>
  /** Link ids that have been in the document. */
  inDoc: Set<string>
  /** Link ids this canvas took out of the document because their element was deleted (undo may bring them back). */
  unlinked: Set<string>
  /** Each link as the document last had it, so undo brings back the same ends (a key, or one view of it). */
  known: Map<string, Link>
}

export const linkMemory = (): LinkMemory => ({ seen: new Set(), inDoc: new Set(), unlinked: new Set(), known: new Map() })

/**
 * Keep the document's links and the link elements in step, whoever wrote either (ui-behaviour 3.4):
 * - unlink: a link element the person deleted takes its document entry with it;
 * - relink: an element brought back by undo puts its entry back;
 * - draw: a document link with no element yet (written by an ask, a job, another person, or an
 *   older canvas), with both ends on the canvas, gets its arrow;
 * - erase: an element whose document entry someone else removed (an inputs chip's ×) goes too.
 * Draw and erase are system writes, never the person's step.
 */
export function reconcileLinks(els: readonly CanvasElement[], doc: ProductionDocument, mem: LinkMemory): { unlink: string[]; relink: Link[]; draw: { link: Link; from: CanvasElement; to: CanvasElement }[]; erase: string[]; regroup: { elId: string; group: string | null }[] } {
  const live = new Map<string, CanvasElement>()
  // Two arrows for one link (the document's entry drawn by a reconcile while the person's own link
  // was still being written): the later goes, so deleting the one on screen unlinks.
  const twins: string[] = []
  for (const e of els) {
    const id = linkIdOf(e)
    if (!id || e.isDeleted) continue
    if (live.has(id)) twins.push(e.id)
    else live.set(id, e)
  }
  for (const [id, l] of Object.entries(doc.links ?? {})) {
    mem.inDoc.add(id)
    mem.known.set(id, l)
  }
  const byEl = new Map(els.filter((e) => !e.isDeleted).map((e) => [e.id, e]))
  const unlink = [...mem.seen].filter((id) => !live.has(id) && doc.links?.[id])
  for (const id of unlink) mem.unlinked.add(id)
  const relink: Link[] = []
  const erase: string[] = [...twins]
  for (const [id, e] of live) {
    mem.seen.add(id)
    if (doc.links?.[id]) continue
    // In the document before and not taken out by this canvas: someone removed it, so the arrow goes.
    if (mem.inDoc.has(id) && !mem.unlinked.has(id)) {
      erase.push(e.id)
      continue
    }
    mem.unlinked.delete(id)
    const ends = e as CanvasElement & { startBinding?: { elementId?: string } | null; endBinding?: { elementId?: string } | null; role?: string }
    const a = endOf(byEl.get(ends.startBinding?.elementId ?? ''), doc)
    const b = endOf(byEl.get(ends.endBinding?.elementId ?? ''), doc)
    // A node's end must be in the document: a node coming back with the canvas's undo is put back
    // there first (CanvasDocSync.nodes), and the link waits for it.
    // A picture's link comes back as it was: from its whole key, or from that one view.
    const was = mem.known.get(id)?.from
    const pic = (k: string) => k === 'key' || k === 'ref'
    const from = isEnd(a) && was && pic(was.kind) && pic(a.doc.kind) ? was : isEnd(a) ? a.doc : null
    if (from && isEnd(b) && ends.role && endInDoc(doc, a as LinkEndOnCanvas) && endInDoc(doc, b)) relink.push({ id, v: 1, field_v: {}, from, to: b.doc, role: ends.role as LinkRole })
  }
  const draw: { link: Link; from: CanvasElement; to: CanvasElement }[] = []
  const regroup: { elId: string; group: string | null }[] = []
  for (const l of Object.values(doc.links ?? {})) {
    const there = live.get(l.id)
    if (there) {
      // A key link leaves from its group (it attaches at the views' bounds); one drawn before that knew it learns it.
      const want = groupOf(doc, l.from).fromGroup ?? null
      const has = (there as CanvasElement & { startBinding?: { group?: string } | null }).startBinding?.group ?? null
      if (want !== has) regroup.push({ elId: there.id, group: want })
      continue
    }
    if (mem.seen.has(l.id)) continue
    const from = elementOfEnd(els, doc, l.from)
    const to = elementOfEnd(els, doc, l.to)
    if (from && to) draw.push({ link: l, from, to })
  }
  return { unlink, relink, draw, erase, regroup }
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

/**
 * Where a new node of this kind goes (ui-behaviour 3.3): centred on `at`, else on the middle of the
 * view, nudged clear of the nodes already there; and the board it joins, when that spot is on a board
 * whose purpose fits the kind (the board in view, the one the rail jumped to). On a board, createNode
 * puts it in the board's next free slot instead (boards/fitting). Pure.
 */
export function placeNode(canvas: CanvasAdapter, doc: ProductionDocument, kind: CardKind, at?: Pt): { box: Box; board: CanvasElement | null } {
  const els = canvas.elements()
  const size = CARD_SIZE[kind]
  const v = canvas.visibleBounds()
  const c = at ?? { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 }
  const purposeOf = (e: CanvasElement) => {
    const id = (e.customData as { id?: string } | undefined)?.id
    return (id && doc.boards?.[id]?.purpose) || (e as CanvasElement & { purpose?: string }).purpose
  }
  const board = boardAt(els, c, (b) => purposeOf(b) === kind) ?? null
  const nodes = els.filter((e) => cardOf(e)).map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height }))
  let box: Box = { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2), ...size }
  for (let i = 0; i < 24 && nodes.some((n) => overlaps(n, box)); i++) box = { ...box, x: box.x + 40, y: box.y + 40 }
  return { box, board }
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
  const { box, board } = placeNode(canvas, env.doc.get(), kind, at)
  const el = canvas.node({ x: box.x, y: box.y, width: box.w, height: box.h, customData: { kind, id: made.entity.id } })
  // On a board: its next free slot, the board growing toward free canvas, never over its neighbours
  // (owner decision 2026-10-15); when it cannot grow, just outside it, and the board says so.
  let fit: ReturnType<typeof fitInto> | null = null
  canvas.transact((all) => {
    const next = [...all, el]
    if (!board) return next
    fit = fitInto(next, board.id, [[el.id]])
    return withFields(canvas, next, fit.fields)
  }, { undoable: true })
  if (board && fit) tellFull(board.id, fit)
  const placed = canvas.elements().find((e) => e.id === el.id) ?? el
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

/**
 * An inputs chip's × (ui-behaviour 3.3, 3.16): the link out of the document, as the person's step. The
 * canvas's arrow follows on its next reconcile (reconcileLinks erase), so chip and arrow go together.
 */
export function unlinkInput(store: DocumentStore, linkId: string): Promise<unknown> {
  const l = store.get().links?.[linkId]
  if (!l) return Promise.resolve()
  return updateDoc(store, (d) => { delete d.links[linkId] }, `unlink ${l.from.kind} from ${l.to.kind}`)
}
