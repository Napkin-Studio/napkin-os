import { describe, expect, it } from 'vitest'
import { placeMenu } from './place'

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
