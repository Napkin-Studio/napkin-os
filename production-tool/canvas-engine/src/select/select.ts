// The select tool (features/engine-select.clan): DOM-free, driven by the input
// router's press, drag and release in scene coordinates.
//
// - A click selects the topmost element there, with its whole outermost group
//   (groupIds run innermost to outermost, as Excalidraw's and core/nodes.ts read
//   them); shift-click adds or removes it. A double-click on a member of a group picks
//   that member alone (pickOne, as Excalidraw enters a group), so one view of a
//   character can be named or linked on its own.
// - Group adds a new outermost group to the selection and Ungroup takes the
//   outermost one off, each one undoable step (canvas-edit-tools; ui-behaviour 3.8).
// - A press on empty space starts a marquee (mouse, touch) or a lasso (pen); at
//   release it selects what lies inside (the whole box for a marquee, the centre
//   for a lasso), added to the selection with shift.
// - A drag on a corner handle scales the selection round the opposite corner, one
//   scale for both axes, so a group scales as one and a sketch area keeps its
//   ratio (ui-behaviour 3.7: only the ratio picker changes it). Nodes, boards and
//   links have no handles.
// - A drag that starts on the selection moves it: the movement is a preview the
//   renderer draws (nothing is written to Y while dragging), then one undoable
//   step at release. Locked elements are selected but never moved or deleted.
// - Boards are spaces (owner decision 2026-10-15; boards/sizing.ts). A thing dropped onto a board from
//   outside stays where it was dropped when that is inside and on nothing; else it goes in the board's
//   next free slot, the board growing toward free canvas, or, when the board is hemmed in, just outside
//   it ("Board is full"). Moved within its board and left sticking out, the board grows to hold it.
//   A selected board has edge and corner handles: a drag resizes it (never through a member; members
//   whose centre the edge passed leave the board), one step. Fit to contents is fitBoard.
// - What a press takes is one table, grabOrder (features/board-move.clan), read top to bottom: the first
//   row whose test finds something starts its gesture. Features that change the press priority add rows
//   to it (container-select: a drawn frame or a sketch area before its strokes; board-autolayout:
//   re-ordering on an auto board), never branches in press(). grabbableAt reads the same table, so a
//   finger's long press grabs exactly what a mouse press would move.
// - Boards (owner answers BM1-BM7, 2026-10-15): the title chip and the edge move a board, selected or
//   not; its inside moves it once it is selected, and a click under the slop on an unselected board's
//   inside selects it, while a drag there marquees (or lassoes, with the pen). Resize is only from the
//   square handles, and never grows within BOARD_CLEAR of a neighbour. A moved board lands at the nearest
//   spot clear of other boards and loose things (`landing` shows it while dragging), in the move's step.
// - Arrow keys nudge (nudge, flushNudge): a preview like a drag, one step when flushed; a board stops
//   at BOARD_CLEAR from what is in its way.
// - A locked container is selected but never moved, and nothing in it moves with it.

import { recordBounds, unionRects, type Rect } from '../model/bounds'
import { boundEnds } from '../render/links'
import { BlockerIndex, BOARD_CLEAR, clampGrowth, clampMove, containsRect, fitRect, freeOffset, growToHold, innerRect, overlaps, placeInBoard, resizeRect, type Edge } from '../boards/sizing'
import { boardGrabAt, type BoardGrab } from '../boards/grab'
import type { PointerKind } from '../input/router'
import type { ElementRecord } from '../model/records'
import type { SceneStore } from '../model/store'

export interface Pt {
  x: number
  y: number
}

