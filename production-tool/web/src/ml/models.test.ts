// The device's model files are the ones the licence gate lists (licences/weights.toml), at the same
// revision and hash, with permissive weight and code licences; and a changed file is refused.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEVICE_MODELS, ModelHashError, fetchModel, modelUrl, CUTOUT_WEIGHTS } from './models'

const toml = readFileSync(new URL('../../../../licences/weights.toml', import.meta.url), 'utf8')
const entries = toml.split('[[model]]').slice(1).map((block) => ({
  id: /^id = "([^"]+)"/m.exec(block)?.[1],
  revision: /^revision = "([^"]+)"/m.exec(block)?.[1],
  weight: /^weight_licence = "([^"]+)"/m.exec(block)?.[1],
  code: /^code_licence = "([^"]+)"/m.exec(block)?.[1],
  files: [...block.matchAll(/path = "([^"]+)", sha256 = "([0-9a-f]{64})"/g)].map((m) => ({ path: m[1], sha256: m[2] })),
}))

describe('the on-device weights', () => {
  it.each(DEVICE_MODELS.map((f) => [f.path, f]))('%s is listed in weights.toml at its revision and hash', (_, f) => {
    const e = entries.find((x) => x.id === f.model)
    expect(e, f.model).toBeTruthy()
    expect(e!.revision).toBe(f.revision)
    expect(e!.files).toContainEqual({ path: f.path, sha256: f.sha256 })
    expect(['MIT', 'Apache-2.0']).toContain(e!.weight)
    expect(['MIT', 'Apache-2.0']).toContain(e!.code)
  })
  it('reads each file from its pinned revision', () => {
    expect(modelUrl(CUTOUT_WEIGHTS)).toBe('https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model_fp16.onnx')
  })
  it('refuses a file whose hash differs', async () => {
    const fake = (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch
    await expect(fetchModel(CUTOUT_WEIGHTS, fake)).rejects.toBeInstanceOf(ModelHashError)
  })
  it('takes a file whose hash matches', async () => {
    const bytes = new TextEncoder().encode('weights')
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const ok = (async () => new Response(bytes)) as unknown as typeof fetch
    const got = await fetchModel({ ...CUTOUT_WEIGHTS, sha256: digest }, ok)
    expect(new Uint8Array(got)).toEqual(bytes)
  })
})
