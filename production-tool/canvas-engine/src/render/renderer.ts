// The canvas2d renderer core (features/canvas-engine.clan; grown from Spike O's
// render.ts on spike/canvas-own-engine). DOM-free: it draws through a 2D context
// and a path factory it is given, so the bench runs it in node and adapter/own
// gives it the real canvas, requestAnimationFrame and the bitmap loader.
//
// - rbush culls to the viewport;
// - each stroke's outline (perfect-freehand) is built once per immutable points
//   array and cached;
// - previews are drawn from the bitmap cache, the small level of detail below
//   FULL_RES_MIN_ZOOM;
// - typed nodes are not drawn here: they are DOM slots (engine-nodes), with a
//   canvas preview below the DOM threshold zoom (engine-previews).

import { getStroke } from 'perfect-freehand'
import RBush from 'rbush'
import { localPoints } from '../model/points'
import { BLOCKS, linkRoute, midway, routeKey, type LinkEnv, type LinkRoute } from './links'
import { photoEdge, recordBounds } from '../model/bounds'
import { LIGHT_INK, resolveInk, type InkPalette } from '../ink/palette'
import type { ElementRecord } from '../model/records'
import type { SceneStore } from '../model/store'
import type { Bitmap, Level } from './bitmaps'
import { FULL_RES_MIN_ZOOM } from './caps'

export interface Camera {
  scrollX: number
  scrollY: number
  zoom: number
}

/** A path the context can fill (Path2D in a browser). */
export interface PathLike {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
}

