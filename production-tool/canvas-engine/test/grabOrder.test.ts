// The press priority (features/board-move.clan): one case per row of grabOrder, top to bottom,
// including the overlaps the order decides (a node over a board, ink and a drawn frame on a board,
// a link across a title chip). Items 7 and 8 add their rows here with a case each.
// The merge with container-select (2026-10-16) re-ordered the table: nodes and links, then titles and
// Drawing labels, then the handles, then double press and the entered container's inside, then picks.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodePoints } from '../src/model/points'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { hitNodeOrLink } from '../src/render/links'
import { grabOrder, SelectTool } from '../src/select/select'
import { boardGrabAt } from '../src/boards/grab'

function setup(records: ElementRecord[], zoom = 1, points: Record<string, Uint8Array> = {}) {
  const scene = new SceneStore(new Y.Doc())
  scene.seed(records, points)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  let t = 0
  const tool = new SelectTool(scene, (x, y) => r.hit(x, y, zoom), { above: (x, y) => hitNodeOrLink(scene, { x, y }, zoom), now: () => t })
  // Each press is a second later than the last unless `at` says when (a double press is two within 350 ms).
  const press = (x: number, y: number, opts: { shift?: boolean; by?: 'mouse' | 'pen' | 'touch'; at?: number } = {}) => {
    t = opts.at ?? t + 1000
    tool.press({ x, y }, { zoom, ...opts })
  }
  return { scene, tool, press }
}

/** A diagonal stroke's points, w by h (relative to its box): strokes are hit along their line (container-select). */
const line = (w: number, h: number) =>
  encodePoints([{ x: 0, y: 0, pressure: 0.5 }, { x: w, y: h, pressure: 0.5 }], { x: 0, y: 0 })

const board = (id: string, x: number, y = 0, extra: Partial<ElementRecord> = {}) => element({ id, kind: 'board', z: `a0${id}`, x, y, w: 400, h: 300, props: { name: id, purpose: 'reference' }, ...extra })
const pic = (id: string, x: number, y: number, parentId: string | null = null) => element({ id, kind: 'image', z: `b${id}`, x, y, w: 100, h: 80, parentId, props: { assetSha: null, status: 'saved' } })

