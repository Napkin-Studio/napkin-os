// Boards as real frames (features/art-boards.clan; ui-behaviour 3.2, plan 2.4).
// Engine-neutral, through CanvasAdapter v2:
// - seedBoards: a canvas with no board gets the Ad template's seven boards, as the
//   document's boards[id]{title, purpose, rank} and as board frames, laid out as
//   production-ui's overlay drew them (mock Main): the Script board wrapping the
//   Script node, the four picture boards beside it, the Storyboard and Video
//   boards wrapping theirs. The nodes sit in their boards (parentId).
// - boardKey and jumpTo: ⌥1…⌥9 fit the board at that rank, ⌥0 fits everything.

import { ranksBetween } from '../../../../clan-store/src'
import type { Board, BoardPurpose, ProductionDocument } from '../../contracts/types'
import { newId } from '../../lib/ulid'
import type { CanvasAdapter, CanvasElement } from '../core/canvasAdapter'
import { cardOf } from '../nodes/nodes'

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

const PAD = 24
const TOP = 32
const PICTURE = { w: 420, h: 300 }
const GAP = 48

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
  const node = (kind: string) => els.find((e) => cardOf(e)?.kind === kind)
  const around = (e: CanvasElement | undefined, fallback: { x: number; y: number; w: number; h: number }) =>
    e ? { x: e.x - PAD, y: e.y - TOP, w: e.width + PAD * 2, h: e.height + TOP + PAD } : fallback
  const script = around(node('script'), { x: -PAD, y: -TOP, w: 388, h: 496 })
  const pictureAt = (i: number) => ({
    x: script.x + script.w + GAP + (i % 2) * (PICTURE.w + GAP),
    y: script.y + Math.floor(i / 2) * (PICTURE.h + GAP),
    ...PICTURE,
  })
  const below = Math.max(script.y + script.h, pictureAt(3).y + PICTURE.h) + GAP
  const rects: Record<BoardPurpose, { x: number; y: number; w: number; h: number } | undefined> = {
    script,
    character: pictureAt(0),
    location: pictureAt(1),
    reference: pictureAt(2),
    product: pictureAt(3),
    storyboard: around(node('storyboard'), { x: script.x, y: below, w: 800, h: 292 }),
    video: around(node('video'), { x: script.x + 848, y: below, w: 428, h: 292 }),
    sketches: undefined, brand: undefined, formats: undefined, none: undefined,
  }
  const made = list.flatMap((b): [Board, CanvasElement][] => {
    const r = rects[b.purpose]
    return r ? [[b, canvas.board({ x: r.x, y: r.y, width: r.w, height: r.h, title: b.title, boardId: b.id, purpose: b.purpose })]] : []
  })
  const frames = made.map(([, f]) => f)
  const byPurpose = new Map(made.map(([b, f]) => [b.purpose, f]))
  return {
    boards,
    apply: (all) => [
      ...frames,
      ...all.map((e) => {
        const c = cardOf(e)
        const home = c && (c.kind === 'script' || c.kind === 'storyboard' || c.kind === 'video') ? byPurpose.get(c.kind) : undefined
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

/** Fit the board at this rank (with what is on it), or everything. Returns false when there is no such board. */
export function jumpTo(canvas: CanvasAdapter, doc: ProductionDocument, which: number | 'fit', animate = true): boolean {
  const els = canvas.elements()
  if (which === 'fit') {
    if (!els.length) return false
    canvas.fit(els, { zoomFactor: 0.9, animate })
    return true
  }
  const board = boardsByRank(doc)[which]
  const frame = board && els.find((e) => boardIdOf(e) === board.id)
  if (!frame) return false
  canvas.fit([frame], { zoomFactor: 0.9, animate })
  canvas.select([])
  return true
}
