// Boards as real frames (features/art-boards.clan; ui-behaviour 3.2, plan 2.4).
// Engine-neutral, through CanvasAdapter v2:
// - A new project starts on an empty canvas (board-autolayout, owner 2026-10-15, BA2 = c): no
//   template, no boards. Boards are for collections of pictures, made by a person or by the
//   Gather nudge. Nodes never get a board.
// - seedBoards: an existing project whose document has boards but whose canvas has no frames for
//   them (made before the frames, or on Excalidraw) gets its frames, laid out as production-ui's
//   overlay drew them (mock Main, layout.ts): the Script board wrapping the Script node, the
//   picture boards wrapping the named pictures of their role, the Storyboard and Video boards
//   wrapping theirs. The nodes and the pictures sit in their boards (parentId).
// - railTargets, boardKey and jumpTo: the rail lists the nodes (Script, Storyboard, Video) and then
//   the boards by rank; ⌥1…⌥9 fit the row at that number, ⌥0 fits everything.

import { rankBetween } from '../../../../clan-store/src'
import { nearestFree } from '../../../../canvas-engine/src'
import type { Board, BoardPurpose, ProductionDocument } from '../../contracts/types'
import { newId } from '../../lib/ulid'
import type { CanvasAdapter, CanvasElement } from '../core/canvasAdapter'
import { cardOf } from '../nodes/nodes'
import { mainScript, mainStoryboard, mainVideo } from '../../model/selectors'
import type { CardKind } from '../nodes/cardChrome'
import { adLayout, CARD_INSET, CARD_SIZE } from './layout'

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
  /** The scene after seeding: board frames below everything, nodes in their boards. */
  apply(els: readonly CanvasElement[]): CanvasElement[]
}

/**
 * Frames for the document's boards on a canvas that has none (an existing project); null when the
 * canvas already has board frames or the document has no boards (a new project: an empty canvas).
 */
export function seedBoards(canvas: CanvasAdapter, doc: ProductionDocument): SeededBoards | null {
  const els = canvas.elements()
  if (els.some(isBoard)) return null
  const list = boardsByRank(doc)
  if (!list.length) return null
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

/** One row of the rail on the own engine: a node not held by a board, or a board on the canvas. */
export type RailTarget = { kind: 'node'; card: CardKind; el: CanvasElement } | { kind: 'board'; board: Board; el: CanvasElement }

const NODE_ORDER: readonly CardKind[] = ['script', 'storyboard', 'video']

/**
 * The nodes the rail lists, in Script, Storyboard, Video order: of each kind, the document's main one
 * if it is on the canvas, else the first made. A node held by a board is listed as its board instead.
 */
export function railNodes(els: readonly CanvasElement[], doc: ProductionDocument): { card: CardKind; el: CanvasElement }[] {
  const frames = new Set(els.filter(isBoard).map((e) => e.id))
  const main: Record<CardKind, string | undefined> = { script: mainScript(doc)?.id, storyboard: mainStoryboard(doc)?.id, video: mainVideo(doc)?.id }
  return NODE_ORDER.flatMap((card) => {
    const mine = els.filter((e) => cardOf(e)?.kind === card).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    const el = mine.find((e) => cardOf(e)!.id === main[card]) ?? mine[0]
    return el && !(el.frameId && frames.has(el.frameId)) ? [{ card, el }] : []
  })
}

/** The rail's rows in order, and so the ⌥ numbers: the loose nodes, then the boards on the canvas by rank. */
export function railTargets(els: readonly CanvasElement[], doc: ProductionDocument): RailTarget[] {
  const frameOf = new Map(els.flatMap((e) => (isBoard(e) ? [[boardIdOf(e)!, e] as const] : [])))
  return [
    ...railNodes(els, doc).map((n): RailTarget => ({ kind: 'node', ...n })),
    ...liveBoards(els, doc).map((b): RailTarget => ({ kind: 'board', board: b, el: frameOf.get(b.id)! })),
  ]
}

/** ⌥1…⌥9 (the rail row at that number) or ⌥0 (everything), read from event.code; never while typing. */
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
 * Fit the rail row at this number (a node, or a board with what is on it), an element by id, or
 * everything. `inset`: screen pixels on the left the chrome covers (the board rail), kept clear.
 * Returns false when there is no such row.
 */
export function jumpTo(canvas: CanvasAdapter, doc: ProductionDocument, which: number | 'fit' | { el: string }, animate = true, inset = 0): boolean {
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
  const target = typeof which === 'number' ? railTargets(els, doc)[which]?.el : els.find((e) => e.id === which.el && !e.isDeleted)
  if (!target) return false
  fit([target])
  canvas.select([])
  return true
}

/** The document's boards that are on the canvas now, by rank: the rail's rows and the ⌥ numbers. */
export function liveBoards(els: readonly CanvasElement[], doc: ProductionDocument): Board[] {
  const live = new Set(els.flatMap((e) => (isBoard(e) ? [boardIdOf(e)!] : [])))
  return boardsByRank(doc).filter((b) => live.has(b.id))
}

type FrameEl = CanvasElement & { name?: string; purpose?: string }

/**
 * Keep the document's boards in step with the board frames (ui-behaviour 3.2): a frame deleted takes
 * its board out of the document (and so out of the rail and the ⌥ numbers); one brought back by undo
 * puts the board back as it was; a frame renamed or given a purpose renames the board. `memory` is
 * every board this session has seen on the canvas, kept as last seen. Only boards seen this session
 * are removed or restored, so a board written before its frame lands is never touched.
 */
export function reconcileBoards(els: readonly CanvasElement[], doc: ProductionDocument, memory: Map<string, Board>): { remove: string[]; restore: Board[]; retitle: { id: string; title: string; purpose?: BoardPurpose }[] } {
  const live = new Map<string, FrameEl>()
  for (const e of els) {
    const id = boardIdOf(e)
    if (id) live.set(id, e as FrameEl)
  }
  const remove: string[] = []
  const restore: Board[] = []
  const retitle: { id: string; title: string; purpose?: BoardPurpose }[] = []
  for (const b of Object.values(doc.boards ?? {})) {
    const f = live.get(b.id)
    if (!f) {
      if (memory.has(b.id)) remove.push(b.id)
      continue
    }
    const title = typeof f.name === 'string' && f.name.trim() ? f.name.trim() : b.title
    const purpose = (f.purpose as BoardPurpose | undefined) ?? b.purpose
    memory.set(b.id, { ...b, title, purpose })
    if (title !== b.title || purpose !== b.purpose) retitle.push({ id: b.id, title, ...(purpose !== b.purpose ? { purpose } : {}) })
  }
  for (const [id] of live) {
    if (doc.boards?.[id]) continue
    const kept = memory.get(id)
    if (kept) restore.push(kept)
  }
  return { remove, restore, retitle }
}

/** What sits on a board: the live elements whose container is its frame. */
export function contentsOf(els: readonly CanvasElement[], frameId: string): CanvasElement[] {
  return els.filter((e) => !e.isDeleted && e.frameId === frameId)
}

/** A new board's size when it is made without a drag. */
export const NEW_BOARD = { w: 420, h: 300 }

/**
 * A new board ("+ New board", or the Board tool's drag; ui-behaviour 3.2): the document's board, last
 * in rank, and its frame at `rect`, else to the right of the boards on the top row. Not yet written.
 */
export function newBoard(canvas: CanvasAdapter, doc: ProductionDocument, opts: { rect?: { x: number; y: number; w: number; h: number }; title?: string; purpose?: BoardPurpose } = {}): { board: Board; frame: CanvasElement } {
  const els = canvas.elements()
  const last = boardsByRank(doc).at(-1)
  const board: Board = { id: newId('board'), v: 1, field_v: {}, title: opts.title ?? 'New board', purpose: opts.purpose ?? 'none', rank: rankBetween(last?.rank ?? null, null) }
  let r = opts.rect
  if (!r) {
    const frames = els.filter(isBoard)
    if (frames.length) {
      const top = Math.min(...frames.map((f) => f.y))
      const right = Math.max(...frames.map((f) => f.x + f.width))
      r = { x: right + GAP, y: top, ...NEW_BOARD }
    } else {
      // In the middle of the view, at the nearest spot clear of what is there (a new project's nodes).
      const v = canvas.visibleBounds()
      const mid = { x: (v.minX + v.maxX) / 2 - NEW_BOARD.w / 2, y: (v.minY + v.maxY) / 2 - NEW_BOARD.h / 2, ...NEW_BOARD }
      const kind = (e: CanvasElement) => (e.customData as { kind?: string } | undefined)?.kind
      const avoid = els.filter((e) => !e.isDeleted && !e.frameId && e.type !== 'arrow' && e.type !== 'line' && kind(e) !== 'link' && kind(e) !== 'provenance').map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height }))
      r = { ...mid, ...nearestFree(mid, avoid) }
    }
  }
  const frame = canvas.board({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h), title: board.title, boardId: board.id, purpose: board.purpose })
  return { board, frame }
}

