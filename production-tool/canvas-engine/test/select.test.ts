// The select tool (features/engine-select.clan): click, groups, shift, marquee,
// lasso, a move written once at release, delete, and locked elements.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { inPolygon, SelectTool } from '../src/select/select'
import { hitBoardTitle } from '../src/render/links'

function setup(records: ElementRecord[]) {
  const doc = new Y.Doc()
  const scene = new SceneStore(doc)
  scene.seed(records)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  const tool = new SelectTool(scene, (x, y) => hitBoardTitle(scene, { x, y }, 1) ?? r.hit(x, y))
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  let updates = 0
  doc.on('update', () => updates++)
  return { scene, tool, steps, updates: () => updates }
}

const box = (id: string, x: number, y: number, extra: Partial<ElementRecord> = {}) => element({ id, kind: 'shape', z: `a${x / 100}`, x, y, w: 50, h: 50, props: { geo: 'rect' }, ...extra })

describe('boards as containers (art-boards)', () => {
  const board = (id: string, x: number, extra: Partial<ElementRecord> = {}) => element({ id, kind: 'board', z: `a0${x}`, x, y: 0, w: 400, h: 300, props: { name: id, purpose: 'location' }, ...extra })
  const pic = (id: string, x: number, y: number, parentId: string | null = null) => element({ id, kind: 'image', z: `b${x}`, x, y, w: 50, h: 50, parentId, props: { assetSha: null, status: 'saved' } })

  it('a picture dropped on a board joins it, dropped off leaves it, in the move’s one step', () => {
    const { scene, tool, steps } = setup([board('L', 0), board('C', 600), pic('p', 900, 400)])
    tool.set(['p'])
    tool.press({ x: 910, y: 410 })
    tool.release({ x: 110, y: 110 })
    expect(scene.get('p')).toMatchObject({ x: 100, y: 100, parentId: 'L' })
    expect(steps).toHaveLength(1)
    tool.press({ x: 110, y: 110 })
    tool.release({ x: 710, y: 110 })
    expect(scene.get('p')!.parentId).toBe('C')
    tool.press({ x: 710, y: 110 })
    tool.release({ x: 710, y: 610 })
    expect(scene.get('p')!.parentId).toBeNull()
  })

  it('a board is picked up by its title and moves what is on it, as one step', () => {
    const { scene, tool, steps } = setup([board('L', 0), pic('p', 100, 100, 'L'), pic('q', 200, 100, 'L'), pic('x', 900, 900)])
    const hit = hitBoardTitle(scene, { x: 50, y: -10 }, 1)!
    expect(hit.id).toBe('L')
    tool.set([hit.id])
    tool.press({ x: 50, y: -10 })
    tool.release({ x: 150, y: 20 })
    expect(steps).toHaveLength(1)
    expect([scene.get('L')!.x, scene.get('p')!.x, scene.get('q')!.x, scene.get('x')!.x]).toEqual([100, 200, 300, 900])
    expect(scene.get('p')!.parentId).toBe('L')
  })

  it('a stroke in a drawn frame keeps its frame when moved', () => {
    const frame = element({ id: 'f', kind: 'frame', z: 'a1', x: 0, y: 0, w: 200, h: 200, props: { name: 'Drawing' } })
    const { scene, tool } = setup([board('L', 0), frame, element({ id: 's', kind: 'shape', z: 'a2', x: 10, y: 10, w: 20, h: 20, parentId: 'f', props: { geo: 'rect' } })])
    tool.set(['s'])
    tool.press({ x: 15, y: 15 })
    tool.release({ x: 45, y: 15 })
    expect(scene.get('s')!.parentId).toBe('f')
  })
})

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
