// "Do the sizes look the same?" A free, local measure of how far a size's colour and tone are from its
// master's, so Jude can flag a size that came back lighter, darker, warmer, cooler or flatter. A rough
// guide, not a verdict: it reads the average colour and the spread of brightness, nothing finer.
// Crop and Layout keep the master's own pixels, so only Extend and Regenerate are measured.

export interface LookStats {
  /** Mean red, green, blue, 0-255. */
  r: number; g: number; b: number
  /** Standard deviation of brightness, 0-255: how much contrast the picture has. */
  sd: number
}

/**
 * Above this distance (0-1) a size is flagged. Read on one real set of 11 extend/regenerate sizes (2026-11-03): 0.025 to 0.105,
 * and one visibly hazier size at 0.183; crops read 0.005. Few samples: adjust it as more sets come in.
 */
export const LOOK_FLAG = 0.14

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** The stats of RGBA pixel data (any size; the sampler hands it a small thumbnail). */
export function statsOf(rgba: ArrayLike<number>): LookStats {
  const n = Math.floor(rgba.length / 4)
  if (!n) return { r: 0, g: 0, b: 0, sd: 0 }
  let r = 0, g = 0, b = 0
  for (let i = 0; i < n; i++) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2] }
  r /= n; g /= n; b /= n
  let v = 0
  const m = lum(r, g, b)
  for (let i = 0; i < n; i++) v += (lum(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) - m) ** 2
  return { r, g, b, sd: Math.sqrt(v / n) }
}

/** How far apart two looks are, 0 (the same) to 1: the average colour gap, half the colour-cast gap (a warm or cool
 *  shift reads strongly though the average moves little), and half the contrast gap. */
export function lookDistance(a: LookStats, b: LookStats): number {
  const colour = (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)) / (3 * 255)
  const cast = (Math.abs((a.r - a.g) - (b.r - b.g)) + Math.abs((a.g - a.b) - (b.g - b.b))) / 255
  const contrast = Math.abs(a.sd - b.sd) / 255
  return Math.min(1, colour + cast * 0.5 + contrast * 0.5)
}

const THUMB = 48

/** The stats of a picture, from a 48-pixel thumbnail of it (the browser's canvas). Null where it cannot be read. */
export async function measureBlob(blob: Blob): Promise<LookStats | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const k = THUMB / Math.max(bmp.width, bmp.height)
    const w = Math.max(1, Math.round(bmp.width * k))
    const h = Math.max(1, Math.round(bmp.height * k))
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    return statsOf(ctx.getImageData(0, 0, w, h).data)
  } catch {
    return null
  }
}

/** How far a size's picture is from the master's (0-1), or undefined where either cannot be read. */
export async function lookOf(master: Blob | undefined, plate: Blob | undefined): Promise<number | undefined> {
  if (!master || !plate) return undefined
  const [a, b] = await Promise.all([measureBlob(master), measureBlob(plate)])
  if (!a || !b) return undefined
  return lookDistance(b, a)
}
