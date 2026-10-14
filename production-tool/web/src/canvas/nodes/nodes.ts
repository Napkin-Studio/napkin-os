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

import { mainScript, mainStoryboard, mainVideo } from '../../model/selectors'
import type { Link, LinkRole, ProductionDocument } from '../../contracts/types'
import { newId } from '../../lib/ulid'
import type { CanvasAdapter, CanvasElement } from '../core/canvasAdapter'
import { canLink, checkLink, type LinkGraph, type LinkKind, type LinkRole as CoreRole } from '../core/links'
import type { CardKind } from './cardChrome'
import { adLayout } from '../boards/layout'

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
