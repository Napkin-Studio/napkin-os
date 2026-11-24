// An SVG logo becomes a PNG in the browser when it is uploaded (owner 2026-11-24, "Go with your recommendations"): the
// tools (the deck, Production's end card and sizes) take the PNG, so no server needs an SVG rasteriser and no licence
// changes. The logo schema holds one file per logo (visual.logos[].asset), so the PNG is what is kept.
//
// The picture is drawn through an <img> (an SVG shown as an image never runs script or loads anything outside it) onto
// a canvas at a sensible size: LOGO_H pixels high, at most LOGO_MAX_W wide, never larger than that.

export const LOGO_H = 480
export const LOGO_MAX_W = 2400

export const isSvg = (file: { name: string; type?: string }) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)

/** The PNG's file name: `logo-dark.svg` → `logo-dark.png`. */
export const pngName = (name: string) => `${name.replace(/\.svg$/i, '') || 'logo'}.png`

const num = (v: string | null | undefined) => {
  const m = v?.trim().match(/^([0-9]*\.?[0-9]+)(px)?$/)
  return m ? Number(m[1]) : NaN
}

/** The SVG's own proportions: its viewBox, else its width and height in pixels. Null: it says neither. */
export function svgSize(text: string): { w: number; h: number } | null {
  const tag = text.match(/<svg\b[^>]*>/i)?.[0]
  if (!tag) return null
  const attr = (n: string) => tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] }
  const w = num(attr('width'))
  const h = num(attr('height'))
  return w > 0 && h > 0 ? { w, h } : null
}

/** The PNG's size for an SVG of these proportions: LOGO_H high, narrowed to LOGO_MAX_W for a very wide logo. */
export function pngSize(s: { w: number; h: number }): { w: number; h: number } {
  let h = LOGO_H
  let w = Math.round((s.w / s.h) * h)
  if (w > LOGO_MAX_W) {
    w = LOGO_MAX_W
    h = Math.max(1, Math.round((s.h / s.w) * w))
  }
  return { w: Math.max(1, w), h }
}

export class LogoError extends Error {}

/** Draw an SVG at a size and give back PNG bytes (the browser's canvas; a seam for tests). */
export type Draw = (svg: Blob, size: { w: number; h: number }) => Promise<Uint8Array>

export const browserDraw: Draw = async (svg, size) => {
  const url = URL.createObjectURL(svg)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok()
      img.onerror = () => fail(new LogoError('That SVG could not be drawn. Try a PNG of the logo.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = size.w
    canvas.height = size.h
    const g = canvas.getContext('2d')
    if (!g) throw new LogoError('This browser cannot draw the logo. Try a PNG of the logo.')
    g.drawImage(img, 0, 0, size.w, size.h)
    const png = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/png'))
    if (!png) throw new LogoError('That SVG could not be turned into a picture. Try a PNG of the logo.')
    return new Uint8Array(await png.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** An uploaded SVG logo as a PNG: its name and bytes. Any other file comes back as it is. */
export async function logoForUpload(file: { name: string; type?: string; bytes: Uint8Array }, draw: Draw = browserDraw): Promise<{ name: string; bytes: Uint8Array }> {
  if (!isSvg(file)) return { name: file.name, bytes: file.bytes }
  const text = new TextDecoder().decode(file.bytes)
  const own = svgSize(text)
  if (!own) throw new LogoError('That SVG does not say its size (no viewBox, width or height). Try a PNG of the logo.')
  const bytes = await draw(new Blob([file.bytes as BlobPart], { type: 'image/svg+xml' }), pngSize(own))
  return { name: pngName(file.name), bytes }
}
