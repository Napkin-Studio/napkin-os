// Boards as real frames (features/art-boards.clan; ui-behaviour 3.2, plan 2.4).
// Engine-neutral, through CanvasAdapter v2:
// - seedBoards: a canvas with no board gets the Ad template's seven boards, as the
//   document's boards[id]{title, purpose, rank} and as board frames, laid out as
//   production-ui's overlay drew them (mock Main, layout.ts): the Script board
//   wrapping the Script node, the picture boards wrapping the named pictures of
//   their role, the Storyboard and Video boards wrapping theirs. The nodes and
//   the pictures sit in their boards (parentId).
// - boardKey and jumpTo: ⌥1…⌥9 fit the board at that rank, ⌥0 fits everything.

import { ranksBetween } from '../../../../clan-store/src'
import type { Board, BoardPurpose, ProductionDocument } from '../../contracts/types'
import { newId } from '../../lib/ulid'
import type { CanvasAdapter, CanvasElement } from '../core/canvasAdapter'
import { cardOf } from '../nodes/nodes'
import type { CardKind } from '../nodes/cardChrome'
import { adLayout, CARD_INSET, CARD_SIZE } from './layout'

/** The Ad template (ui-behaviour 3.2; production-ui's boards.ts TEMPLATE). */
export const AD_TEMPLATE: readonly { key: string; title: string; purpose: BoardPurpose }[] = [
  { key: 'script', title: 'Script', purpose: 'script' },
  { key: 'characters', title: 'Characters', purpose: 'character' },
  { key: 'locations', title: 'Locations', purpose: 'location' },
  { key: 'references', title: 'References', purpose: 'reference' },
  { key: 'products', title: 'Products', purpose: 'product' },
  { key: 'storyboard', title: 'Storyboard', purpose: 'storyboard' },
  { key: 'video', title: 'Video', purpose: 'video' },
]

const GAP = 48
/** Empty picture boards (no pictures of their role yet). */
const PICTURE = { w: 420, h: 300 }

const tagOf = (e: CanvasElement) => e.customData as { kind?: string; id?: string } | undefined
export const isBoard = (e: CanvasElement) => !e.isDeleted && tagOf(e)?.kind === 'board'
export const boardIdOf = (e: CanvasElement) => (isBoard(e) ? tagOf(e)?.id ?? null : null)

/** The document's boards by rank. */
export const boardsByRank = (doc: ProductionDocument): Board[] =>
  Object.values(doc.boards ?? {}).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))

export interface SeededBoards {
  /** Document boards to create (none when the document already has them). */
  boards: Board[]
  /** The scene after seeding: board frames below everything, nodes in their boards. */
  apply(els: readonly CanvasElement[]): CanvasElement[]
}

