// The pixels in and out of the Image editor's on-device model (features/image-editor.clan). Pure, so
// the tests hold them to the model's preprocessor config (ImageNet mean and std, 1024 px):
//   BiRefNet-lite  1 x 3 x 1024 x 1024 in, 1 x 1 x 1024 x 1024 logits out (a sigmoid gives alpha).

export const SIDE = 1024
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/** RGBA pixels (w x h) as the normalised NCHW tensor of a side x side input, the rest left 0. */
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

/** Where Remove background runs (3.12): on the device with WebGPU and enough memory, else our server. */
export type CutoutWhere = 'device' | 'server'
export function cutoutWhere(env: { webgpu: boolean; memoryGb?: number }): CutoutWhere {
  return env.webgpu && (env.memoryGb === undefined || env.memoryGb >= 4) ? 'device' : 'server'
}

/** A promise that gives up after `ms` (a model that stalls must not hold the editor). */
export function within<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(why)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
