// The Image editor's stage (ui-behaviour 3.12): the frame at its locked ratio, zoomed and panned,
// with the edits drawn over it. Mask paint is translucent tool blue with marching ants ("Mask: blue
// paint marks what changes"); text sits in front and moves with Select; crop keeps the ratio. The
// pointer does what the tool says; Space held is the Hand.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EditSession, MaskOp, Pt } from './edits'
import { edges, rasterize, type AlphaOf } from './mask'
import { compose, type Plan } from './compose'
import { cropRect, type ToolId } from './tools'

const BLUE = [47, 100, 245]
const OVERLAY_MAX = 1100

export interface Brush { size: number; soft: number; mode: 'add' | 'sub' }

export function Stage({ src, plan, image, w, h, session, tool, brush, zoom, pan, onPan, before, motion, alphaOf,
  onMaskOp, onClick, onAddText, onText, onCrop, pending, children }: {
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
  onMaskOp: (op: MaskOp) => void
  onClick: (p: Pt) => void
  onAddText: (p: Pt) => void
  onText: (id: string, patch: { text?: string; x?: number; y?: number }) => void
  onCrop: (r: { x: number; y: number; w: number; h: number }) => void
  /** A fill is running on this mask: its area shows the pending stripes. */
  pending?: string
  children?: ReactNode
}) {
  const frame = useRef<HTMLDivElement>(null)
  const pic = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState(false)
  const [live, setLive] = useState<MaskOp | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [cropDrag, setCropDrag] = useState<{ a: Pt; b: Pt } | null>(null)
  const drag = useRef<{ kind: 'pan' | 'text'; from: Pt; start: Pt; id?: string } | null>(null)
  const [ants, setAnts] = useState(0)

  // The picture as the edits make it (no text or crop: those are drawn over it here).
  const planKey = JSON.stringify(plan)
  useEffect(() => {
    let alive = true
    const c = pic.current
    if (!c || before) return
    void compose(plan, image, (id, mw, mh) => {
      const m = session.edits.find((e) => e.id === id)
      return m && m.kind === 'mask' ? rasterize(m.ops, mw, mh, alphaOf) : new Uint8Array(mw * mh)
    }).then((out) => {
      if (!alive) return
      c.width = out.width
      c.height = out.height
      c.getContext('2d')?.drawImage(out, 0, 0)
      setDrawn(true)
    }).catch(() => alive && setDrawn(false))
    return () => { alive = false }
    // planKey stands for plan; the masks change the picture only through a fill's plan step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, before])

  // The masks, as overlay pixels: committed steps once per change.
  const ow = Math.min(w, OVERLAY_MAX)
  const oh = Math.max(1, Math.round((ow * h) / w))
  const masks = useMemo(() => session.edits.filter((e) => e.kind === 'mask' && !session.hidden.includes(e.id)), [session])
  const raster = useMemo(() => {
    const out = new Uint8Array(ow * oh)
    for (const m of masks) if (m.kind === 'mask') {
      const r = rasterize(m.ops, ow, oh, alphaOf)
      for (let i = 0; i < out.length; i++) if (r[i] > out[i]) out[i] = r[i]
    }
    return out
  }, [masks, ow, oh, alphaOf])
  const rim = useMemo(() => edges(raster, ow, oh), [raster, ow, oh])

  // Marching ants: the edge's dashes move, unless motion is reduced.
  useEffect(() => {
    if (!motion) return
    const t = setInterval(() => setAnts((a) => (a + 1) % 8), 140)
    return () => clearInterval(t)
  }, [motion])

  useEffect(() => {
    const c = overlay.current
    if (!c) return
    c.width = ow
    c.height = oh
    const ctx = c.getContext('2d')
    if (!ctx) return // no 2D canvas here (a test DOM): the masks are drawn nowhere
    ctx.clearRect(0, 0, ow, oh)
    if (before) return
    const img = ctx.createImageData(ow, oh)
    const d = img.data
    for (let i = 0; i < raster.length; i++) {
      if (rim[i]) {
        const x = i % ow, y = (i / ow) | 0
        const on = ((x + y + ants) & 7) < 4
        d[i * 4] = on ? 255 : 20; d[i * 4 + 1] = on ? 255 : 22; d[i * 4 + 2] = on ? 255 : 27; d[i * 4 + 3] = 255
      } else if (raster[i]) {
        d[i * 4] = BLUE[0]; d[i * 4 + 1] = BLUE[1]; d[i * 4 + 2] = BLUE[2]; d[i * 4 + 3] = Math.round(raster[i] * 0.38)
      }
    }
    ctx.putImageData(img, 0, 0)
    if (live && live.t === 'brush') {
      ctx.save()
      ctx.globalCompositeOperation = live.mode === 'add' ? 'source-over' : 'destination-out'
      ctx.strokeStyle = ctx.fillStyle = `rgba(${BLUE.join(',')},0.38)`
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = live.r * 2 * ow
      ctx.beginPath()
      live.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * ow, p.y * oh) : ctx.moveTo(p.x * ow, p.y * oh)))
      if (live.pts.length === 1) ctx.lineTo(live.pts[0].x * ow + 0.1, live.pts[0].y * oh)
      ctx.stroke()
      ctx.restore()
    }
  }, [raster, rim, ants, live, ow, oh, before])

  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = frame.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const r = brush.size / 2 / w
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || before) return
    const p = at(e)
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    if (tool === 'hand') drag.current = { kind: 'pan', from: { x: e.clientX, y: e.clientY }, start: pan }
    else if (tool === 'brush' || tool === 'eraser') {
      setLive({ t: 'brush', mode: tool === 'eraser' ? 'sub' : brush.mode, r, soft: brush.soft / 100, pts: [p] })
    } else if (tool === 'lasso') setLive({ t: 'lasso', mode: brush.mode, pts: [p] })
    else if (tool === 'click') onClick(p)
    else if (tool === 'text') onAddText(p)
    else if (tool === 'crop') setCropDrag({ a: p, b: p })
  }
  const onMove = (e: React.PointerEvent) => {
    const p = at(e)
    setCursor(p)
    const dr = drag.current
    if (dr?.kind === 'pan') onPan({ x: dr.start.x + (e.clientX - dr.from.x) / zoom, y: dr.start.y + (e.clientY - dr.from.y) / zoom })
    else if (dr?.kind === 'text' && dr.id) onText(dr.id, { x: Math.min(0.98, Math.max(0, dr.start.x + p.x - dr.from.x)), y: Math.min(0.98, Math.max(0, dr.start.y + p.y - dr.from.y)) })
    if (live && (live.t === 'brush' || live.t === 'lasso')) setLive({ ...live, pts: [...live.pts, p] } as MaskOp)
    if (cropDrag) setCropDrag({ ...cropDrag, b: p })
  }
  const onUp = () => {
    drag.current = null
    if (live) {
      if (live.t !== 'lasso' || live.pts.length >= 3) onMaskOp(live)
      setLive(null)
    }
    if (cropDrag) {
      if (Math.abs(cropDrag.b.x - cropDrag.a.x) > 0.02 || Math.abs(cropDrag.b.y - cropDrag.a.y) > 0.02) onCrop(cropRect(cropDrag.a, cropDrag.b))
      setCropDrag(null)
    }
  }
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

  return (
    <div className="ie-viewport" style={{ aspectRatio: `${w} / ${h}` }} data-tool={tool}>
      <div ref={frame} className={`ie-frame tool-${tool}`} style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setCursor(null)}>
        {src && (before || !drawn) && <img className="ie-pic" src={src} alt="" draggable={false} />}
        <canvas ref={pic} className="ie-pic" hidden={before || !drawn} />
        <canvas ref={overlay} className="ie-mask" aria-hidden="true" />
        {live?.t === 'lasso' && (
          <svg className="ie-lasso" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={live.pts.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
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
        {cursor && !before && (tool === 'brush' || tool === 'eraser') && (
          <div className="ie-cursor" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, width: `${r * 200}%`, aspectRatio: '1' }} aria-hidden="true" />
        )}
        {children}
      </div>
    </div>
  )
}
