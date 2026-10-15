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

import { recordBounds, unionRects, type Rect } from '../model/bounds'
import { boundEnds } from '../render/links'
import { containsRect, fitRect, growToHold, innerRect, overlaps, placeInBoard, resizeRect, type Edge } from '../boards/sizing'
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

/** Kinds that never block a board's growth: they follow their ends, or are boards' own business. */
const NO_BLOCK = new Set(['link', 'arrow'])

/** Two presses this close in time (ms) and on screen (px) are a double press: double-click, or double-tap with pen or touch. */
export const DOUBLE_PRESS_MS = 350
export const DOUBLE_PRESS_PX = 16

/**
 * One level of what a click can select, innermost first: the element alone, the drawn frame or sketch
 * area it is in, then its groups out to the outermost (container-select). `key` is what `scope` holds
 * when this level is entered: an element or container id, or a group id.
 */
interface Level {
  key: string
  ids: string[]
}

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
  private readonly now: () => number
  /**
   * The container the person entered (a drawn frame, a sketch area or a group: its `Level.key`), or null.
   * While entered, clicks inside pick members alone; Esc or a click outside leaves it (container-select).
   */
  scope: string | null = null
  /** A marquee started on the empty inside of the entered container: it selects only members. */
  private marqueeIn: Set<string> | null = null
  /** The last press, for double-press detection: when, where (screen px at its zoom), and by what. */
  private lastPress: { t: number; p: Pt; zoom: number; by?: PointerKind } | null = null

  constructor(scene: SceneStore, hit: (x: number, y: number) => ElementRecord | undefined, opts: { newId?: () => string; now?: () => number } = {}) {
    this.scene = scene
    this.hit = hit
    this.newId = opts.newId ?? (() => `group_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
    this.now = opts.now ?? (() => Date.now())
  }

  // ── containers: drawn frames, sketch areas and groups selected as one (container-select) ──

  /** Is this record a container that is selected as one thing: a drawn frame (a Drawing) or a sketch area? Boards are not. */
  isObjectContainer(r: ElementRecord | undefined): r is ElementRecord {
    return !!r && (r.kind === 'frame' || isArea(r))
  }

  /** The drawn frame or sketch area an element is in (by parentId, or a sketch area's ink by geometry), or null. */
  private objectContainerOf(r: ElementRecord, kids?: Map<string, string[]>): ElementRecord | null {
    const parent = r.parentId ? this.scene.get(r.parentId) : undefined
    if (parent && this.isObjectContainer(parent)) return parent
    if (r.kind !== 'stroke' && r.kind !== 'shape') return null
    for (const [id, members] of kids ?? this.membersByContainer()) {
      if (!members.includes(r.id)) continue
      const c = this.scene.get(id)
      if (c && isArea(c)) return c
    }
    return null
  }

  /** What a click on `r` can select, innermost first: r alone, its drawn frame or sketch area, then that one's groups outward. */
  private levels(r: ElementRecord): Level[] {
    const out: Level[] = [{ key: r.id, ids: [r.id] }]
    const c = this.objectContainerOf(r)
    const top = c ?? r
    if (c) out.push({ key: c.id, ids: [c.id] })
    const all = this.scene.all()
    for (const g of top.groupIds) out.push({ key: g, ids: all.filter((x) => x.groupIds.includes(g)).map((x) => x.id) })
    return out
  }

  /** Is `key` (a scope) still a container: a drawn frame or sketch area that exists, or a group with members? */
  private scopeAlive(key: string): boolean {
    const r = this.scene.get(key)
    if (r) return this.isObjectContainer(r)
    return this.scene.all().some((x) => x.groupIds.includes(key))
  }

  /** The level the scope names, as a selection (the container whole). */
  private scopeIds(key: string): string[] {
    return this.scene.get(key) ? [key] : this.scene.all().filter((x) => x.groupIds.includes(key)).map((x) => x.id)
  }

  /** The members of the entered container (what a click or marquee inside may pick), or an empty set. */
  private scopeMembers(): Set<string> {
    const key = this.scope
    if (!key) return new Set()
    if (this.scene.get(key)) {
      const out = this.withMembers([key])
      out.delete(key)
      return out
    }
    return new Set(this.scene.all().filter((x) => x.groupIds.includes(key)).map((x) => x.id))
  }

  /**
   * What a press on `hit` selects. Not entered: the outermost level (the drawn frame, sketch area or group,
   * whole). Entered and the hit is inside the scope: the member alone. A hit outside the scope leaves it.
   */
  private resolve(hit: ElementRecord): string[] {
    const levels = this.levels(hit)
    if (this.scope) {
      if (levels.some((l) => l.key === this.scope)) return levels[0].ids
      this.scope = null
    }
    return levels[levels.length - 1].ids
  }

  /** Enter the container at a point (a double press, or a double-click): select the member there alone. Its id, or null. */
  enterAt(p: Pt): string | null {
    const hit = this.hit(p.x, p.y)
    if (!hit) return null
    const levels = this.levels(hit)
    // A container's own frame or area (its empty inside): nothing inside to enter on.
    if (levels.length > 1) this.scope = levels[levels.length - 1].key
    this.selected = new Set([hit.id])
    this.changed()
    return hit.id
  }

  /** Leave the entered container and select it whole. False when nothing was entered. */
  exitScope(): boolean {
    const key = this.scope
    if (!key) return false
    this.scope = null
    if (this.scopeAlive(key)) this.selected = new Set(this.scopeIds(key))
    this.changed()
    return true
  }

  /** The box of the entered container (its frame or area, or its group's members), for the inside outline; null when none. */
  scopeBox(): Box | null {
    const key = this.scope
    if (!key || !this.scopeAlive(key)) return null
    const rs = this.scopeIds(key).map((id) => this.scene.get(id)).filter((r): r is ElementRecord => !!r)
    return rs.length ? boxOfAll(rs) : null
  }

  /** Is a gesture running (a move, scale, resize, marquee or lasso)? Esc cancels it first. */
  busy(): boolean {
    return !!(this.preview || this.scaling || this.resizing || this.marquee || this.lasso)
  }

  /** Is this press the second of a double press (time and screen distance, any pointer)? Records it either way. */
  private doublePress(p: Pt, zoom: number, by?: PointerKind): boolean {
    const t = this.now()
    const last = this.lastPress
    const twice = !!last && t - last.t <= DOUBLE_PRESS_MS && (last.by ?? 'mouse') === (by ?? 'mouse')
      && Math.hypot((p.x - last.p.x) * zoom, (p.y - last.p.y) * zoom) <= DOUBLE_PRESS_PX
    this.lastPress = twice ? null : { t, p, zoom, by }
    return twice
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

  /** The handle of the selected board at a scene point (HANDLE_PX on screen), or null. */
  boardHandleAt(p: Pt, zoom: number): Edge | null {
    const b = this.soleBoard()
    if (!b) return null
    const reach = HANDLE_PX / zoom
    const { x, y, w, h } = this.resizing?.rect ?? b
    const near = (cx: number, cy: number) => Math.abs(p.x - cx) <= reach && Math.abs(p.y - cy) <= reach
    const corners: [Edge, number, number][] = [['nw', x, y], ['ne', x + w, y], ['sw', x, y + h], ['se', x + w, y + h], ['n', x + w / 2, y]]
    const hit = corners.find(([, cx, cy]) => near(cx, cy))
    if (hit) return hit[0]
    // The sides and the foot are handles all along; the top is the title (it moves the board), so only its middle.
    const alongY = p.y >= y && p.y <= y + h
    if (alongY && Math.abs(p.x - x) <= reach) return 'w'
    if (alongY && Math.abs(p.x - (x + w)) <= reach) return 'e'
    if (p.x >= x && p.x <= x + w && Math.abs(p.y - (y + h)) <= reach) return 's'
    return null
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

  /** The selection's units: each outermost group once, and each ungrouped element; a member of a selected Drawing or sketch area is part of it. */
  private units(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    const kids = this.selected.size > 1 ? this.membersByContainer() : undefined
    for (const id of this.selected) {
      const r = this.scene.get(id)
      if (!r) continue
      const c = kids ? this.objectContainerOf(r, kids) : null
      if (c && this.selected.has(c.id)) continue
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
      for (const k of kids.get(todo.pop()!) ?? []) if (!out.has(k)) {
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

  /** The topmost element at a point, alone, even when it is in a group or a Drawing (a double-click): enters its container. Its id, or null. */
  pickOne(p: Pt): string | null {
    return this.enterAt(p)
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

  press(p: Pt, opts: { shift?: boolean; by?: PointerKind; zoom?: number } = {}) {
    const edge = opts.shift ? null : this.boardHandleAt(p, opts.zoom ?? 1)
    const board = edge ? this.soleBoard() : null
    if (edge && board) {
      this.resizeUnits = this.boardUnits(board.id)
      this.resizing = { id: board.id, edge, rect: { x: board.x, y: board.y, w: board.w, h: board.h }, leaving: [] }
      this.changed()
      return
    }
    const corner = opts.shift ? null : this.handleAt(p, opts.zoom ?? 1)
    if (corner) {
      const box = this.frame()!.box
      const ox = corner === 'nw' || corner === 'sw' ? box.x + box.w : box.x
      const oy = corner === 'nw' || corner === 'ne' ? box.y + box.h : box.y
      this.scaleFrom = { box, ox, oy }
      this.scaling = { ids: new Set(this.selected), ox, oy, s: 1 }
      this.changed()
      return
    }
    const twice = this.doublePress(p, opts.zoom ?? 1, opts.by)
    const hit = this.hit(p.x, p.y)
    // A double press on a member enters its container and picks the member alone; a drag then moves only it.
    if (hit && twice && !opts.shift && this.enterAt(p)) {
      this.dragFrom = p
      this.preview = { ids: this.withMembers(this.selected), dx: 0, dy: 0 }
      this.changed()
      return
    }
    if (hit && this.scope && hit.id === this.scope) {
      // The empty inside of the entered container: a marquee (or lasso) over its members only.
      this.startArea(p, opts, this.scopeMembers())
    } else if (hit) {
      const ids = this.resolve(hit)
      const on = ids.every((id) => this.selected.has(id))
      if (opts.shift) {
        for (const id of ids) {
          if (on) this.selected.delete(id)
          else this.selected.add(id)
        }
      } else if (!on) this.selected = new Set(ids)
      if (ids.some((id) => this.selected.has(id))) {
        this.dragFrom = p
        this.preview = { ids: this.withMembers(this.selected), dx: 0, dy: 0 }
      }
    } else {
      // Empty canvas: a click outside the entered container leaves it.
      this.scope = null
      this.startArea(p, opts, null)
    }
    this.changed()
  }

  /** Start a marquee (mouse, touch) or a lasso (pen), limited to `within` when it is inside an entered container. */
  private startArea(p: Pt, opts: { shift?: boolean; by?: PointerKind }, within: Set<string> | null) {
    this.additive = !!opts.shift
    this.marqueeIn = within
    if (!opts.shift) this.selected = new Set()
    if (opts.by === 'pen') this.lasso = [p]
    else this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
  }

  drag(p: Pt) {
    const rz = this.resizing
    const rb = rz ? this.scene.get(rz.id) : undefined
    if (rz && rb) {
      const { rect, leaving } = resizeRect(rb, rz.edge, p, this.resizeUnits.map((u) => u.rect))
      this.resizing = { ...rz, rect, leaving: leaving.flatMap((i) => this.resizeUnits[i].ids) }
    } else if (this.scaling && this.scaleFrom) {
      const { box, ox, oy } = this.scaleFrom
      const want = Math.max(Math.abs(p.x - ox) / Math.max(1e-9, box.w), Math.abs(p.y - oy) / Math.max(1e-9, box.h))
      // Never smaller than 8 px on its long side.
      const s = Math.max(want, 8 / Math.max(1e-9, box.w, box.h))
      this.scaling = { ...this.scaling, s }
    } else if (this.preview && this.dragFrom) {
      this.preview = { ids: this.preview.ids, dx: p.x - this.dragFrom.x, dy: p.y - this.dragFrom.y }
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
      this.preview = null
      this.dragFrom = null
      if (dx || dy) {
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
          told = this.fitToBoards(placed, carried, (id) => tx.get(id))
          if (placed.size) tx.put([...placed.values()])
        })
      }
    } else if (this.marquee) {
      const m = this.marquee
      this.marquee = null
      const [x0, x1] = [Math.min(m.x0, m.x1), Math.max(m.x0, m.x1)]
      const [y0, y1] = [Math.min(m.y0, m.y1), Math.max(m.y0, m.y1)]
      if (x1 - x0 > 0 || y1 - y0 > 0) {
        const inside = this.scene.all().filter((r) => r.kind !== 'board' && r.x >= x0 && r.y >= y0 && r.x + r.w <= x1 && r.y + r.h <= y1)
        this.add(inside)
      }
    } else if (this.lasso) {
      const poly = this.lasso
      this.lasso = null
      if (poly.length > 2) this.add(this.scene.all().filter((r) => r.kind !== 'board' && inPolygon(centre(r), poly)))
    }
    this.changed()
    for (const e of told) this.tell(e)
  }

  private add(rs: ElementRecord[]) {
    const next = this.additive ? new Set(this.selected) : new Set<string>()
    const within = this.marqueeIn
    // Inside an entered container: members alone. Outside: each with its whole outermost group.
    for (const r of rs) {
      if (within) {
        if (within.has(r.id)) next.add(r.id)
      } else for (const id of this.withGroup(r)) next.add(id)
    }
    this.selected = next
    this.additive = false
    this.marqueeIn = null
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
    this.resizing = null
    this.resizeUnits = []
    this.scaling = null
    this.scaleFrom = null
    this.preview = null
    this.marquee = null
    this.lasso = null
    this.marqueeIn = null
    this.dragFrom = null
    this.changed()
  }

  /** Drop ids that are gone (deleted here or by someone else), and the scope when its container is gone or no longer one. */
  prune() {
    for (const id of [...this.selected]) if (!this.scene.get(id)) this.selected.delete(id)
    if (this.scope && !this.scopeAlive(this.scope)) this.scope = null
  }
}
