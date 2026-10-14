// The own engine's edit tools in the adapter (features/canvas-edit-tools.clan):
// the sketch area tool, group and ungroup, scaling by a corner and the selection
// frame the renderer draws.

import { describe, expect, it } from 'vitest'
import { OwnAdapter } from './adapter'
import { ownChrome } from './chrome'

const at = (x: number, y: number) => ({ x, y })

describe('the own engine’s edit tools', () => {
  it('S draws a sketch area at the next ratio, then goes back to Select with it selected', () => {
    const a = new OwnAdapter()
    ownChrome(a).setTool('sketch')
    expect(ownChrome(a).tool()).toBe('sketch')
    a.setSketchRatio('9:16')
    a.press(at(0, 0))
    a.drag(at(90, 10))
    expect(a.sketch.ghost).toMatchObject({ w: 90, h: 160, ratio: '9:16' })
    a.release(at(90, 10))
    const [el] = a.elements()
    expect(el).toMatchObject({ type: 'rectangle', width: 90, height: 160, ratio: '9:16', customData: { kind: 'sketch' } })
    expect(a.view().selectedIds).toEqual([el.id])
    expect(ownChrome(a).tool()).toBe('select')
  })

  it('its corners keep the ratio: the area grows, still 9:16', () => {
    const a = new OwnAdapter()
    a.setActiveTool({ type: 'native', id: 'sketch' })
    a.setSketchRatio('9:16')
    a.press(at(0, 0))
    a.release(at(90, 160))
    // The south-east handle sits 6 px out from the corner (at 100% zoom).
    a.press(at(96, 166))
    a.release(at(300, 170))
    const [el] = a.elements()
    expect(el.width / el.height).toBeCloseTo(9 / 16, 9)
    expect(el.width).toBeCloseTo(300, 6)
    a.undoScene('undo')
    expect(a.elements()[0].width).toBe(90)
  })

  it('groups and ungroups the selection, and a group shows one dashed frame (ink with its label)', () => {
    const a = new OwnAdapter()
    a.setActiveTool({ type: 'native', id: 'freedraw' })
    for (const x of [0, 60]) {
      a.ink.begin('pen', { x, y: 0, pressure: 0.5 }, a.inkStyle)
      a.ink.add([{ x: x + 40, y: 20, pressure: 0.5 }])
      a.ink.end()
    }
    a.setActiveTool({ type: 'native', id: 'selection' })
    a.press(at(10, 5))
    a.release(at(10, 5))
    // Strokes drawn close together are one ink group already.
    expect(a.selectionKind()).toMatchObject({ kind: 'group', ink: true, count: 2 })
    expect(a.selectionFrame()).toMatchObject({ dashed: true, handles: true, label: 'Ink · 2 strokes · one group' })
    expect(a.ungroup()).toBe(true)
    expect(a.selectionKind()).toEqual({ kind: 'several', count: 2 })
    expect(a.selectionFrame()).toMatchObject({ dashed: false, handles: true })
    expect(a.group()).toEqual(expect.any(String))
    expect(a.selectionKind()).toMatchObject({ kind: 'group', count: 2 })
  })
})