export interface MovePreview {
  ids: ReadonlySet<string>
  dx: number
  dy: number
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** A scale being dragged: every id round (ox, oy) by s. Drawn by the renderer, written at release. */
export interface ScalePreview {
  ids: ReadonlySet<string>
  ox: number
  oy: number
  s: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A board being resized by a handle: drawn at `rect`, written at release. */
export interface BoardResize {
  id: string
  edge: Edge
  rect: Box
  /** The members whose centre the dragged edge has passed: they leave at release. */
  leaving: string[]
}

/** What a board did that the person should hear about: it was full (a thing landed outside), or things left it on a resize. */
export type BoardEvent = { kind: 'full'; board: string; ids: string[] } | { kind: 'left'; board: string; ids: string[] }

/** A press that moves less than this (screen pixels) before release is a click (a board's inside selects it). */
export const CLICK_SLOP_PX = 4
/** A square handle on touch is at least this big (screen pixels): a finger's reach. */
export const TOUCH_HANDLE_PX = 44

/** What one press found, for the row that takes it. */
export interface PressAt {
  p: Pt
  zoom: number
  shift: boolean
  by: PointerKind
}

/**
 * One row of the press priority (grabOrder). `test` looks without changing anything and returns what it
 * found, or null; `start` begins the row's gesture with it. `moves` says whether the gesture picks
 * something up (a finger's long press grabs only those).
 */
export interface GrabRow<T = unknown> {
  name: string
  /** What the row means, for people reading the table (ui-behaviour 3.2 says the same). */
  says: string
  test(tool: SelectTool, at: PressAt): T | null
  start(tool: SelectTool, found: T, at: PressAt): void
  moves(found: T, tool: SelectTool): boolean
}

const row = <T>(r: GrabRow<T>) => r as unknown as GrabRow

const boardAt = (tool: SelectTool, at: PressAt, part: BoardGrab['part']) => {
  const g = tool.boardGrab(at)
  return g?.part === part ? g.board : null
}

/**
 * The press priority, top to bottom: the first row that finds something takes the press. Shared by
 * board-move (item 5), container-select (item 8) and board-autolayout (item 7): each adds or moves rows
 * here, with a test per row in test/grabOrder.test.ts, instead of branching in press().
 */
export const grabOrder: GrabRow[] = [
  row<Edge>({
    name: 'board-handle',
    says: 'A selected board’s square handles (corners and edge middles) resize it.',
    test: (t, at) => (at.shift ? null : t.boardHandleAt(at.p, at.zoom, at.by)),
    start: (t, edge) => t.startResize(edge),
    moves: () => true,
  }),
  row<Corner>({
    name: 'scale-handle',
    says: 'The selection’s corner handles scale it (not nodes, boards or links).',
    test: (t, at) => (at.shift ? null : t.handleAt(at.p, at.zoom)),
    start: (t, corner) => t.startScale(corner),
    moves: () => true,
  }),
  row<ElementRecord>({
    name: 'node-or-link',
    says: 'A node card, or a link along its line, is picked (it sits above the canvas).',
    test: (t, at) => t.hitAbove(at.p) ?? null,
    start: (t, hit, at) => t.startPick(hit, at),
    moves: () => true,
  }),
  row<ElementRecord>({
    name: 'board-title',
    says: 'A board’s title chip picks the board up, with everything on it.',
    test: (t, at) => boardAt(t, at, 'title'),
    start: (t, b, at) => t.startPick(b, at),
    moves: () => true,
  }),
  row<ElementRecord>({
    name: 'element',
    says: 'The topmost element (picture, ink, shape, text, drawn frame, sketch area) is picked with its group.',
    test: (t, at) => t.hitElement(at.p) ?? null,
    start: (t, hit, at) => t.startPick(hit, at),
    moves: () => true,
  }),
  row<ElementRecord>({
    name: 'board-edge',
    says: 'Within 6 px of a board’s frame line, selected or not, picks the board up.',
    test: (t, at) => boardAt(t, at, 'edge'),
    start: (t, b, at) => t.startPick(b, at),
    moves: () => true,
  }),
  row<ElementRecord>({
    name: 'board-inside-selected',
    says: 'The empty inside of a selected board moves the selection.',
    test: (t, at) => {
      const b = at.shift ? null : boardAt(t, at, 'inside')
      return b && t.selected.has(b.id) ? b : null
    },
    start: (t, _b, at) => t.startMove(at.p),
    moves: () => true,
  }),
  row<ElementRecord>({
    name: 'board-inside',
    says: 'The empty inside of an unselected board: a drag marquees (the pen lassoes); a click under the slop selects the board.',
    test: (t, at) => boardAt(t, at, 'inside'),
    start: (t, b, at) => t.startArea(at, b.id),
    moves: () => false,
  }),
  row<true>({
    name: 'empty',
    says: 'Empty canvas: a drag marquees (the pen lassoes); a click clears the selection.',
    test: () => true,
    start: (t, _x, at) => t.startArea(at, null),
    moves: () => false,
  }),
]

/** Kinds that never block a board's growth: they follow their ends, or are boards' own business. */
const NO_BLOCK = new Set(['link', 'arrow'])

/** The handles sit this far (screen pixels) outside the box's corners, where the renderer draws them. */
export const HANDLE_PAD = 6
/** How near a handle's centre (screen pixels) a press takes it. */
export const HANDLE_PX = 7
/** Kinds the handles never scale: their size is the card's or the board's, or they follow their ends. */
const UNSCALED = new Set(['node', 'board', 'link'])

/** A ratio 'w:h' as a number, or null. */
export function ratioValue(ratio: unknown): number | null {
  if (typeof ratio !== 'string') return null
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio)
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null
}

const isArea = (r: ElementRecord) => r.kind === 'sketch' || r.customData?.kind === 'sketch'

/** A record scaled round (ox, oy); a sketch area's height then follows its ratio exactly. */
export function scaled(r: ElementRecord, ox: number, oy: number, s: number, ratio: number | null = null): ElementRecord {
  const w = r.w * s
  const h = ratio ? w / ratio : r.h * s
  return { ...r, x: ox + (r.x - ox) * s, y: oy + (r.y - oy) * s, w, h }
}

/** The box round records as drawn: a turned one by its turned corners, a stacked photo with its edge (a whole pile). */
const boxOfAll = (rs: readonly ElementRecord[]): Box => unionRects(rs.map(recordBounds))

const centre = (r: ElementRecord): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Is p inside the polygon (even-odd)? */
export function inPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export class SelectTool {
  private readonly scene: SceneStore
  private readonly hit: (x: number, y: number) => ElementRecord | undefined
  selected = new Set<string>()
  preview: MovePreview | null = null
  marquee: { x0: number; y0: number; x1: number; y1: number } | null = null
  lasso: Pt[] | null = null
  scaling: ScalePreview | null = null
  resizing: BoardResize | null = null
  private resizeUnits: { ids: string[]; rect: Rect }[] = []
  private readonly boardCbs = new Set<(e: BoardEvent) => void>()
  private scaleFrom: { box: Box; ox: number; oy: number } | null = null
  private dragFrom: Pt | null = null
  private additive = false
  private readonly cbs = new Set<() => void>()
  private readonly newId: () => string

  private readonly above: ((x: number, y: number) => ElementRecord | undefined) | undefined

  /**
   * `hit`: the topmost element at a scene point (the renderer's index). `above`: what sits above the
   * canvas and comes first (node cards, links along their line). Boards are found by boards/grab.
   */
  constructor(scene: SceneStore, hit: (x: number, y: number) => ElementRecord | undefined, opts: { newId?: () => string; above?: (x: number, y: number) => ElementRecord | undefined } = {}) {
    this.scene = scene
    this.hit = hit
    this.above = opts.above
    this.newId = opts.newId ?? (() => `group_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
  }

  onChange(cb: () => void): () => void {
    this.cbs.add(cb)
    return () => void this.cbs.delete(cb)
  }

  private changed() {
    for (const cb of this.cbs) cb()
  }

  /** Hear when a board was full or things left it (the host says so, with Undo). */
  onBoard(cb: (e: BoardEvent) => void): () => void {
    this.boardCbs.add(cb)
    return () => void this.boardCbs.delete(cb)
  }

  private tell(e: BoardEvent) {
    for (const cb of this.boardCbs) cb(e)
  }

  // ── boards as spaces (owner decision 2026-10-15) ──

  /** The one board selected (nothing else, not locked), or null: it gets the resize handles. */
  soleBoard(): ElementRecord | null {
    if (this.selected.size !== 1) return null
    const r = this.scene.get([...this.selected][0])
    return r && r.kind === 'board' && !r.locked ? r : null
  }

  /** What is on a board, a group as one unit, each with its box (positions as `at` has them). */
  boardUnits(boardId: string, at: ReadonlyMap<string, ElementRecord> = new Map()): { ids: string[]; rect: Rect }[] {
    const by = new Map<string, ElementRecord[]>()
    for (const r0 of this.scene.all()) {
      const r = at.get(r0.id) ?? r0
      if (r.parentId !== boardId || NO_BLOCK.has(r.kind)) continue
      const key = r.groupIds.at(-1) ?? `#${r.id}`
      by.set(key, [...(by.get(key) ?? []), r])
    }
    return [...by.values()].map((rs) => ({ ids: rs.map((r) => r.id), rect: unionRects(rs.map(recordBounds)) }))
  }

  /** What a board must not grow onto: the other boards and loose things (not links), except `skip`. */
  private blockers(boardId: string, skip: ReadonlySet<string>, at: ReadonlyMap<string, ElementRecord> = new Map()): Rect[] {
    const out: Rect[] = []
    for (const r0 of this.scene.all()) {
      const r = at.get(r0.id) ?? r0
      if (r.id === boardId || skip.has(r.id) || NO_BLOCK.has(r.kind)) continue
      if (r.kind === 'board' ? r.parentId !== boardId : r.parentId === null) out.push(recordBounds(r))
    }
    return out
  }

  /**
   * The square handle of the selected board at a scene point, or null: its corners and the middles of
   * its edges (owner BM6: the rest of the edge moves the board). HANDLE_PX on screen; on touch, half of
   * TOUCH_HANDLE_PX, so the handle is a finger's size.
   */
  boardHandleAt(p: Pt, zoom: number, by: PointerKind = 'mouse'): Edge | null {
    const b = this.soleBoard()
    if (!b) return null
    const reach = (by === 'touch' ? Math.max(HANDLE_PX, TOUCH_HANDLE_PX / 2) : HANDLE_PX) / zoom
    const { x, y, w, h } = this.resizing?.rect ?? b
    const squares: [Edge, number, number][] = [
      ['nw', x, y], ['ne', x + w, y], ['sw', x, y + h], ['se', x + w, y + h],
      ['n', x + w / 2, y], ['s', x + w / 2, y + h], ['w', x, y + h / 2], ['e', x + w, y + h / 2],
    ]
    return squares.find(([, cx, cy]) => Math.abs(p.x - cx) <= reach && Math.abs(p.y - cy) <= reach)?.[0] ?? null
  }

  /** Fit to contents: the board round what is on it with its padding, one step. False when nothing changes. */
  fitBoard(id: string): boolean {
    const b = this.scene.get(id)
    if (!b || b.kind !== 'board' || b.locked) return false
    const units = this.boardUnits(id)
    if (!units.length) return false
    const r = fitRect(b, units.map((u) => u.rect))
    if (r.x === b.x && r.y === b.y && r.w === b.w && r.h === b.h) return false
    this.scene.change((tx) => tx.put([{ ...tx.get(id)!, ...r }]))
    this.changed()
    return true
  }

  /**
   * The moved things that are now on a board, fitted to it as the owner's rules say: `placed` (id → the
   * record as it is about to be written) gets their final places and parents, and the boards' new boxes.
   */
  private fitToBoards(placed: Map<string, ElementRecord>, carried: ReadonlySet<string>, before: (id: string) => ElementRecord | undefined): BoardEvent[] {
    const events: BoardEvent[] = []
    const units = new Map<string, ElementRecord[]>()
    for (const r of placed.values()) {
      if (carried.has(r.id) || r.kind === 'board' || !r.parentId) continue
      const parent = placed.get(r.parentId) ?? before(r.parentId)
      if (parent?.kind !== 'board') continue
      const key = `${r.parentId} ${r.groupIds.at(-1) ?? `#${r.id}`}`
      units.set(key, [...(units.get(key) ?? []), r])
    }
    for (const rs of units.values()) {
      const boardId = rs[0].parentId!
      const board = placed.get(boardId) ?? before(boardId)!
      const ids = new Set<string>(rs.map((r) => r.id))
      const rect = unionRects(rs.map(recordBounds))
      const occupied = this.boardUnits(boardId, placed).filter((u) => !u.ids.some((id) => ids.has(id))).map((u) => u.rect)
      // What is in the unit (a sketch area's ink) comes with it: it never blocks its own board's growth.
      const blockers = this.blockers(boardId, this.withMembers(ids), placed)
      const joined = rs.some((r) => before(r.id)?.parentId !== boardId)
      const inner = innerRect(board)
      if (containsRect(inner, rect) && (!joined || !occupied.some((o) => overlaps(rect, o)))) continue
      if (!joined) {
        const g = growToHold(board, [rect], blockers)
        if (g) {
          placed.set(boardId, { ...board, ...g })
          continue
        }
      }
      const p = placeInBoard(board, occupied, { w: rect.w, h: rect.h }, blockers)
      const dx = p.box.x - rect.x
      const dy = p.box.y - rect.y
      for (const r of rs) placed.set(r.id, { ...r, x: r.x + dx, y: r.y + dy, parentId: p.full ? null : boardId })
      // What is in the unit (a drawn frame's strokes, a sketch area's ink) goes with it, in the same step.
      for (const id of this.withMembers(ids)) {
        if (ids.has(id)) continue
        const m = placed.get(id) ?? before(id)
        if (m && !m.locked) placed.set(id, { ...m, x: m.x + dx, y: m.y + dy })
      }
      if (p.full) events.push({ kind: 'full', board: boardId, ids: [...ids] })
      else if (p.board !== board) placed.set(boardId, { ...board, ...p.board })
    }
    return events
  }

  /** An element and the rest of its outermost group (the last of its groupIds). */
  private withGroup(r: ElementRecord): string[] {
    const g = r.groupIds.at(-1)
    if (!g) return [r.id]
    return this.scene.all().filter((x) => x.groupIds.includes(g)).map((x) => x.id)
  }

  /** The selection's units: each outermost group once, and each ungrouped element. */
  private units(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const id of this.selected) {
      const r = this.scene.get(id)
      if (!r) continue
      const key = r.groupIds.at(-1) ?? `#${id}`
      out.set(key, [...(out.get(key) ?? []), id])
    }
    return out
  }

