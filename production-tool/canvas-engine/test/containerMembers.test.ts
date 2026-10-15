// A container moves with what is in it (owner screenshot 2026-10-15: a "Drawing" frame sat empty at a
// board's edge while its stick figure stayed behind, and the board still said "Drop pictures here").
// A drawn frame's strokes (parentId) and a sketch area's ink (by geometry, web core/sketch.ts
// membersOf) go wherever the container goes: a drag, a drop auto-placed onto a board, a board's move;
// all in one undo step. A board with anything drawn over it shows no drop hint.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { Renderer, type DrawContext } from '../src/render/renderer'
import { SelectTool } from '../src/select/select'
import { SceneUndo } from '../src/undo/sceneUndo'

const board = (id: string, x: number, w = 520, h = 300) => element({ id, kind: 'board', z: `a0${id}`, x, y: 0, w, h, props: { name: 'Samurai', purpose: 'character' } })
const ink = (id: string, x: number, y: number, extra: Partial<ElementRecord> = {}) => element({ id, kind: 'shape', z: `c${id}`, x, y, w: 80, h: 180, props: { geo: 'rect' }, ...extra })

function setup(records: ElementRecord[]) {
  const scene = new SceneStore(new Y.Doc())
  scene.seed(records)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  const tool = new SelectTool(scene, (x, y) => r.hit(x, y))
  const undo = new SceneUndo(scene)
  return { scene, r, tool, undo, at: (id: string) => { const e = scene.get(id)!; return [e.x, e.y] } }
}

describe('a container moves with what is in it', () => {
  it('a drawn frame auto-placed onto a board takes its strokes along, one step, and undo brings both back', () => {
    const frame = element({ id: 'F', kind: 'frame', z: 'b1', x: 1000, y: -100, w: 112, h: 212, props: { name: 'Drawing' }, customData: { kind: 'drawn', id: 'n1' } })
    const { scene, tool, undo, at } = setup([board('B', 0), frame, ink('s1', 1016, -84, { parentId: 'F' })])
    tool.set(['F'])
    tool.press({ x: 1005, y: 100 })
    // Dropped sticking out of the board's top: auto-placed in its first free slot.
    tool.release({ x: 105, y: 150 })
    expect(scene.get('F')!.parentId).toBe('B')
    expect(at('F')).toEqual([16, 22])
    expect(at('s1')).toEqual([32, 38])
    expect(scene.get('s1')!.parentId).toBe('F')
    undo.undo()
    expect(at('F')).toEqual([1000, -100])
    expect(at('s1')).toEqual([1016, -84])
  })

  it('a sketch area dragged takes the ink drawn in it (by geometry), keeps its size and ratio, and a board move takes both', () => {
    const area = element({ id: 'A', kind: 'sketch', z: 'b1', x: 1000, y: 0, w: 320, h: 180, style: { fill: '#ffffff' }, props: { ratio: '16:9' }, customData: { kind: 'sketch', id: 'sketch_1' } })
    const { scene, tool, at } = setup([board('B', 0, 700, 400), area, ink('s1', 1100, 10), ink('far', 2000, 10)])
    tool.set(['A'])
    tool.press({ x: 1010, y: 170 })
    tool.release({ x: 60, y: 220 })
    const a = scene.get('A')!
    expect(a.parentId).toBe('B')
    expect([a.w, a.h, a.props.ratio]).toEqual([320, 180, '16:9'])
    expect(at('s1')).toEqual([1100 + a.x - 1000, 10 + a.y])
    expect(at('far')).toEqual([2000, 10])
    // The board moved by its title: the area and its ink with it.
    const before = { a: at('A'), s: at('s1') }
    tool.set(['B'])
    tool.press({ x: 50, y: -10 })
    tool.release({ x: 150, y: 40 })
    expect(at('A')).toEqual([before.a[0] + 100, before.a[1] + 50])
    expect(at('s1')).toEqual([before.s[0] + 100, before.s[1] + 50])
  })

  it('a board with ink or a sketch area over it draws no drop hint; an empty one does', () => {
    const { r } = setup([board('E', 0), board('I', 600), ink('s1', 700, 50)])
    const calls: string[] = []
    const ctx = new Proxy({} as DrawContext, { get: (_t, k) => (k === 'lineWidth' || k === 'globalAlpha' ? 1 : (...a: unknown[]) => { if (k === 'fillText') calls.push(String(a[0])) }), set: () => true })
    r.boardLook = { fill: '#fff', stroke: '#ccc', current: '#2F64F5', radius: 16, title: '#333', titleBg: '#fafafa' }
    r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 1400, height: 600 }, 1, 'transparent')
    expect(calls.filter((c) => c.startsWith('Drop pictures'))).toHaveLength(1)
  })
})

describe('a container’s contents never block its own board', () => {
  it('a 16:9 sketch area with ink dropped onto the Products board (too narrow for it) grows the board right, its ink with it', () => {
    const area = element({ id: 'A', kind: 'sketch', z: 'b1', x: 1433, y: 702, w: 437, h: 246, style: { fill: '#ffffff' }, props: { ratio: '16:9' }, customData: { kind: 'sketch', id: 'sketch_1' } })
    const { scene, tool, at } = setup([
      element({ id: 'R', kind: 'board', z: 'a0R', x: 1324, y: 0, w: 420, h: 300, props: { name: 'References', purpose: 'reference' } }),
      element({ id: 'P', kind: 'board', z: 'a0P', x: 1792, y: 0, w: 420, h: 300, props: { name: 'Products', purpose: 'product' } }),
      area, ink('s1', 1618, 769, { w: 41, h: 41 }), ink('s2', 1638, 810, { w: 1, h: 53 }),
    ])
    tool.set(['A'])
    tool.press({ x: 1440, y: 940 })
    tool.release({ x: 1840, y: 300 })
    const a = scene.get('A')!
    expect(a.parentId).toBe('P')
    expect([a.x, a.y, a.w, a.h]).toEqual([1808, 22, 437, 246])
    expect([at('s1'), at('s2')]).toEqual([[1993, 89], [2013, 130]])
    expect(scene.get('P')!.w).toBe(16 + 437 + 16)
  })
})
