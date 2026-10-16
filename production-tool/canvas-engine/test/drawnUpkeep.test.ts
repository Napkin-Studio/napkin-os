// A Drawing's upkeep (features/container-select.clan, phase 4): a member moved, scaled,
// erased or deleted refits the drawn frame (pad 16) in the same undo step; a member
// dropped with its centre outside leaves; a pen stroke drawn inside joins; an empty
// Drawing stays.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Ink } from '../src/ink/ink'
import { encodePoints, type InkPoint } from '../src/model/points'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { DRAWN_PAD, drawnAt, isDrawn, refitDrawn } from '../src/select/drawn'
import { SelectTool } from '../src/select/select'
import { SceneUndo } from '../src/undo/sceneUndo'

const pt = (x: number, y: number): InkPoint => ({ x, y, pressure: 0.5 })
const box = (r: ElementRecord | undefined) => r && { x: r.x, y: r.y, w: r.w, h: r.h }

function stick(id: string, x: number, y: number, len: number, parentId: string | null = 'D') {
  return {
    rec: element({ id, kind: 'stroke', z: `c${id}`, x, y, w: 1, h: len, parentId, style: { width: 4 }, props: { tool: 'pen' } }),
    pts: encodePoints([pt(0, 0), pt(0, len), pt(1, len)], { x: 0, y: 0 }),
  }
}

/** A Drawing fitted round two strokes: s1 at x 100, s2 at x 200, both y 50 to 250. */
function drawing(tag: 'drawn' | null = 'drawn') {
  const scene = new SceneStore(new Y.Doc())
  const frame = element({
    id: 'D', kind: 'frame', z: 'a1', x: 84, y: 34, w: 133, h: 232, props: { name: 'Drawing' },
    customData: tag ? { kind: 'drawn', id: 'node_D', asset: 'sha256:x' } : null,
  })
  const s1 = stick('s1', 100, 50, 200)
  const s2 = stick('s2', 200, 50, 200)
  scene.seed([frame, s1.rec, s2.rec], { s1: s1.pts, s2: s2.pts })
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  let t = 0
  const tool = new SelectTool(scene, (x, y) => r.hit(x, y), { now: () => t })
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  const undo = new SceneUndo(scene)
  /** Enter the Drawing and pick the stroke at (x, y) alone. */
  const enter = (x: number, y: number) => {
    for (const at of [0, 100]) {
      t = at
      tool.press({ x, y }, { zoom: 1 })
      tool.release({ x, y })
    }
    t = 5000
  }
  return { scene, tool, steps, undo, enter }
}

describe('isDrawn and drawnAt', () => {
  it('a Drawing is a frame tagged drawn; a person’s own frame is not', () => {
    expect(isDrawn(drawing().scene.get('D'))).toBe(true)
    expect(isDrawn(drawing(null).scene.get('D'))).toBe(false)
  })

  it('finds the Drawing holding both ends of a stroke', () => {
    const { scene } = drawing()
    expect(drawnAt(scene, { x: 90, y: 40 }, { x: 210, y: 260 })?.id).toBe('D')
    expect(drawnAt(scene, { x: 90, y: 40 }, { x: 400, y: 260 })).toBeNull()
  })
})

