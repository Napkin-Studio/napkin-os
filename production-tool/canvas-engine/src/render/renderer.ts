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
  fillRect(x: number, y: number, w: number, h: number): void
  strokeRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void
  closePath(): void
  stroke(): void
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

const DEFAULT_INK = '#1e1e1e'

/** A stroke's filled outline, from its points relative to its origin. */
export function strokeOutline(pts: Uint8Array, size: number): number[][] {
  const input = localPoints(pts).map((p) => [p.x, p.y, p.pressure])
  return getStroke(input, { size, thinning: 0.6, smoothing: 0.5, streamline: 0.4, simulatePressure: false, last: true })
}

/** The outline of a stroke still being drawn (the live-ink canvas), from its points in scene coordinates. */
export function liveOutline(points: readonly { x: number; y: number; pressure: number }[], size: number, last = false): number[][] {
  return getStroke(points.map((p) => [p.x, p.y, p.pressure]), { size, thinning: 0.6, smoothing: 0.5, streamline: 0.4, simulatePressure: false, last })
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

  private order(): ElementRecord[] {
    this.ordered ??= this.scene.all().filter((r) => r.kind !== 'node').sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0))
    return this.ordered
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
    ctx.fillStyle = background
    ctx.fillRect(0, 0, viewport.width * dpr, viewport.height * dpr)
    const s = dpr * cam.zoom
    ctx.setTransform(s, 0, 0, s, s * cam.scrollX, s * cam.scrollY)
    const visible = new Set(this.tree.search(Renderer.view(cam, viewport)).map((b) => b.id))
    const minPx = 1.5 / cam.zoom
    const level: Level = cam.zoom < FULL_RES_MIN_ZOOM ? 'small' : 'full'
    for (const r of this.order()) {
      if (!visible.has(r.id)) {
        stats.culled++
        continue
      }
      if (r.kind === 'stroke' && Math.abs(r.w) < minPx && Math.abs(r.h) < minPx) {
        stats.culled++
        continue
      }
      stats.drawn++
      ctx.globalAlpha = r.opacity
      const moving = this.moving?.ids.has(r.id) ? this.moving : null
      if (moving) {
        ctx.save()
        ctx.translate(moving.dx, moving.dy)
      }
      this.drawOne(ctx, r, cam, level, stats)
      if (this.selected.has(r.id)) {
        ctx.strokeStyle = '#4a7fd4'
        ctx.lineWidth = 2 / cam.zoom
        ctx.strokeRect(r.x - 4 / cam.zoom, r.y - 4 / cam.zoom, r.w + 8 / cam.zoom, r.h + 8 / cam.zoom)
      }
      if (moving) ctx.restore()
    }
    ctx.globalAlpha = 1
    stats.ms = performance.now() - t0
    return stats
  }

  private drawOne(ctx: DrawContext, r: ElementRecord, cam: Camera, level: Level, stats: DrawStats) {
    const stroke = r.style.stroke ?? DEFAULT_INK
    switch (r.kind) {
      case 'stroke': {
        const pts = this.scene.points(r.id)
        if (!pts) return
        const p = this.pathOf(pts, r.style.width ?? 4, stats)
        ctx.save()
        ctx.translate(r.x, r.y)
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
        if (r.kind === 'sketch' || r.style.fill) {
          ctx.fillStyle = r.style.fill ?? '#ffffff'
          ctx.fillRect(r.x, r.y, r.w, r.h)
        }
        ctx.strokeStyle = r.kind === 'board' ? '#c9c3b5' : r.kind === 'sketch' ? '#5a6b8c' : stroke
        ctx.lineWidth = 2 / cam.zoom
        ctx.strokeRect(r.x, r.y, r.w, r.h)
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
