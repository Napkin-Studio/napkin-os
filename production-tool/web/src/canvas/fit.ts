// The size every input picture is sent at. Providers refuse pictures that are
// too small or too long and thin (2026-10-07: fal's Kling answered "image
// dimensions are too small" for a sketch exported at its on-screen size). So
// each picture is fitted once, where it is made: scaled so its short side is
// at least MIN_SIDE and its long side at most MAX_SIDE, then padded with white
// to an aspect within MAX_ASPECT. Pure maths here; scene.ts draws it.

/** The short side every provider takes (Kling image and video need ≥ 300 px; Qwen and Ideogram less). */
export const MIN_SIDE = 512
export const MAX_SIDE = 1536
/** The longest side over the shortest that every provider takes (Kling: 1:2.5 to 2.5:1). */
export const MAX_ASPECT = 2.5

export interface Fit {
  /** The picture's size after scaling. */
  w: number
  h: number
  /** The canvas it is centred on (padding is white). */
  canvasW: number
  canvasH: number
  /** Nothing to do: the picture is sent as it is. */
  same: boolean
}

export function fitSize(width: number, height: number): Fit {
  const w0 = Math.max(1, width)
  const h0 = Math.max(1, height)
  // Grow the short side to MIN_SIDE, then shrink if the long side passed MAX_SIDE.
  let scale = Math.max(1, MIN_SIDE / Math.min(w0, h0))
  if (Math.max(w0, h0) * scale > MAX_SIDE) scale = MAX_SIDE / Math.max(w0, h0)
  const w = Math.round(w0 * scale)
  const h = Math.round(h0 * scale)
  // Pad the short side until both the minimum and the aspect hold.
  const long = Math.max(w, h)
  const short = Math.max(Math.min(w, h), MIN_SIDE, Math.ceil(long / MAX_ASPECT))
  const canvasW = w >= h ? Math.max(w, MIN_SIDE) : short
  const canvasH = w >= h ? short : Math.max(h, MIN_SIDE)
  return { w, h, canvasW, canvasH, same: w === width && h === height && canvasW === w && canvasH === h }
}
