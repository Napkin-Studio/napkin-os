// Boards on our own engine (features/art-boards.clan, board-autolayout), with a real contract-3
// document: a new project starts on an empty canvas with no boards; an existing project's seven
// template boards get their frames once with the nodes in theirs,
// a node dragged out of and into a board, a board carrying its members with undo,
// the ⌥ jumps on real frames, and the Y round trip.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { SceneStore } from '../../../../../canvas-engine/src'
import type { ProductionDocument } from '../../../contracts/types'
import { modelStore, MAYA } from '../../../test/model'
import { boardIdOf, boardKey, bringIntoView, isBoard, jumpTo, newBoard, railTargets, seedBoards } from '../../boards/boards'
import { AD_TEMPLATE, withAdBoards } from '../../../test/adBoards'
import { cardOf, seedNodes } from '../../nodes/nodes'
import { OwnAdapter } from './adapter'

async function seeded() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.resize(1200, 800, 0, 0)
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  const doc = structuredClone(s.get()) as unknown as ProductionDocument
  const boards = withAdBoards(doc)
  const seed = seedBoards(a, doc)!
  a.transact((els) => seed.apply(els), { undoable: false })
  await s.close()
  return { a, doc, boards }
}

const node = (a: OwnAdapter, kind: string) => a.elements().find((e) => cardOf(e)?.kind === kind)!
const board = (a: OwnAdapter, doc: ProductionDocument, purpose: string) => {
  const id = Object.values(doc.boards).find((b) => b.purpose === purpose)!.id
  return a.elements().find((e) => boardIdOf(e) === id)!
}

