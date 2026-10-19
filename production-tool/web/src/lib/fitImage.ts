// Drawing a picture at the size providers take (canvas/fit.ts has the maths).
// Used where a picture is made (canvas intake, drawings) and again where it is
// sent (jobs/assets.ts), so a picture made before a size rule changed is fitted too.

import { fitSize } from '../canvas/fit'

/**
 * Fit a picture for providers (fit.ts): short side ≥ 512 px, long side ≤ 1536 px, aspect within
 * 2.5:1, padded with white. The result is the artifact that gets hashed and sent.
 */
export async function downscale(blob: Blob): Promise<{ blob: Blob; w: number; h: number; changed: boolean }> {
  const bmp = await createImageBitmap(blob)
  const f = fitSize(bmp.width, bmp.height)
  const okType = blob.type === 'image/png' || blob.type === 'image/jpeg' || blob.type === 'image/webp'
  if (f.same && okType) {
    bmp.close?.()
    return { blob, w: f.w, h: f.h, changed: false }
  }
  const c = document.createElement('canvas')
  c.width = f.canvasW
  c.height = f.canvasH
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, Math.round((f.canvasW - f.w) / 2), Math.round((f.canvasH - f.h) / 2), f.w, f.h)
  bmp.close?.()
  const type = blob.type === 'image/jpeg' && f.canvasW === f.w && f.canvasH === f.h ? 'image/jpeg' : 'image/png'
  const out = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not resize the picture.'))), type, 0.9))
  return { blob: out, w: f.canvasW, h: f.canvasH, changed: true }
}

/** The picture to send for `blob`: fitted when it is an image this browser can draw, else as it is. */
export async function fitForSending(blob: Blob): Promise<Blob> {
  if (!blob.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return blob
  try {
    return (await downscale(blob)).blob
  } catch {
    return blob // not a picture the browser can read; the provider will say so
  }
}
