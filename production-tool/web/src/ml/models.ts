// The model weights the Image editor runs on the person's device (features/image-editor.clan,
// ui-behaviour 3.12), under onnxruntime-web (MIT). Every file is pinned to a revision and its sha256,
// the same as licences/weights.toml (models.test.ts holds them equal); a file whose hash differs is
// refused. Permissive code and weights only: no RMBG (non-commercial), no AGPL ISNet export.
//
//   Remove background  BiRefNet-lite (MIT) on WebGPU: fp16 (115 MB), or fp32 (224 MB) where the GPU has no f16.

/** Remove background: BiRefNet-lite, as onnx-community converted it. The relay's cut-out runs the same. */
export const CUTOUT_MODEL_NAME = 'onnx-community/BiRefNet_lite-ONNX'

export interface ModelFile { model: string; revision: string; path: string; sha256: string; bytes: number }

export const CUTOUT_WEIGHTS: ModelFile = {
  model: CUTOUT_MODEL_NAME, revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
  path: 'onnx/model_fp16.onnx', sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402', bytes: 114538221,
}
/** The same weights in fp32, for a WebGPU device without shader-f16 (224 MB). */
export const CUTOUT_WEIGHTS_FP32: ModelFile = {
  model: CUTOUT_MODEL_NAME, revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
  path: 'onnx/model.onnx', sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333', bytes: 224005088,
}
export const DEVICE_MODELS: readonly ModelFile[] = [CUTOUT_WEIGHTS, CUTOUT_WEIGHTS_FP32]

/** Where a file is read from: Hugging Face at its pinned revision. */
export function modelUrl(f: ModelFile): string {
  return `https://huggingface.co/${f.model}/resolve/${f.revision}/${f.path}`
}

export class ModelHashError extends Error {}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The file's bytes, checked against its sha256 (and kept in Cache Storage for next time). */
export async function fetchModel(f: ModelFile, fetcher: typeof fetch = fetch, cacheName = 'napkin-models'): Promise<ArrayBuffer> {
  const url = modelUrl(f)
  let cache: Cache | undefined
  try {
    cache = typeof caches !== 'undefined' ? await caches.open(cacheName) : undefined
  } catch {
    cache = undefined // a private window may refuse Cache Storage: fetch every time
  }
  const hit = await cache?.match(url).catch(() => undefined)
  const res = hit ?? await fetcher(url)
  if (!res.ok) throw new Error(`Could not load ${f.model} (${res.status}).`)
  const bytes = await res.clone().arrayBuffer()
  const got = hex(await crypto.subtle.digest('SHA-256', bytes))
  if (got !== f.sha256) {
    await cache?.delete(url).catch(() => undefined)
    throw new ModelHashError(`${f.model} ${f.path} is not the file we checked (its hash differs).`)
  }
  if (!hit) await cache?.put(url, res).catch(() => undefined)
  return bytes
}
