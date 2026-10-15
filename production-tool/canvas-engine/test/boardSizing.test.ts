// Board sizing (owner decision, Shrey 2026-10-15; features/art-boards.clan): next free slot in rows,
// growth down then right toward free canvas, never onto a neighbour (then just outside, "full"), no
// shrinking by itself, Fit to contents, resize handles that never cut a member and let go of what the
// edge passed, each one undo step.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BOARD_GAP, BOARD_PAD, fitRect, innerRect, outsideSpot, overlaps, placeAllInBoard, placeInBoard, resizeRect, rowSlot } from '../src/boards/sizing'
import type { Rect } from '../src/model/bounds'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { SceneUndo } from '../src/undo/sceneUndo'
import { Renderer } from '../src/render/renderer'
import { hitBoardTitle } from '../src/render/links'
import { SelectTool, type BoardEvent } from '../src/select/select'

const PIC = { w: 100, h: 80 }
const inside = (outer: Rect, r: Rect) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h

describe('placing on a board (pure)', () => {
  const board: Rect = { x: 0, y: 0, w: 400, h: 300 }

  it('fills contact-sheet rows from the top left, a gap apart, then the next row', () => {
    const inn = innerRect(board)
    const first = rowSlot([], PIC, inn.x, inn.x + inn.w, inn.y, inn.y + inn.h)!
    expect(first).toEqual({ x: BOARD_PAD.x, y: BOARD_PAD.top })
    const a = { ...first, ...PIC }
    const second = rowSlot([a], PIC, inn.x, inn.x + inn.w, inn.y)!
    expect(second).toEqual({ x: a.x + PIC.w + BOARD_GAP, y: a.y })
    const b = { ...second, ...PIC }
    // A third of 100 does not fit in the 368 inside (16 + 100 + 40 + 100 + 40 + 100 = 396 > 384): the next row.
    const third = rowSlot([a, b], PIC, inn.x, inn.x + inn.w, inn.y)!
    expect(third).toEqual({ x: inn.x, y: a.y + PIC.h + BOARD_GAP })
  })

  it('never lands on what is there: a slot skips a member sitting in the way', () => {
    const member = { x: 16, y: 22, w: 200, h: 100 }
    const p = placeInBoard(board, [member], PIC, [])
    expect(overlaps(p.box, member)).toBe(false)
    expect(p.box).toMatchObject({ x: 16 + 200 + BOARD_GAP, y: 22 })
    expect(p.grew).toBeNull()
  })

  it('grows down first when the board is full and the canvas below is free', () => {
    const full = [{ x: 16, y: 22, w: 368, h: 244 }]
    const p = placeInBoard(board, full, PIC, [])
    expect(p.grew).toBe('down')
    expect(p.box.y).toBe(22 + 244 + BOARD_GAP)
    expect(p.board.x).toBe(0)
    expect(p.board.w).toBe(400)
    expect(p.board.h).toBe(p.box.y + PIC.h + BOARD_PAD.bottom)
    expect(inside(p.board, p.box)).toBe(true)
  })

  it('grows right when below is taken by a neighbour, and never onto it', () => {
    const full = [{ x: 16, y: 22, w: 368, h: 244 }]
    const below = { x: 0, y: 330, w: 800, h: 300 }
    const p = placeInBoard(board, full, PIC, [below])
    expect(p.grew).toBe('right')
    expect(p.box).toMatchObject({ x: 16 + 368 + BOARD_GAP, y: 22 })
    expect(p.board.h).toBe(300)
    expect(overlaps(p.board, below)).toBe(false)
  })

  it('when both ways are blocked it does not grow: the thing goes just outside, clear of everything', () => {
    const full = [{ x: 16, y: 22, w: 368, h: 244 }]
    const below = { x: 0, y: 330, w: 800, h: 300 }
    const right = { x: 430, y: -200, w: 300, h: 500 }
    const p = placeInBoard(board, full, PIC, [below, right])
    expect(p.full).toBe(true)
    expect(p.board).toEqual(board)
    expect(overlaps(p.box, board)).toBe(false)
    for (const b of [below, right]) expect(overlaps(p.box, b)).toBe(false)
  })

  it('a neighbour it already touches does not stop it growing the other way (Storyboard beside Video)', () => {
    const story = { x: 0, y: 0, w: 752, h: 236 }
    const video = { x: 776, y: 0, w: 380, h: 236 }
    const card = { x: 16, y: 22, w: 720, h: 194 }
    const p = placeInBoard(story, [card], { w: 720, h: 194 }, [video])
    expect(p.grew).toBe('down')
    expect(overlaps(p.board, video)).toBe(false)
    expect(p.board.w).toBe(752)
  })

  it('takes a preferred spot beside a source, growing toward it when that is free', () => {
    const src = { x: 16, y: 22, w: 300, h: 200 }
    const p = placeInBoard(board, [src], PIC, [], { x: 16 + 300 + 80, y: 22 })
    expect(p.box).toMatchObject({ x: 396, y: 22 })
    expect(p.grew).toBe('beside')
    expect(inside(p.board, p.box)).toBe(true)
  })

  it('places several in order, and once full the rest land outside, apart', () => {
    const low = { ...board, h: 180 }
    const r = placeAllInBoard(low, [], [PIC, PIC, PIC, PIC], [{ x: 0, y: 220, w: 2000, h: 10 }, { x: 430, y: -500, w: 10, h: 2000 }])
    // Two fit in a row of the 368 inside; with no room to grow, the third and fourth go outside.
    expect(r.full).toEqual([false, false, true, true])
    expect(r.board).toEqual(low)
    expect(overlaps(r.boxes[2], low)).toBe(false)
    expect(overlaps(r.boxes[3], low)).toBe(false)
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(overlaps(r.boxes[i], r.boxes[j])).toBe(false)
  })

  it('outsideSpot slides along a side before going far out: the nearest free spot', () => {
    const avoid = [
      { x: 410, y: -1000, w: 800, h: 1300 }, // right
      { x: -600, y: -1000, w: 590, h: 3000 }, // left
      { x: -1000, y: -2000, w: 3000, h: 1990 }, // above
      { x: 0, y: 310, w: 300, h: 400 }, // below, under its left part
    ]
    expect(outsideSpot(board, PIC, avoid)).toEqual({ x: 320, y: 324 })
  })

  it('outsideSpot steps further out until it is clear', () => {
    const avoid = [{ x: 0, y: 300, w: 400, h: 200 }, { x: 400, y: 0, w: 400, h: 400 }]
    const s = outsideSpot(board, PIC, avoid)
    for (const a of avoid) expect(overlaps({ ...s, ...PIC }, a)).toBe(false)
  })

  it('Fit to contents is the members with the padding, smaller or larger', () => {
    expect(fitRect(board, [{ x: 50, y: 60, w: 100, h: 50 }])).toEqual({ x: 50 - 16, y: 60 - 22, w: Math.max(160, 132), h: Math.max(120, 106) })
    expect(fitRect(board, [{ x: 0, y: 0, w: 900, h: 400 }])).toEqual({ x: -16, y: -22, w: 932, h: 456 })
    expect(fitRect(board, [])).toEqual(board)
  })

  it('a resize never cuts a member: the edge stops at the members whose centre is still inside', () => {
    const m = { x: 16, y: 22, w: 200, h: 100 }
    const r = resizeRect(board, 'e', { x: 150, y: 0 }, [m])
    expect(r.rect.x + r.rect.w).toBe(216 + BOARD_PAD.x)
    expect(r.leaving).toEqual([])
    const s = resizeRect(board, 'se', { x: 10, y: 10 }, [m])
    expect(s.rect.w).toBe(232)
    expect(s.rect.h).toBe(22 + 100 + BOARD_PAD.bottom)
  })

  it('a resize past a member’s centre lets it go; one already outside neither holds nor leaves', () => {
    const a = { x: 16, y: 22, w: 100, h: 100 }
    const b = { x: 250, y: 22, w: 100, h: 100 }
    const out = { x: 900, y: 0, w: 50, h: 50 }
    const r = resizeRect(board, 'e', { x: 280, y: 0 }, [a, b, out])
    expect(r.leaving).toEqual([1])
    expect(r.rect.x + r.rect.w).toBe(280)
    // Never smaller than BOARD_MIN.
    expect(resizeRect(board, 'w', { x: 1000, y: 0 }, []).rect.w).toBe(160)
  })
})

