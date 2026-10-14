// Boards on our own engine (features/art-boards.clan), with a real contract-3
// document: the Ad template's seven boards seeded once with the nodes in theirs,
// a node dragged out of and into a board, a board carrying its members with undo,
// the ⌥ jumps on real frames, and the Y round trip.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { SceneStore } from '../../../../../canvas-engine/src'
import type { ProductionDocument } from '../../../contracts/types'
import { modelStore, MAYA } from '../../../test/model'
import { AD_TEMPLATE, boardIdOf, boardKey, isBoard, jumpTo, seedBoards } from '../../boards/boards'
import { cardOf, seedNodes } from '../../nodes/nodes'
import { OwnAdapter } from './adapter'

async function seeded() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.resize(1200, 800, 0, 0)
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  const seed = seedBoards(a, s.get() as unknown as ProductionDocument)!
  a.transact((els) => seed.apply(els), { undoable: false })
  const doc = structuredClone(s.get()) as unknown as ProductionDocument
  for (const b of seed.boards) doc.boards[b.id] = b
  await s.close()
  return { a, doc, seed }
}

const node = (a: OwnAdapter, kind: string) => a.elements().find((e) => cardOf(e)?.kind === kind)!
const board = (a: OwnAdapter, doc: ProductionDocument, purpose: string) => {
  const id = Object.values(doc.boards).find((b) => b.purpose === purpose)!.id
  return a.elements().find((e) => boardIdOf(e) === id)!
}

describe('art-boards on the own engine', () => {
  it('seeds the seven template boards once, in rank order, with the nodes in their boards', async () => {
    const { a, doc, seed } = await seeded()
    expect(seed.boards.map((b) => b.title)).toEqual(AD_TEMPLATE.map((t) => t.title))
    expect([...seed.boards.map((b) => b.rank)].sort()).toEqual(seed.boards.map((b) => b.rank))
    expect(a.elements().filter(isBoard)).toHaveLength(7)
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
  })
})
