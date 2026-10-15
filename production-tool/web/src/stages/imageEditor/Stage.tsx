// The Image editor's stage (ui-behaviour 3.12): the frame at its locked ratio, zoomed and panned,
// with the edits drawn over it. Mask paint is translucent tool blue with marching ants ("Mask: blue
// paint marks what changes"); text sits in front and moves with Select; crop keeps the ratio. The
// pointer does what the tool says; Space held is the Hand.
//
// Input (features/image-editor-masks-layers.clan): the viewport takes the pointer, so a stroke can start
// on the margin when zoomed out (Click and Text need a point on the picture). A stroke belongs to the
// pointer that started it: another finger or pen is ignored, hover moves add nothing, and pointercancel
// drops the stroke. The live stroke is drawn on its own canvas once per animation frame, so a move
// never redraws the committed masks. A running job never covers the stage: its area shows the pending
// stripes (a fill) or a progress edge (a whole-frame job), and its status and Cancel sit in its Edits row.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EditSession, MaskOp, Pt } from './edits'
import { edges, rasterize, RasterCache, type AlphaOf } from './mask'
import { compose, type Plan } from './compose'
import { cropRect, type ToolId } from './tools'

const BLUE = [47, 100, 245]
const OVERLAY_MAX = 1100
/** Where a press belongs to the control under it, not to the stage. */
const UI = 'button, a, input, textarea, select, [data-ie-ui]'

export interface Brush { size: number; soft: number; mode: 'add' | 'sub' }

