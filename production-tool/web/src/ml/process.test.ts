// The on-device models' pixels in and out (features/image-editor.clan): the preprocessor configs of
// BiRefNet_lite-ONNX and slimsam-77-uniform (ImageNet mean and std, 1024 px, SAM's longest-side pad).
import { describe, expect, it } from 'vitest'
import { SIDE, alphaOf, bestMask, clickBackend, cutoutWhere, nchw, samMask, samPoint, samSize } from './process'

describe('the model inputs', () => {
  it('normalises RGBA into NCHW planes with ImageNet mean and std, padding with 0', () => {
    const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255])
    const t = nchw(rgba, 2, 1, 4)
    expect(t.length).toBe(3 * 16)
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 5)
    expect(t[16 + 1]).toBeCloseTo((1 - 0.456) / 0.224, 5)
    expect(t[32]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5)
    expect(t[4]).toBe(0) // the second row is padding
  })
  it('sizes a 1344 x 768 frame to 1024 x 585 for SlimSAM and scales a click the same way', () => {
    expect(samSize(1344, 768)).toMatchObject({ nw: 1024, nh: 585 })
    const [x, y] = samPoint({ x: 0.5, y: 0.5 }, 1344, 768)
    expect(x).toBeCloseTo(512, 3)
    expect(y).toBeCloseTo(292.57, 1)
  })
})

describe('the model outputs', () => {
  it('turns BiRefNet logits into alpha with a sigmoid', () => {
    expect([...alphaOf([-20, 0, 20])]).toEqual([0, 128, 255])
  })
  it('picks the mask SlimSAM scores highest', () => {
    expect(bestMask([0.82, 0.95, 0.9])).toBe(1)
  })
  it('maps a 256 x 256 logit block back onto the picture, padding ignored', () => {
    const low = 256
    const pred = new Float32Array(3 * low * low).fill(-5)
    // mask 2: a block over the centre of the resized picture (x 96-160, y 48-96 of the 256 grid)
    for (let y = 48; y < 96; y++) for (let x = 96; x < 160; x++) pred[2 * low * low + y * low + x] = 5
    const w = 400, h = 200 // resized 1024 x 512: the picture fills grid rows 0-128
    const m = samMask(pred, 2, w, h)
    expect(m.length).toBe(w * h)
    expect(m[100 * w + 200]).toBe(255) // centre
    expect(m[10 * w + 10]).toBe(0)
    expect(m[100 * w + 50]).toBe(0)
    expect(samMask(pred, 0, w, h).some((v) => v)).toBe(false)
  })
  it('is 1024 on a side', () => expect(SIDE).toBe(1024))
})

describe('where each tool runs (3.12)', () => {
  it('removes backgrounds on the device with WebGPU and memory, else on our server', () => {
    expect(cutoutWhere({ webgpu: true, memoryGb: 8 })).toBe('device')
    expect(cutoutWhere({ webgpu: true })).toBe('device')
    expect(cutoutWhere({ webgpu: true, memoryGb: 2 })).toBe('server')
    expect(cutoutWhere({ webgpu: false, memoryGb: 16 })).toBe('server')
  })
  it('click-selects on WebGPU, or on WebAssembly without it', () => {
    expect(clickBackend({ webgpu: true })).toBe('webgpu')
    expect(clickBackend({ webgpu: false })).toBe('wasm')
  })
})