describe('grabOrder', () => {
  it('is one table, in the documented order, every row explained', () => {
    // Was board-handle, scale-handle, node-or-link, board-title, element, …: the order decided when
    // container-select merged (nodes and titles before handles; double press and scope before picks).
    expect(grabOrder.map((r) => r.name)).toEqual([
      'node-or-link', 'board-title', 'drawing-label', 'board-handle', 'scale-handle', 'enter', 'scope-inside',
      'element', 'board-edge', 'board-inside-selected', 'board-inside', 'empty',
    ])
    for (const r of grabOrder) expect(r.says.length).toBeGreaterThan(10)
  })

  it('board-handle: a selected board’s corner resizes it', () => {
    const { tool, press } = setup([board('B', 0)])
    tool.set(['B'])
    press(400, 300)
    expect(tool.pressed).toBe('board-handle')
    expect(tool.resizing?.edge).toBe('se')
  })

  it('scale-handle: a selected shape’s corner scales it', () => {
    const shape = element({ id: 's', kind: 'shape', z: 'c', x: 1000, y: 0, w: 50, h: 50, props: { geo: 'rect' } })
    const { tool, press } = setup([shape])
    tool.set(['s'])
    press(1056, 56)
    expect(tool.pressed).toBe('scale-handle')
    expect(tool.scaling).not.toBeNull()
  })

  it('node-or-link: a node card over a board is the node’s, not the board’s', () => {
    const node = element({ id: 'n', kind: 'node', z: 'c', x: 50, y: 50, w: 200, h: 100, props: { nodeKind: 'script' } })
    const { tool, press } = setup([board('B', 0), node])
    press(100, 100)
    expect(tool.pressed).toBe('node-or-link')
    expect([...tool.selected]).toEqual(['n'])
    expect([...tool.preview!.ids]).toEqual(['n'])
  })

  it('node-or-link: a link across a board’s title chip is the link’s', () => {
    const a = pic('a', -300, -40)
    const b = pic('b', 600, -40)
    const link = element({ id: 'l', kind: 'link', z: 'd', x: 0, y: 0, w: 0, h: 0, props: { start: { elementId: 'a' }, end: { elementId: 'b' } } })
    const { tool, press, scene } = setup([board('B', 0, 0), a, b, link])
    expect(boardGrabAt(scene, { x: 30, y: 0 }, 1)?.part).toBe('title')
    press(30, 0)
    expect(tool.pressed).toBe('node-or-link')
    expect([...tool.selected]).toEqual(['l'])
  })

  it('board-title: the chip picks the board up with what is on it', () => {
    const { tool, press } = setup([board('B', 0), pic('p', 50, 50, 'B')])
    press(30, 0)
    expect(tool.pressed).toBe('board-title')
    expect([...tool.selected]).toEqual(['B'])
    expect([...tool.preview!.ids].sort()).toEqual(['B', 'p'])
  })

  it('element: a picture on a board is the picture’s, alone', () => {
    const { tool, press } = setup([board('B', 0), pic('p', 50, 50, 'B')])
    press(60, 60)
    expect(tool.pressed).toBe('element')
    expect([...tool.preview!.ids]).toEqual(['p'])
  })

  it('element: ink on a board is the ink’s', () => {
    const ink = element({ id: 'k', kind: 'stroke', z: 'c', x: 100, y: 100, w: 60, h: 40, parentId: 'B', props: { tool: 'pen' } })
    // A stroke is hit along its line since container-select, so it has points and the press is on them.
    const { tool, press } = setup([board('B', 0), ink], 1, { k: line(60, 40) })
    press(130, 120)
    expect(tool.pressed).toBe('element')
    expect([...tool.selected]).toEqual(['k'])
  })

  it('element: a drawn frame on a board is the frame’s (container-select refines what inside it is hit)', () => {
    const frame = element({ id: 'f', kind: 'frame', z: 'c', x: 100, y: 100, w: 120, h: 90, parentId: 'B', props: { name: 'Drawing' } })
    const { tool, press } = setup([board('B', 0), frame])
    press(110, 110)
    expect(tool.pressed).toBe('element')
    expect([...tool.selected]).toEqual(['f'])
  })

  it('board-edge: within 6 px of an unselected board’s frame line, inside or out, picks it up', () => {
    for (const [x, y] of [[-5, 150], [4, 150], [200, 305], [397, 100]]) {
      const { tool, press } = setup([board('B', 0)])
      press(x, y)
      expect(tool.pressed).toBe('board-edge')
      expect([...tool.selected]).toEqual(['B'])
      expect(tool.preview).not.toBeNull()
    }
  })

  it('board-edge: on a selected board, the edge away from the square handles moves it too (BM6)', () => {
    const { tool, press } = setup([board('B', 0)])
    tool.set(['B'])
    press(400, 60)
    expect(tool.pressed).toBe('board-edge')
    expect(tool.resizing).toBeNull()
    expect(tool.preview).not.toBeNull()
  })

  it('board-inside-selected: the empty inside of a selected board moves it', () => {
    const { tool, press } = setup([board('B', 0), pic('p', 50, 50, 'B')])
    tool.set(['B'])
    press(250, 200)
    expect(tool.pressed).toBe('board-inside-selected')
    expect([...tool.preview!.ids].sort()).toEqual(['B', 'p'])
  })

  it('board-inside: the empty inside of an unselected board marquees, and the pen lassoes', () => {
    const { tool, press } = setup([board('B', 0)])
    press(250, 200)
    expect(tool.pressed).toBe('board-inside')
    expect(tool.marquee).not.toBeNull()
    tool.cancel()
    press(250, 200, { by: 'pen' })
    expect(tool.lasso).not.toBeNull()
  })

  it('empty: off every board, a marquee', () => {
    const { tool, press } = setup([board('B', 0), pic('p', 900, 0)])
    tool.set(['p'])
    press(2000, 2000)
    expect(tool.pressed).toBe('empty')
    expect(tool.selected.size).toBe(0)
  })

  it('drawing-label: a Drawing’s label above its top-left picks the Drawing up whole; a board’s chip comes first', () => {
    const frame = element({ id: 'D', kind: 'frame', z: 'c', x: 600, y: 100, w: 200, h: 150, customData: { kind: 'drawn' }, props: { name: 'Drawing' } })
    const s1 = element({ id: 's1', kind: 'stroke', z: 'd', x: 650, y: 150, w: 50, h: 50, parentId: 'D', props: { tool: 'pen' } })
    const { tool, press } = setup([board('B', 0), frame, s1], 1, { s1: line(50, 50) })
    press(610, 90)
    expect(tool.pressed).toBe('drawing-label')
    expect([...tool.selected]).toEqual(['D'])
    expect([...tool.preview!.ids].sort()).toEqual(['D', 's1'])
    press(30, 0)
    expect(tool.pressed).toBe('board-title')
  })

  it('board-title comes before a selected board’s handles where they meet (a long name over the top-middle handle)', () => {
    const long = board('B', 0, 0, { props: { name: 'A board with a really long name here', purpose: 'reference' } })
    const { tool, press } = setup([long])
    tool.set(['B'])
    press(200, 0)
    expect(tool.pressed).toBe('board-title')
    expect(tool.resizing).toBeNull()
  })

  it('enter: a double press on a Drawing’s stroke picks the stroke alone; a drag moves only it', () => {
    const frame = element({ id: 'D', kind: 'frame', z: 'c', x: 600, y: 100, w: 200, h: 150, customData: { kind: 'drawn' }, props: { name: 'Drawing' } })
    const s1 = element({ id: 's1', kind: 'stroke', z: 'd', x: 650, y: 150, w: 50, h: 50, parentId: 'D', props: { tool: 'pen' } })
    const { tool, press } = setup([frame, s1], 1, { s1: line(50, 50) })
    press(675, 175, { at: 0 })
    expect(tool.pressed).toBe('element')
    expect([...tool.selected]).toEqual(['D'])
    tool.release({ x: 675, y: 175 })
    press(675, 175, { at: 200 })
    expect(tool.pressed).toBe('enter')
    expect(tool.scope).toBe('D')
    expect([...tool.selected]).toEqual(['s1'])
    expect([...tool.preview!.ids]).toEqual(['s1'])
  })

  it('scope-inside: the empty inside of the entered Drawing marquees over its members only; empty canvas leaves it', () => {
    const frame = element({ id: 'D', kind: 'frame', z: 'c', x: 600, y: 100, w: 200, h: 150, customData: { kind: 'drawn' }, props: { name: 'Drawing' } })
    const s1 = element({ id: 's1', kind: 'stroke', z: 'd', x: 650, y: 150, w: 50, h: 50, parentId: 'D', props: { tool: 'pen' } })
    const { tool, press } = setup([frame, s1], 1, { s1: line(50, 50) })
    tool.enterAt({ x: 675, y: 175 })
    press(780, 240)
    expect(tool.pressed).toBe('scope-inside')
    tool.release({ x: 610, y: 110 })
    expect([...tool.selected]).toEqual(['s1'])
    expect(tool.scope).toBe('D')
    press(2000, 2000)
    expect(tool.pressed).toBe('empty')
    expect(tool.scope).toBeNull()
  })

  it('grabbableAt reads the same rows: what a press would pick up, not what it would marquee', () => {
    const { tool } = setup([board('B', 0), pic('p', 50, 50, 'B')])
    expect(tool.grabbableAt({ x: 30, y: 0 }, 1)).toBe(true)
    expect(tool.grabbableAt({ x: 60, y: 60 }, 1)).toBe(true)
    expect(tool.grabbableAt({ x: 0, y: 150 }, 1)).toBe(true)
    expect(tool.grabbableAt({ x: 250, y: 200 }, 1)).toBe(false)
    expect(tool.grabbableAt({ x: 2000, y: 2000 }, 1)).toBe(false)
    tool.set(['B'])
    expect(tool.grabbableAt({ x: 250, y: 200 }, 1)).toBe(true)
  })
})
