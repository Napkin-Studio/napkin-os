import { describe, expect, it } from 'vitest'
import type { ProtectBox, SizeMethod } from '../contracts/types'
import { fitFor, methodOffered, methodWhy } from './fit'
import { availableMethods, methodModels } from './rules'

const ALL = availableMethods(methodModels())
const NO_REDRAW = new Set<SizeMethod>([...ALL].filter((m) => m !== 'regenerate'))
const MASTER_45 = { w: 1536, h: 1920 }
const can: ProtectBox = { role: 'product', label: 'can', x: 520, y: 500, w: 500, h: 900 }

describe('a 4:1 96-sheet from a 4:5 master (UAT 2026-11-22)', () => {
  const sheet = { w: 14400, h: 3600 }
  it('does not offer Extend, and says why in the relay\'s own numbers', () => {
    const fit = fitFor(MASTER_45, sheet, [can], ALL)
    expect(methodOffered(fit, 'extend')).toBe(false)
    expect(methodWhy(fit, 'extend')).toMatch(/4:1 is too far from this picture's shape to extend: it takes 6 steps and Extend makes at most 3/)
  })
  it('does not offer Crop, which would cut the can', () => {
    const fit = fitFor(MASTER_45, sheet, [can], ALL)
    expect(methodOffered(fit, 'crop')).toBe(false)
    expect(methodWhy(fit, 'crop')).toBe('A crop to 4:1 would cut what must stay.')
  })
  it('offers Redraw, which keeps the product (the relay lays it back)', () => {
    const fit = fitFor(MASTER_45, sheet, [can], ALL)
    expect(methodOffered(fit, 'regenerate')).toBe(true)
    expect(fit.product).toBe('holds')
  })
  it('says plainly the product will not fit when Redraw is off, and to start from a wider picture', () => {
    const fit = fitFor(MASTER_45, sheet, [can], NO_REDRAW)
    expect(fit.product).toBe('wont')
    expect(fit.suggest).toBe('wider')
    expect(fit.say).toBe("This picture can't hold the product at 4:1. Start from a wider picture, one close to 4:1, and make this size from that.")
  })
  it('suggests a taller picture for a tall shape from a wide master', () => {
    const fit = fitFor({ w: 1920, h: 1080 }, { w: 1, h: 6 }, [{ ...can, x: 700, y: 300, w: 300, h: 500 }], NO_REDRAW)
    expect(fit.suggest).toBe('taller')
  })
})

describe('what holds', () => {
  it('a crop that keeps the product, and an extend inside three steps, are offered', () => {
    const fit = fitFor({ w: 1920, h: 1080 }, { w: 1, h: 1 }, [{ ...can, x: 700, y: 200, w: 400, h: 600 }], ALL)
    expect(fit.methods.crop.ok).toBe(true)
    expect(fit.methods.extend.ok).toBe(true)
  })
  it('without a product box, nothing is claimed about the product', () => {
    const fit = fitFor(MASTER_45, { w: 4, h: 1 }, [{ role: 'subject', x: 0, y: 0, w: 100, h: 100 }], NO_REDRAW)
    expect(fit.product).toBe('none')
    expect(fit.say).toBeUndefined()
  })
  it('a redraw past 8:1 is not offered; a product too small to read is not offered either', () => {
    expect(fitFor(MASTER_45, { w: 10, h: 1 }, [can], ALL).methods.regenerate.ok).toBe(false)
    const tiny = fitFor({ w: 4000, h: 3000 }, { w: 9, h: 16 }, [{ ...can, x: 0, y: 0, w: 60, h: 60 }], ALL)
    expect(tiny.methods.regenerate.ok).toBe(false)
    expect(tiny.methods.regenerate.why).toMatch(/too small to read/)
  })
})
