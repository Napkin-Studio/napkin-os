// The tools and their keys (ui-behaviour 3.12).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BRUSH_MAX, BRUSH_MIN, TOOLS, brushStep, cropRect, toolForKey, zoomStep } from './tools'

const SPEC = readFileSync(new URL('../../../../../docs/production-tool/ui-behaviour.md', import.meta.url), 'utf8')

describe('the tools', () => {
  it('are the eight of the spec, with their keys', () => {
    expect(TOOLS.map((t) => `${t.id}:${t.key}`)).toEqual(['select:V', 'click:A', 'brush:B', 'lasso:L', 'eraser:E', 'text:T', 'crop:C', 'hand:H'])
    for (const t of TOOLS) expect(SPEC).toMatch(new RegExp(`\\| ${t.label.split(',')[0]}[^|]*\\| ${t.key}`))
  })
  it('a key chooses its tool; a key with a modifier chooses none', () => {
    expect(toolForKey({ key: 'b' })).toBe('brush')
    expect(toolForKey({ key: 'A' })).toBe('click')
    expect(toolForKey({ key: 'c', metaKey: true })).toBeUndefined()
    expect(toolForKey({ key: 'z' })).toBeUndefined()
  })
  it('[ and ] change the brush size within its range', () => {
    expect(brushStep(48, ']')).toBe(54)
    expect(brushStep(48, '[')).toBe(42)
    expect(brushStep(BRUSH_MIN, '[')).toBe(BRUSH_MIN)
    expect(brushStep(BRUSH_MAX, ']')).toBe(BRUSH_MAX)
  })
})

describe('crop keeps the frame ratio (review item 10)', () => {
  it('is square in the picture\'s own units, whatever the drag', () => {
    const r = cropRect({ x: 0.1, y: 0.1 }, { x: 0.7, y: 0.3 })
    expect(r).toEqual({ x: 0.1, y: 0.1, w: 0.6, h: 0.6 })
  })
  it('stays on the picture and works dragged up and left', () => {
    const up = cropRect({ x: 0.8, y: 0.8 }, { x: 0.1, y: 0.5 })
    for (const [k, v] of Object.entries({ x: 0.1, y: 0.1, w: 0.7, h: 0.7 })) expect(up[k as keyof typeof up]).toBeCloseTo(v, 9)
    const r = cropRect({ x: 0.6, y: 0.2 }, { x: 1.4, y: 0.9 })
    expect(r.x + r.w).toBeLessThanOrEqual(1)
    expect(r.y + r.h).toBeLessThanOrEqual(1)
  })
})

describe('zoom', () => {
  it('steps in and out', () => {
    expect(zoomStep(1, 1)).toBe(1.5)
    expect(zoomStep(1, -1)).toBe(0.75)
    expect(zoomStep(4, 1)).toBe(4)
  })
})
