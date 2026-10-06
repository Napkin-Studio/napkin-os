// Painted masks: strokes in 0-1 coordinates → a region and a PNG (white = change).

import type { Region } from '../contracts/types'

/** Brush strokes in 0-1 coordinates; radius as a fraction of the image width. */
export type Stroke = { r: number; pts: { x: number; y: number }[] }

export function strokesBounds(strokes: Stroke[]): Region | null {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0
  for (const s of strokes) for (const p of s.pts) {
    x0 = Math.min(x0, p.x - s.r); y0 = Math.min(y0, p.y - s.r)
    x1 = Math.max(x1, p.x + s.r); y1 = Math.max(y1, p.y + s.r)
  }
  if (x1 <= x0 || y1 <= y0) return null
  const cl = (v: number) => Math.min(1, Math.max(0, v))
  const x = cl(x0), y = cl(y0)
  return { x, y, w: Math.max(0.001, cl(x1) - x), h: Math.max(0.001, cl(y1) - y) }
}

/** Render strokes as a PNG mask the size of the image: black = keep, white = change. */
export async function maskPng(strokes: Stroke[], w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#fff'
  ctx.fillStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes) {
    ctx.lineWidth = s.r * 2 * w
    ctx.beginPath()
    s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)))
    if (s.pts.length === 1) {
      ctx.arc(s.pts[0].x * w, s.pts[0].y * h, s.r * w, 0, Math.PI * 2)
      ctx.fill()
    } else ctx.stroke()
  }
  return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the mask.'))), 'image/png'))
}

