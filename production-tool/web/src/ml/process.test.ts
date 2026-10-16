// The on-device model's pixels in and out (features/image-editor.clan): the preprocessor config of
// BiRefNet_lite-ONNX (ImageNet mean and std, 1024 px).
import { describe, expect, it } from 'vitest'
import { SIDE, alphaOf, cutoutWhere, nchw, within } from './process'

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
})

describe('the model outputs', () => {
  it('turns BiRefNet logits into alpha with a sigmoid', () => {
    expect([...alphaOf([-20, 0, 20])]).toEqual([0, 128, 255])
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
  it('gives up on a model that stalls', async () => {
    await expect(within(new Promise(() => {}), 10, 'too slow')).rejects.toThrow('too slow')
    await expect(within(Promise.resolve(3), 10, 'too slow')).resolves.toBe(3)
  })
})
