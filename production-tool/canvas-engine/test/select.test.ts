// The select tool (features/engine-select.clan): click, groups, shift, marquee,
// lasso, a move written once at release, delete, and locked elements.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { inPolygon, SelectTool } from '../src/select/select'

function setup(records: ElementRecord[]) {
  const doc = new Y.Doc()
  const scene = new SceneStore(doc)
  scene.seed(records)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  const tool = new SelectTool(scene, (x, y) => r.hit(x, y))
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  let updates = 0
  doc.on('update', () => updates++)
  return { scene, tool, steps, updates: () => updates }
}

const box = (id: string, x: number, y: number, extra: Partial<ElementRecord> = {}) => element({ id, kind: 'shape', z: `a${x / 100}`, x, y, w: 50, h: 50, props: { geo: 'rect' }, ...extra })

describe('SelectTool', () => {
  const RECS = [box('a', 0, 0), box('b', 100, 0, { groupIds: ['g'] }), box('c', 200, 0, { groupIds: ['g'] }), box('d', 300, 0, { locked: true })]

  it('a click selects the topmost element with its outermost group; shift toggles', () => {
    const { tool } = setup(RECS)
    tool.press({ x: 10, y: 10 })
    tool.release({ x: 10, y: 10 })
    expect([...tool.selected]).toEqual(['a'])
    tool.press({ x: 110, y: 10 })
    tool.release({ x: 110, y: 10 })
    expect([...tool.selected].sort()).toEqual(['b', 'c'])
    tool.press({ x: 10, y: 10 }, { shift: true })
    tool.release({ x: 10, y: 10 })
    expect([...tool.selected].sort()).toEqual(['a', 'b', 'c'])
    tool.press({ x: 210, y: 10 }, { shift: true })
    tool.release({ x: 210, y: 10 })
    expect([...tool.selected]).toEqual(['a'])
  })

  it('a click on empty space clears; a marquee selects what is wholly inside', () => {
    const { tool } = setup(RECS)
    tool.set(['a'])
    tool.press({ x: -20, y: -20 })
    tool.drag({ x: 160, y: 80 })
    expect(tool.marquee).not.toBeNull()
    tool.release({ x: 160, y: 80 })
    // b is inside, and brings c (its group); d is not inside.
    expect([...tool.selected].sort()).toEqual(['a', 'b', 'c'])
    tool.press({ x: 500, y: 500 })
    tool.release({ x: 500, y: 500 })
    expect(tool.selected.size).toBe(0)
  })

  it('a pen lasso selects by centre', () => {
    const { tool } = setup(RECS)
    tool.press({ x: -10, y: -10 }, { by: 'pen' })
    for (const p of [{ x: 80, y: -10 }, { x: 80, y: 80 }, { x: -10, y: 80 }]) tool.drag(p)
    tool.release({ x: -10, y: -10 })
    expect([...tool.selected]).toEqual(['a'])
    expect(inPolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(true)
  })

  it('a drag on the selection previews without writing, then moves as one step; locked stays', () => {
    const { scene, tool, steps, updates } = setup(RECS)
    tool.set(['a', 'd'])
    const before = updates()
    tool.press({ x: 10, y: 10 })
    tool.drag({ x: 30, y: 15 })
    tool.drag({ x: 60, y: 40 })
    expect(tool.preview).toMatchObject({ dx: 50, dy: 30 })
    expect(updates()).toBe(before)
    tool.release({ x: 60, y: 40 })
    expect(steps).toHaveLength(1)
    expect(updates()).toBe(before + 1)
    expect(scene.get('a')).toMatchObject({ x: 50, y: 30 })
    expect(scene.get('d')).toMatchObject({ x: 300, y: 0 })
  })

  it('delete removes the selection as one step, but not what is locked', () => {
    const { scene, tool, steps } = setup(RECS)
    tool.set(['a', 'b', 'd'])
    expect(tool.deleteSelected()).toBe(2)
    expect(steps).toHaveLength(1)
    expect(scene.all().map((r) => r.id).sort()).toEqual(['c', 'd'])
    expect([...tool.selected]).toEqual(['d'])
  })
})