/** The part of CanvasRenderingContext2D the renderer uses. */
export interface DrawContext {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale?(x: number, y: number): void
  rotate?(angle: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  clearRect?(x: number, y: number, w: number, h: number): void
  strokeRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void
  closePath(): void
  stroke(): void
  setLineDash?(segments: number[]): void
  fill(path?: PathLike): void
  drawImage(image: Bitmap, x: number, y: number, w: number, h: number): void
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  font: string
  globalAlpha: number
}

export interface RenderHost {
  newPath(): PathLike
  /** The bitmap of an asset at a level of detail, if it is decoded; the host loads it when not. */
  bitmap(sha: string, level: Level): Bitmap | undefined
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
  id: string
}

export interface DrawStats {
  drawn: number
  culled: number
  pathsBuilt: number
  ms: number
}

/** The selection's frame (canvas-edit-tools; mock SketchInk): dashed round a group, corner handles when it scales. */
export interface SelectionFrame {
  box: { x: number; y: number; w: number; h: number }
  dashed: boolean
  handles: boolean
  /** A selected board: square handles on its corners and the middles of its edges (it resizes). */
  edges?: boolean
  /** Above the box ("Ink · 9 strokes · one group"). */
  label?: string
}

export const FRAME_COLOUR = '#2F64F5'
const LABEL_COLOUR = '#1E4ED8'

const naturalSizes = new WeakMap<Uint8Array, { w: number; h: number }>()

/** The extent of a stroke's own points: its record's w/h over this is the scale it is drawn at. */
export function naturalSize(pts: Uint8Array): { w: number; h: number } {
  let n = naturalSizes.get(pts)
  if (!n) {
    let w = 0
    let h = 0
    for (const p of localPoints(pts)) {
      w = Math.max(w, p.x)
      h = Math.max(h, p.y)
    }
    n = { w, h }
    naturalSizes.set(pts, n)
  }
  return n
}

/** The scale a stroke record is drawn at (1 on an axis its points do not span). */
export function strokeScale(r: { w: number; h: number }, pts: Uint8Array): { sx: number; sy: number } {
  const n = naturalSize(pts)
  return { sx: n.w > 1e-6 ? r.w / n.w : 1, sy: n.h > 1e-6 ? r.h / n.h : 1 }
}

/** A stroke's filled outline, from its points relative to its origin. */
export function strokeOutline(pts: Uint8Array, size: number): number[][] {
  const input = localPoints(pts).map((p) => [p.x, p.y, p.pressure])
  return getStroke(input, { size, thinning: 0.6, smoothing: 0.5, streamline: 0.4, simulatePressure: false, last: true })
}

/** What an empty board of this purpose asks for (ui-behaviour 3.2). */
export function dropHint(purpose: string): string {
  switch (purpose) {
    case 'character': return 'Drop pictures here. They become characters.'
    case 'location': return 'Drop pictures here. They become locations.'
    case 'product': return 'Drop pictures here. They become products.'
    case 'reference': return 'Drop pictures here. They become references.'
    case 'sketches': return 'Draw a sketch area here.'
    case 'brand': return 'Drop a brand book here.'
    default: return ''
  }
}

/** The outline of a stroke still being drawn (the live-ink canvas), from its points in scene coordinates. */
export function liveOutline(points: readonly { x: number; y: number; pressure: number }[], size: number, last = false): number[][] {
  return getStroke(points.map((p) => [p.x, p.y, p.pressure]), { size, thinning: 0.6, smoothing: 0.5, streamline: 0.4, simulatePressure: false, last })
}

/**
 * How boards look, from the host's theme tokens (the web chrome's --line, --card, --canvas-bg):
 * a rounded frame with a soft fill and its title in a chip on the top edge. Null keeps the plain
 * outline with the title above it.
 */
export interface BoardLook {
  fill: string
  stroke: string
  /** The stroke of the current board (the one the rail last jumped to). */
  current: string
  radius: number
  title: string
  /** The chip behind the title: the canvas's background, so the frame line breaks under it. */
  titleBg: string
}

/** How bound links look, from the host's tokens: solid ink, lit in the tool colour, the role in a pill. */
export interface LinkLook {
  stroke: string
  lit: string
  /** The role pill: its text, fill and border. */
  label: string
  labelBg: string
  labelLine: string
  /** Roles written on the line (mock Main writes "drives" only). */
  roles: readonly string[]
}

/** Is this link or arrow bound to something at either end? (Then it is drawn from its ends, or not at all.) */
const isBound = (r: ElementRecord) => [r.props.start, r.props.end].some((b) => !!b && typeof b === 'object' && !Array.isArray(b) && typeof b.elementId === 'string')

export class Renderer {
  private readonly scene: SceneStore
  private readonly host: RenderHost
  private readonly tree = new RBush<Box>()
  private readonly boxes = new Map<string, Box>()
  private readonly paths = new WeakMap<Uint8Array, PathLike>()
  private ordered: ElementRecord[] | null = null
  private readonly off: () => void
  selected = new Set<string>()
  /** A move being dragged (select tool): drawn offset, never written until release. */
  moving: { ids: ReadonlySet<string>; dx: number; dy: number } | null = null
  /** A scale being dragged (select tool's handles): drawn scaled round (ox, oy), never written until release. */
  scaling: { ids: ReadonlySet<string>; ox: number; oy: number; s: number } | null = null
  /** A board being resized by its handles: drawn at this box until release. */
  resizing: { id: string; rect: { x: number; y: number; w: number; h: number } } | null = null
  /** The selection's frame, drawn on top; a dashed group box replaces the members' own outlines. */
  frame: SelectionFrame | null = null
  boardLook: BoardLook | null = null
  linkLook: LinkLook | null = null
  currentBoard: string | null = null
  /** What the ink names mean in the host's theme (ink/palette.ts); the light values until it says. */
  inkPalette: InkPalette = LIGHT_INK
  /**
   * Elements gliding from where they were to where they are now (a stack of pictures opening or
   * folding): drawn in between for `ms`, eased, never written. The host keeps drawing while
   * animating() says so.
   */
  tween: { from: ReadonlyMap<string, { x: number; y: number; rotation: number }>; t0: number; ms: number } | null = null

  /** Is a tween still running at `now`? */
  animating(now = performance.now()): boolean {
    return !!this.tween && now - this.tween.t0 < this.tween.ms
  }

  /** A record where the tween draws it at `now`: on its way from where it was (ease out). */
  tweened(r: ElementRecord, now = performance.now()): ElementRecord {
    const t = this.tween
    const from = t?.from.get(r.id)
    if (!t || !from) return r
    const k = Math.min(1, Math.max(0, (now - t.t0) / Math.max(1, t.ms)))
    if (k >= 1) return r
    const e = 1 - (1 - k) ** 3
    const at = (a: number, b: number) => a + (b - a) * e
    return { ...r, x: at(from.x, r.x), y: at(from.y, r.y), rotation: at(from.rotation, r.rotation) }
  }

