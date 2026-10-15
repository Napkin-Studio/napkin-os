// Nodes made from other nodes (ui-behaviour 3.5 Make video, 3.10 Plan shots; features/production-ui.clan):
// a Video from a Script, a Storyboard or both, and the Storyboard a Script drives when it has none.
// Engine-neutral, through CanvasAdapter v2, like nodes.ts.
//
// Each make is ONE undo step: the new node and every link it brings are written to the canvas in one
// undoable transact first, then the entity and the links to the document as a system write. The
// canvas's undo takes the node and the link elements away; the document follows (CanvasDocSync takes
// the entity out with its links; reconcileLinks takes out a link whose element went), and redo brings
// them back the same way. Nothing is hidden: what a make adds is on the canvas, beside what it came from.

import type { Link, LinkEndpoint, ProductionDocument, Storyboard, Video } from '../../contracts/types'
import { systemUpdate } from '../../doc/store'
import { newId } from '../../lib/ulid'
import { storyboardOfScript } from '../../model/selectors'
import { CARD_SIZE } from '../boards/layout'
import type { CanvasElement } from '../core/canvasAdapter'
import type { CardKind } from './cardChrome'
import { cardOf, elementOfEnd, newEntity, placeNode, type NodeEnv } from './nodes'

type Doc = ProductionDocument
type Box = { x: number; y: number; w: number; h: number }

/** The gap between a node and the one made beside it. */
export const BESIDE_GAP = 96

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Where a new node of `kind` goes beside `src`: to its right, top-aligned, moved down clear of other nodes. */
export function besideBox(els: readonly CanvasElement[], src: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height'>, kind: CardKind): Box {
  const size = CARD_SIZE[kind]
  const nodes = els.filter((e) => !e.isDeleted && cardOf(e)).map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height }))
  let box: Box = { x: Math.round(src.x + src.width + BESIDE_GAP), y: Math.round(src.y), ...size }
  for (let i = 0; i < 40; i++) {
    const hit = nodes.find((n) => overlaps(n, box))
    if (!hit) break
    box = { ...box, y: hit.y + hit.h + 40 }
  }
  return box
}

/** The scripts that drive this node (`drives` links into it). */
export function drivers(d: Doc, to: LinkEndpoint): string[] {
  return Object.values(d.links ?? {}).filter((l) => l.role === 'drives' && l.from.kind === 'script' && l.to.kind === to.kind && l.to.id === to.id).map((l) => l.from.id)
}

/** The storyboard this script drives (its newest `drives` link, as the Script editor shows it), if any. */
export function drivenStoryboard(d: Doc, scriptId: string): Storyboard | undefined {
  const ids = Object.values(d.links ?? {})
    .filter((l) => l.role === 'drives' && l.from.kind === 'script' && l.from.id === scriptId && l.to.kind === 'storyboard')
    .sort((a, b) => (a.id < b.id ? 1 : -1)).map((l) => l.to.id)
  return ids.map((id) => d.storyboards[id]).find(Boolean) ?? storyboardOfScript(d, scriptId)
}

const newLink = (from: LinkEndpoint, to: LinkEndpoint, role: 'drives' | 'renders'): Link => ({ id: newId('link'), v: 1, field_v: {}, from, to, role })

/** Write a new node and its links: the canvas first (one undoable step), then the document (a system write). */
async function place(env: NodeEnv, kind: CardKind, entity: Storyboard | Video | { id: string }, box: Box, links: { link: Link; from: string; to: string }[], action: string): Promise<CanvasElement> {
  const { canvas } = env
  const el = canvas.node({ x: box.x, y: box.y, width: box.w, height: box.h, customData: { kind, id: entity.id } })
  const ends = new Map<string, string>([[entity.id, el.id]])
  for (const e of canvas.elements()) {
    const c = cardOf(e)
    if (c) ends.set(c.id, e.id)
  }
  canvas.transact((all) => {
    let out: CanvasElement[] = [...all, el]
    for (const l of links) {
      const from = ends.get(l.from)
      const to = ends.get(l.to)
      if (!from || !to) continue
      const arrow = canvas.link({ fromElId: from, toElId: to, role: l.link.role, linkId: l.link.id })
      out = canvas.bindArrow([...out, arrow], arrow)
    }
    return out
  }, { undoable: true })
  await systemUpdate(env.doc, (d) => {
    if (kind === 'storyboard') d.storyboards[entity.id] = entity as Storyboard
    else if (kind === 'video') d.videos[entity.id] = entity as Video
    for (const l of links) d.links[l.link.id] = l.link
  }, action)
  canvas.select([el.id])
  return el
}

