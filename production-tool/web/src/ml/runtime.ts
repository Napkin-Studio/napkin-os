// Running the Image editor's models in the browser (features/image-editor.clan): onnxruntime-web
// (MIT), loaded only when Remove background first needs it: BiRefNet-lite on WebGPU (without
// WebGPU, as on Firefox, our server does it). The pixels in and out are ml/process.ts.

import type * as OrtNs from 'onnxruntime-web'
import { CUTOUT_WEIGHTS, CUTOUT_WEIGHTS_FP32, fetchModel, type ModelFile } from './models'
import { SIDE, alphaOf, nchw } from './process'

type Ort = typeof OrtNs
let ortP: Promise<Ort> | null = null
const ort = () => (ortP ??= import('onnxruntime-web/webgpu') as Promise<Ort>)

export interface DeviceEnv { webgpu: boolean; memoryGb?: number; f16?: boolean }

/** What this device offers: a WebGPU adapter, and its memory where the browser says. */
export async function deviceEnv(): Promise<DeviceEnv> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null> }; deviceMemory?: number }
  let webgpu: boolean
  let f16 = false
  try {
    const adapter = await nav.gpu?.requestAdapter()
    webgpu = !!adapter
    f16 = !!adapter?.features.has('shader-f16')
  } catch {
    webgpu = false
  }
  return { webgpu, f16, ...(typeof nav.deviceMemory === 'number' ? { memoryGb: nav.deviceMemory } : {}) }
}

const sessions = new Map<string, Promise<OrtNs.InferenceSession>>()
function session(f: ModelFile, ep: 'webgpu' | 'wasm'): Promise<OrtNs.InferenceSession> {
  const key = `${f.path}@${ep}`
  let s = sessions.get(key)
  if (!s) {
    s = (async () => {
      const o = await ort()
      return o.InferenceSession.create(new Uint8Array(await fetchModel(f)), { executionProviders: [ep] })
    })()
    s.catch(() => sessions.delete(key))
    sessions.set(key, s)
  }
  return s
}

function pixels(src: CanvasImageSource, w: number, h: number, cw = w, ch = h): ImageData {
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, w, h)
  return ctx.getImageData(0, 0, cw, ch)
}

/** The picture with its background removed, as an RGBA PNG its own size (BiRefNet-lite on WebGPU). */
export async function removeBackground(src: CanvasImageSource, w: number, h: number, env: DeviceEnv): Promise<Blob> {
  const o = await ort()
  const s = await session(env.f16 ? CUTOUT_WEIGHTS : CUTOUT_WEIGHTS_FP32, 'webgpu')
  const input = new o.Tensor('float32', nchw(pixels(src, SIDE, SIDE).data, SIDE, SIDE), [1, 3, SIDE, SIDE])
  const out = await s.run({ [s.inputNames[0]]: input })
  const alpha = alphaOf(out[s.outputNames[0]].data as Float32Array)
  // The matte at 1024, scaled to the picture, multiplied into its alpha.
  const m = document.createElement('canvas')
  m.width = SIDE
  m.height = SIDE
  const mask = new ImageData(SIDE, SIDE)
  for (let i = 0; i < alpha.length; i++) mask.data[i * 4 + 3] = alpha[i]
  m.getContext('2d')!.putImageData(mask, 0, 0)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(m, 0, 0, w, h)
  ctx.globalCompositeOperation = 'source-in'
  ctx.drawImage(src, 0, 0, w, h)
  return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the cut-out.'))), 'image/png'))
}