/** The marching ants on the rim's pixels only, then just the rim's box put back on the canvas (or all of it, once). */
function antsOn(ctx: CanvasRenderingContext2D, s: { img: ImageData; rim: Int32Array; box: [number, number, number, number] }, ants: number, all: boolean) {
  const d = s.img.data, w = s.img.width
  for (const i of s.rim) {
    const on = (((i % w) + ((i / w) | 0) + ants) & 7) < 4
    d[i * 4] = on ? 255 : 20; d[i * 4 + 1] = on ? 255 : 22; d[i * 4 + 2] = on ? 255 : 27
  }
  const [x0, y0, x1, y1] = s.box
  if (all) ctx.putImageData(s.img, 0, 0)
  else if (x1 >= 0) ctx.putImageData(s.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
}

type Live = { id: number; op: Extract<MaskOp, { t: 'brush' | 'lasso' }>; drawn: number }

export function Stage({ src, plan, image, w, h, session, tool, brush, zoom, pan, onPan, before, motion, alphaOf, alphaKey, onDrawn,
  onMaskOp, onClick, onAddText, onText, onCrop, pending, progress, children }: {
  /** The frame as saved, for Before and while the preview draws. */
  src?: string
  plan: Plan
  image: (sha: string) => Promise<CanvasImageSource>
  w: number
  h: number
  session: EditSession
  tool: ToolId
  brush: Brush
  zoom: number
  pan: Pt
  onPan: (p: Pt) => void
  before: boolean
  motion: boolean
  alphaOf: AlphaOf
  /** What a cut-out's alpha is drawn from ('' while it loads): part of a snap step's cache key. */
  alphaKey?: (cutoutId: string) => string
  /** The picture drew (null) or could not (why): a failure keeps the last good picture on the stage. */
  onDrawn?: (error: string | null) => void
  onMaskOp: (op: MaskOp) => void
  onClick: (p: Pt) => void
  onAddText: (p: Pt) => void
  onText: (id: string, patch: { text?: string; x?: number; y?: number }) => void
  onCrop: (r: { x: number; y: number; w: number; h: number }) => void
  /** A fill is running on this mask: its area shows the pending stripes. */
  pending?: string
  /** A whole-frame job is running: a progress edge along the top. */
  progress?: boolean
  children?: ReactNode
}) {
  const frame = useRef<HTMLDivElement>(null)
  const pic = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const liveCanvas = useRef<HTMLCanvasElement>(null)
  const cursorEl = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)
  const live = useRef<Live | null>(null)
  const raf = useRef(0)
  const [redraw, setRedraw] = useState(0)
  const [cropDrag, setCropDrag] = useState<{ a: Pt; b: Pt } | null>(null)
  const drag = useRef<{ kind: 'pan' | 'text'; from: Pt; start: Pt; id?: string } | null>(null)
  const [ants, setAnts] = useState(0)
  // Committed masks, drawn incrementally: a new stroke draws only itself (features/image-editor-masks-layers.clan).
  const [cache] = useState(() => new RasterCache())
  const shown = useRef<{ img: ImageData; rim: Int32Array; box: [number, number, number, number] } | null>(null)

  // The picture as the edits make it (no text or crop: those are drawn over it here).
  const planKey = JSON.stringify(plan)
  useEffect(() => {
    let alive = true
    const c = pic.current
    if (!c || before) return
    void compose(plan, image, (id, mw, mh) => {
      const m = session.edits.find((e) => e.id === id)
      return m && m.kind === 'mask' ? cache.get(m.id, m.ops, mw, mh, alphaOf, alphaKey) : new Uint8Array(mw * mh)
    }).then((out) => {
      if (!alive) return
      c.width = out.width
      c.height = out.height
      c.getContext('2d')?.drawImage(out, 0, 0)
      setDrawn(true)
      onDrawn?.(null)
    }).catch((e) => {
      // The last good picture stays (or the frame as saved, before the first): never a blank, never a silent revert.
      if (alive) onDrawn?.(e instanceof Error ? e.message : 'something went wrong')
    })
    return () => { alive = false }
    // planKey stands for plan; the masks change the picture only through a fill's plan step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, before])

  // The masks, as overlay pixels: committed steps once per change.
  const ow = Math.min(w, OVERLAY_MAX)
  const oh = Math.max(1, Math.round((ow * h) / w))
  const masks = useMemo(() => session.edits.filter((e) => e.kind === 'mask' && !session.hidden.includes(e.id)), [session])
  const raster = useMemo(() => {
    cache.retain(new Set(session.edits.filter((e) => e.kind === 'mask').map((e) => e.id)))
    const drawn = masks.flatMap((m) => (m.kind === 'mask' ? [cache.get(m.id, m.ops, ow, oh, alphaOf, alphaKey)] : []))
    if (drawn.length === 1) return drawn[0]
    const out = new Uint8Array(ow * oh)
    for (const r of drawn) for (let i = 0; i < out.length; i++) if (r[i] > out[i]) out[i] = r[i]
    return out
  }, [cache, session.edits, masks, ow, oh, alphaOf, alphaKey])
  const rim = useMemo(() => edges(raster, ow, oh), [raster, ow, oh])

  // Marching ants: the edge's dashes move, unless motion is reduced (and they wait while a stroke is drawn).
  useEffect(() => {
    if (!motion) return
    const t = setInterval(() => { if (!live.current) setAnts((a) => (a + 1) % 8) }, 140)
    return () => clearInterval(t)
  }, [motion])

  // The masks drawn once per change: blue paint and the rim. The ants then move only the rim's pixels.
  useEffect(() => {
    const c = overlay.current
    if (!c) return
    c.width = ow
    c.height = oh
    const ctx = c.getContext('2d')
    shown.current = null
    if (!ctx) return // no 2D canvas here (a test DOM): the masks are drawn nowhere
    ctx.clearRect(0, 0, ow, oh)
    if (before) return
    const img = ctx.createImageData(ow, oh)
    const d = img.data
    let n = 0
    for (let i = 0; i < raster.length; i++) if (rim[i]) n++
    const rims = new Int32Array(n)
    let k = 0, x0 = ow, y0 = oh, x1 = -1, y1 = -1
    for (let i = 0; i < raster.length; i++) {
      if (rim[i]) {
        rims[k++] = i
        const x = i % ow, y = (i / ow) | 0
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        d[i * 4 + 3] = 255
      } else if (raster[i]) {
        d[i * 4] = BLUE[0]; d[i * 4 + 1] = BLUE[1]; d[i * 4 + 2] = BLUE[2]; d[i * 4 + 3] = Math.round(raster[i] * 0.38)
      }
    }
    shown.current = { img, rim: rims, box: [x0, y0, x1, y1] }
    antsOn(ctx, shown.current, ants, true)
    c.dataset.drawn = String(Number(c.dataset.drawn ?? 0) + 1) // a count the e2e timing reads
    // ants: drawn by the effect below from here on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raster, rim, ow, oh, before, redraw])
  useEffect(() => {
    const ctx = overlay.current?.getContext('2d')
    if (ctx && shown.current && !before) antsOn(ctx, shown.current, ants, false)
  }, [ants, before])

  // The live stroke, once per animation frame: a brush adds only its new segments (on its own canvas,
  // or, subtracting, out of the committed one); a lasso redraws its outline.
  const paintLive = () => {
    raf.current = 0
    const s = live.current
    const c = liveCanvas.current
    if (!s || !c) return
    if (c.width !== ow || c.height !== oh) { c.width = ow; c.height = oh }
    const op = s.op
    if (op.t === 'lasso') {
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, ow, oh)
      ctx.beginPath()
      op.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * ow, p.y * oh) : ctx.moveTo(p.x * ow, p.y * oh)))
      ctx.closePath()
      ctx.fillStyle = `rgba(${BLUE.join(',')},${op.mode === 'add' ? 0.3 : 0.12})`
      ctx.fill()
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 1.4
      ctx.strokeStyle = '#FFFFFF'
      ctx.stroke()
      return
    }
    const ctx = (op.mode === 'add' ? c : overlay.current)?.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.globalCompositeOperation = op.mode === 'add' ? 'source-over' : 'destination-out'
    ctx.strokeStyle = ctx.fillStyle = `rgb(${BLUE.join(',')})`
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = op.r * 2 * ow
    const from = Math.max(0, s.drawn - 1)
    if (op.pts.length === 1 && s.drawn === 0) {
      ctx.beginPath()
      ctx.arc(op.pts[0].x * ow, op.pts[0].y * oh, op.r * ow, 0, Math.PI * 2)
      ctx.fill()
    } else if (op.pts.length - from > 1) {
      ctx.beginPath()
      ctx.moveTo(op.pts[from].x * ow, op.pts[from].y * oh)
      for (let i = from + 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i].x * ow, op.pts[i].y * oh)
      ctx.stroke()
    }
    ctx.restore()
    s.drawn = op.pts.length
  }
  const schedule = () => { if (!raf.current) raf.current = requestAnimationFrame(paintLive) }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  /** Where the pointer is, 0-1 of the picture (outside it on the margin). */
  const rel = (e: { clientX: number; clientY: number }): Pt => {
    const r = frame.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const clamp = (p: Pt): Pt => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) })
  const at = (e: { clientX: number; clientY: number }): Pt => clamp(rel(e))
  const r = brush.size / 2 / w

  /** The stroke ends: kept (pointerup, or the pointer gone without one) or dropped (pointercancel). */
  const finish = (keep: boolean) => {
    const s = live.current
    if (!s) return
    live.current = null
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0 }
    const c = liveCanvas.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    const ok = keep && (s.op.t !== 'lasso' || s.op.pts.length >= 3)
    if (ok) onMaskOp(s.op)
    // A dropped subtract drew out of the committed masks: draw them again.
    if (!ok || s.op.mode === 'sub') setRedraw((n) => n + 1)
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || before || live.current) return // a second pointer during a stroke adds nothing
    if ((e.target as Element).closest?.(UI)) return
    const raw = rel(e)
    const inside = raw.x >= 0 && raw.x <= 1 && raw.y >= 0 && raw.y <= 1
    if ((tool === 'click' || tool === 'text') && !inside) return
    const p = clamp(raw)
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    if (tool === 'hand') drag.current = { kind: 'pan', from: { x: e.clientX, y: e.clientY }, start: pan }
    else if (tool === 'brush' || tool === 'eraser') {
      live.current = { id: e.pointerId, drawn: 0, op: { t: 'brush', mode: tool === 'eraser' ? 'sub' : brush.mode, r, soft: brush.soft / 100, pts: [p] } }
      liveCanvas.current?.setAttribute('data-mode', 'brush')
      schedule()
    } else if (tool === 'lasso') {
      live.current = { id: e.pointerId, drawn: 0, op: { t: 'lasso', mode: brush.mode, pts: [p] } }
      liveCanvas.current?.setAttribute('data-mode', 'lasso')
      schedule()
    } else if (tool === 'click') onClick(p)
    else if (tool === 'text') onAddText(p)
    else if (tool === 'crop') setCropDrag({ a: p, b: p })
  }
  const onMove = (e: React.PointerEvent) => {
    const raw = rel(e)
    const cur = cursorEl.current
    if (cur) {
      cur.style.display = ''
      cur.style.left = `${raw.x * 100}%`
      cur.style.top = `${raw.y * 100}%`
    }
    const s = live.current
    if (s) {
      if (e.pointerId !== s.id) return
      if (!(e.buttons & 1)) return finish(true) // the button came up where we did not hear it
      const pts = e.nativeEvent.getCoalescedEvents?.() ?? []
      for (const ev of pts.length ? pts : [e]) s.op.pts.push(clamp(rel(ev)))
      schedule()
      return
    }
    const p = clamp(raw)
    const dr = drag.current
    if (dr?.kind === 'pan') onPan({ x: dr.start.x + (e.clientX - dr.from.x) / zoom, y: dr.start.y + (e.clientY - dr.from.y) / zoom })
    else if (dr?.kind === 'text' && dr.id) onText(dr.id, { x: Math.min(0.98, Math.max(0, dr.start.x + p.x - dr.from.x)), y: Math.min(0.98, Math.max(0, dr.start.y + p.y - dr.from.y)) })
    if (cropDrag) setCropDrag({ ...cropDrag, b: p })
  }
  const onUp = (e: React.PointerEvent) => {
    const s = live.current
    if (s && e.pointerId !== s.id) return
    drag.current = null
    if (s) finish(true)
    if (cropDrag) {
      if (Math.abs(cropDrag.b.x - cropDrag.a.x) > 0.02 || Math.abs(cropDrag.b.y - cropDrag.a.y) > 0.02) onCrop(cropRect(cropDrag.a, cropDrag.b))
      setCropDrag(null)
    }
  }
  const onCancel = (e: React.PointerEvent) => {
    if (live.current?.id === e.pointerId) finish(false)
    drag.current = null
    setCropDrag(null)
  }
  const onLost = (e: React.PointerEvent) => { if (live.current?.id === e.pointerId) finish(true) }

  const kept = session.edits.find((e) => e.kind === 'crop' && !session.hidden.includes(e.id))
  const crop = cropDrag ? cropRect(cropDrag.a, cropDrag.b) : kept && kept.kind === 'crop' ? kept : undefined
  const texts = session.edits.filter((e) => e.kind === 'text' && !session.hidden.includes(e.id))
  const pendingMask = pending ? session.edits.find((e) => e.id === pending) : undefined
  const pendingBox = useMemo(() => {
    if (!pendingMask || pendingMask.kind !== 'mask') return null
    const m = rasterize(pendingMask.ops, 64, Math.max(1, Math.round((64 * h) / w)))
    let x0 = 64, y0 = 999, x1 = -1, y1 = -1
    const mh = m.length / 64
    for (let y = 0; y < mh; y++) for (let x = 0; x < 64; x++) if (m[y * 64 + x] >= 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    return x1 < 0 ? null : { left: `${(x0 / 64) * 100}%`, top: `${(y0 / mh) * 100}%`, width: `${((x1 - x0 + 1) / 64) * 100}%`, height: `${((y1 - y0 + 1) / mh) * 100}%` }
  }, [pendingMask, w, h])
  const brushy = !before && (tool === 'brush' || tool === 'eraser')

  return (
    <div className="ie-viewport" style={{ aspectRatio: `${w} / ${h}`, '--ie-ratio': w / h } as React.CSSProperties} data-tool={tool}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onLostPointerCapture={onLost}
      onPointerLeave={() => { if (cursorEl.current) cursorEl.current.style.display = 'none' }}>
      <div ref={frame} className={`ie-frame tool-${tool}`} style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }}>
        {src && (before || !drawn) && <img className="ie-pic" src={src} alt="" draggable={false} />}
        <canvas ref={pic} className="ie-pic" hidden={before || !drawn} />
        <canvas ref={overlay} className="ie-mask" aria-hidden="true" />
        <canvas ref={liveCanvas} className="ie-live" aria-hidden="true" />
        {pendingBox && <div className="ie-pending pending" style={pendingBox} aria-hidden="true" />}
        {!before && texts.map((t) => t.kind === 'text' && (
          <div key={t.id} className="ie-text" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, fontSize: `${t.size * 100}cqh` }}
            contentEditable={tool === 'text'} suppressContentEditableWarning spellCheck={false} role="textbox" aria-label="Text on the frame"
            onPointerDown={(e) => {
              if (tool === 'text') e.stopPropagation() // typing on it, not a new text
              if (tool !== 'select') return
              e.stopPropagation()
              ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
              drag.current = { kind: 'text', from: at(e), start: { x: t.x, y: t.y }, id: t.id }
            }}
            onBlur={(e) => onText(t.id, { text: e.currentTarget.textContent ?? '' })}>{t.text}</div>
        ))}
        {!before && crop && (
          <div className="ie-crop" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} aria-label="The crop, kept at the frame's ratio" />
        )}
        {brushy && <div ref={cursorEl} className="ie-cursor" style={{ display: 'none', width: `${r * 200}%`, aspectRatio: '1' }} aria-hidden="true" />}
      </div>
      {progress && <div className="ie-progress" aria-hidden="true" />}
      {children}
    </div>
  )
}
