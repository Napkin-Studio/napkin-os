// The pixels in and out of the Image editor's two on-device models (features/image-editor.clan).
// Pure, so the tests hold them to the models' preprocessor configs (ImageNet mean and std, 1024 px):
//   BiRefNet-lite  1 x 3 x 1024 x 1024 in, 1 x 1 x 1024 x 1024 logits out (a sigmoid gives alpha).
//   SlimSAM        the longest side resized to 1024 and padded to 1024 x 1024; a point in those
//                  pixels; three 256 x 256 mask logits and their IoU scores out.

export const SIDE = 1024
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/** RGBA pixels (w x h) as the normalised NCHW tensor of a side x side input, the rest left 0 (SAM's pad). */
export function nchw(rgba: ArrayLike<number>, w: number, h: number, side = SIDE): Float32Array {
  const out = new Float32Array(3 * side * side)
  const plane = side * side
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const o = y * side + x
      for (let c = 0; c < 3; c++) out[c * plane + o] = (rgba[i + c] / 255 - MEAN[c]) / STD[c]
    }
  }
  return out
}

/** BiRefNet's logits as alpha bytes (sigmoid), still side x side. */
export function alphaOf(logits: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(logits.length)
  for (let i = 0; i < logits.length; i++) out[i] = Math.round(255 / (1 + Math.exp(-logits[i])))
  return out
}

/** SlimSAM's input size for a w x h picture: the longest side at 1024. */
export function samSize(w: number, h: number): { nw: number; nh: number; scale: number } {
  const scale = SIDE / Math.max(w, h)
  return { nw: Math.round(w * scale), nh: Math.round(h * scale), scale }
}

/** A click (0-1 of the picture) in SlimSAM's input pixels. */
export function samPoint(p: { x: number; y: number }, w: number, h: number): [number, number] {
  const { scale } = samSize(w, h)
  return [p.x * w * scale, p.y * h * scale]
}

/** Which of SlimSAM's masks a click means: "AI finds the object", so the largest of the masks it is
 *  nearly as sure of as its best (within 0.1), not the letter under the pointer. `areas`: each mask's
 *  share of the picture; without them, the surest. */
export function bestMask(iou: ArrayLike<number>, areas?: ArrayLike<number>): number {
  let best = 0
  for (let i = 1; i < iou.length; i++) if (iou[i] > iou[best]) best = i
  if (!areas) return best
  let pick = best
  for (let i = 0; i < iou.length; i++) if (iou[i] >= iou[best] - 0.1 && areas[i] > areas[pick]) pick = i
  return pick
}

/** Each low-resolution mask's share of the grid it covers (its positive logits). */
export function maskAreas(pred: ArrayLike<number>, count: number, low = 256): number[] {
  const out: number[] = []
  for (let k = 0; k < count; k++) {
    let n = 0
    for (let i = k * low * low; i < (k + 1) * low * low; i++) if (pred[i] > 0) n++
    out.push(n / (low * low))
  }
  return out
}

/**
 * One of SlimSAM's 256 x 256 mask logits (index `which` of `count`) as a w x h mask, 255 inside:
 * each picture pixel is sampled (bilinear) where it falls on the padded 1024 grid.
 */
export function samMask(pred: ArrayLike<number>, which: number, w: number, h: number, low = 256): Uint8Array {
  const { scale } = samSize(w, h)
  const base = which * low * low
  const k = (scale * low) / SIDE
  const out = new Uint8Array(w * h)
  const at = (x: number, y: number) => pred[base + Math.min(low - 1, Math.max(0, y)) * low + Math.min(low - 1, Math.max(0, x))]
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) * k - 0.5
    const y0 = Math.floor(v)
    const fy = v - y0
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) * k - 0.5
      const x0 = Math.floor(u)
      const fx = u - x0
      const val = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
      out[y * w + x] = val > 0 ? 255 : 0
    }
  }
  return out
}

/** Where Remove background runs (3.12): on the device with WebGPU and enough memory, else our server. */
export type CutoutWhere = 'device' | 'server'
export function cutoutWhere(env: { webgpu: boolean; memoryGb?: number }): CutoutWhere {
  return env.webgpu && (env.memoryGb === undefined || env.memoryGb >= 4) ? 'device' : 'server'
}

/** Click-select runs on WebAssembly on every device: the quantized (int8) SlimSAM is small enough for
 *  the CPU, and onnxruntime-web's WebGPU path stalled on it (headless Chromium, 2026-10-15). */
export function clickBackend(_env: { webgpu: boolean }): 'webgpu' | 'wasm' {
  return 'wasm'
}

/** A promise that gives up after `ms` (a model that stalls must not hold the editor). */
export function within<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(why)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
