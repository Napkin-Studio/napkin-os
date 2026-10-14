// core/sketch.ts against the shared case table (contracts/examples/aspect-cases.json),
// which the relay's test_aspect.py reads too (features/frame-aspect.clan).

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import cases from '../../../../contracts/examples/aspect-cases.json'
import { cropLoss, FLASH_SIZES, PRO_SIZES, runwaySize } from '../../lib/runwaySizes'
import {
  aspectLabel, aspectOfRatio, BIG_CROP, boxOf, centreCrop, croppedCaption, exactRatio, exportPlan, exportPx, ghostRect, lockAspect,
  lossOf, membersOf, ratioFor, ratioText, sameShape, TOLERANCE, type Boxed,
} from './sketch'

describe('the case table', () => {
  it('has the tolerance and export side the code uses', () => {
    expect(TOLERANCE).toBe(cases.tolerance)
    expect(exportPx({ w: 16, h: 9 }).w).toBe(cases.exportLongSide)
  })

  for (const c of cases.cases) {
    it(`${c.name}: the export size, the size each model renders, the crop and the loss`, () => {
      expect(exportPx(c.target)).toEqual(c.export)
      for (const [model, want] of Object.entries(c.models)) {
        expect(runwaySize(c.target, model), model).toEqual(want.size)
        const box = centreCrop(want.size, c.target)
        if (want.crop === null) {
          expect(sameShape(want.size, c.target)).toBe(true)
          expect(lossOf(c.target, want.size)).toBe(0)
        } else {
          expect([box.x, box.y, box.x + box.w, box.y + box.h]).toEqual(want.crop)
          expect({ w: box.w, h: box.h }).toEqual(want.out)
          expect(Number(lossOf(c.target, want.size).toFixed(4))).toBe(want.loss)
        }
      }
    })
  }
})

describe('the size tables', () => {
  it('are the relay’s (director.py), so the warning says what the relay will do', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const py = readFileSync(resolve(here, '../../../../relay/director/director.py'), 'utf8')
    const table = (name: string) => {
      const m = new RegExp(`${name} = frozenset\\("""([\\s\\S]*?)"""`).exec(py)
      return m![1].trim().split(/\s+/).sort()
    }
    const ours = (xs: { w: number; h: number }[]) => xs.map((s) => `${s.w}:${s.h}`).sort()
    expect(ours(FLASH_SIZES)).toEqual(table('FLASH_RATIOS'))
    expect(ours(PRO_SIZES)).toEqual(table('PRO_RATIOS'))
  })

  it('a 728×90 banner loses most of the picture on Pro and almost none on Flash', () => {
    expect(cropLoss({ w: 728, h: 90 }, 'gemini_image3_pro')).toBeGreaterThan(BIG_CROP)
    expect(cropLoss({ w: 728, h: 90 }, 'gemini_image3.1_flash')).toBeLessThan(0.02)
    expect(cropLoss({ w: 16, h: 9 }, 'gemini_image3_pro')).toBeCloseTo(0.0156, 4)
  })
})

describe('ghostRect: the dashed ghost while dragging, locked to the shape', () => {
  const r169 = { w: 16, h: 9 }
  it('grows the way the pointer went, from all four directions', () => {
    expect(ghostRect({ x: 0, y: 0 }, { x: 160, y: 10 }, r169)).toEqual({ x: 0, y: 0, w: 160, h: 90 })
    expect(ghostRect({ x: 0, y: 0 }, { x: -160, y: 10 }, r169)).toEqual({ x: -160, y: 0, w: 160, h: 90 })
    expect(ghostRect({ x: 0, y: 0 }, { x: 160, y: -10 }, r169)).toEqual({ x: 0, y: -90, w: 160, h: 90 })
    expect(ghostRect({ x: 0, y: 0 }, { x: -160, y: -10 }, r169)).toEqual({ x: -160, y: -90, w: 160, h: 90 })
  })

  it('a tall drag leads with its height, so the pointer stays on the edge', () => {
    const g = ghostRect({ x: 0, y: 0 }, { x: 10, y: 90 }, r169)
    expect(g.h).toBeCloseTo(90)
    expect(g.w).toBeCloseTo(160)
  })
})

