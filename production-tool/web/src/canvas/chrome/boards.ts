// The board rail's rows (ui-behaviour 3.2). One selector feeds the rail, so when art-boards puts
// board frames on the canvas only this source changes: rows come from doc.boards by rank when the
// project has any. Until then the rail lists the Ad template's seven boards with today's counts:
// the reference boards fit the canvas to their pictures; Script, Storyboard and Video open their
// editors, since their nodes are not on the canvas yet (features/production-ui.clan).

import type { BoardPurpose, ProductionDocument, RefRole } from '../../contracts/types'
import { keysList, refsList, shotsOf } from '../../model/selectors'

export type BoardTarget =
  | { kind: 'board'; id: string }
  /** A node on the canvas that no board holds (own engine): its element id. */
  | { kind: 'node'; id: string }
  | { kind: 'refs'; nodes: string[] }
  | { kind: 'open'; editor: 'script' | 'storyboard' | 'video' }

export interface BoardRow {
  id: string
  title: string
  /** "Characters · 3"; none when nothing is counted. */
  count?: number
  purpose: BoardPurpose
  target: BoardTarget
  /** Why the row cannot be used now, in words; absent when it can. */
  off?: string
}

const TEMPLATE: { id: string; title: string; purpose: BoardPurpose; roles?: RefRole[] | 'other' }[] = [
  { id: 'script', title: 'Script', purpose: 'script' },
  { id: 'characters', title: 'Characters', purpose: 'character', roles: ['character'] },
  { id: 'locations', title: 'Locations', purpose: 'location', roles: ['location'] },
  { id: 'references', title: 'References', purpose: 'reference', roles: 'other' },
  { id: 'products', title: 'Products', purpose: 'product', roles: ['product'] },
  { id: 'storyboard', title: 'Storyboard', purpose: 'storyboard' },
  { id: 'video', title: 'Video', purpose: 'video' },
]
const OWN: RefRole[] = ['character', 'location', 'product']
const PICTURE_BOARDS: BoardPurpose[] = ['character', 'location', 'reference', 'product']

/** A node the rail lists (own engine): its kind and its element; see boards/boards.ts railNodes. */
export interface RailNode {
  card: 'script' | 'storyboard' | 'video'
  elId: string
}
const NODE_TITLE: Record<RailNode['card'], string> = { script: 'Script', storyboard: 'Storyboard', video: 'Video' }

/**
 * The rail's rows. `frames`: the canvas has the boards as real frames (our own engine, art-boards),
 * so the rows are the loose nodes (`nodes`: Script, Storyboard, Video, those no board holds) and
 * then doc.boards by rank, each board counting what sits in its frame (`counts`, by board id). A new
 * project has no boards: its rows are its nodes. Otherwise (Excalidraw) the Ad template's rows,
 * whatever doc.boards holds.
 */
export function boardRows(doc: ProductionDocument, frames = false, counts: Record<string, number> = {}, nodes: readonly RailNode[] = []): BoardRow[] {
  const boards = Object.values(doc.boards ?? {}).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
  if (frames) {
    const shots = shotsOf(doc).length
    return [
      ...nodes.map((n): BoardRow => ({ id: n.elId, title: NODE_TITLE[n.card], purpose: n.card, count: (n.card === 'storyboard' && shots) || undefined, target: { kind: 'node', id: n.elId } })),
      ...boards.map((b): BoardRow => {
        const count = b.purpose === 'storyboard' ? shots : PICTURE_BOARDS.includes(b.purpose) ? counts[b.id] ?? 0 : 0
        return { id: b.id, title: b.title, purpose: b.purpose, count: count || undefined, target: { kind: 'board', id: b.id } }
      }),
    ]
  }
  const roleOf = new Map(keysList(doc).map((k) => [k.key, k.role]))
  const refs = refsList(doc)
  const shots = shotsOf(doc).length
  return TEMPLATE.map((t): BoardRow => {
    if (t.roles) {
      const mine = refs.filter((r) => {
        const role = roleOf.get(r.key) ?? 'character'
        return t.roles === 'other' ? !OWN.includes(role) : t.roles!.includes(role)
      })
      const nodes = mine.flatMap((r) => (r.node ? [r.node] : []))
      return { id: t.id, title: t.title, purpose: t.purpose, count: mine.length || undefined, target: { kind: 'refs', nodes },
        off: nodes.length ? undefined : `No ${t.title.toLowerCase()} named yet` }
    }
    if (t.id === 'storyboard') return { id: t.id, title: t.title, purpose: t.purpose, count: shots || undefined, target: { kind: 'open', editor: 'storyboard' } }
    return { id: t.id, title: t.title, purpose: t.purpose, target: { kind: 'open', editor: t.id as 'script' | 'video' } }
  })
}

/** "Characters · 3". */
export const rowLabel = (r: Pick<BoardRow, 'title' | 'count'>) => (r.count ? `${r.title} · ${r.count}` : r.title)

// ── Board frames on today's canvas (mock Main) ─────────────────────────────

/** A board drawn over the canvas: its scene box, its title, and what it holds. */
export interface BoardFrame {
  id: string
  title: string
  rect: { x: number; y: number; w: number; h: number }
  /** Script, Storyboard and Video boards hold their node card; the others wrap their pictures. */
  holds: 'script' | 'storyboard' | 'video' | 'pictures'
}

type Box = { minX: number; minY: number; maxX: number; maxY: number }
const PAD = 16
const TOP = 22
const FOOT = 34
/** Main's sizes: the Script board, the Storyboard board and the Video board. */
const SCRIPT = { w: 340, h: 440 }
const STORY = { w: 752, h: 236 }
const VIDEO = { w: 380, h: 236 }
const GAP = 32

/**
 * Where the boards sit (mock Main), from what is on the canvas: a picture board wraps the pictures of
 * its role; the Script board stands to the left of them, the Storyboard below, the Video to the
 * Storyboard's right. Derived on every draw and never written: art-boards will make them real frames.
 * `groups` are the picture boards with pictures, each with the box of its pictures.
 */
export function boardFrames(groups: { id: string; title: string; box: Box }[]): BoardFrame[] {
  const frames: BoardFrame[] = groups.map((g) => ({
    id: g.id, title: g.title, holds: 'pictures' as const,
    rect: { x: g.box.minX - PAD, y: g.box.minY - TOP, w: g.box.maxX - g.box.minX + PAD * 2, h: g.box.maxY - g.box.minY + TOP + FOOT },
  }))
  const all = frames.length
    ? frames.reduce((b, f) => ({ minX: Math.min(b.minX, f.rect.x), minY: Math.min(b.minY, f.rect.y), maxX: Math.max(b.maxX, f.rect.x + f.rect.w), maxY: Math.max(b.maxY, f.rect.y + f.rect.h) }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    : { minX: SCRIPT.w + GAP, minY: 0, maxX: SCRIPT.w + GAP, maxY: SCRIPT.h }
  const script = { x: all.minX - GAP - SCRIPT.w, y: all.minY, ...SCRIPT }
  const below = Math.max(all.maxY, script.y + script.h) + 48
  return [
    { id: 'script', title: 'Script', holds: 'script', rect: script },
    ...frames,
    { id: 'storyboard', title: 'Storyboard', holds: 'storyboard', rect: { x: script.x, y: below, ...STORY } },
    { id: 'video', title: 'Video', holds: 'video', rect: { x: script.x + STORY.w + 24, y: below, ...VIDEO } },
  ]
}
