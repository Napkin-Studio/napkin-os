// Moving boards (features/board-move.clan; ui-behaviour 3.2 "Moving a board"): by the title chip
// at any zoom, by the edge, by the inside once selected; a locked board stays; a moved board lands
// clear of its neighbours in the move's one step; several boards move as one; a resize never grows
// under a neighbour; arrow nudges are one step and stop short of a blocker; ink joins its board.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { boardTitleRect, TITLE_PX } from '../src/boards/grab'
import { BOARD_CLEAR, distance, overlaps } from '../src/boards/sizing'
import { Ink } from '../src/ink/ink'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { CLICK_SLOP_PX, SelectTool } from '../src/select/select'
import { SceneUndo } from '../src/undo/sceneUndo'

function setup(records: ElementRecord[]) {
  const scene = new SceneStore(new Y.Doc())
  scene.seed(records)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  const tool = new SelectTool(scene, (x, y) => r.hit(x, y))
  const undo = new SceneUndo(scene)
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  return { scene, tool, undo, steps }
}

const board = (id: string, x: number, y = 0, extra: Partial<ElementRecord> = {}) =>
  element({ id, kind: 'board', z: `a0${id}`, x, y, w: 400, h: 300, props: { name: id, purpose: 'reference' }, ...extra })
const pic = (id: string, x: number, y: number, parentId: string | null = null) =>
  element({ id, kind: 'image', z: `b${id}`, x, y, w: 100, h: 80, parentId, props: { assetSha: null, status: 'saved' } })
const box = (r: ElementRecord) => ({ x: r.x, y: r.y, w: r.w, h: r.h })
const drag = (tool: SelectTool, from: { x: number; y: number }, to: { x: number; y: number }, zoom = 1) => {
  tool.press(from, { zoom })
  tool.drag(to)
  tool.release(to)
}

describe('the title chip', () => {
  it('is at least 20 px tall on screen at every zoom, and picks the board up with what is on it', () => {
    for (const zoom of [0.1, 0.49, 1, 4]) {
      const { scene, tool, steps } = setup([board('Characters', 0), pic('p', 50, 50, 'Characters'), pic('far', 5000, 5000)])
      const chip = boardTitleRect(scene.get('Characters')!, zoom)
      expect(chip.h * zoom).toBeGreaterThanOrEqual(TITLE_PX - 1e-9)
      const at = { x: chip.x + chip.w / 2, y: chip.y + chip.h / 2 }
      drag(tool, at, { x: at.x + 100 / zoom, y: at.y }, zoom)
      expect(scene.get('Characters')!.x).toBeCloseTo(100 / zoom)
      expect(scene.get('p')!.x).toBeCloseTo(50 + 100 / zoom)
      expect(scene.get('p')!.parentId).toBe('Characters')
      expect(steps).toHaveLength(1)
    }
  })
})

describe('the edge and the inside', () => {
  it('the edge of an unselected board moves it; on a selected one the square handles resize and the rest of the edge moves', () => {
    const { scene, tool } = setup([board('B', 0)])
    drag(tool, { x: 2, y: 150 }, { x: 102, y: 150 })
    expect(box(scene.get('B')!)).toEqual({ x: 100, y: 0, w: 400, h: 300 })
    expect([...tool.selected]).toEqual(['B'])
    // Selected now: the east handle (middle of the edge) resizes …
    drag(tool, { x: 500, y: 150 }, { x: 600, y: 150 })
    expect(box(scene.get('B')!)).toEqual({ x: 100, y: 0, w: 500, h: 300 })
    // … and the same edge away from a handle moves it.
    drag(tool, { x: 600, y: 40 }, { x: 650, y: 40 })
    expect(box(scene.get('B')!)).toEqual({ x: 150, y: 0, w: 500, h: 300 })
  })

  it('a click on the empty inside under the slop selects the board; a drag there marquees; inside a selected board a drag moves it', () => {
    const { scene, tool } = setup([board('B', 0), pic('p', 50, 50, 'B'), pic('q', 200, 50, 'B')])
    tool.press({ x: 300, y: 250 }, { zoom: 0.5 })
    tool.release({ x: 300 + (CLICK_SLOP_PX - 1) / 0.5, y: 250 })
    expect([...tool.selected]).toEqual(['B'])
    // A drag inside the selected board moves it and its members, one step.
    drag(tool, { x: 300, y: 250 }, { x: 330, y: 260 })
    expect([scene.get('B')!.x, scene.get('p')!.x, scene.get('q')!.y]).toEqual([30, 80, 60])
    // Unselected: a drag on the inside marquees the pictures.
    tool.set([])
    drag(tool, { x: 60, y: 45 }, { x: 400, y: 200 })
    expect([...tool.selected].sort()).toEqual(['p', 'q'])
  })

  it('a click on empty canvas clears the selection, a shift-click on a board’s inside adds the board', () => {
    const { tool } = setup([board('B', 0), pic('x', 900, 0)])
    tool.set(['x'])
    tool.press({ x: 250, y: 200 }, { shift: true })
    tool.release({ x: 250, y: 200 })
    expect([...tool.selected].sort()).toEqual(['B', 'x'])
    tool.press({ x: 3000, y: 3000 })
    tool.release({ x: 3000, y: 3000 })
    expect(tool.selected.size).toBe(0)
  })
})

