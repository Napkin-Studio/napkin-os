// The Boards rail equals the live boards (features/art-boards.clan; ui-behaviour 3.2): a board frame
// deleted takes its board out of the document, so out of the rail and the ⌥ numbers, at once; undo
// brings it back as it was; a rename follows the frame. Delete board only keeps what was on it,
// unboarded; Delete all takes it and its links. A new board goes last in rank, beside the others.

import { describe, expect, it } from 'vitest'
import type { Board, ProductionDocument } from '../../../contracts/types'
import { modelStore, MAYA } from '../../../test/model'
import { boardIdOf, boardsByRank, contentsOf, deleteBoards, isBoard, jumpTo, liveBoards, newBoard, reconcileBoards, seedBoards } from '../../boards/boards'
import { boardRows } from '../../chrome/boards'
import { cardOf, linkIdOf, seedNodes } from '../../nodes/nodes'
import { OwnAdapter } from './adapter'

async function seeded() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  const seed = seedBoards(a, s.get() as unknown as ProductionDocument)!
  a.transact((els) => seed.apply(els), { undoable: false })
  const doc = structuredClone(s.get()) as unknown as ProductionDocument
  for (const b of seed.boards) doc.boards[b.id] = b
  await s.close()
  return { a, doc }
}

/** What the board layer does on each change: apply the reconcile to the document. */
function follow(a: OwnAdapter, doc: ProductionDocument, memory: Map<string, Board>): ProductionDocument {
  const r = reconcileBoards(a.elements(), doc, memory)
  const d = structuredClone(doc)
  for (const id of r.remove) delete d.boards[id]
  for (const b of r.restore) d.boards[b.id] = b
  for (const t of r.retitle) {
    d.boards[t.id].title = t.title
    if (t.purpose) d.boards[t.id].purpose = t.purpose
  }
  return d
}

const frameOf = (a: OwnAdapter, doc: ProductionDocument, purpose: string) => {
  const id = Object.values(doc.boards).find((b) => b.purpose === purpose)!.id
  return a.elements().find((e) => boardIdOf(e) === id)!
}
const titles = (d: ProductionDocument) => boardRows(d, true).map((r) => r.title)

describe('the rail is the live boards', () => {
  it('a deleted board leaves the rail and the ⌥ numbers at once; undo brings it back in its place', async () => {
    const { a, doc } = await seeded()
    const memory = new Map<string, Board>()
    let d = follow(a, doc, memory)
    expect(titles(d)).toEqual(['Script', 'Characters', 'Locations', 'References', 'Products', 'Storyboard', 'Video'])
    // The person deletes the (empty) Locations board.
    const loc = frameOf(a, d, 'location')
    a.selector.set([loc.id])
    a.selector.deleteSelected()
    // ⌥3 already means References, before the document catches up (the frames are the truth).
    expect(liveBoards(a.elements(), d).map((b) => b.title)[2]).toBe('References')
    d = follow(a, d, memory)
    expect(titles(d)).toEqual(['Script', 'Characters', 'References', 'Products', 'Storyboard', 'Video'])
    expect(jumpTo(a, d, 2, false)).toBe(true)
    const refs = frameOf(a, d, 'reference')
    const vb = a.visibleBounds()
    expect(refs.x >= vb.minX && refs.x + refs.width <= vb.maxX).toBe(true)
    // Undo: the frame is back, and so is its row, at its rank.
    a.undoScene('undo')
    d = follow(a, d, memory)
    expect(titles(d)).toEqual(['Script', 'Characters', 'Locations', 'References', 'Products', 'Storyboard', 'Video'])
  })

  it('a rename and a purpose on the frame follow into the document (and so the rail)', async () => {
    const { a, doc } = await seeded()
    const memory = new Map<string, Board>()
    let d = follow(a, doc, memory)
    const f = frameOf(a, d, 'product')
    a.transact((els) => els.map((e) => (e.id === f.id ? a.patch(e, { name: 'Bottles', purpose: 'reference' } as never) : e)), { undoable: true })
    d = follow(a, d, memory)
    const b = d.boards[boardIdOf(f)!]
    expect([b.title, b.purpose]).toEqual(['Bottles', 'reference'])
    expect(titles(d)).toContain('Bottles')
  })
})

describe('deleting a board (ui-behaviour 3.2: Delete board only, Delete all)', () => {
  it('Delete board only keeps the node, on no board; one undo puts both back', async () => {
    const { a, doc } = await seeded()
    const f = frameOf(a, doc, 'script')
    const node = a.elements().find((e) => cardOf(e)?.kind === 'script')!
    expect(contentsOf(a.elements(), f.id).map((e) => e.id)).toEqual([node.id])
    deleteBoards(a, [f.id], false)
    expect(a.elements().some((e) => e.id === f.id)).toBe(false)
    expect(a.elements().find((e) => e.id === node.id)!.frameId ?? null).toBeNull()
    a.undoScene('undo')
    expect(a.elements().some((e) => e.id === f.id)).toBe(true)
    expect(a.elements().find((e) => e.id === node.id)!.frameId).toBe(f.id)
  })

  it('Delete all takes the board, what is on it and the links to it, as one step', async () => {
    const { a, doc } = await seeded()
    const f = frameOf(a, doc, 'storyboard')
    const links = () => a.elements().filter((e) => linkIdOf(e)).length
    expect(links()).toBe(2)
    deleteBoards(a, [f.id], true)
    expect(a.elements().some((e) => cardOf(e)?.kind === 'storyboard')).toBe(false)
    expect(links()).toBe(0)
    a.undoScene('undo')
    expect(a.elements().some((e) => cardOf(e)?.kind === 'storyboard')).toBe(true)
    expect(links()).toBe(2)
  })
})

describe('a new board ("+ New board", the Board tool)', () => {
  it('goes last in rank, to the right of the boards on the top row, with no purpose yet', async () => {
    const { a, doc } = await seeded()
    const { board, frame } = newBoard(a, doc)
    expect(board.rank > boardsByRank(doc).at(-1)!.rank).toBe(true)
    expect([board.title, board.purpose]).toEqual(['New board', 'none'])
    const frames = a.elements().filter(isBoard)
    expect(frame.x).toBeGreaterThan(Math.max(...frames.map((e) => e.x + e.width)))
    expect(frame.y).toBe(Math.min(...frames.map((e) => e.y)))
    // At a drawn rect, it takes the rect.
    const drawn = newBoard(a, doc, { rect: { x: 10, y: 20, w: 300, h: 200 } }).frame
    expect([drawn.x, drawn.y, drawn.width, drawn.height]).toEqual([10, 20, 300, 200])
  })
})