describe('lockAspect: a resize put back on its shape', () => {
  it('after a corner or an edge resize, anchored top-left and led by the width', () => {
    expect(lockAspect({ x: 10, y: 20, w: 320, h: 100 }, { w: 16, h: 9 })).toEqual({ x: 10, y: 20, w: 320, h: 180 })
    expect(lockAspect({ x: 0, y: 0, w: 90, h: 300 }, { w: 9, h: 16 })).toEqual({ x: 0, y: 0, w: 90, h: 160 })
  })

  it('writes nothing within half a unit', () => {
    expect(lockAspect({ x: 0, y: 0, w: 160, h: 90.4 }, { w: 16, h: 9 })).toBeNull()
    expect(lockAspect({ x: 0, y: 0, w: 160, h: 90 }, { w: 16, h: 9 })).toBeNull()
  })
})

describe('membersOf: the strokes an area exports', () => {
  const area = { x: 0, y: 0, w: 160, h: 90 }
  const el = (id: string, x: number, y: number, w: number, h: number, more: Partial<Boxed> = {}): Boxed =>
    ({ id, type: 'freedraw', x, y, width: w, height: h, ...more })
  const els: Boxed[] = [
    el('inside', 10, 10, 20, 20),
    el('crossing', 150, 40, 100, 10),
    el('outside', 300, 300, 10, 10),
    el('deleted', 10, 10, 5, 5, { isDeleted: true }),
    el('text', 10, 10, 50, 20, { type: 'text' }),
    el('tagged', 10, 10, 50, 20, { type: 'rectangle', customData: { kind: 'sketch', id: 's' } }),
    // A line whose points run left of its origin: its box is from the points.
    el('line', 200, 50, 0, 0, { type: 'line', points: [[0, 0], [-60, 10]] }),
  ]
  it('inside and crossing belong; outside, deleted, text and tagged elements do not', () => {
    expect(membersOf(els, area).map((e) => e.id)).toEqual(['inside', 'crossing', 'line'])
  })

  it('a line’s box comes from its points', () => {
    expect(boxOf(els[6])).toEqual({ x: 140, y: 50, w: 60, h: 10 })
  })
})

describe('export and labels', () => {
  it('exportPlan is exactly the area at exportPx', () => {
    const p = exportPlan({ x: 5, y: 5, w: 320, h: 180 }, { w: 16, h: 9 })
    expect(p).toEqual({ rect: { x: 5, y: 5, w: 320, h: 180 }, aspect: { w: 16, h: 9 }, outW: 1536, outH: 864, scale: 4.8 })
  })

  it('ratioFor snaps any shape to the nearest of the four', () => {
    expect(ratioFor({ w: 300, h: 400 })).toBe('4:5')
    expect(ratioFor({ w: 1000, h: 1000 })).toBe('1:1')
    expect(ratioFor({ w: 1920, h: 1000 })).toBe('16:9')
    expect(ratioFor({ w: 500, h: 1200 })).toBe('9:16')
  })

  it('exactRatio is one of the four only within the tolerance', () => {
    expect(exactRatio({ w: 1920, h: 1080 })).toBe('16:9')
    expect(exactRatio({ w: 1920, h: 1081 })).toBe('16:9')
    expect(exactRatio({ w: 191, h: 100 })).toBeUndefined()
    expect(aspectOfRatio('4:5')).toEqual({ w: 4, h: 5 })
  })

  it('labels a shape as the spec writes it', () => {
    expect(aspectLabel({ w: 16, h: 9 })).toBe('16:9 · 1920×1080')
    expect(aspectLabel({ w: 9, h: 16 })).toBe('9:16 · 1080×1920')
    expect(aspectLabel({ w: 1080, h: 1920 })).toBe('9:16 · 1080×1920')
    expect(aspectLabel({ w: 191, h: 100 })).toBe('191:100 · 191×100')
    expect(ratioText({ w: 7200, h: 3600 })).toBe('2:1')
  })

  it('the caption of a cropped picture', () => {
    expect(croppedCaption({ w: 1344, h: 756 }, { w: 16, h: 9 })).toBe('1344×756 · cropped to 16:9')
    expect(croppedCaption({ w: 1344, h: 704 }, { w: 191, h: 100 })).toBe('1344×704 · cropped to 191:100')
  })
})