/**
 * The Storyboard a Script drives (3.10 Plan shots): the one it drives already, else a new one beside
 * the script on the canvas with the `drives` link, as one undo step. `made` says which.
 */
export async function storyboardFor(env: NodeEnv, scriptId: string): Promise<{ storyboardId: string; made: boolean; el?: CanvasElement }> {
  const d = env.doc.get()
  if (!d.scripts[scriptId]) throw new Error('This script is gone.')
  const there = drivenStoryboard(d, scriptId)
  if (there) return { storyboardId: there.id, made: false }
  const made = newEntity(d, 'storyboard')
  const sb = { ...(made.entity as Storyboard), target_s: d.scripts[scriptId].target_s || (made.entity as Storyboard).target_s }
  const src = elementOfEnd(env.canvas.elements(), d, { kind: 'script', id: scriptId })
  const box = src ? besideBox(env.canvas.elements(), src, 'storyboard') : placeNode(env.canvas, d, 'storyboard').box
  const link = newLink({ kind: 'script', id: scriptId }, { kind: 'storyboard', id: sb.id }, 'drives')
  const el = await place(env, 'storyboard', sb, box, [{ link, from: scriptId, to: sb.id }], `add a storyboard for scripts[${scriptId}]`)
  return { storyboardId: sb.id, made: true, el }
}

/** What Make video was given: at most one script and one storyboard (an ambiguous selection is asked about first). */
export interface MakeVideoFrom { scriptId?: string; storyboardId?: string }

export interface MadeVideo {
  el: CanvasElement
  videoId: string
  /** How many links the make wrote. */
  links: number
  /** The toast: "Video made from Script and Storyboard · 2 links". */
  label: string
}

/**
 * Make video (3.5), as one undo step: the Video node to the right of the storyboard (else the script),
 * with a `renders` link from the storyboard, the script's `drives` link into the storyboard when it is
 * missing, or, from a script alone, a `drives` link from the script into the video (Dex then asks how to
 * make its clips, before anything is spent). No job starts.
 */
export async function makeVideo(env: NodeEnv, from: MakeVideoFrom): Promise<MadeVideo> {
  const d = env.doc.get()
  const { scriptId, storyboardId } = from
  if (!scriptId && !storyboardId) throw new Error('Select a script or a storyboard to make a video from.')
  if (scriptId && !d.scripts[scriptId]) throw new Error('That script is gone.')
  if (storyboardId && !d.storyboards[storyboardId]) throw new Error('That storyboard is gone.')
  const made = newEntity(d, 'video')
  const sb = storyboardId ? d.storyboards[storyboardId] : undefined
  const video = { ...(made.entity as Video), ...(sb ? { ratio: sb.ratio, target_s: sb.target_s } : scriptId ? { target_s: d.scripts[scriptId].target_s || (made.entity as Video).target_s } : {}) }
  const links: { link: Link; from: string; to: string }[] = []
  const vEnd = { kind: 'video' as const, id: video.id }
  if (storyboardId) {
    // The drives link only when the storyboard has no script yet (one script per storyboard).
    if (scriptId && !drivers(d, { kind: 'storyboard', id: storyboardId }).length) {
      links.push({ link: newLink({ kind: 'script', id: scriptId }, { kind: 'storyboard', id: storyboardId }, 'drives'), from: scriptId, to: storyboardId })
    }
    links.push({ link: newLink({ kind: 'storyboard', id: storyboardId }, vEnd, 'renders'), from: storyboardId, to: video.id })
  } else if (scriptId) {
    links.push({ link: newLink({ kind: 'script', id: scriptId }, vEnd, 'drives'), from: scriptId, to: video.id })
  }
  const srcEnd = storyboardId ? { kind: 'storyboard' as const, id: storyboardId } : { kind: 'script' as const, id: scriptId! }
  const src = elementOfEnd(env.canvas.elements(), d, srcEnd)
  const box = src ? besideBox(env.canvas.elements(), src, 'video') : placeNode(env.canvas, d, 'video').box
  const el = await place(env, 'video', video, box, links, `make a video from ${scriptId && storyboardId ? 'a script and a storyboard' : srcEnd.kind === 'script' ? 'a script' : 'a storyboard'}`)
  const words = scriptId && storyboardId ? 'Script and Storyboard' : storyboardId ? 'Storyboard' : 'Script'
  return { el, videoId: video.id, links: links.length, label: `Video made from ${words} · ${links.length} ${links.length === 1 ? 'link' : 'links'}` }
}