function setup(records: ElementRecord[]) {
  const doc = new Y.Doc()
  const scene = new SceneStore(doc)
  scene.seed(records)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  const tool = new SelectTool(scene, (x, y) => hitBoardTitle(scene, { x, y }, 1) ?? r.hit(x, y))
  const undo = new SceneUndo(scene)
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  const events: BoardEvent[] = []
  tool.onBoard((e) => events.push(e))
  return { scene, tool, steps, undo, events }
}

const board = (id: string, x: number, y = 0, w = 400, h = 300) => element({ id, kind: 'board', z: `a0${id}`, x, y, w, h, props: { name: id, purpose: 'character' } })
const pic = (id: string, x: number, y: number, parentId: string | null = null, extra: Partial<ElementRecord> = {}) =>
  element({ id, kind: 'image', z: `b${id}`, x, y, w: 100, h: 80, parentId, props: { assetSha: null, status: 'saved' }, ...extra })
const box = (r: ElementRecord) => ({ x: r.x, y: r.y, w: r.w, h: r.h })

describe('the select tool and boards as spaces', () => {
  it('a picture dropped onto another one on a board goes to the next free slot instead, in the move’s one step', () => {
    const { scene, tool, steps } = setup([board('C', 0), pic('a', 16, 22, 'C'), pic('p', 900, 400)])
    tool.set(['p'])
    tool.press({ x: 910, y: 410 })
    tool.release({ x: 30, y: 30 })
    const p = scene.get('p')!
    expect(p.parentId).toBe('C')
    expect(overlaps(box(p), box(scene.get('a')!))).toBe(false)
    expect([p.x, p.y]).toEqual([16 + 100 + BOARD_GAP, 22])
    expect(steps).toHaveLength(1)
  })

  it('dropped where it is free, inside, it stays exactly there', () => {
    const { scene, tool } = setup([board('C', 0), pic('a', 16, 22, 'C'), pic('p', 900, 400)])
    tool.set(['p'])
    tool.press({ x: 910, y: 410 })
    tool.release({ x: 260, y: 190 })
    expect(scene.get('p')).toMatchObject({ x: 250, y: 180, parentId: 'C' })
  })

  it('a full board grows down to take a dropped picture; it never shrinks back when the picture leaves', () => {
    const { scene, tool } = setup([board('C', 0, 0, 400, 180), pic('a', 16, 22, 'C'), pic('b', 156, 22, 'C'), pic('c', 296, 22, 'C'), pic('p', 900, 400)])
    tool.set(['p'])
    tool.press({ x: 910, y: 410 })
    tool.release({ x: 50, y: 50 })
    const c = scene.get('C')!
    const p = scene.get('p')!
    expect(p.parentId).toBe('C')
    expect([p.x, p.y]).toEqual([16, 22 + 80 + BOARD_GAP])
    expect([c.x, c.y, c.w]).toEqual([0, 0, 400])
    expect(c.h).toBe(p.y + 80 + BOARD_PAD.bottom)
    const grown = c.h
    // Taken off again: the board keeps its size (no auto-shrink).
    tool.press({ x: p.x + 10, y: p.y + 10 })
    tool.release({ x: 1500, y: 1500 })
    expect(scene.get('p')!.parentId).toBeNull()
    expect(scene.get('C')!.h).toBe(grown)
  })

  it('blocked below and to the right, a board does not grow: the picture lands just outside, on no board, and the host hears "full"', () => {
    const { scene, tool, events } = setup([
      board('C', 0, 0, 400, 180), board('D', 0, 204, 900, 200), board('R', 424, -300, 300, 480),
      pic('a', 16, 22, 'C'), pic('b', 156, 22, 'C'), pic('c', 296, 22, 'C'), pic('p', 1500, 1500),
    ])
    tool.set(['p'])
    tool.press({ x: 1510, y: 1510 })
    tool.release({ x: 50, y: 50 })
    const p = scene.get('p')!
    expect(p.parentId).toBeNull()
    for (const id of ['C', 'D', 'R']) expect(overlaps(box(p), box(scene.get(id)!))).toBe(false)
    expect(box(scene.get('C')!)).toEqual({ x: 0, y: 0, w: 400, h: 180 })
    expect(events).toEqual([{ kind: 'full', board: 'C', ids: ['p'] }])
  })

  it('moved within its board so it sticks out, the board grows to hold it', () => {
    const { scene, tool } = setup([board('C', 0), pic('a', 16, 22, 'C')])
    tool.set(['a'])
    tool.press({ x: 20, y: 30 })
    tool.release({ x: 344, y: 238 })
    const a = scene.get('a')!
    expect(a.parentId).toBe('C')
    const c = scene.get('C')!
    expect(c.x + c.w).toBe(a.x + a.w + BOARD_PAD.x)
    expect(c.y + c.h).toBe(a.y + a.h + BOARD_PAD.bottom)
  })

  it('a selected board resizes from its handles: never through a member, one undo step', () => {
    const { scene, tool, steps, undo } = setup([board('C', 0), pic('a', 16, 22, 'C')])
    tool.set(['C'])
    expect(tool.boardHandleAt({ x: 400, y: 150 }, 1)).toBe('e')
    expect(tool.boardHandleAt({ x: 400, y: 300 }, 1)).toBe('se')
    expect(tool.boardHandleAt({ x: 200, y: 300 }, 1)).toBe('s')
    expect(tool.boardHandleAt({ x: 200, y: 150 }, 1)).toBeNull()
    tool.press({ x: 400, y: 300 })
    tool.drag({ x: 60, y: 60 })
    // Drawn at the preview box until release; nothing written yet.
    // Never below BOARD_MIN, never through the picture: 160 wide (the minimum), 136 high (the picture and the padding).
    expect(tool.resizing!.rect).toMatchObject({ w: 160, h: 102 + BOARD_PAD.bottom })
    expect(steps).toHaveLength(0)
    tool.release({ x: 60, y: 60 })
    expect(box(scene.get('C')!)).toEqual({ x: 0, y: 0, w: 160, h: 136 })
    expect(steps).toHaveLength(1)
    undo.undo()
    expect(box(scene.get('C')!)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })

  it('things the edge passed leave the board on release, with the resize, and the host hears it; undo brings them back', () => {
    const { scene, tool, events, undo, steps } = setup([board('C', 0), pic('a', 16, 22, 'C'), pic('b', 250, 22, 'C')])
    tool.set(['C'])
    tool.press({ x: 400, y: 150 })
    tool.drag({ x: 260, y: 150 })
    expect(tool.resizing!.leaving).toEqual(['b'])
    tool.release({ x: 260, y: 150 })
    expect(scene.get('b')!.parentId).toBeNull()
    expect(scene.get('a')!.parentId).toBe('C')
    expect(scene.get('C')!.w).toBe(260)
    expect(events).toEqual([{ kind: 'left', board: 'C', ids: ['b'] }])
    expect(steps).toHaveLength(1)
    undo.undo()
    expect(scene.get('b')!.parentId).toBe('C')
    expect(scene.get('C')!.w).toBe(400)
  })

  it('a key group counts as one: the edge never splits it', () => {
    const { scene, tool } = setup([board('C', 0), pic('f', 16, 22, 'C', { groupIds: ['key:sam'] }), pic('s', 156, 22, 'C', { groupIds: ['key:sam'] })])
    tool.set(['C'])
    tool.press({ x: 400, y: 150 })
    tool.release({ x: 150, y: 150 })
    expect(scene.get('C')!.w).toBe(256 + BOARD_PAD.x)
    expect(scene.get('s')!.parentId).toBe('C')
  })

  it('Fit to contents shrinks or grows the board to its members with the padding, one step; nothing to fit, nothing done', () => {
    const { scene, tool, undo, steps } = setup([board('C', 0), pic('a', 116, 122, 'C'), board('E', 1000)])
    expect(tool.fitBoard('C')).toBe(true)
    expect(box(scene.get('C')!)).toEqual({ x: 100, y: 100, w: 160, h: 136 })
    expect(steps).toHaveLength(1)
    undo.undo()
    expect(box(scene.get('C')!)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(tool.fitBoard('E')).toBe(false)
  })
})
