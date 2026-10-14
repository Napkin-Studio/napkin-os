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
import { boundEnds, linkSegment } from './links'
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
  /** The selection's frame, drawn on top; a dashed group box replaces the members' own outlines. */
  frame: SelectionFrame | null = null
  boardLook: BoardLook | null = null
  linkLook: LinkLook | null = null
  currentBoard: string | null = null
  /** What the ink names mean in the host's theme (ink/palette.ts); the light values until it says. */
  inkPalette: InkPalette = LIGHT_INK

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
    return { minX: Math.min(r.x, r.x + r.w) - pad, minY: Math.min(r.y, r.y + r.h) - pad, maxX: Math.max(r.x, r.x + r.w) + pad, maxY: Math.max(r.y, r.y + r.h) + pad, id: r.id }
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
    }
    return this.ordered
  }

  /** Containers that hold something (refreshed with the order). */
  private occupied = new Set<string>()

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
    for (const r of this.order()) {
      // A bound link is drawn from its ends (it follows them), so its own box never culls it.
      if (!visible.has(r.id) && r.kind !== 'link') {
        stats.culled++
        continue
      }
      if (r.kind === 'stroke' && Math.abs(r.w) < minPx && Math.abs(r.h) < minPx) {
        stats.culled++
        continue
      }
      stats.drawn++
      ctx.globalAlpha = r.opacity
      const moving = r.kind !== 'link' && this.moving?.ids.has(r.id) ? this.moving : null
      const scaling = r.kind !== 'link' && ctx.scale && this.scaling?.ids.has(r.id) ? this.scaling : null
      if (moving || scaling) ctx.save()
      if (moving) ctx.translate(moving.dx, moving.dy)
      if (scaling) {
        ctx.translate(scaling.ox, scaling.oy)
        ctx.scale!(scaling.s, scaling.s)
        ctx.translate(-scaling.ox, -scaling.oy)
      }
      this.drawOne(ctx, r, cam, level, stats)
      if (this.selected.has(r.id) && !this.frame?.dashed) {
        ctx.strokeStyle = '#4a7fd4'
        ctx.lineWidth = 2 / (cam.zoom * (scaling?.s ?? 1))
        const pad = 4 / (cam.zoom * (scaling?.s ?? 1))
        ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
      }
      if (moving || scaling) ctx.restore()
    }
    ctx.globalAlpha = 1
    if (this.frame) this.drawFrame(ctx, this.frame, cam)
    stats.ms = performance.now() - t0
    return stats
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
        if (bm) ctx.drawImage(bm, r.x, r.y, r.w, r.h)
        else {
          ctx.fillStyle = '#eeeeee'
          ctx.fillRect(r.x, r.y, r.w, r.h)
        }
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
        const ends = r.kind === 'link' ? boundEnds((id) => this.scene.get(id), r) : null
        if (ends) {
          // A link runs between its ends' edges, wherever they are now; quiet until an end is selected.
          const { a, b } = linkSegment(this.moved(ends.from), this.moved(ends.to))
          const lit = this.selected.has(r.id) || this.selected.has(ends.from.id) || this.selected.has(ends.to.id)
          const look = this.linkLook
          ctx.globalAlpha = lit || look ? 1 : 0.3
          ctx.strokeStyle = look ? (lit ? look.lit : look.stroke) : '#4a7fd4'
          ctx.lineWidth = (lit ? 2 : 1.5) / cam.zoom
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          const ang = Math.atan2(b.y - a.y, b.x - a.x)
          const head = 9 / cam.zoom
          ctx.moveTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45))
          ctx.lineTo(b.x, b.y)
          ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45))
          ctx.stroke()
          const role = typeof r.props.role === 'string' ? r.props.role : ''
          if (look) {
            if (role && look.roles.includes(role) && cam.zoom > 0.2) {
              // A pill beside the line's middle, in scene units (it scales with the canvas, as Main's does).
              const w = role.length * 6.5 + 16
              const x = (a.x + b.x) / 2 + 10
              const y = (a.y + b.y) / 2 - 10
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
            ctx.fillText(role, (a.x + b.x) / 2 + 6 / cam.zoom, (a.y + b.y) / 2 - 6 / cam.zoom)
          }
          return
        }
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