describe('a member moved inside its Drawing', () => {
  it('the frame refits round it (pad 16) in the same step, and one undo puts both back', () => {
    const { scene, tool, steps, undo, enter } = drawing()
    enter(100, 150)
    expect(tool.scope).toBe('D')
    const before = box(scene.get('D'))
    const n = steps.length
    tool.press({ x: 100, y: 150 }, { zoom: 1 })
    // Its centre lands at x 90.5, inside the frame (84 to 217): it stays, and the frame grows left.
    tool.release({ x: 90, y: 150 })
    expect(scene.get('s1')).toMatchObject({ x: 90, parentId: 'D' })
    expect(box(scene.get('D'))).toEqual({ x: 90 - DRAWN_PAD, y: 34, w: 201 - 90 + 2 * DRAWN_PAD, h: 232 })
    expect(steps.length).toBe(n + 1)
    undo.undo()
    expect(scene.get('s1')).toMatchObject({ x: 100 })
    expect(box(scene.get('D'))).toEqual(before)
  })

  it('a member dropped with its centre outside leaves it (parentId null), and the frame refits round the rest', () => {
    const { scene, tool, enter } = drawing()
    enter(100, 150)
    tool.press({ x: 100, y: 150 }, { zoom: 1 })
    tool.release({ x: 500, y: 150 })
    expect(scene.get('s1')).toMatchObject({ x: 500, parentId: null })
    expect(box(scene.get('D'))).toEqual({ x: 200 - DRAWN_PAD, y: 34, w: 1 + 2 * DRAWN_PAD, h: 232 })
  })

  it('the last stroke out leaves an empty Drawing where it was', () => {
    const { scene, tool, enter } = drawing()
    enter(100, 150)
    tool.press({ x: 100, y: 150 }, { zoom: 1 })
    tool.release({ x: 500, y: 150 })
    enter(200, 150)
    tool.press({ x: 200, y: 150 }, { zoom: 1 })
    tool.release({ x: 600, y: 150 })
    expect(scene.get('s2')).toMatchObject({ parentId: null })
    expect(box(scene.get('D'))).toEqual({ x: 184, y: 34, w: 33, h: 232 })
  })

  it('a person’s own frame keeps its strokes wherever they go (unchanged)', () => {
    const { scene, tool, enter } = drawing(null)
    enter(100, 150)
    tool.press({ x: 100, y: 150 }, { zoom: 1 })
    tool.release({ x: 500, y: 150 })
    expect(scene.get('s1')).toMatchObject({ parentId: 'D' })
    expect(box(scene.get('D'))).toEqual({ x: 84, y: 34, w: 133, h: 232 })
  })

  it('moving the whole Drawing carries its strokes and does not refit', () => {
    const { scene, tool } = drawing()
    tool.press({ x: 150, y: 150 }, { zoom: 1 })
    tool.release({ x: 170, y: 160 })
    expect(box(scene.get('D'))).toEqual({ x: 104, y: 44, w: 133, h: 232 })
    expect(scene.get('s1')).toMatchObject({ x: 120, y: 60, parentId: 'D' })
  })
})

describe('scale, delete and erase', () => {
  it('scaling the Drawing scales its strokes with it', () => {
    const { scene, tool } = drawing()
    tool.set(['D'])
    // The se handle, dragged to double the box.
    tool.press({ x: 84 + 133 + 8, y: 34 + 232 + 8 }, { zoom: 1 })
    tool.release({ x: 84 + 266, y: 34 + 464 })
    expect(scene.get('D')).toMatchObject({ w: 266, h: 464 })
    expect(scene.get('s1')).toMatchObject({ x: 84 + 32, y: 34 + 32, h: 400 })
  })

  it('scaling one member refits the Drawing in the same step', () => {
    const { scene, tool, steps, enter } = drawing()
    enter(100, 150)
    const n = steps.length
    const f = tool.frame()!.box
    tool.press({ x: f.x + f.w + 8, y: f.y + f.h + 8 }, { zoom: 1 })
    tool.release({ x: f.x + f.w * 2, y: f.y + f.h * 2 })
    expect(steps.length).toBe(n + 1)
    const s1 = scene.get('s1')!
    expect(box(scene.get('D'))).toEqual({ x: 84, y: 34, w: 201 - 84 + DRAWN_PAD, h: s1.y + s1.h + DRAWN_PAD - 34 })
  })

  it('deleting a member refits the Drawing in the same step', () => {
    const { scene, tool, steps, enter } = drawing()
    enter(100, 150)
    const n = steps.length
    expect(tool.deleteSelected()).toBe(1)
    expect(steps.length).toBe(n + 1)
    expect(box(scene.get('D'))).toEqual({ x: 184, y: 34, w: 33, h: 232 })
  })

  it('erasing a member refits the Drawing in the same step', () => {
    const { scene, steps } = drawing()
    const ink = new Ink(scene)
    const n = steps.length
    ink.begin('eraser', { x: 100, y: 150, pressure: 0.5 }, { color: '#000', width: 10 })
    ink.end()
    expect(scene.get('s1')).toBeUndefined()
    expect(steps.length).toBe(n + 1)
    expect(box(scene.get('D'))).toEqual({ x: 184, y: 34, w: 33, h: 232 })
  })

  it('refitDrawn leaves an empty Drawing and a person’s frame alone', () => {
    const { scene } = drawing()
    scene.change((tx) => {
      tx.remove(['s1', 's2'])
      refitDrawn(scene, tx, 'D')
    })
    expect(box(scene.get('D'))).toEqual({ x: 84, y: 34, w: 133, h: 232 })
  })
})