  constructor(scene: SceneStore, host: RenderHost) {
    this.scene = scene
    this.host = host
    this.tree.load(scene.all().filter((r) => r.kind !== 'node').map((r) => this.boxOf(r)))
    for (const b of this.tree.all()) this.boxes.set(b.id, b)
    this.off = scene.onChange((ids) => {
      for (const id of ids) {
        const r = scene.get(id)
        this.unindex(id)
        if (r && r.kind !== 'node') this.index(r)
      }
      this.ordered = null
    })
  }

  destroy() {
    this.off()
  }

  private boxOf(r: ElementRecord): Box {
    const pad = typeof r.style.width === 'number' ? r.style.width * 2 : 0
    // As drawn: turned about its centre, a stacked photo with its white edge (model/bounds).
    const b = recordBounds(r)
    return { minX: b.x - pad, minY: b.y - pad, maxX: b.x + b.w + pad, maxY: b.y + b.h + pad, id: r.id }
  }

  private index(r: ElementRecord) {
    const b = this.boxOf(r)
    this.boxes.set(r.id, b)
    this.tree.insert(b)
  }

  private unindex(id: string) {
    const b = this.boxes.get(id)
    if (b) {
      this.tree.remove(b)
      this.boxes.delete(id)
    }
  }

  /** The scene box a viewport of this size shows under a camera. */
  static view(cam: Camera, viewport: { width: number; height: number }) {
    return { minX: -cam.scrollX, minY: -cam.scrollY, maxX: -cam.scrollX + viewport.width / cam.zoom, maxY: -cam.scrollY + viewport.height / cam.zoom }
  }

