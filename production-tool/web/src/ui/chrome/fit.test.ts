import { describe, expect, it } from 'vitest'
import { BUDGET, barItems, barWidth, fitLevel, undoInMore, type FitLevel } from './fit'

// The top bars fit (features/topbar-declutter.clan): three fixed levels by viewport width, and a
// width budget per bar that fails when someone adds a control and a bar stops fitting. The
// mock-stack script test-sandbox/production/bar-fit.mjs measures the real bars at the same widths.

const BARS = Object.keys(BUDGET) as (keyof typeof BUDGET)[]

describe('fit levels', () => {
  it('full from 1280, compact from 1024, tight below', () => {
    expect([1440, 1280, 1279, 1180, 1024, 1023, 820].map(fitLevel)).toEqual(['full', 'full', 'compact', 'compact', 'compact', 'tight', 'tight'])
  })
  it('Undo and Redo leave the bar only at tight on a fine pointer: on touch they stay (iPad portrait)', () => {
    expect(undoInMore(fitLevel(820), true)).toBe(false)
    expect(undoInMore(fitLevel(1000), false)).toBe(true)
    expect(undoInMore(fitLevel(1180), false)).toBe(false)
    expect(barItems('script', 'tight', true).map((i) => i.item)).toContain('undo')
    expect(barItems('script', 'tight', false).map((i) => i.item)).not.toContain('undo')
  })
})

describe('the width budget: every bar fits at every width it can be shown at', () => {
  // [viewport, level, coarse]: the narrowest width of each level, and the widths the owner checks.
  const CASES: [number, FitLevel, boolean][] = [
    [1440, 'full', false], [1280, 'full', false],
    [1180, 'compact', false], [1024, 'compact', false], [1180, 'compact', true],
    [1023, 'tight', false], [820, 'tight', true],
  ]
  for (const bar of BARS) {
    for (const [width, level, coarse] of CASES) {
      it(`${bar} at ${width}px${coarse ? ' (touch)' : ''}`, () => {
        // A scrollbar or a window frame can take 32px at the narrow end.
        const room = level === 'tight' ? width - 32 : width
        expect(barWidth(bar, level, coarse)).toBeLessThanOrEqual(room)
      })
    }
  }
  it('the way back, the job button, the primary and the account are in every bar at every level', () => {
    const primary: Record<string, string> = { script: 'Update storyboard', storyboard: 'Drawing the rest…', video: 'Rendering…', image: 'Apply as new version' }
    for (const bar of BARS) {
      for (const level of ['full', 'compact', 'tight'] as FitLevel[]) {
        for (const coarse of [false, true]) {
          const items = barItems(bar, level, coarse).map((i) => i.item)
          expect(items).toContain(bar === 'canvas' ? 'home' : 'back')
          expect(items).toContain('job button')
          expect(items).toContain('account')
          expect(items).toContain('more')
          if (primary[bar]) expect(items).toContain(primary[bar])
        }
      }
    }
  })
  it('reserves room for live presence on every bar', () => {
    for (const bar of BARS) expect(barItems(bar, 'full', false).map((i) => i.item)).toContain('presence')
  })
})
