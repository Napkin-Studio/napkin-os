// "Make a 9:16 copy" (features/art-boards.clan, owner decision 2026-10-14): a drawn sketch area keeps
// its ratio; the picker, with an area selected, copies it into another shape with its strokes scaled
// to fit, one undo step, the copy selected and the original untouched.

import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '../../core/canvasAdapter'
import { boxOf } from '../../core/sketch'
import { copyLabel, sketchCopy } from '../../core/sketchCopy'
import { OwnAdapter } from './adapter'
import { ownChrome } from './chrome'

const at = (x: number, y: number) => ({ x, y })
let n = 0
const ids = (p: string) => `${p}_${++n}`

/** A 16:9 area at (0,0) 320×180 with two strokes inside it, drawn on the own engine. */
function drawn() {
  const a = new OwnAdapter()
  a.setActiveTool({ type: 'native', id: 'sketch' })
  a.setSketchRatio('16:9')
  a.press(at(0, 0))
  a.release(at(320, 180))
  const area = a.elements()[0]
  a.setActiveTool({ type: 'native', id: 'freedraw' })
  for (const y of [40, 120]) {
    a.ink.begin('pen', { x: 40, y, pressure: 0.5 }, a.inkStyle)
    a.ink.add([{ x: 160, y: y + 10, pressure: 0.5 }, { x: 280, y: y + 20, pressure: 0.5 }])
    a.ink.end()
  }
  a.setActiveTool({ type: 'native', id: 'selection' })
  a.select([area.id])
  return { a, area }
}

const inside = (b: { x: number; y: number; w: number; h: number }, box: { x: number; y: number; w: number; h: number }) =>
  b.x >= box.x - 1e-6 && b.y >= box.y - 1e-6 && b.x + b.w <= box.x + box.w + 1e-6 && b.y + b.h <= box.y + box.h + 1e-6

describe('a sketch area copied into another shape', () => {
  it('names the copy for the picked ratio', () => {
    expect(copyLabel('9:16')).toBe('Make a 9:16 copy')
  })

  it('places a 9:16 area beside the original, its strokes scaled uniformly and centred inside it', () => {
    const { a, area } = drawn()
    const els = a.elements()
    const made = sketchCopy(els, area, '9:16', ids)!
    expect(made.area.width / made.area.height).toBeCloseTo(9 / 16, 9)
    expect(made.area).toMatchObject({ ratio: '9:16', customData: { kind: 'sketch' } })
    expect(made.area.x).toBeGreaterThanOrEqual(area.x + area.width)
    expect(made.strokes).toHaveLength(2)
    const box = { x: made.area.x, y: made.area.y, w: made.area.width, h: made.area.height }
    for (const s of made.strokes) expect(inside(boxOf(s), box)).toBe(true)
    // One factor on both axes: each stroke's box keeps its shape.
    const src = els.filter((e) => e.type === 'freedraw').map(boxOf)
    const out = made.strokes.map(boxOf)
    for (let i = 0; i < src.length; i++) expect(out[i].w / out[i].h).toBeCloseTo(src[i].w / src[i].h, 6)
    // Centred: the drawing (the 16:9 area's frame) sits in the middle of the tall copy.
    const top = Math.min(...out.map((b) => b.y)) - made.area.y
    const bottom = made.area.y + made.area.height - Math.max(...out.map((b) => b.y + b.h))
    expect(top).toBeGreaterThan(0)
    expect(bottom).toBeGreaterThan(0)
  })

  it('nudges clear of what is already beside the original', () => {
    const { a, area } = drawn()
    const blocker = { ...area, id: 'blocker', x: area.x + area.width + 40, y: 0, width: 200, height: 200, customData: undefined } as CanvasElement
    const made = sketchCopy([...a.elements(), blocker], area, '1:1', ids)!
    expect(made.area.x).toBeGreaterThan(blocker.x + blocker.width)
  })

  it('refuses the area\'s own ratio', () => {
    const { a, area } = drawn()
    expect(sketchCopy(a.elements(), area, '16:9', ids)).toBeNull()
  })

  it('through the picker: one undo step, the copy selected, the original untouched', () => {
    const { a, area } = drawn()
    const chrome = ownChrome(a)
    expect(chrome.selectedSketch?.()).toEqual({ id: area.id, ratio: '16:9' })
    const before = JSON.stringify(a.elements())
    expect(chrome.copySketch?.('9:16')).toBe(true)
    const after = a.elements()
    expect(after).toHaveLength(6)
    const sel = a.view().selectedIds
    expect(sel).toHaveLength(1)
    const copy = after.find((e) => e.id === sel[0])!
    expect(copy).toMatchObject({ ratio: '9:16' })
    expect(after.find((e) => e.id === area.id)).toEqual(a.elements().find((e) => e.id === area.id))
    expect(JSON.stringify(after.filter((e) => JSON.parse(before).some((b: CanvasElement) => b.id === e.id)))).toBe(before)
    a.undoScene('undo')
    expect(JSON.stringify(a.elements())).toBe(before)
  })

  it('a drawn area never changes ratio: picking a shape with nothing selected only sets the next area\'s', () => {
    const { a, area } = drawn()
    a.select([])
    expect(ownChrome(a).selectedSketch?.()).toBeNull()
    ownChrome(a).setSketchRatio?.('9:16')
    expect(a.elements().find((e) => e.id === area.id)).toMatchObject({ ratio: '16:9', width: 320, height: 180 })
  })
})