  /** The topmost element (not a node or board) under a scene point. */
  hit(x: number, y: number): ElementRecord | undefined {
    return this.tree.search({ minX: x, minY: y, maxX: x, maxY: y })
      .map((b) => this.scene.get(b.id))
      .filter((r): r is ElementRecord => !!r && r.kind !== 'board')
      .sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0))[0]
  }

  /** An element where it is drawn: offset while it is being moved. */
  private moved(r: ElementRecord): ElementRecord {
    return this.moving?.ids.has(r.id) ? { ...r, x: r.x + this.moving.dx, y: r.y + this.moving.dy } : r
  }

  private order(): ElementRecord[] {
    if (!this.ordered) {
      const all = this.scene.all()
      this.ordered = all.filter((r) => r.kind !== 'node').sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0))
      this.occupied = new Set(all.flatMap((r) => (r.parentId ? [r.parentId] : [])))
      // The passes: boards, then links (under everything on the boards), then the rest in z-order.
      this.passes = { boards: [], links: [], rest: [] }
      // A link, or an arrow bound at either end (a generation's provenance arrow), is drawn from its ends.
      for (const r of this.ordered) (r.kind === 'board' ? this.passes.boards : r.kind === 'link' || (r.kind === 'arrow' && isBound(r)) ? this.passes.links : this.passes.rest).push(r)
      this.groups = new Map()
      for (const r of all) for (const g of r.groupIds) {
        const m = this.groups.get(g)
        if (m) m.push(r)
        else this.groups.set(g, [r])
      }
      this.nodes = all.filter((r) => r.kind === 'node').sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0))
    }
    return this.ordered
  }

  /** Containers that hold something (refreshed with the order). */
  private occupied = new Set<string>()
  private passes: { boards: ElementRecord[]; links: ElementRecord[]; rest: ElementRecord[] } = { boards: [], links: [], rest: [] }
  private groups = new Map<string, ElementRecord[]>()
  private nodes: ElementRecord[] = []

  /** What link routing reads: groups, what blocks a line (pictures, sketch areas, node cards), records as drawn now. */
  private linkEnv(now: number): LinkEnv {
    this.order()
    return {
      get: (id) => this.scene.get(id),
      members: (g) => this.groups.get(g) ?? [],
      obstacles: (box) => {
        const out: ElementRecord[] = []
        for (const b of this.tree.search({ minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h })) {
          const r = this.scene.get(b.id)
          if (r && BLOCKS.has(r.kind)) out.push(r)
        }
        for (const n of this.nodes) if (n.x < box.x + box.w && n.x + n.w > box.x && n.y < box.y + box.h && n.y + n.h > box.y) out.push(n)
        return out
      },
      at: (r) => this.moved(this.tween ? this.tweened(r, now) : r),
    }
  }

  /** The links as drawn now: each one's route, two between the same group and target drawn as one (the key link first). */
  linkRoutes(now = performance.now()): { link: ElementRecord; route: LinkRoute; all: ElementRecord[] }[] {
    this.order()
    if (!this.passes.links.length) return []
    const env = this.linkEnv(now)
    const out = new Map<string, { link: ElementRecord; route: LinkRoute; all: ElementRecord[] }>()
    const named = (l: ElementRecord) => {
      const s = l.props.start
      return !!s && typeof s === 'object' && !Array.isArray(s) && typeof s.group === 'string'
    }
    // A link bound by its group comes first, so it is the one drawn.
    const links = [...this.passes.links].sort((a, b) => Number(named(b)) - Number(named(a)))
    for (const l of links) {
      const route = linkRoute(env, l)
      if (!route) continue
      // Arrows keep their own key: a provenance arrow and a link between the same ends are both drawn.
      const key = `${l.kind}:${routeKey(route)}`
      const had = out.get(key)
      if (had) had.all.push(l)
      else out.set(key, { link: l, route, all: [l] })
    }
    return [...out.values()]
  }

  private pathOf(pts: Uint8Array, size: number, stats: DrawStats): PathLike {
    let p = this.paths.get(pts)
    if (p) return p
    const outline = strokeOutline(pts, size)
    p = this.host.newPath()
    if (outline.length) {
      p.moveTo(outline[0][0], outline[0][1])
      for (let i = 1; i < outline.length; i++) p.lineTo(outline[i][0], outline[i][1])
      p.closePath()
    }
    this.paths.set(pts, p)
    stats.pathsBuilt++
    return p
  }

  /** Draw one frame: clear, then every visible element in z-order. */
  draw(ctx: DrawContext, cam: Camera, viewport: { width: number; height: number }, dpr: number, background = '#ffffff'): DrawStats {
    const t0 = performance.now()
    const stats: DrawStats = { drawn: 0, culled: 0, pathsBuilt: 0, ms: 0 }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // 'transparent': the host's own background (the chrome's dot grid) shows through.
    if (background === 'transparent' && ctx.clearRect) ctx.clearRect(0, 0, viewport.width * dpr, viewport.height * dpr)
    else {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, viewport.width * dpr, viewport.height * dpr)
    }
    const s = dpr * cam.zoom
    ctx.setTransform(s, 0, 0, s, s * cam.scrollX, s * cam.scrollY)
    const visible = new Set(this.tree.search(Renderer.view(cam, viewport)).map((b) => b.id))
    const minPx = 1.5 / cam.zoom
    const level: Level = cam.zoom < FULL_RES_MIN_ZOOM ? 'small' : 'full'
    const now = performance.now()
    if (this.tween && !this.animating(now)) this.tween = null
    this.order()
    const paint = (rec: ElementRecord) => {
      const r0 = this.tween ? this.tweened(rec, now) : rec
      const r = this.resizing?.id === r0.id ? { ...r0, ...this.resizing.rect } : r0
      if (!visible.has(r.id) && r === r0) {
        stats.culled++
        return
      }
      if (r.kind === 'stroke' && Math.abs(r.w) < minPx && Math.abs(r.h) < minPx) {
        stats.culled++
        return
      }
      stats.drawn++
      ctx.globalAlpha = r.opacity
      const moving = this.moving?.ids.has(r.id) ? this.moving : null
      const scaling = ctx.scale && this.scaling?.ids.has(r.id) ? this.scaling : null
      if (moving || scaling) ctx.save()
      if (moving) ctx.translate(moving.dx, moving.dy)
      if (scaling) {
        ctx.translate(scaling.ox, scaling.oy)
        ctx.scale!(scaling.s, scaling.s)
        ctx.translate(-scaling.ox, -scaling.oy)
      }
      this.drawOne(ctx, r, cam, level, stats)
      // A selected board's own frame (its handles) is its outline.
      if (this.selected.has(r.id) && !this.frame?.dashed && !(this.frame?.edges && r.kind === 'board')) {
        ctx.strokeStyle = '#4a7fd4'
        ctx.lineWidth = 2 / (cam.zoom * (scaling?.s ?? 1))
        const pad = 4 / (cam.zoom * (scaling?.s ?? 1))
        ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
      }
      if (moving || scaling) ctx.restore()
    }
    for (const rec of this.passes.boards) paint(rec)
    // Links under everything on the boards: never over a picture's, a card's or a sketch area's content.
    // A bound link is drawn from its ends (it follows them), so its own box never culls it.
    for (const { link, route, all } of this.linkRoutes(now)) {
      stats.drawn++
      if (link.kind === 'arrow') this.drawBoundArrow(ctx, link, route, cam)
      else this.drawLink(ctx, link, route, all, cam)
    }
    // A link or bound arrow whose end is gone is not drawn at all (never a line to nowhere).
    for (const rec of this.passes.rest) paint(rec)
    ctx.globalAlpha = 1
    if (this.frame) this.drawFrame(ctx, this.frame, cam)
    stats.ms = performance.now() - t0
    return stats
  }

  /**
   * A bound link along its route, under what is on the boards; quiet until it or an end (or a view of
   * its group) is selected. `all`: the links drawn as this one (the same group to the same target).
   */
  private drawLink(ctx: DrawContext, r: ElementRecord, route: LinkRoute, all: readonly ElementRecord[], cam: Camera) {
    const pts = route.pts
    if (pts.length < 2) return
    const sel = (id: string) => this.selected.has(id)
    const inGroup = (g: string | null) => !!g && (this.groups.get(g) ?? []).some((m) => sel(m.id))
    const lit = all.some((l) => sel(l.id)) || sel(route.from.id) || sel(route.to.id) || inGroup(route.fromGroup) || inGroup(route.toGroup)
    const look = this.linkLook
    ctx.globalAlpha = lit || look ? 1 : 0.3
    ctx.strokeStyle = look ? (lit ? look.lit : look.stroke) : '#4a7fd4'
    ctx.lineWidth = (lit ? 2 : 1.5) / cam.zoom
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    const b = pts[pts.length - 1]
    // The head points along the line's last stretch into the target.
    let k = pts.length - 2
    while (k > 0 && Math.hypot(b.x - pts[k].x, b.y - pts[k].y) < 2) k--
    const ang = Math.atan2(b.y - pts[k].y, b.x - pts[k].x)
    const head = 9 / cam.zoom
    ctx.moveTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45))
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45))
    ctx.stroke()
    const role = typeof r.props.role === 'string' ? r.props.role : ''
    const m = midway(pts)
    if (look) {
      if (role && look.roles.includes(role) && cam.zoom > 0.2) {
        // A pill beside the line's middle, in scene units (it scales with the canvas, as Main's does).
        const w = role.length * 6.5 + 16
        const x = m.x + 10
        const y = m.y - 10
        ctx.fillStyle = look.labelBg
        ctx.strokeStyle = look.labelLine
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x + 10, y)
        ctx.lineTo(x + w - 10, y)
        ctx.ellipse(x + w - 10, y + 10, 10, 10, 0, -Math.PI / 2, Math.PI / 2)
        ctx.lineTo(x + 10, y + 20)
        ctx.ellipse(x + 10, y + 10, 10, 10, 0, Math.PI / 2, Math.PI * 1.5)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = look.label
        ctx.font = '11px Geist, sans-serif'
        ctx.fillText(role, x + 8, y + 14)
      }
      return
    }
    if (role && cam.zoom > 0.2) {
      ctx.fillStyle = '#4a7fd4'
      ctx.font = `${12 / cam.zoom}px Geist, sans-serif`
      ctx.fillText(role, m.x + 6 / cam.zoom, m.y - 6 / cam.zoom)
    }
  }

  /** A bound arrow (a generation's provenance arrow) along its route, in its own colour and dash. */
  private drawBoundArrow(ctx: DrawContext, r: ElementRecord, route: LinkRoute, cam: Camera) {
    const pts = route.pts
    if (pts.length < 2) return
    ctx.globalAlpha = r.opacity
    ctx.strokeStyle = resolveInk(r.style.stroke, this.inkPalette)
    ctx.lineWidth = r.style.width ?? 2
    const k = 1 / cam.zoom
    if (r.style.dash === 'dashed') ctx.setLineDash?.([8, 6])
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
    ctx.setLineDash?.([])
    const b = pts[pts.length - 1]
    let n = pts.length - 2
    while (n > 0 && Math.hypot(b.x - pts[n].x, b.y - pts[n].y) < 2) n--
    const ang = Math.atan2(b.y - pts[n].y, b.x - pts[n].x)
    const head = Math.max(10, 12 * k)
    ctx.beginPath()
    ctx.moveTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45))
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45))
    ctx.stroke()
  }

  /**
   * The ink that lies over node cards, for a canvas above the cards (the cards are DOM over the main
   * canvas): each stroke drawn later than a card it crosses is drawn again here, so a stroke across a
   * card shows whole. Nothing else. Clears first.
   */
  drawOver(ctx: DrawContext, cam: Camera, viewport: { width: number; height: number }, dpr: number): number {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect?.(0, 0, viewport.width * dpr, viewport.height * dpr)
    this.order()
    if (!this.nodes.length) return 0
    const s = dpr * cam.zoom
    ctx.setTransform(s, 0, 0, s, s * cam.scrollX, s * cam.scrollY)
    const view = Renderer.view(cam, viewport)
    const stats: DrawStats = { drawn: 0, culled: 0, pathsBuilt: 0, ms: 0 }
    const level: Level = cam.zoom < FULL_RES_MIN_ZOOM ? 'small' : 'full'
    const over = new Map<string, ElementRecord>()
    for (const n of this.nodes) {
      if (n.x > view.maxX || n.x + n.w < view.minX || n.y > view.maxY || n.y + n.h < view.minY) continue
      for (const b of this.tree.search({ minX: n.x, minY: n.y, maxX: n.x + n.w, maxY: n.y + n.h })) {
        const r = this.scene.get(b.id)
        if (r && r.kind === 'stroke' && r.z > n.z) over.set(r.id, r)
      }
    }
    const strokes = [...over.values()].sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0))
    for (const r of strokes) {
      ctx.globalAlpha = r.opacity
      const moving = this.moving?.ids.has(r.id) ? this.moving : null
      if (moving) {
        ctx.save()
        ctx.translate(moving.dx, moving.dy)
      }
      this.drawOne(ctx, r, cam, level, stats)
      if (moving) ctx.restore()
    }
    ctx.globalAlpha = 1
    return strokes.length
  }

  /** The selection's frame: a dashed group box (1.5 px, 6 px out) or a plain one, and white corner handles. */
  private drawFrame(ctx: DrawContext, f: SelectionFrame, cam: Camera) {
    const k = 1 / cam.zoom
    // Where the select tool takes the handles (HANDLE_PAD).
    const pad = 6 * k
    const { x, y, w, h } = f.box
    ctx.strokeStyle = FRAME_COLOUR
    ctx.lineWidth = 1.5 * k
    if (f.dashed) {
      ctx.setLineDash?.([5 * k, 4 * k])
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2)
      ctx.setLineDash?.([])
    }
    if (f.handles) {
      const hs = 8 * k
      for (const [cx, cy] of [[x - pad, y - pad], [x + w + pad, y - pad], [x - pad, y + h + pad], [x + w + pad, y + h + pad]]) {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs)
        ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs)
      }
    }
    if (f.edges) {
      const hs = 9 * k
      ctx.strokeRect(x, y, w, h)
      for (const [cx, cy] of [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]]) {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs)
        ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs)
      }
    }
    if (f.label && cam.zoom > 0.15) {
      ctx.fillStyle = LABEL_COLOUR
      ctx.font = `${11 * k}px 'Geist Mono', monospace`
      ctx.fillText(f.label, x - pad, y - pad - 10 * k)
    }
  }

  /** A board in the host's look: rounded, softly filled, its title in a chip on the top edge. */
  private drawBoard(ctx: DrawContext, r: ElementRecord, cam: Camera, look: BoardLook) {
    const x = Math.min(r.x, r.x + r.w)
    const y = Math.min(r.y, r.y + r.h)
    const w = Math.abs(r.w)
    const h = Math.abs(r.h)
    const k = Math.min(look.radius, w / 2, h / 2)
    const q = Math.PI / 2
    ctx.beginPath()
    ctx.moveTo(x + k, y)
    ctx.lineTo(x + w - k, y)
    ctx.ellipse(x + w - k, y + k, k, k, 0, -q, 0)
    ctx.lineTo(x + w, y + h - k)
    ctx.ellipse(x + w - k, y + h - k, k, k, 0, 0, q)
    ctx.lineTo(x + k, y + h)
    ctx.ellipse(x + k, y + h - k, k, k, 0, q, 2 * q)
    ctx.lineTo(x, y + k)
    ctx.ellipse(x + k, y + k, k, k, 0, 2 * q, 3 * q)
    ctx.closePath()
    ctx.fillStyle = look.fill
    ctx.fill()
    const current = this.currentBoard === r.id
    ctx.strokeStyle = current ? look.current : look.stroke
    ctx.lineWidth = current ? 2 : 1
    ctx.stroke()
    const empty = !this.occupied.has(r.id)
    if (empty) {
      const hint = dropHint(typeof r.props.purpose === 'string' ? r.props.purpose : '')
      if (hint && cam.zoom > 0.25) {
        ctx.fillStyle = '#a8a397'
        ctx.font = '13px Geist, sans-serif'
        ctx.fillText(hint, x + 16, y + h / 2)
      }
    }
    const name = typeof r.props.name === 'string' ? r.props.name : ''
    if (name && cam.zoom > 0.08) {
      // Scene units: the title scales with the board, as the chrome's frames do.
      const tw = name.length * 7 + 16
      ctx.fillStyle = look.titleBg
      ctx.fillRect(x + 14, y - 10, tw, 20)
      ctx.fillStyle = current ? look.current : look.title
      ctx.font = '600 12px Geist, sans-serif'
      ctx.fillText(name, x + 22, y + 4)
    }
  }

  private drawOne(ctx: DrawContext, r: ElementRecord, cam: Camera, level: Level, stats: DrawStats) {
    const stroke = resolveInk(r.style.stroke, this.inkPalette)
    switch (r.kind) {
      case 'stroke': {
        const pts = this.scene.points(r.id)
        if (!pts) return
        const p = this.pathOf(pts, r.style.width ?? 4, stats)
        ctx.save()
        ctx.translate(r.x, r.y)
        // A stroke scaled by the handles keeps its points: its box over theirs is its scale.
        const { sx, sy } = strokeScale(r, pts)
        if (ctx.scale && (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6)) ctx.scale(sx, sy)
        ctx.fillStyle = stroke
        ctx.fill(p)
        ctx.restore()
        return
      }
      case 'image': {
        const sha = typeof r.props.assetSha === 'string' ? r.props.assetSha : null
        const bm = sha ? (this.host.bitmap(sha, level) ?? this.host.bitmap(sha, level === 'full' ? 'small' : 'full')) : undefined
        // Turned about its centre (a picture in a stack: a pile of photos).
        const turned = !!r.rotation && !!ctx.rotate
        if (turned) {
          ctx.save()
          ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
          ctx.rotate!(r.rotation)
          ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2))
        }
        // A picture in a stack is a photo: a soft shadow and a white edge, so the ones below read apart.
        if (r.props.stack) {
          const b = photoEdge(r)
          ctx.fillStyle = 'rgba(0, 0, 0, 0.14)'
          ctx.fillRect(r.x - b + 2, r.y - b + 5, r.w + b * 2, r.h + b * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(r.x - b, r.y - b, r.w + b * 2, r.h + b * 2)
        }
        if (bm) ctx.drawImage(bm, r.x, r.y, r.w, r.h)
        else {
          ctx.fillStyle = '#eeeeee'
          ctx.fillRect(r.x, r.y, r.w, r.h)
        }
        if (turned) ctx.restore()
        return
      }
      case 'board':
      case 'frame':
      case 'sketch': {
        if (r.kind === 'board' && this.boardLook) return this.drawBoard(ctx, r, cam, this.boardLook)
        if (r.kind === 'sketch' || r.style.fill) {
          ctx.fillStyle = r.style.fill ?? '#ffffff'
          ctx.fillRect(r.x, r.y, r.w, r.h)
        }
        ctx.strokeStyle = r.kind === 'board' ? '#c9c3b5' : r.kind === 'sketch' ? '#5a6b8c' : stroke
        ctx.lineWidth = 2 / cam.zoom
        // An empty board is dashed, with its purpose's drop hint (ui-behaviour 3.2).
        const empty = r.kind === 'board' && !this.occupied.has(r.id)
        if (empty) ctx.setLineDash?.([8 / cam.zoom, 6 / cam.zoom])
        ctx.strokeRect(r.x, r.y, r.w, r.h)
        if (empty) {
          ctx.setLineDash?.([])
          const hint = dropHint(typeof r.props.purpose === 'string' ? r.props.purpose : '')
          if (hint && cam.zoom > 0.25) {
            ctx.fillStyle = '#a8a397'
            ctx.font = `${13 / cam.zoom}px Geist, sans-serif`
            ctx.fillText(hint, r.x + 16 / cam.zoom, r.y + r.h / 2)
          }
        }
        // A sketch area says its ratio is held (ui-behaviour 3.7: "16:9 locked").
        if (r.kind === 'sketch' && typeof r.props.ratio === 'string' && cam.zoom > 0.2) {
          ctx.fillStyle = '#6B7180'
          ctx.font = `${11 / cam.zoom}px 'Geist Mono', monospace`
          ctx.fillText(`${r.props.ratio} locked`, r.x + 10 / cam.zoom, r.y + r.h - 10 / cam.zoom)
        }
        const name = typeof r.props.name === 'string' ? r.props.name : ''
        if (name && cam.zoom > 0.08) {
          ctx.fillStyle = '#8a8579'
          ctx.font = `${14 / cam.zoom}px Geist, sans-serif`
          ctx.fillText(name, r.x, r.y - 6 / cam.zoom)
        }
        return
      }
      case 'text': {
        ctx.fillStyle = stroke
        const size = r.style.fontSize ?? 20
        ctx.font = `${size}px ${r.style.fontFamily ?? 'Geist'}, sans-serif`
        const plain = typeof r.props.plain === 'string' ? r.props.plain : ''
        plain.split('\n').forEach((line, i) => ctx.fillText(line, r.x, r.y + size * (i + 1)))
        return
      }
      case 'arrow':
      case 'link': {
        // Bound links are drawn in their own pass (drawLink); this is an arrow, or a link whose ends are gone.
        const route = Array.isArray(r.props.route) ? (r.props.route as number[]) : [0, 0, r.w, r.h]
        ctx.strokeStyle = r.kind === 'link' ? '#4a7fd4' : stroke
        ctx.lineWidth = (r.style.width ?? 2) / (r.kind === 'link' ? cam.zoom : 1)
        ctx.beginPath()
        ctx.moveTo(r.x + route[0], r.y + route[1])
        for (let i = 2; i + 1 < route.length; i += 2) ctx.lineTo(r.x + route[i], r.y + route[i + 1])
        ctx.stroke()
        return
      }
      default: {
        // shape: rect, ellipse, diamond, line
        ctx.strokeStyle = stroke
        ctx.lineWidth = r.style.width ?? 2
        const geo = r.props.geo
        if (geo === 'ellipse') {
          ctx.beginPath()
          ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2)
          if (r.style.fill) {
            ctx.fillStyle = r.style.fill
            ctx.fill()
          }
          ctx.stroke()
        } else if (geo === 'diamond') {
          ctx.beginPath()
          ctx.moveTo(r.x + r.w / 2, r.y)
          ctx.lineTo(r.x + r.w, r.y + r.h / 2)
          ctx.lineTo(r.x + r.w / 2, r.y + r.h)
          ctx.lineTo(r.x, r.y + r.h / 2)
          ctx.closePath()
          if (r.style.fill) {
            ctx.fillStyle = r.style.fill
            ctx.fill()
          }
          ctx.stroke()
        } else if (geo === 'line') {
          ctx.beginPath()
          ctx.moveTo(r.x, r.y)
          ctx.lineTo(r.x + r.w, r.y + r.h)
          ctx.stroke()
        } else {
          if (r.style.fill) {
            ctx.fillStyle = r.style.fill
            ctx.fillRect(r.x, r.y, r.w, r.h)
          }
          ctx.strokeRect(r.x, r.y, r.w, r.h)
        }
      }
    }
  }
}
