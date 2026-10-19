// An image you can mark: draw a box (→ a 0-1 region), paint a mask, or click
// to select. The region is what goes to the relay; a painted mask also becomes
// a PNG (white = change, our convention) at submit time.

import { useEffect, useRef, useState } from 'react'
import type { Region } from '../contracts/types'
import { rectToRegion, regionAround } from '../lib/region'
import { strokesBounds, type Stroke } from '../lib/mask'

export type { Stroke } from '../lib/mask'

export type MarkMode = 'none' | 'box' | 'brush' | 'click'
export function RegionImage({ src, aspect, mode, region, strokes, onRegion, onStrokes, children }: {
  src?: string
  aspect: number
  mode: MarkMode
  region?: Region
  strokes?: Stroke[]
  onRegion: (r: Region | null) => void
  onStrokes?: (s: Stroke[]) => void
  children?: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const painting = useRef<Stroke | null>(null)

  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
  }

  // Draw the painted mask preview.
  useEffect(() => {
    const c = canvas.current
    const el = box.current
    if (!c || !el) return
    const { width, height } = el.getBoundingClientRect()
    c.width = Math.max(1, Math.round(width))
    c.height = Math.max(1, Math.round(height))
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#FF4F2E'
    ctx.fillStyle = '#FF4F2E'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokes ?? []) {
      ctx.lineWidth = s.r * 2 * c.width
      ctx.beginPath()
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * c.width, p.y * c.height) : ctx.moveTo(p.x * c.width, p.y * c.height)))
      if (s.pts.length === 1) {
        ctx.arc(s.pts[0].x * c.width, s.pts[0].y * c.height, s.r * c.width, 0, Math.PI * 2)
        ctx.fill()
      } else ctx.stroke()
    }
  }, [strokes])

  const onDown = (e: React.PointerEvent) => {
    if (mode === 'none' || !src) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = local(e)
    if (mode === 'box') setDrag({ a: p, b: p })
    if (mode === 'click') onRegion(regionAround(p, { w: p.w, h: p.h }))
    if (mode === 'brush') {
      painting.current = { r: 0.035, pts: [{ x: p.x / p.w, y: p.y / p.h }] }
      onStrokes?.([...(strokes ?? []), painting.current])
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const p = local(e)
    if (drag) setDrag({ ...drag, b: p })
    if (painting.current) {
      painting.current = { ...painting.current, pts: [...painting.current.pts, { x: p.x / p.w, y: p.y / p.h }] }
      const next = [...(strokes ?? [])]
      next[next.length - 1] = painting.current
      onStrokes?.(next)
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const p = local(e)
    if (drag) {
      onRegion(rectToRegion(drag.a, p, { w: p.w, h: p.h }))
      setDrag(null)
    }
    if (painting.current) {
      painting.current = null
      onRegion(strokesBounds(strokes ?? []))
    }
  }

  let preview: React.CSSProperties | null = null
  if (drag) {
    preview = { left: Math.min(drag.a.x, drag.b.x), top: Math.min(drag.a.y, drag.b.y), width: Math.abs(drag.b.x - drag.a.x), height: Math.abs(drag.b.y - drag.a.y) }
  } else if (region && mode !== 'brush') {
    preview = { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }
  }

  return (
    <div
      ref={box}
      className={`imgbox ${mode !== 'none' && src ? 'drawing' : ''}`}
      style={{ aspectRatio: String(aspect), touchAction: mode !== 'none' ? 'none' : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {src && <img src={src} alt="" draggable={false} />}
      <canvas ref={canvas} className="maskcanvas" />
      {preview && <div className="regionbox" style={preview} />}
      {children}
    </div>
  )
}
