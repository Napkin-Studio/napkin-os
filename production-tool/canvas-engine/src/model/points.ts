// A stroke's points as bytes (features/canvas-engine.clan, contracts: napkin/1
// "Stroke points"): 5 bytes a point, Int16 dx and Int16 dy (little-endian) in
// tenths of a pixel from the previous point (the first from the element's x, y),
// then a pressure byte (0..255 for 0..1). Written once at pointer-up and never
// rewritten: a move changes the element's x and y only.
//
// Each step is taken from the previous *quantised* point (error feedback), so the
// error never builds up along a stroke: every decoded point is within 0.05 px of
// what was drawn. A step past Int16 range (3,276.7 px) is split by inserting
// points along it.

export const BYTES_PER_POINT = 5
const Q = 10 // tenths of a pixel
const MAX = 32767

export interface InkPoint {
  x: number
  y: number
  /** 0..1 */
  pressure: number
}

/** Encode points (scene coordinates) relative to the element's origin. */
export function encodePoints(points: readonly InkPoint[], origin: { x: number; y: number }): Uint8Array {
  const steps: [number, number, number][] = []
  let qx = Math.round(origin.x * Q)
  let qy = Math.round(origin.y * Q)
  for (const p of points) {
    const tx = Math.round(p.x * Q)
    const ty = Math.round(p.y * Q)
    const pr = Math.max(0, Math.min(255, Math.round(p.pressure * 255)))
    let dx = tx - qx
    let dy = ty - qy
    // Split a long step into pieces that fit Int16, each a point on the way.
    const parts = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX))
    for (let i = 1; i < parts; i++) {
      const sx = Math.round((dx * i) / parts) - Math.round((dx * (i - 1)) / parts)
      const sy = Math.round((dy * i) / parts) - Math.round((dy * (i - 1)) / parts)
      steps.push([sx, sy, pr])
    }
    const doneX = Math.round((dx * (parts - 1)) / parts)
    const doneY = Math.round((dy * (parts - 1)) / parts)
    dx -= doneX
    dy -= doneY
    steps.push([dx, dy, pr])
    qx = tx
    qy = ty
  }
  const out = new Uint8Array(steps.length * BYTES_PER_POINT)
  const view = new DataView(out.buffer)
  steps.forEach(([dx, dy, pr], i) => {
    const o = i * BYTES_PER_POINT
    view.setInt16(o, dx, true)
    view.setInt16(o + 2, dy, true)
    view.setUint8(o + 4, pr)
  })
  return out
}

/** Decode to scene coordinates, given the element's origin when the points were written. */
export function decodePoints(bytes: Uint8Array, origin: { x: number; y: number }): InkPoint[] {
  if (bytes.length % BYTES_PER_POINT) throw new Error(`Stroke points are ${BYTES_PER_POINT} bytes each; got ${bytes.length}.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: InkPoint[] = []
  let qx = Math.round(origin.x * Q)
  let qy = Math.round(origin.y * Q)
  for (let o = 0; o < bytes.length; o += BYTES_PER_POINT) {
    qx += view.getInt16(o, true)
    qy += view.getInt16(o + 2, true)
    out.push({ x: qx / Q, y: qy / Q, pressure: view.getUint8(o + 4) / 255 })
  }
  return out
}

/** Points relative to the element's origin (what a renderer draws after translating to x, y). */
export function localPoints(bytes: Uint8Array): InkPoint[] {
  return decodePoints(bytes, { x: 0, y: 0 })
}

export const pointCount = (bytes: Uint8Array) => bytes.length / BYTES_PER_POINT

const naturalSizes = new WeakMap<Uint8Array, { w: number; h: number }>()

/** The extent of a stroke's own points: its record's w/h over this is the scale it is drawn at. */
export function naturalSize(pts: Uint8Array): { w: number; h: number } {
  let n = naturalSizes.get(pts)
  if (!n) {
    let w = 0
    let h = 0
    for (const p of localPoints(pts)) {
      w = Math.max(w, p.x)
      h = Math.max(h, p.y)
    }
    n = { w, h }
    naturalSizes.set(pts, n)
  }
  return n
}

/** The scale a stroke record is drawn at (1 on an axis its points do not span). */
export function strokeScale(r: { w: number; h: number }, pts: Uint8Array): { sx: number; sy: number } {
  const n = naturalSize(pts)
  return { sx: n.w > 1e-6 ? r.w / n.w : 1, sy: n.h > 1e-6 ? r.h / n.h : 1 }
}
