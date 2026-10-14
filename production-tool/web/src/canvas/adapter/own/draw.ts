// Drawing the own engine's scene (features/engine-adapter.clan): one function
// for the screen and the PNG export, and one for SVG. This is the stand-in
// until engine-foundation and engine-ink bring canvas-engine's renderer
// (Spike O's canvas2d, Path2D cache and culling); it draws boxes, images,
// lines and text plainly, which is enough for the adapter contract and a look.

import { LIGHT_INK, resolveInk, type InkPalette } from '../../../../../canvas-engine/src/ink/palette'
import type { CanvasElement } from '../../core/canvasAdapter'

/** A bare host's dark ink, when no --pen-* tokens say otherwise. */
const BARE_DARK: InkPalette = { ...LIGHT_INK, ink: '#e8e8e8' }

export type Ctx2D = Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'beginPath' | 'rect' | 'clip' | 'fillRect' | 'strokeRect' | 'fillText' | 'moveTo' | 'lineTo' | 'stroke' | 'fill' |
  'ellipse' | 'drawImage' | 'setTransform' | 'translate' | 'scale' | 'setLineDash'> & {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  globalAlpha: number
}

type Styled = CanvasElement & {
  strokeColor?: string
  backgroundColor?: string
  strokeWidth?: number
  strokeStyle?: string
  fontSize?: number
  opacity?: number
  assetSha?: string | null
}

/** Paint order: a container under what it holds, otherwise the scene's order. */
export function paintOrder(els: readonly CanvasElement[]): CanvasElement[] {
  return els.filter((e) => !e.isDeleted)
}

/**
 * Paint the elements. Ink names (a stroke's 'ink', 'orange'…) go through `palette`: the theme's on
 * screen, the light one for exports, which are always on white.
 */
export function drawElements(ctx: Ctx2D, els: readonly CanvasElement[], images: (sha: string) => CanvasImageSource | undefined, theme: 'light' | 'dark' = 'light', palette: InkPalette = theme === 'dark' ? BARE_DARK : LIGHT_INK) {
  const ink = palette.ink
  for (const raw of paintOrder(els)) {
    const e = raw as Styled
    ctx.save()
    ctx.globalAlpha = (e.opacity ?? 100) / 100
    ctx.lineWidth = e.strokeWidth ?? 1
    ctx.strokeStyle = e.strokeColor && e.strokeColor !== 'transparent' ? resolveInk(e.strokeColor, palette) : ink
    ctx.setLineDash(e.strokeStyle === 'dashed' ? [8, 6] : [])
    const fill = e.backgroundColor && e.backgroundColor !== 'transparent' ? e.backgroundColor : null
    switch (e.type) {
      case 'image': {
        const img = e.assetSha ? images(e.assetSha) : undefined
        if (img) ctx.drawImage(img, e.x, e.y, e.width, e.height)
        else {
          ctx.fillStyle = theme === 'dark' ? '#2a2a2a' : '#f1f1f1'
          ctx.fillRect(e.x, e.y, e.width, e.height)
        }
        break
      }
      case 'ellipse':
        ctx.beginPath()
        ctx.ellipse(e.x + e.width / 2, e.y + e.height / 2, Math.abs(e.width / 2), Math.abs(e.height / 2), 0, 0, Math.PI * 2)
        if (fill) {
          ctx.fillStyle = fill
          ctx.fill()
        }
        if (e.strokeColor !== 'transparent') ctx.stroke()
        break
      case 'text':
        ctx.fillStyle = resolveInk(e.strokeColor, palette)
        ctx.font = `${e.fontSize ?? 20}px Geist, sans-serif`
        ;(e.text ?? '').split('\n').forEach((line, i) => ctx.fillText(line, e.x, e.y + (e.fontSize ?? 20) * (i + 1)))
        break
      case 'freedraw':
      case 'line':
      case 'arrow': {
        const pts = e.points ?? []
        if (pts.length) {
          ctx.beginPath()
          ctx.moveTo(e.x + pts[0][0], e.y + pts[0][1])
          for (const p of pts.slice(1)) ctx.lineTo(e.x + p[0], e.y + p[1])
          ctx.stroke()
        }
        break
      }
      default:
        // rectangle, diamond, frame and anything else: its box.
        if (fill) {
          ctx.fillStyle = fill
          ctx.fillRect(e.x, e.y, e.width, e.height)
        }
        if (e.strokeColor !== 'transparent' || e.type === 'frame') ctx.strokeRect(e.x, e.y, e.width, e.height)
    }
    ctx.restore()
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** An SVG of the elements inside `box`, pictures embedded from `dataURL`; ink names in the light values (exports are on white). */
export function svgOf(els: readonly CanvasElement[], box: { x: number; y: number; w: number; h: number }, background: string, dataURL: (sha: string) => string | undefined): string {
  const parts: string[] = [`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${esc(background)}"/>`]
  for (const raw of paintOrder(els)) {
    const e = raw as Styled
    const stroke = esc(e.strokeColor && e.strokeColor !== 'transparent' ? resolveInk(e.strokeColor) : LIGHT_INK.ink)
    const fill = esc(e.backgroundColor && e.backgroundColor !== 'transparent' ? e.backgroundColor : 'none')
    const sw = e.strokeWidth ?? 1
    switch (e.type) {
      case 'image': {
        const href = e.assetSha ? dataURL(e.assetSha) : undefined
        if (href) parts.push(`<image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" href="${esc(href)}"/>`)
        break
      }
      case 'ellipse':
        parts.push(`<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${Math.abs(e.width / 2)}" ry="${Math.abs(e.height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`)
        break
      case 'text':
        parts.push(`<text x="${e.x}" y="${e.y + (e.fontSize ?? 20)}" font-family="Geist, sans-serif" font-size="${e.fontSize ?? 20}" fill="${stroke}">${esc(e.text ?? '')}</text>`)
        break
      case 'freedraw':
      case 'line':
      case 'arrow': {
        const pts = (e.points ?? []).map((p) => `${e.x + p[0]},${e.y + p[1]}`).join(' ')
        if (pts) parts.push(`<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}"${e.strokeStyle === 'dashed' ? ' stroke-dasharray="8 6"' : ''}/>`)
        break
      }
      default:
        parts.push(`<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="${fill}" stroke="${e.strokeColor === 'transparent' ? 'none' : stroke}" stroke-width="${sw}"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${box.w}" height="${box.h}">${parts.join('')}</svg>`
}