describe('art-boards on the own engine', () => {
  it('a new project opens on an empty canvas: its nodes, no boards, and the rail lists the nodes (⌥1 is Script)', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Rain')
    const a = new OwnAdapter()
    a.resize(1200, 800, 0, 0)
    const doc = s.get() as unknown as ProductionDocument
    a.transact((els) => [...els, ...seedNodes(a, doc)], { undoable: false })
    await s.close()
    expect(seedBoards(a, doc)).toBeNull()
    expect(Object.keys(doc.boards)).toEqual([])
    expect(a.elements().filter(isBoard)).toHaveLength(0)
    expect(a.elements().filter((e) => cardOf(e)).map((e) => [cardOf(e)!.kind, e.frameId ?? null])).toEqual([['script', null], ['storyboard', null], ['video', null]])
    expect(railTargets(a.elements(), doc).map((t) => (t.kind === 'node' ? t.card : t.board.title))).toEqual(['script', 'storyboard', 'video'])
    expect(jumpTo(a, doc, 0, false)).toBe(true)
    const sc = node(a, 'script')
    const vb = a.visibleBounds()
    expect(vb.minX <= sc.x && vb.maxX >= sc.x + sc.width).toBe(true)
    expect(jumpTo(a, doc, 3, false)).toBe(false)
  })

  it('+ New board on a new project lands in the middle of the view, clear of its nodes', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Rain')
    const a = new OwnAdapter()
    a.resize(1200, 800, 0, 0)
    const doc = s.get() as unknown as ProductionDocument
    a.transact((els) => [...els, ...seedNodes(a, doc)], { undoable: false })
    await s.close()
    jumpTo(a, doc, 'fit', false)
    const { frame } = newBoard(a, doc)
    const ov = (p: { x: number; y: number; width: number; height: number }, q: typeof p) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height
    for (const n of a.elements().filter((e) => cardOf(e))) expect(ov(frame, n)).toBe(false)
    const vb = a.visibleBounds()
    expect(frame.x + frame.width / 2).toBeGreaterThan(vb.minX)
    expect(frame.x + frame.width / 2).toBeLessThan(vb.maxX + 600)
  })

  it('new results come into view right of the rail with the smallest move: a pan at this zoom when they fit, else zoomed out just enough', () => {
    const a = new OwnAdapter()
    a.resize(1200, 800, 0, 0)
    const z0 = a.view().zoom
    const vb = a.visibleBounds()
    // In view: nothing moves.
    expect(bringIntoView(a, { minX: vb.minX + 400, minY: vb.minY + 100, maxX: vb.minX + 600, maxY: vb.minY + 300 }, 240, false)).toBe(false)
    // Under the rail (the left 240 px): a pan right of it, same zoom.
    const under = { minX: vb.minX + 20, minY: vb.minY + 100, maxX: vb.minX + 200, maxY: vb.minY + 300 }
    expect(bringIntoView(a, under, 240, false)).toBe(true)
    expect(a.view().zoom).toBeCloseTo(z0, 5)
    expect(a.sceneToViewport({ x: under.minX, y: under.minY }, a.view()).x).toBeGreaterThanOrEqual(240)
    // Too wide for the view: zoomed out, all of it right of the rail.
    const wide = { minX: 0, minY: 0, maxX: 3000, maxY: 400 }
    bringIntoView(a, wide, 240, false)
    const v = a.view()
    expect(v.zoom).toBeLessThan(z0)
    expect(a.sceneToViewport({ x: wide.minX, y: 0 }, v).x).toBeGreaterThanOrEqual(240)
    expect(a.sceneToViewport({ x: wide.maxX, y: 0 }, v).x).toBeLessThanOrEqual(1200)
  })

  it("an existing project's seven template boards get their frames once, in rank order, with the nodes in their boards", async () => {
    const { a, doc, boards } = await seeded()
    expect(boards.map((b) => b.title)).toEqual(AD_TEMPLATE.map((t) => t.title))
    expect(a.elements().filter(isBoard)).toHaveLength(7)
    // The nodes are held by boards, so the rail lists the boards alone.
    expect(railTargets(a.elements(), doc).map((t) => t.kind)).toEqual(Array(7).fill('board'))
    expect(node(a, 'script').frameId).toBe(board(a, doc, 'script').id)
    expect(node(a, 'storyboard').frameId).toBe(board(a, doc, 'storyboard').id)
    expect(node(a, 'video').frameId).toBe(board(a, doc, 'video').id)
    expect(seedBoards(a, doc)).toBeNull()
    const scene = new SceneStore((() => { const d = new Y.Doc(); Y.applyUpdate(d, Y.encodeStateAsUpdate(a.doc)); return d })())
    expect(scene.all().filter((r) => r.kind === 'board').map((r) => r.props.purpose).sort()).toEqual(AD_TEMPLATE.map((t) => t.purpose).sort())
  })

  it('a node dragged onto the Characters board joins it; dragged back, it returns to its own', async () => {
    const { a, doc } = await seeded()
    a.setActiveTool({ type: 'native', id: 'selection' })
    const s = node(a, 'script')
    const chars = board(a, doc, 'character')
    a.selector.press({ x: s.x + 10, y: s.y + 10 })
    const to = { x: chars.x + chars.width / 2 - s.width / 2 + 10, y: chars.y + chars.height / 2 - s.height / 2 + 10 }
    a.selector.release(to)
    expect(node(a, 'script').frameId).toBe(chars.id)
    a.undoScene('undo')
    expect(node(a, 'script').frameId).toBe(board(a, doc, 'script').id)
  })

  it('a board picked up by its title carries what is on it, as one undo step', async () => {
    const { a, doc } = await seeded()
    a.setActiveTool({ type: 'native', id: 'selection' })
    const sb = board(a, doc, 'storyboard')
    const n = node(a, 'storyboard')
    const before = a.undo.depth().undo
    a.selector.press({ x: sb.x + 20, y: sb.y - 10 })
    expect(a.view().selectedIds).toEqual([sb.id])
    a.selector.release({ x: sb.x + 220, y: sb.y + 90 })
    expect(a.undo.depth().undo).toBe(before + 1)
    expect(node(a, 'storyboard').x).toBe(n.x + 200)
    expect(board(a, doc, 'storyboard').x).toBe(sb.x + 200)
    a.undoScene('undo')
    expect(node(a, 'storyboard').x).toBe(n.x)
  })

  it('⌥2 fits the second board by rank, ⌥0 everything; typing keeps the keys', async () => {
    const { a, doc } = await seeded()
    expect(boardKey({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit2', target: null })).toBe(1)
    expect(boardKey({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit0', target: null })).toBe('fit')
    expect(boardKey({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit2', target: null })).toBeNull()
    const input = { closest: (s: string) => (s.includes('input') ? {} : null) }
    expect(boardKey({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit2', target: input as never })).toBeNull()
    expect(jumpTo(a, doc, 1, false)).toBe(true)
    const chars = board(a, doc, 'character')
    const vb = a.visibleBounds()
    expect(vb.minX <= chars.x && vb.maxX >= chars.x + chars.width).toBe(true)
    expect(vb.maxX - vb.minX).toBeLessThan(2000)
    expect(jumpTo(a, doc, 'fit', false)).toBe(true)
    expect(jumpTo(a, doc, 20, false)).toBe(false)
    // With the rail's 240px kept clear: the board lands right of it, never above 100%.
    expect(jumpTo(a, doc, 1, false, 240)).toBe(true)
    const v = a.view()
    expect(v.zoom).toBeLessThanOrEqual(1)
    expect(a.sceneToViewport({ x: chars.x, y: chars.y }, v).x).toBeGreaterThanOrEqual(240)
    expect(a.sceneToViewport({ x: chars.x + chars.width, y: chars.y }, v).x).toBeLessThanOrEqual(1200)
  })

  it('an existing project on a canvas with named pictures: each picture board wraps its pictures, and the nodes stand left of them (mock Main)', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Rain')
    const doc = structuredClone(s.get()) as unknown as ProductionDocument
    await s.close()
    const a = new OwnAdapter()
    a.resize(1440, 900, 0, 0)
    const pic = (x: number, y: number) => a.imageNode({ x, y, width: 100, height: 150, assetSha: null, customData: { kind: 'pic', id: `pic_${x}_${y}` }, status: 'saved' })
    const face = pic(600, 100)
    const beach = pic(800, 100)
    const bottle = pic(600, 400)
    a.transact((els) => [...els, face, beach, bottle], { undoable: false })
    const ref = (id: string, key: string, role: string, node: string) => {
      doc.keys[`k_${id}`] = { id: `k_${id}`, v: 1, field_v: {}, key, role } as never
      doc.refs[id] = { id, v: 1, field_v: {}, key, variant: 'front', role, node } as never
    }
    ref('r1', 'maya', 'character', face.id)
    ref('r2', 'ext', 'location', beach.id)
    ref('r3', 'bottle', 'product', bottle.id)
    a.transact((els) => [...els, ...seedNodes(a, doc)], { undoable: false })
    withAdBoards(doc)
    const seed = seedBoards(a, doc)!
    a.transact((els) => seed.apply(els), { undoable: false })
    const inside = (e: { x: number; y: number; width: number; height: number }, f: { x: number; y: number; width: number; height: number }) =>
      e.x >= f.x && e.y >= f.y && e.x + e.width <= f.x + f.width && e.y + e.height <= f.y + f.height
    const at = (id: string) => a.elements().find((e) => e.id === id)!
    expect(at(face.id).frameId).toBe(board(a, doc, 'character').id)
    expect(at(beach.id).frameId).toBe(board(a, doc, 'location').id)
    expect(at(bottle.id).frameId).toBe(board(a, doc, 'product').id)
    expect(inside(at(face.id), board(a, doc, 'character'))).toBe(true)
    expect(inside(at(bottle.id), board(a, doc, 'product'))).toBe(true)
    const script = node(a, 'script')
    expect(script.x + script.width).toBeLessThan(600)
    expect(inside(script, board(a, doc, 'script'))).toBe(true)
    expect(node(a, 'storyboard').y).toBeGreaterThan(550)
    // Every board is there, the References board (no pictures yet) after the others.
    expect(a.elements().filter(isBoard)).toHaveLength(7)
  })
})