  /** What is selected: nothing, one thing, one whole group (ink when all its members are pen strokes), or several things. */
  selectionKind(): { kind: 'none' } | { kind: 'one' } | { kind: 'group'; group: string; ink: boolean; count: number } | { kind: 'several'; count: number } {
    const units = this.units()
    if (!units.size) return { kind: 'none' }
    if (units.size > 1) return { kind: 'several', count: units.size }
    const [[key, ids]] = [...units]
    if (key.startsWith('#')) return { kind: 'one' }
    const members = this.scene.all().filter((r) => r.groupIds.includes(key))
    const ink = members.every((r) => r.kind === 'stroke' && r.props.tool !== 'highlighter')
    return { kind: 'group', group: key, ink, count: Math.max(ids.length, members.length) }
  }

  /** Group the selection (two or more things) under a new outermost group, as one step. Returns its id, or null. */
  group(): string | null {
    if (this.units().size < 2) return null
    const g = this.newId()
    const recs = [...this.selected].map((id) => this.scene.get(id)).filter((r): r is ElementRecord => !!r && !r.locked)
    if (recs.length < 2) return null
    this.scene.change((tx) => tx.put(recs.map((r) => ({ ...r, groupIds: [...r.groupIds, g] }))))
    this.changed()
    return g
  }