describe('a pen stroke drawn inside a Drawing', () => {
  it('joins it and the frame refits, in one step; one undo removes the stroke and puts the frame back', () => {
    const { scene, steps, undo } = drawing()
    const ink = new Ink(scene, { newId: (p) => `${p}N` })
    const n = steps.length
    ink.begin('pen', { x: 120, y: 60, pressure: 0.5 }, { color: '#000', width: 3 })
    ink.add([{ x: 300, y: 100, pressure: 0.5 }, { x: 150, y: 200, pressure: 0.5 }])
    const r = ink.end()!
    expect(r.parentId).toBe('D')
    expect(steps.length).toBe(n + 1)
    expect(box(scene.get('D'))).toEqual({ x: 84, y: 34, w: 300 + DRAWN_PAD - 84, h: 232 })
    undo.undo()
    expect(scene.get(r.id)).toBeUndefined()
    expect(box(scene.get('D'))).toEqual({ x: 84, y: 34, w: 133, h: 232 })
  })

  it('a stroke that ends outside stays loose', () => {
    const { scene } = drawing()
    const ink = new Ink(scene)
    ink.begin('pen', { x: 120, y: 60, pressure: 0.5 }, { color: '#000', width: 3 })
    ink.add([{ x: 400, y: 60, pressure: 0.5 }])
    expect(ink.end()!.parentId).toBeNull()
    expect(box(scene.get('D'))).toEqual({ x: 84, y: 34, w: 133, h: 232 })
  })

  it('a stroke inside does not join the ink group of a loose stroke just before it', () => {
    const { scene } = drawing()
    const ink = new Ink(scene, { now: () => 0 })
    ink.begin('pen', { x: 70, y: 60, pressure: 0.5 }, { color: '#000', width: 3 })
    ink.add([{ x: 75, y: 100, pressure: 0.5 }])
    const loose = ink.end()!
    ink.begin('pen', { x: 90, y: 60, pressure: 0.5 }, { color: '#000', width: 3 })
    ink.add([{ x: 95, y: 100, pressure: 0.5 }])
    const inside = ink.end()!
    expect(inside.parentId).toBe('D')
    expect(inside.groupIds).toEqual([])
    expect(scene.get(loose.id)!.groupIds).toEqual([])
  })

  it('on a board: a stroke inside the Drawing joins the Drawing; one that leaves it joins the board under its centre (board-move)', () => {
    const { scene } = drawing()
    scene.change((tx) => {
      tx.put([element({ id: 'B', kind: 'board', z: 'a0', x: 0, y: 0, w: 800, h: 600, props: { name: 'B', purpose: 'reference' } })])
      tx.put([{ ...scene.get('D')!, parentId: 'B' }])
    })
    const ink = new Ink(scene, { now: () => 0 })
    ink.begin('pen', { x: 120, y: 60, pressure: 0.5 }, { color: '#000', width: 3 })
    ink.add([{ x: 150, y: 100, pressure: 0.5 }])
    expect(ink.end()!.parentId).toBe('D')
    ink.begin('pen', { x: 120, y: 60, pressure: 0.5 }, { color: '#000', width: 3 })
    ink.add([{ x: 500, y: 400, pressure: 0.5 }])
    const out = ink.end()!
    expect(out.parentId).toBe('B')
    // Strokes group only within one container: the board's stroke is not in the Drawing stroke's group.
    expect(out.groupIds).toEqual([])
  })
})
