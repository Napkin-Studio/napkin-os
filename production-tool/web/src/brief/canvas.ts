// The Brief node on the canvas (features/brief-node.clan): its card element, the brief a page arrives with,
// and a brief linked later. Engine-neutral, through CanvasAdapter v2 like canvas/nodes. How the card looks
// (compact: title, version, proposition, tone) is the card chrome's; this file only places it.
//
// A blank canvas asks nothing (owner 2026-11-18, features/production-new-ui.clan): arriving from Brief Maker
// puts the brief's Brief node there alone (bringBrief), and the person links it to what they add.

import type { Id, Link, LinkEndpoint } from '../contracts/types'
import type { CanvasElement, Pt } from '../canvas/core/canvasAdapter'
import { elementOfEnd, linkInput, type NodeEnv } from '../canvas/nodes/nodes'
import { clearOffset } from '../canvas/boards/fitting'
import { addBrief, briefFromDocument, briefOf, newBrief } from './model'
import type { OsBriefRead } from './os'

/** The card's box on the canvas (the compact card; the Booth shows the whole spine). */
export const BRIEF_CARD = { w: 300, h: 132 } as const
/** The gap between the Brief card and the Script it feeds. */
const GAP = 72

/** The Brief node's element on the canvas, if it is there. */
export function briefElement(env: NodeEnv, briefId: Id): CanvasElement | undefined {
  return elementOfEnd(env.canvas.elements(), env.doc.get(), { kind: 'brief', id: briefId })
}

/** The Brief node a canvas element is, if it is one. */
export function briefOfElement(e: CanvasElement | undefined): Id | null {
  const c = e?.customData as { kind?: unknown; id?: unknown } | undefined
  return !e?.isDeleted && c?.kind === 'brief' && typeof c.id === 'string' ? c.id : null
}

/**
 * Place a Brief node's card (the person's one undo step), centred on `at` or the middle of the view,
 * clear of what is there, selected. The brief must be in the document already (addBrief).
 */
export function placeBrief(env: NodeEnv, briefId: Id, at?: Pt): CanvasElement {
  const { canvas } = env
  const there = briefElement(env, briefId)
  if (there) {
    canvas.select([there.id])
    return there
  }
  const v = canvas.visibleBounds()
  const c = at ?? { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 }
  let box = { x: Math.round(c.x - BRIEF_CARD.w / 2), y: Math.round(c.y - BRIEF_CARD.h / 2), w: BRIEF_CARD.w, h: BRIEF_CARD.h }
  const { dx, dy } = clearOffset(canvas.elements(), [box])
  box = { ...box, x: Math.round(box.x + dx), y: Math.round(box.y + dy) }
  const el = canvas.node({ x: box.x, y: box.y, width: box.w, height: box.h, customData: { kind: 'brief', id: briefId } })
  canvas.transact((all) => [...all, el], { undoable: true })
  const placed = canvas.elements().find((e) => e.id === el.id) ?? el
  canvas.select([placed.id])
  return placed
}

/** Link a Brief node into a Script, Storyboard, Video or Format set (the person's step); the canvas draws the arrow. */
export async function linkBrief(env: NodeEnv, briefId: Id, to: LinkEndpoint): Promise<{ ok: true; link: Link } | { ok: false; reason: string }> {
  return linkInput(env.doc, env.doc.get(), { kind: 'brief', id: briefId }, to)
}

/**
 * The brief a project is born with (Brief Maker's Continue in › Production, carried in the project: start.ts): its Brief node
 * (the one already made from this brief, else a new frozen copy), placed in view and nothing else: no Script,
 * no link, nothing selected, so no Booth opens. The person links it to what they add.
 */
export async function bringBrief(env: NodeEnv, read: OsBriefRead, how: 'link' | 'spinoff' = 'spinoff'): Promise<{ briefId: Id; el: CanvasElement }> {
  const brief = briefFromDocument(env.doc.get(), read.documentId) ?? (await addBrief(env.doc, newBrief(read, how)))
  const el = placeBrief(env, brief.id)
  env.canvas.select([])
  return { briefId: brief.id, el }
}

/** What linking a brief later did: the Brief node, and the Script it now feeds when there was one to feed. */
export interface LinkedLater {
  briefId: Id
  /** The Script the brief was linked into: the only Script with no brief of its own, if there was one. */
  scriptId?: Id
  /** Why it was placed but not linked (several Scripts, or each already has a brief). */
  note?: string
}

/**
 * Link a brief to a film started without one (live test 2026-11-18; Assets › From Napkin, Continue in ›
 * Link a brief…): its Brief node (the one already made from this brief, else a new frozen copy) beside
 * the film's Script, linked into it when exactly one Script has no brief yet; otherwise placed, selected,
 * for the person to link (its port, or + Link input).
 */
export async function linkBriefLater(env: NodeEnv, read: OsBriefRead): Promise<LinkedLater> {
  const brief = briefFromDocument(env.doc.get(), read.documentId) ?? (await addBrief(env.doc, newBrief(read, 'link')))
  const d = env.doc.get()
  const open = Object.values(d.scripts ?? {}).filter((sc) => !briefOf(d, sc.id))
  const target = open.length === 1 ? open[0].id : undefined
  const scriptEl = target ? elementOfEnd(env.canvas.elements(), d, { kind: 'script', id: target }) : undefined
  const at = scriptEl ? { x: scriptEl.x - GAP - BRIEF_CARD.w / 2, y: scriptEl.y + Math.min(scriptEl.height / 3, BRIEF_CARD.h / 2 + 24) } : undefined
  const el = placeBrief(env, brief.id, at)
  if (!target || !scriptEl) {
    env.canvas.select([el.id])
    return { briefId: brief.id, note: open.length ? 'Link it into the Script it is for: drag from its port.' : 'Every Script has a brief already: link this one where you want it.' }
  }
  const linked = await linkBrief(env, brief.id, { kind: 'script', id: target })
  env.canvas.select([el.id])
  return linked.ok ? { briefId: brief.id, scriptId: target } : { briefId: brief.id, note: linked.reason }
}