  /** Take the outermost group off the selected elements, as one step. False when nothing was grouped. */
  ungroup(): boolean {
    const recs = [...this.selected].map((id) => this.scene.get(id)).filter((r): r is ElementRecord => !!r && !r.locked && r.groupIds.length > 0)
    if (!recs.length) return false
    this.scene.change((tx) => tx.put(recs.map((r) => ({ ...r, groupIds: r.groupIds.slice(0, -1) }))))
    this.changed()
    return true
  }

  /**
   * What sits in each container: its children by parentId (a board's members, a drawn frame's strokes),
   * and for a sketch area its strokes by geometry (web core/sketch.ts membersOf: untagged strokes and
   * shapes whose box meets it, not inside another frame). One rule for everything that moves a container.
   */
  private membersByContainer(): Map<string, string[]> {
    const kids = new Map<string, string[]>()
    const all = this.scene.all()
    for (const r of all) if (r.parentId) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r.id])
    // Loose ink lying wholly on a board (drawn before ink joined boards) goes with it.
    const boards = all.filter((r) => r.kind === 'board')
    if (boards.length) {
      for (const r of all) {
        if (r.kind !== 'stroke' || r.parentId !== null || r.customData) continue
        const rb = recordBounds(r)
        const on = boards.filter((b) => containsRect(recordBounds(b), rb)).sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0))[0]
        if (on) kids.set(on.id, [...(kids.get(on.id) ?? []), r.id])
      }
    }
    const areas = all.filter(isArea)
    if (areas.length) {
      const loose = all.filter((r) => (r.kind === 'stroke' || r.kind === 'shape') && !r.customData && (!r.parentId || this.scene.get(r.parentId)?.kind === 'board'))
      for (const a of areas) {
        const box = recordBounds(a)
        for (const r of loose) if (overlaps(recordBounds(r), box, 1e-6)) kids.set(a.id, [...(kids.get(a.id) ?? []), r.id])
      }
    }
    return kids
  }

  /** The ids and everything in the containers among them (boards, drawn frames, sketch areas), at any depth. */
  private withMembers(ids: Iterable<string>): Set<string> {
    const out = new Set(ids)
    const kids = this.membersByContainer()
    const todo = [...out]
    while (todo.length) {
      const id = todo.pop()!
      // A locked container never carries what is in it.
      if (this.scene.get(id)?.locked) continue
      for (const k of kids.get(id) ?? []) if (!out.has(k)) {
        out.add(k)
        todo.push(k)
      }
    }
    return out
  }

  /** The topmost board under a point, other than `self` (positions as they are about to be). */
  private containerAt(p: Pt, self: string, placed: ReadonlyMap<string, ElementRecord>): string | null {
    const boards = this.scene.all().filter((r) => r.kind === 'board' && r.id !== self).map((r) => placed.get(r.id) ?? r)
    const hit = boards.filter((b) => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h).sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0))[0]
    return hit?.id ?? null
  }

  /** The topmost element at a point, alone, even when it is in a group (a double-click). Its id, or null. */
  pickOne(p: Pt): string | null {
    const hit = this.hitAbove(p) ?? this.hitElement(p)
    if (!hit) return null
    this.selected = new Set([hit.id])
    this.changed()
    return hit.id
  }

  set(ids: Iterable<string>) {
    this.selected = new Set(ids)
    this.changed()
  }

  /** The selected records, as they are drawn now (moved or scaled while a drag runs). */
  private shown(): ElementRecord[] {
    const out: ElementRecord[] = []
    for (const id of this.selected) {
      const r = this.scene.get(id)
      if (!r) continue
      const sc = this.scaling
      if (sc?.ids.has(id)) out.push(scaled(r, sc.ox, sc.oy, sc.s))
      else if (this.preview?.ids.has(id)) out.push({ ...r, x: r.x + this.preview.dx, y: r.y + this.preview.dy })
      else out.push(r)
    }
    return out
  }

  /** The box round the selection, and whether its handles scale it (no node, board or link in it), or null. */
  frame(): { box: Box; scalable: boolean } | null {
    // Links and bound arrows follow their ends: their stored box is not where they are drawn (inside a
    // closed pile they are not drawn at all), so they neither make the frame nor get handles.
    const rs = this.shown().filter((r) => r.kind !== 'link' && !(r.kind === 'arrow' && boundEnds((id) => this.scene.get(id), r)))
    if (!rs.length) return null
    return { box: boxOfAll(rs), scalable: rs.every((r) => !UNSCALED.has(r.kind)) && rs.some((r) => !r.locked) }
  }

  /** The corner handle at a scene point (HANDLE_PX on screen at this zoom), when the selection can be scaled. */
  handleAt(p: Pt, zoom: number): Corner | null {
    const f = this.frame()
    if (!f?.scalable) return null
    const reach = HANDLE_PX / zoom
    const d = HANDLE_PAD / zoom
    const { x, y, w, h } = f.box
    const corners: [Corner, number, number][] = [['nw', x - d, y - d], ['ne', x + w + d, y - d], ['sw', x - d, y + h + d], ['se', x + w + d, y + h + d]]
    return corners.find(([, cx, cy]) => Math.abs(p.x - cx) <= reach && Math.abs(p.y - cy) <= reach)?.[0] ?? null
  }

  /** What a press at `p` would take: the first row of grabOrder that finds something, and what it found. */
  resolve(at: PressAt): { row: GrabRow; found: unknown } {
    this.grabCache = null
    for (const r of grabOrder) {
      const found = r.test(this, at)
      if (found !== null && found !== undefined) return { row: r, found }
    }
    throw new Error('grabOrder has no row for an empty press')
  }

  /** Would a press here pick something up (move, resize or scale it)? A finger's long press grabs only then. */
  grabbableAt(p: Pt, zoom: number): boolean {
    const at: PressAt = { p, zoom, shift: false, by: 'touch' }
    const { row: r, found } = this.resolve(at)
    return r.moves(found, this)
  }

  press(p: Pt, opts: { shift?: boolean; by?: PointerKind; zoom?: number } = {}) {
    this.flushNudge()
    const at: PressAt = { p, zoom: opts.zoom ?? 1, shift: !!opts.shift, by: opts.by ?? 'mouse' }
    const { row: r, found } = this.resolve(at)
    this.pressed = r.name
    r.start(this, found, at)
    this.changed()
  }

  /** The row of grabOrder that took the last press (for tests and cursors). */
  pressed: string | null = null

  // ── what grabOrder's rows test and start (not for other callers) ──

  private grabCache: { key: string; g: BoardGrab | undefined } | null = null

  /** The board a press takes, by its title, edge or inside (boards/grab), once per press. */
  boardGrab(at: PressAt): BoardGrab | undefined {
    const key = `${at.p.x},${at.p.y},${at.zoom}`
    if (this.grabCache?.key !== key) this.grabCache = { key, g: boardGrabAt(this.scene, at.p, at.zoom) }
    return this.grabCache.g
  }

  /** A node card or a link under a point (they sit above the canvas). */
  hitAbove(p: Pt): ElementRecord | undefined {
    return this.above?.(p.x, p.y)
  }

  /** The topmost element under a point (never a board: boards are taken by boardGrab). */
  hitElement(p: Pt): ElementRecord | undefined {
    const r = this.hit(p.x, p.y)
    return r && r.kind !== 'board' ? r : undefined
  }

  startResize(edge: Edge) {
    const board = this.soleBoard()!
    this.resizeUnits = this.boardUnits(board.id)
    this.resizeBlockers = this.blockers(board.id, new Set())
    this.resizing = { id: board.id, edge, rect: { x: board.x, y: board.y, w: board.w, h: board.h }, leaving: [] }
  }

  startScale(corner: Corner) {
    const box = this.frame()!.box
    const ox = corner === 'nw' || corner === 'sw' ? box.x + box.w : box.x
    const oy = corner === 'nw' || corner === 'ne' ? box.y + box.h : box.y
    this.scaleFrom = { box, ox, oy }
    this.scaling = { ids: new Set(this.selected), ox, oy, s: 1 }
  }

  /** A press on a thing: select it with its outermost group (shift adds or removes), then move the selection. */
  startPick(hit: ElementRecord, at: PressAt) {
    const ids = this.withGroup(hit)
    if (at.shift) {
      const on = this.selected.has(hit.id)
      for (const id of ids) {
        if (on) this.selected.delete(id)
        else this.selected.add(id)
      }
    } else if (!this.selected.has(hit.id)) this.selected = new Set(ids)
    if (this.selected.has(hit.id)) this.startMove(at.p)
  }

  /** Move the selection from `p`: what is in it and in its containers, never what is locked. */
  startMove(p: Pt) {
    this.dragFrom = p
    this.preview = { ids: this.movable(this.selected), dx: 0, dy: 0 }
    this.landFrom = this.landingSetup(this.preview.ids)
    this.landing = null
  }

  /** A marquee (mouse, touch) or a lasso (pen) from `at`; a click on a board's inside under the slop selects `board`. */
  startArea(at: PressAt, board: string | null) {
    this.additive = at.shift
    if (!at.shift) this.selected = new Set()
    this.area = { board, zoom: at.zoom }
    if (at.by === 'pen') this.lasso = [at.p]
    else this.marquee = { x0: at.p.x, y0: at.p.y, x1: at.p.x, y1: at.p.y }
  }

  private area: { board: string | null; zoom: number } | null = null
  private resizeBlockers: Rect[] = []
  /** Where the moving boards will land (the dashed outline), when that is not where they are dropped. */
  landing: Box[] | null = null
  private landFrom: { boards: Rect[]; index: BlockerIndex } | null = null

  /** The ids with what is in their containers, less anything locked (and nothing in a locked container). */
  private movable(ids: Iterable<string>): Set<string> {
    const out = new Set<string>()
    for (const id of this.withMembers(ids)) {
      const r = this.scene.get(id)
      if (r && !r.locked) out.add(id)
    }
    return out
  }

  /** The moving boards and what they must land clear of: other boards and loose things, not links. */
  private landingSetup(ids: ReadonlySet<string>): { boards: Rect[]; index: BlockerIndex } | null {
    const boards: Rect[] = []
    const avoid: Rect[] = []
    for (const r of this.scene.all()) {
      if (ids.has(r.id)) {
        if (r.kind === 'board') boards.push(recordBounds(r))
        continue
      }
      if (NO_BLOCK.has(r.kind)) continue
      if (r.kind === 'board' || r.parentId === null) avoid.push(recordBounds(r))
    }
    return boards.length ? { boards, index: new BlockerIndex(avoid) } : null
  }

  /** How much further the moving boards must go from (dx, dy) to land clear: (0, 0) when they are. */
  private snapFor(dx: number, dy: number): { dx: number; dy: number } {
    const l = this.landFrom
    if (!l) return { dx: 0, dy: 0 }
    return freeOffset(l.boards.map((b) => ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h })), l.index, BOARD_CLEAR)
  }

  private showLanding() {
    const l = this.landFrom
    const pv = this.preview
    if (!l || !pv) {
      this.landing = null
      return
    }
    const s = this.snapFor(pv.dx, pv.dy)
    this.landing = s.dx || s.dy ? l.boards.map((b) => ({ x: b.x + pv.dx + s.dx, y: b.y + pv.dy + s.dy, w: b.w, h: b.h })) : null
  }

  drag(p: Pt) {
    const rz = this.resizing
    const rb = rz ? this.scene.get(rz.id) : undefined
    if (rz && rb) {
      const { rect, leaving } = resizeRect(rb, rz.edge, p, this.resizeUnits.map((u) => u.rect))
      // Never grown under a neighbour (owner BM7): a growing side stops BOARD_CLEAR short of it.
      const held = clampGrowth(rb, rect, this.resizeBlockers)
      this.resizing = { ...rz, rect: held, leaving: leaving.flatMap((i) => this.resizeUnits[i].ids) }
    } else if (this.scaling && this.scaleFrom) {
      const { box, ox, oy } = this.scaleFrom
      const want = Math.max(Math.abs(p.x - ox) / Math.max(1e-9, box.w), Math.abs(p.y - oy) / Math.max(1e-9, box.h))
      // Never smaller than 8 px on its long side.
      const s = Math.max(want, 8 / Math.max(1e-9, box.w, box.h))
      this.scaling = { ...this.scaling, s }
    } else if (this.preview && this.dragFrom) {
      this.preview = { ids: this.preview.ids, dx: p.x - this.dragFrom.x, dy: p.y - this.dragFrom.y }
      this.showLanding()
    } else if (this.marquee) {
      this.marquee = { ...this.marquee, x1: p.x, y1: p.y }
    } else if (this.lasso) {
      this.lasso.push(p)
    } else return
    this.changed()
  }

  release(p: Pt) {
    this.drag(p)
    let told: BoardEvent[] = []
    if (this.resizing) {
      const { id, leaving } = this.resizing
      // Whole scene units: a drag at any zoom leaves a board of round size.
      const r0 = this.resizing.rect
      const rect = { x: Math.round(r0.x), y: Math.round(r0.y), w: Math.round(r0.x + r0.w) - Math.round(r0.x), h: Math.round(r0.y + r0.h) - Math.round(r0.y) }
      this.resizing = null
      this.resizeUnits = []
      this.resizeBlockers = []
      const b = this.scene.get(id)
      if (b && (rect.x !== b.x || rect.y !== b.y || rect.w !== b.w || rect.h !== b.h)) {
        // One step: the board's new box, and what it let go of leaves it.
        this.scene.change((tx) => tx.put([
          { ...tx.get(id)!, ...rect },
          ...leaving.map((m) => tx.get(m)).filter((r): r is ElementRecord => !!r).map((r) => ({ ...r, parentId: null })),
        ]))
        if (leaving.length) told = [{ kind: 'left', board: id, ids: leaving }]
      }
    } else if (this.scaling) {
      const { ids, ox, oy, s } = this.scaling
      this.scaling = null
      this.scaleFrom = null
      if (s !== 1) {
        this.scene.change((tx) => {
          const out: ElementRecord[] = []
          for (const id of ids) {
            const r = tx.get(id)
            if (!r || r.locked || UNSCALED.has(r.kind)) continue
            // A sketch area keeps its ratio: the one it was drawn at, else its shape now.
            const ratio = isArea(r) ? ratioValue(r.props.ratio) ?? (r.h ? r.w / r.h : null) : null
            out.push(scaled(r, ox, oy, s, ratio))
          }
          if (out.length) tx.put(out)
        })
      }
    } else if (this.preview) {
      const { ids, dx, dy } = this.preview
      // Boards land clear of their neighbours, in the same step (owner BM5: loose ink and pictures count).
      const snap = dx || dy ? this.snapFor(dx, dy) : { dx: 0, dy: 0 }
      this.preview = null
      this.dragFrom = null
      this.landFrom = null
      this.landing = null
      told = this.commitMove(ids, dx + snap.dx, dy + snap.dy)
    } else if (this.marquee) {
      const m = this.marquee
      this.marquee = null
      const [x0, x1] = [Math.min(m.x0, m.x1), Math.max(m.x0, m.x1)]
      const [y0, y1] = [Math.min(m.y0, m.y1), Math.max(m.y0, m.y1)]
      if (this.clicked(x1 - x0, y1 - y0)) this.clickArea()
      else {
        const inside = this.scene.all().filter((r) => r.kind !== 'board' && r.x >= x0 && r.y >= y0 && r.x + r.w <= x1 && r.y + r.h <= y1)
        this.add(inside)
      }
    } else if (this.lasso) {
      const poly = this.lasso
      this.lasso = null
      const xs = poly.map((q) => q.x)
      const ys = poly.map((q) => q.y)
      if (this.clicked(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))) this.clickArea()
      else if (poly.length > 2) this.add(this.scene.all().filter((r) => r.kind !== 'board' && inPolygon(centre(r), poly)))
    }
    this.area = null
    this.changed()
    for (const e of told) this.tell(e)
  }

  /** Did the area gesture stay under the click slop? */
  private clicked(w: number, h: number): boolean {
    const z = this.area?.zoom ?? 1
    return Math.max(w, h) * z < CLICK_SLOP_PX
  }

  /** A click on empty canvas (nothing more to do) or on a board's inside: the board is selected (shift: toggled). */
  private clickArea() {
    const b = this.area?.board
    if (b) {
      const next = this.additive ? new Set(this.selected) : new Set<string>()
      if (this.additive && next.has(b)) next.delete(b)
      else next.add(b)
      this.selected = next
    }
    this.additive = false
  }

  /**
   * Write a move of `ids` by (dx, dy) as one step: membership follows the drop, what was dropped on a
   * board is fitted to it (boards/sizing), and what a moved container carries stays in it.
   */
  private commitMove(ids: ReadonlySet<string>, dx: number, dy: number): BoardEvent[] {
    let told: BoardEvent[] = []
    if (!dx && !dy) return told
    this.scene.change((tx) => {
      const moved = [...ids].map((id) => tx.get(id)).filter((r): r is ElementRecord => !!r && !r.locked).map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
      // Membership is parentId only (art-boards): what was picked up joins the board its centre
      // lands on, or leaves every board; what came along with a moved board stays on it.
      // Carried: what is in another moving container (by parentId, or a sketch area's strokes by geometry).
      const kids = this.membersByContainer()
      const carried = new Set<string>()
      for (const id of ids) for (const k of kids.get(id) ?? []) if (ids.has(k)) carried.add(k)
      const placed = new Map(moved.map((r) => [r.id, r]))
      for (const r of moved) {
        if (carried.has(r.id) || r.kind === 'board') continue
        // Strokes in a drawn frame or a sketch area keep that container; only board membership follows the drop.
        const cur = r.parentId ? tx.get(r.parentId) : undefined
        if (cur && cur.kind !== 'board') continue
        const parent = this.containerAt(centre(r), r.id, placed)
        if (parent !== r.parentId) placed.set(r.id, { ...r, parentId: parent })
      }
      // Loose ink a moved board carried (drawn on it before ink joined boards) now joins it.
      for (const r of moved) {
        if (!carried.has(r.id) || r.parentId !== null || r.kind !== 'stroke') continue
        const owner = [...ids].find((id) => tx.get(id)?.kind === 'board' && (kids.get(id) ?? []).includes(r.id))
        if (owner) placed.set(r.id, { ...placed.get(r.id)!, parentId: owner })
      }
      told = this.fitToBoards(placed, carried, (id) => tx.get(id))
      if (placed.size) tx.put([...placed.values()])
    })
    return told
  }

  // ── the arrow keys (ui-behaviour 7: arrows nudge 1 px, Shift+arrow 10 px) ──

  /** A run of nudges, shown like a drag until it is flushed as one step. */
  private nudging: { ids: Set<string>; dx: number; dy: number; landFrom: { boards: Rect[]; index: BlockerIndex } | null } | null = null

  /** Is a run of nudges waiting to be written? */
  get nudgePending(): boolean {
    return !!this.nudging
  }

  /** The ids a waiting nudge would write (a remote change to one flushes it). */
  nudgeIds(): ReadonlySet<string> {
    return this.nudging?.ids ?? new Set()
  }

  /**
   * Nudge the selection by (dx, dy) scene units (one axis), as a preview. A board stops at BOARD_CLEAR
   * from what is in its way and never jumps it. False when nothing can move.
   */
  nudge(dx: number, dy: number): boolean {
    if (this.preview && !this.nudging) return false
    if (!this.nudging) {
      const ids = this.movable(this.selected)
      if (!ids.size) return false
      this.nudging = { ids, dx: 0, dy: 0, landFrom: this.landingSetup(ids) }
    }
    const n = this.nudging
    let step = { dx, dy }
    if (n.landFrom) step = clampMove(n.landFrom.boards.map((b) => ({ x: b.x + n.dx, y: b.y + n.dy, w: b.w, h: b.h })), n.landFrom.index, BOARD_CLEAR, dx, dy)
    n.dx += step.dx
    n.dy += step.dy
    this.preview = { ids: n.ids, dx: n.dx, dy: n.dy }
    this.changed()
    return !!(step.dx || step.dy)
  }

  /** Write a waiting run of nudges as one step (on idle, undo, a press, a tool change, blur or a remote change). */
  flushNudge(): boolean {
    const n = this.nudging
    if (!n) return false
    this.nudging = null
    this.preview = null
    const told = this.commitMove(n.ids, n.dx, n.dy)
    this.changed()
    for (const e of told) this.tell(e)
    return !!(n.dx || n.dy)
  }

  private add(rs: ElementRecord[]) {
    const next = this.additive ? new Set(this.selected) : new Set<string>()
    for (const r of rs) for (const id of this.withGroup(r)) next.add(id)
    this.selected = next
    this.additive = false
  }

  /** Delete the selection (not what is locked) as one step. Returns how many went. */
  deleteSelected(): number {
    const ids = [...this.selected].filter((id) => {
      const r = this.scene.get(id)
      return r && !r.locked
    })
    if (!ids.length) return 0
    this.scene.change((tx) => tx.remove(ids))
    for (const id of ids) this.selected.delete(id)
    this.changed()
    return ids.length
  }

  cancel() {
    this.nudging = null
    this.landFrom = null
    this.landing = null
    this.area = null
    this.resizeBlockers = []
    this.resizing = null
    this.resizeUnits = []
    this.scaling = null
    this.scaleFrom = null
    this.preview = null
    this.marquee = null
    this.lasso = null
    this.dragFrom = null
    this.changed()
  }

  /** Drop ids that are gone (deleted here or by someone else). */
  prune() {
    for (const id of [...this.selected]) if (!this.scene.get(id)) this.selected.delete(id)
  }
}