/**
 * Delete boards as one undoable step (ui-behaviour 3.2): with `all`, what sits on them goes too (and
 * the links to it); without, it stays where it is, on no board. `also`: other elements deleted with them.
 */
export function deleteBoards(canvas: CanvasAdapter, frameIds: readonly string[], all: boolean, also: readonly string[] = []) {
  const frames = new Set(frameIds)
  canvas.transact((els) => {
    const gone = new Set([...frames, ...also])
    if (all) for (const e of els) if (!e.isDeleted && e.frameId && frames.has(e.frameId)) gone.add(e.id)
    // Links whose ends are going go with them.
    for (const e of els) {
      const ends = e as CanvasElement & { startBinding?: { elementId?: string } | null; endBinding?: { elementId?: string } | null }
      if ((ends.startBinding?.elementId && gone.has(ends.startBinding.elementId)) || (ends.endBinding?.elementId && gone.has(ends.endBinding.elementId))) gone.add(e.id)
    }
    return els.map((e) => {
      if (e.isDeleted) return e
      if (gone.has(e.id)) return canvas.patch(e, { isDeleted: true })
      return e.frameId && frames.has(e.frameId) ? canvas.patch(e, { frameId: null }) : e
    })
  }, { undoable: true })
  canvas.select([])
}

/** The purposes a board can have, with the words the picker shows (ui-behaviour 3.2). */
export const PURPOSES: readonly { purpose: BoardPurpose; label: string }[] = [
  { purpose: 'none', label: 'None' },
  { purpose: 'character', label: 'Characters' },
  { purpose: 'location', label: 'Locations' },
  { purpose: 'reference', label: 'References' },
  { purpose: 'product', label: 'Products' },
  { purpose: 'storyboard', label: 'Storyboard' },
  { purpose: 'video', label: 'Video' },
  { purpose: 'sketches', label: 'Sketches' },
  { purpose: 'brand', label: 'Brand' },
  { purpose: 'formats', label: 'Formats' },
]