describe('locked boards', () => {
  it('a locked board is selected but neither it nor what is on it moves', () => {
    const { scene, tool, steps } = setup([board('B', 0, 0, { locked: true }), pic('p', 50, 50, 'B')])
    drag(tool, { x: 30, y: 0 }, { x: 330, y: 100 })
    expect([...tool.selected]).toEqual(['B'])
    expect(box(scene.get('B')!)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect([scene.get('p')!.x, scene.get('p')!.parentId]).toEqual([50, 'B'])
    expect(steps).toHaveLength(0)
  })
})

describe('landing clear of neighbours', () => {
  it('dropped over another board, it lands at the nearest spot BOARD_CLEAR clear, in the same step; the outline shows it while dragging', () => {
    const { scene, tool, steps, undo } = setup([board('S', 0), pic('p', 50, 50, 'S'), board('V', 600)])
    tool.press({ x: 30, y: 0 })
    tool.drag({ x: 530, y: 40 })
    // Over V: the landing outline is where it will go, not where the pointer is.
    expect(tool.landing).toHaveLength(1)
    const land = tool.landing![0]
    expect(distance(land, box(scene.get('V')!))).toBeGreaterThanOrEqual(BOARD_CLEAR - 1e-6)
    tool.release({ x: 530, y: 40 })
    const s = scene.get('S')!
    expect(box(s)).toEqual(land)
    expect(overlaps(box(s), box(scene.get('V')!), BOARD_CLEAR)).toBe(false)
    // The nearest: pushed out the short way (down, below V: 284 against 324 back to the left).
    expect(s.x).toBeCloseTo(500)
    expect(s.y).toBeCloseTo(300 + BOARD_CLEAR)
    // Its members came along by the same delta, one step; undo puts everything back.
    expect(scene.get('p')!.x).toBeCloseTo(50 + s.x)
    expect(steps).toHaveLength(1)
    undo.undo()
    expect(box(scene.get('S')!)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(scene.get('p')!.x).toBe(50)
  })

  it('a clear drop lands exactly where it was dropped, with no outline', () => {
    const { scene, tool } = setup([board('S', 0), board('V', 2000)])
    tool.press({ x: 30, y: 0 })
    tool.drag({ x: 130, y: 500 })
    expect(tool.landing).toBeNull()
    tool.release({ x: 130, y: 500 })
    expect([scene.get('S')!.x, scene.get('S')!.y]).toEqual([100, 500])
  })

  it('loose pictures and ink block where a board lands (BM5); things on other boards count as their board', () => {
    const ink = element({ id: 'k', kind: 'stroke', z: 'c', x: 1000, y: 0, w: 200, h: 200, props: { tool: 'pen' } })
    const { scene, tool } = setup([board('S', 0), ink, pic('loose', 1000, 600)])
    drag(tool, { x: 30, y: 0 }, { x: 930, y: 0 })
    const s = box(scene.get('S')!)
    expect(overlaps(s, box(ink), BOARD_CLEAR)).toBe(false)
    expect(overlaps(s, box(scene.get('loose')!), BOARD_CLEAR)).toBe(false)
  })

  it('several selected boards move by one delta and land together, never blocking each other', () => {
    const { scene, tool, steps } = setup([board('A', 0), board('B', 0, 400), board('W', 1000, 0)])
    tool.set(['A', 'B'])
    drag(tool, { x: 30, y: 0 }, { x: 830, y: 0 })
    const a = box(scene.get('A')!)
    const b = box(scene.get('B')!)
    // Together: the same delta for both.
    expect(b.x - a.x).toBe(0)
    expect(b.y - a.y).toBe(400)
    expect(overlaps(a, box(scene.get('W')!), BOARD_CLEAR)).toBe(false)
    expect(overlaps(b, box(scene.get('W')!), BOARD_CLEAR)).toBe(false)
    expect(steps).toHaveLength(1)
  })

  it('boards never become members of other boards', () => {
    const { scene, tool } = setup([board('S', 0), board('Big', 1000, 0, { w: 2000, h: 2000 } as Partial<ElementRecord>)])
    drag(tool, { x: 30, y: 0 }, { x: 1530, y: 900 })
    expect(scene.get('S')!.parentId).toBeNull()
  })
})

describe('resizing never grows under a neighbour (BM7)', () => {
  it('the east handle stops BOARD_CLEAR short of the next board; shrinking is never held', () => {
    const { scene, tool } = setup([board('C', 0), board('S', 500, 0)])
    tool.set(['C'])
    drag(tool, { x: 400, y: 150 }, { x: 900, y: 150 })
    expect(scene.get('C')!.w).toBe(500 - BOARD_CLEAR)
    drag(tool, { x: 500 - BOARD_CLEAR, y: 150 }, { x: 300, y: 150 })
    expect(scene.get('C')!.w).toBe(300)
  })

  it('the south-east corner stops at a neighbour below, and still grows across where it is free', () => {
    const { scene, tool } = setup([board('C', 0), board('D', 0, 400)])
    tool.set(['C'])
    drag(tool, { x: 400, y: 300 }, { x: 600, y: 700 })
    const c = box(scene.get('C')!)
    expect(c.h).toBe(400 - BOARD_CLEAR)
    expect(c.w).toBe(600)
  })
})

describe('arrow nudges', () => {
  it('a run of nudges is a preview, written as one step when flushed; a locked thing never moves', () => {
    const { scene, tool, steps, undo } = setup([pic('p', 0, 0), pic('l', 300, 0)])
    scene.change((tx) => tx.put([{ ...scene.get('l')!, locked: true }]))
    steps.length = 0
    tool.set(['p', 'l'])
    for (let i = 0; i < 5; i++) tool.nudge(1, 0)
    tool.nudge(0, 10)
    expect(scene.get('p')!.x).toBe(0)
    expect(tool.preview).toMatchObject({ dx: 5, dy: 10 })
    expect(tool.flushNudge()).toBe(true)
    expect([scene.get('p')!.x, scene.get('p')!.y, scene.get('l')!.x]).toEqual([5, 10, 300])
    expect(steps).toHaveLength(1)
    undo.undo()
    expect([scene.get('p')!.x, scene.get('p')!.y]).toEqual([0, 0])
  })

  it('a press writes a waiting nudge first', () => {
    const { scene, tool, steps } = setup([pic('p', 0, 0)])
    tool.set(['p'])
    tool.nudge(10, 0)
    tool.press({ x: 5000, y: 5000 })
    expect(scene.get('p')!.x).toBe(10)
    expect(steps).toHaveLength(1)
  })

  it('a nudged board stops BOARD_CLEAR from a blocker and never jumps it', () => {
    const { scene, tool } = setup([board('A', 0), board('B', 430)])
    tool.set(['A'])
    for (let i = 0; i < 20; i++) tool.nudge(1, 0)
    tool.flushNudge()
    expect(scene.get('A')!.x).toBe(430 - BOARD_CLEAR - 400)
    for (let i = 0; i < 5; i++) tool.nudge(10, 0)
    tool.flushNudge()
    expect(scene.get('A')!.x).toBe(6)
  })
})

describe('ink joins the board it is drawn on', () => {
  it('a stroke whose centre is on a board joins it and moves with it; off every board it stays loose', () => {
    const { scene, tool } = setup([board('B', 0)])
    const ink = new Ink(scene, { newId: (p) => `${p}_${Math.random().toString(36).slice(2, 8)}` })
    ink.begin('pen', { x: 100, y: 100, pressure: 0.5 }, { color: 'ink', width: 4 })
    ink.add([{ x: 150, y: 140, pressure: 0.5 }])
    const on = ink.end()!
    expect(scene.get(on.id)!.parentId).toBe('B')
    ink.begin('pen', { x: 900, y: 900, pressure: 0.5 }, { color: 'ink', width: 4 })
    ink.add([{ x: 950, y: 950, pressure: 0.5 }])
    const off = ink.end()!
    expect(scene.get(off.id)!.parentId).toBeNull()
    drag(tool, { x: 30, y: 0 }, { x: 30, y: 2000 })
    expect(scene.get(on.id)!.y).toBe(2100)
    expect(scene.get(off.id)!.y).toBe(900)
  })

  it('loose ink lying wholly on a board from before goes with it, and joins it', () => {
    const old = element({ id: 'old', kind: 'stroke', z: 'c', x: 100, y: 100, w: 50, h: 40, props: { tool: 'pen' } })
    const { scene, tool } = setup([board('B', 0), old])
    drag(tool, { x: 30, y: 0 }, { x: 1030, y: 0 })
    expect(scene.get('old')).toMatchObject({ x: 1100, parentId: 'B' })
  })
})
