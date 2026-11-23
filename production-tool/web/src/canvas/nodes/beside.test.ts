// A node made beside another keeps clear of every card there, the Brief card too (UAT 2026-11-21, F18: after Plan
// shots the Brief card sat on top of the new Storyboard node).
import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '../core/canvasAdapter'
import { besideBox } from './make'

const el = (id: string, kind: string, x: number, y: number, width: number, height: number) =>
  ({ id, type: 'rectangle', x, y, width, height, isDeleted: false, customData: { kind, id: `${kind}_1` } }) as unknown as CanvasElement

describe('besideBox', () => {
  it('goes below a Brief card that sits where it would land', () => {
    const script = el('s', 'script', 0, 0, 400, 360)
    const brief = el('b', 'brief', 440, 100, 280, 140)
    const box = besideBox([script, brief], script, 'storyboard')
    const overlaps = box.x < brief.x + brief.width && box.x + box.w > brief.x && box.y < brief.y + brief.height && box.y + box.h > brief.y
    expect(overlaps).toBe(false)
  })
})
