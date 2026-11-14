import { describe, expect, it } from 'vitest'
import { placeFloating, placeMenu } from './place'

const view = { w: 1000, h: 800 }
const button = { left: 900, top: 10, right: 960, bottom: 40 }

describe('placeMenu (floating menus)', () => {
  it('opens below the button, lined up with its end, inside the viewport', () => {
    expect(placeMenu(button, { w: 200, h: 100 }, view, 'end')).toEqual({ left: 760, top: 46, above: false })
  })
  it('lines up with the start, pushed back inside when it would spill off the right', () => {
    expect(placeMenu(button, { w: 200, h: 100 }, view, 'start').left).toBe(792)
  })
  it('opens above when there is no room below', () => {
    const low = { left: 100, top: 700, right: 160, bottom: 730 }
    expect(placeMenu(low, { w: 200, h: 200 }, view)).toEqual({ left: 100, top: 494, above: true })
  })
  it('asked for above, it goes below when there is no room above', () => {
    expect(placeMenu(button, { w: 200, h: 100 }, view, 'center', 'above')).toMatchObject({ top: 46, above: false })
  })
  it('a panel taller than the viewport stays pinned to the top margin', () => {
    expect(placeMenu(button, { w: 200, h: 900 }, view).top).toBe(8)
  })
})

describe('placeFloating keeps clear of the canvas chrome (ui-behaviour 3.9)', () => {
  const box = { w: 1600, h: 900 }
  const rail = { left: 16, top: 16, right: 300, bottom: 540 }
  const bar = { w: 900, h: 50 }
  it('as before with nothing to avoid: centred above the selection', () => {
    expect(placeFloating({ x: 500, top: 400, bottom: 600 }, bar, box)).toEqual({ left: 50, top: 336, below: false })
  })
  it('moves along beside the boards rail rather than over it (owner screenshot 2026-10-15)', () => {
    const p = placeFloating({ x: 500, top: 400, bottom: 600 }, bar, box, 14, 8, [rail])
    expect(p).toEqual({ left: 308, top: 336, below: false })
  })
  it('a bar that cannot sit beside it at either height goes below, clear of it', () => {
    const wide = { w: 1400, h: 50 }
    const p = placeFloating({ x: 500, top: 400, bottom: 600 }, wide, box, 14, 8, [rail])
    expect(p.below).toBe(true)
    expect(p.top).toBe(614)
  })
  it('covers it only when nothing else fits', () => {
    const p = placeFloating({ x: 500, top: 400, bottom: 600 }, { w: 1584, h: 50 }, box, 14, 8, [{ left: 0, top: 0, right: 1600, bottom: 900 }])
    expect(p).toEqual({ left: 8, top: 336, below: false })
  })
})