/** The template's boards for a canvas with none; null when it already has boards. */
export function seedBoards(canvas: CanvasAdapter, doc: ProductionDocument): SeededBoards | null {
  const els = canvas.elements()
  if (els.some(isBoard)) return null
  const existing = boardsByRank(doc)
  const ranks = ranksBetween(null, null, AD_TEMPLATE.length)
  const boards: Board[] = existing.length
    ? []
    : AD_TEMPLATE.map((t, i) => ({ id: newId('board'), v: 1, field_v: {}, title: t.title, purpose: t.purpose, rank: ranks[i] }))
  const list = existing.length ? existing : boards
  const layout = adLayout(els, doc)
  const node = (kind: CardKind) => els.find((e) => cardOf(e)?.kind === kind)
  // A node's board: the card's inset round it (canvas.css .bl-card), as Main's frames.
  const around = (kind: CardKind) => {
    const e = node(kind)
    if (!e) return layout.boards[kind]
    const below = (layout.boards[kind]?.h ?? 0) - CARD_INSET.top - CARD_SIZE[kind].h
    return { x: e.x - CARD_INSET.x, y: e.y - CARD_INSET.top, w: e.width + CARD_INSET.x * 2, h: e.height + CARD_INSET.top + Math.max(CARD_INSET.x, below) }
  }
  // Picture boards wrap their pictures; one with none yet goes after the last on the top row.
  const rects: Partial<Record<BoardPurpose, { x: number; y: number; w: number; h: number }>> = {
    script: around('script'), storyboard: around('storyboard'), video: around('video'),
  }
  const top = rects.script!
  let right = Math.max(top.x + top.w, ...(['character', 'location', 'reference', 'product'] as const).flatMap((p) => (layout.boards[p] ? [layout.boards[p]!.x + layout.boards[p]!.w] : [])))
  for (const p of ['character', 'location', 'reference', 'product'] as const) {
    if (layout.boards[p]) rects[p] = layout.boards[p]
    else {
      rects[p] = { x: right + GAP, y: top.y, ...PICTURE }
      right += GAP + PICTURE.w
    }
  }
  const made = list.flatMap((b): [Board, CanvasElement][] => {
    const r = rects[b.purpose]
    return r ? [[b, canvas.board({ x: r.x, y: r.y, width: r.w, height: r.h, title: b.title, boardId: b.id, purpose: b.purpose })]] : []
  })
  const frames = made.map(([, f]) => f)
  const byPurpose = new Map(made.map(([b, f]) => [b.purpose, f]))
  const homeOf = new Map<string, CanvasElement>()
  for (const [p, pics] of layout.pictures) {
    const f = byPurpose.get(p)
    if (f) for (const e of pics) homeOf.set(e.id, f)
  }
  return {
    boards,
    apply: (all) => [
      ...frames,
      ...all.map((e) => {
        const c = cardOf(e)
        const home = c ? byPurpose.get(c.kind) : homeOf.get(e.id)
        return home ? canvas.patch(e, { frameId: home.id }) : e
      }),
    ],
  }
}

/** ⌥1…⌥9 (the board at that rank) or ⌥0 (everything), read from event.code; never while typing. */
export function boardKey(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'target'>): number | 'fit' | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null
  const m = /^Digit([0-9])$/.exec(e.code)
  if (!m) return null
  const t = e.target as { closest?: (s: string) => unknown } | null
  if (t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return null
  const n = Number(m[1])
  return n === 0 ? 'fit' : n - 1
}

/**
 * Fit the board at this rank (with what is on it), or everything. `inset`: screen pixels on the left
 * the chrome covers (the board rail), kept clear. Returns false when there is no such board.
 */
export function jumpTo(canvas: CanvasAdapter, doc: ProductionDocument, which: number | 'fit', animate = true, inset = 0): boolean {
  const els = canvas.elements()
  // Fit at most at 100%, centred in the part of the view right of the inset (production-ui's fitView):
  // measure the view, then fit a box made to come out at that zoom and place.
  const fit = (what: CanvasElement[]) => {
    canvas.fit(what, { zoomFactor: 0.9, animate: false })
    const z0 = canvas.view().zoom
    const vb = canvas.visibleBounds()
    const vw = (vb.maxX - vb.minX) * z0
    const vh = (vb.maxY - vb.minY) * z0
    const b = canvas.bounds(what)
    const z = Math.min(1, 0.9 * Math.min(Math.max(1, vw - inset) / Math.max(1, b.w), vh / Math.max(1, b.h)))
    const cx = b.minX + b.w / 2 - inset / 2 / z
    const cy = b.minY + b.h / 2
    const w = (0.9 * vw) / z
    const h = (0.9 * vh) / z
    const corner = (id: string, x: number, y: number): CanvasElement => ({ id, type: 'rectangle', x, y, width: 0, height: 0 })
    canvas.fit([corner('__fit_a', cx - w / 2, cy - h / 2), corner('__fit_b', cx + w / 2, cy + h / 2)], { zoomFactor: 0.9, animate })
  }
  if (which === 'fit') {
    // Bound links run between their ends; their own boxes say nothing about where they are.
    const placed = els.filter((e) => (e.customData as { kind?: string } | undefined)?.kind !== 'link')
    if (!placed.length) return false
    fit(placed)
    return true
  }
  const board = boardsByRank(doc)[which]
  const frame = board && els.find((e) => boardIdOf(e) === board.id)
  if (!frame) return false
  fit([frame])
  canvas.select([])
  return true
}
