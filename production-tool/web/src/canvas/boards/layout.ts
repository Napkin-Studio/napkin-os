// Where the Ad template's boards and nodes go on a canvas that already has
// pictures (mock Main; features/production-ui.clan): each picture board wraps
// the named pictures of its role, the Script board stands to their left, the
// Storyboard board below and the Video board beside it, with the three nodes
// inside their boards. The same geometry production-ui's Excalidraw overlay draws
// (chrome/boards.ts boardFrames), so a project opens on either engine alike.
// Engine-neutral and pure: seedNodes and seedBoards place by it.

import type { BoardPurpose, ProductionDocument, RefRole } from '../../contracts/types'
import { keysList, refsList } from '../../model/selectors'
import { boardFrames } from '../chrome/boards'
import { elementBounds } from '../core/geometry'
import type { CanvasElement } from '../core/canvasAdapter'
import type { CardKind } from '../nodes/cardChrome'

export type Rect = { x: number; y: number; w: number; h: number }

/** A node card inside its board (canvas.css .bl-card: 16 in from the sides, 22 down). */
export const CARD_INSET = { x: 16, top: 22 }
/** The cards' own sizes (cards.tsx: Script 380 high, Storyboard and Video 194). */
export const CARD_SIZE: Record<CardKind, { w: number; h: number }> = {
  script: { w: 308, h: 380 },
  storyboard: { w: 720, h: 194 },
  video: { w: 348, h: 194 },
}

const PURPOSE_OF: Partial<Record<RefRole, BoardPurpose>> = { character: 'character', location: 'location', product: 'product' }
/** The brand roles (board-autolayout): a Brand board takes them when there is one, else References. */
export const BRAND_ROLES: readonly RefRole[] = ['logo', 'palette', 'typography', 'brand_rule']
/** The board a picture of this role belongs on: Characters, Locations, Products, else References. */
export const boardPurposeOfRole = (role: RefRole | undefined): BoardPurpose => (role && PURPOSE_OF[role]) || 'reference'
const TITLE: Record<string, string> = { character: 'Characters', location: 'Locations', reference: 'References', product: 'Products' }

/** The named pictures on the canvas by the board they belong on. */
export function picturesByPurpose(els: readonly CanvasElement[], doc: ProductionDocument): Map<BoardPurpose, CanvasElement[]> {
  const roleOf = new Map(keysList(doc).map((k) => [k.key, k.role]))
  const out = new Map<BoardPurpose, CanvasElement[]>()
  for (const r of refsList(doc)) {
    if (!r.node) continue
    const el = els.find((e) => !e.isDeleted && (e.id === r.node || (e.customData as { id?: string } | undefined)?.id === r.node))
    if (!el) continue
    const purpose = PURPOSE_OF[roleOf.get(r.key) ?? r.role ?? 'character'] ?? 'reference'
    const list = out.get(purpose) ?? []
    if (!list.includes(el)) list.push(el)
    out.set(purpose, list)
  }
  return out
}

export interface AdLayout {
  /** Board rects by purpose; picture boards only where they have pictures. */
  boards: Partial<Record<BoardPurpose, Rect>>
  /** The node cards' boxes. */
  nodes: Record<CardKind, Rect>
  pictures: Map<BoardPurpose, CanvasElement[]>
}

/** The template's layout round the pictures on the canvas (none: Script, Storyboard and Video only). */
export function adLayout(els: readonly CanvasElement[], doc: ProductionDocument): AdLayout {
  const pictures = picturesByPurpose(els, doc)
  const order: BoardPurpose[] = ['character', 'location', 'reference', 'product']
  const groups = order.flatMap((p) => {
    const hit = pictures.get(p)
    if (!hit?.length) return []
    const b = elementBounds(hit)
    return [{ id: p, title: TITLE[p], box: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } }]
  })
  const frames = boardFrames(groups)
  const boards: Partial<Record<BoardPurpose, Rect>> = {}
  for (const f of frames) boards[(f.holds === 'pictures' ? f.id : f.holds) as BoardPurpose] = f.rect
  const inside = (k: CardKind): Rect => {
    const r = boards[k]!
    return { x: r.x + CARD_INSET.x, y: r.y + CARD_INSET.top, ...CARD_SIZE[k] }
  }
  return { boards, nodes: { script: inside('script'), storyboard: inside('storyboard'), video: inside('video') }, pictures }
}
