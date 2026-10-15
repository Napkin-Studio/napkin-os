// Corner handles (features/canvas-edit-tools.clan; ui-behaviour 3.7, 3.8): the
// selection scales round the opposite corner, as a preview while dragging and one
// step at release; a group scales as one; a sketch area keeps its ratio, so only
// the ratio picker changes it.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodePoints } from '../src/model/points'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { SelectTool } from '../src/select/select'

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

// Filled, so a click anywhere inside hits it (an unfilled shape is hit only on its outline: hitStroke.test.ts).
const shape = (id: string, x: number, y: number, w: number, h: number, extra: Partial<ElementRecord> = {}) =>
  element({ id, kind: 'shape', z: `a${id}`, x, y, w, h, style: { fill: '#dddddd' }, props: { geo: 'rect' }, ...extra })
const area = (id: string, x: number, y: number, w: number, h: number, ratio?: string) =>
  element({ id, kind: 'sketch', z: `a${id}`, x, y, w, h, style: { fill: '#ffffff' }, props: ratio ? { ratio } : {}, customData: { kind: 'sketch', id: `sk_${id}` } })

describe('corner handles', () => {
  it('the frame is the selection’s box, with handles when what is selected can be scaled', () => {
    const node = element({ id: 'n', kind: 'node', z: 'an', x: 500, y: 0, w: 100, h: 100, props: { nodeKind: 'script' } })
    const { tool } = setup([shape('a', 0, 0, 100, 50), shape('b', 200, 100, 100, 100), node])
    tool.set(['a', 'b'])
    expect(tool.frame()).toMatchObject({ box: { x: 0, y: 0, w: 300, h: 200 }, scalable: true })
    expect(tool.handleAt({ x: 304, y: 209 }, 1)).toBe('se')
    expect(tool.handleAt({ x: -6, y: -6 }, 1)).toBe('nw')
    // Inside the box is the box (a move), not a handle.
    expect(tool.handleAt({ x: 3, y: 3 }, 1)).toBeNull()
    expect(tool.handleAt({ x: 150, y: 100 }, 1)).toBeNull()
    tool.set(['a', 'n'])
    expect(tool.frame()!.scalable).toBe(false)
    expect(tool.handleAt({ x: -6, y: -6 }, 1)).toBeNull()
  })

  it('dragging a corner previews without writing, then scales round the opposite corner as one step', () => {
    const { scene, tool, steps, updates } = setup([shape('a', 0, 0, 100, 50), shape('b', 200, 100, 100, 100)])
    tool.set(['a', 'b'])
    const before = updates()
    tool.press({ x: 306, y: 206 })
    tool.drag({ x: 450, y: 260 })
    expect(tool.scaling).toMatchObject({ ox: 0, oy: 0, s: 1.5 })
    expect(updates()).toBe(before)
    expect(tool.frame()!.box).toEqual({ x: 0, y: 0, w: 450, h: 300 })
    tool.release({ x: 600, y: 400 })
    expect(steps).toHaveLength(1)
    expect(scene.get('a')).toMatchObject({ x: 0, y: 0, w: 200, h: 100 })
    expect(scene.get('b')).toMatchObject({ x: 400, y: 200, w: 200, h: 200 })
    expect(tool.scaling).toBeNull()
  })

  it('the north-west corner scales round the south-east one', () => {
    const { scene, tool } = setup([shape('a', 100, 100, 100, 100)])
    tool.set(['a'])
    tool.press({ x: 94, y: 94 })
    tool.release({ x: 150, y: 150 })
    expect(scene.get('a')).toMatchObject({ x: 150, y: 150, w: 50, h: 50 })
  })

  it('a group scales as one: every member, round the group’s corner', () => {
    const { scene, tool } = setup([shape('a', 0, 0, 50, 50, { groupIds: ['g'] }), shape('b', 50, 50, 50, 50, { groupIds: ['g'] })])
    tool.press({ x: 10, y: 10 })
    tool.release({ x: 10, y: 10 })
    tool.press({ x: 106, y: 106 })
    tool.release({ x: 200, y: 200 })
    expect(scene.get('b')).toMatchObject({ x: 100, y: 100, w: 100, h: 100 })
  })

  it('a sketch area keeps its ratio from every corner, whichever way the pointer goes', () => {
    for (const [corner, from] of [['se', { x: 166, y: 96 }], ['nw', { x: -6, y: -6 }], ['ne', { x: 166, y: -6 }], ['sw', { x: -6, y: 96 }]] as const) {
      const { scene, tool } = setup([area('s', 0, 0, 160, 90, '16:9')])
      tool.set(['s'])
      expect(tool.handleAt(from, 1)).toBe(corner)
      tool.press(from)
      tool.drag({ x: from.x + 37, y: from.y + 80 })
      tool.release({ x: from.x + 37, y: from.y + 80 })
      const r = scene.get('s')!
      expect(r.w / r.h).toBeCloseTo(16 / 9, 9)
      expect(r.w).not.toBe(160)
    }
  })

  it('an area with no ratio keeps the shape it had when the drag began', () => {
    const { scene, tool } = setup([area('s', 0, 0, 120, 100)])
    tool.set(['s'])
    tool.press({ x: 126, y: 106 })
    tool.release({ x: 300, y: 120 })
    const r = scene.get('s')!
    expect(r.w / r.h).toBeCloseTo(1.2, 9)
  })

  it('locked elements are not scaled; a tiny drag never collapses the box', () => {
    const { scene, tool } = setup([shape('a', 0, 0, 100, 100), shape('l', 100, 100, 100, 100, { locked: true })])
    tool.set(['a', 'l'])
    tool.press({ x: 206, y: 206 })
    tool.release({ x: -500, y: -500 })
    expect(scene.get('l')).toMatchObject({ x: 100, y: 100, w: 100, h: 100 })
    expect(scene.get('a')!.w).toBeGreaterThan(0)
  })

  it('a stroke keeps its points and is drawn at its new size', () => {
    const pts = encodePoints([{ x: 0, y: 0, pressure: 0.5 }, { x: 40, y: 20, pressure: 0.5 }], { x: 0, y: 0 })
    const s = element({ id: 's', kind: 'stroke', z: 'a1', x: 0, y: 0, w: 40, h: 20, props: { tool: 'pen' } })
    const { scene, tool } = setup([])
    scene.seed([s], { s: pts })
    tool.set(['s'])
    tool.press({ x: 46, y: 26 })
    tool.release({ x: 80, y: 40 })
    expect(scene.get('s')).toMatchObject({ w: 80, h: 40 })
    expect(scene.points('s')).toBe(pts)
  })
})
