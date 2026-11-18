// Boards from pictures (features/board-autolayout.clan; owner BA2 = c, BA3): two or more loose pictures
// that share a role offer "Gather into a <Role> board" (one undo step: the board, clear of its
// neighbours, the pictures in it one key per row); with a board of that role there, "Move to <Board>"
// (nothing already on it moves); one picture on another purpose's board offers Move; Tidy lines a
// board up by its purpose as one undo step.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument, RefRole } from '../../../contracts/types'
import { updateDoc } from '../../../doc/store'
import { newId } from '../../../lib/ulid'
import { addKey, addRef } from '../../../test/jobFixtures'
import { modelStore, MAYA, SHA } from '../../../test/model'
import { gatherOffer, lanesFor, unitsOf } from '../../boards/arrange'
import { boardIdOf, isBoard, reconcileBoards } from '../../boards/boards'
import { gatherIntoBoard, moveIntoBoard, tidyBoard } from '../../boards/gather'
import type { CanvasElement } from '../../core/canvasAdapter'
import { OwnAdapter } from './adapter'

type Box = { x: number; y: number; width: number; height: number }
const ov = (p: Box, q: Box, m = 0) => p.x < q.x + q.width + m && q.x < p.x + p.width + m && p.y < q.y + q.height + m && q.y < p.y + p.height + m
const inside = (e: Box, f: Box) => e.x >= f.x && e.y >= f.y && e.x + e.width <= f.x + f.width && e.y + e.height <= f.y + f.height

async function setup(pics: [string, string, RefRole, number, number][]) {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  const els = pics.map(([, , , x, y], i) => a.imageNode({ x, y, width: 200, height: 250, assetSha: SHA(String(i)), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA(String(i)) } }))
  a.transact((all) => [...all, ...els], { undoable: false })
  await updateDoc(s, (d) => {
    pics.forEach(([key, variant, role], i) => {
      if (!Object.values(d.keys).some((k) => k.key === key)) addKey(d, key, role)
      const r = addRef(d, key, variant, SHA(String(i)), role)
      r.node = (els[i].customData as { id: string }).id
    })
  }, 'name')
  const doc = () => s.get() as unknown as ProductionDocument
  const at = (i: number) => a.elements().find((e) => e.id === els[i].id)!
  return { s, a, doc, els, at }
}

describe('Gather into a board', () => {
  it('two loose characters offer Gather; one step makes the board clear of its neighbours with one key per row, and one undo takes it all back', async () => {
    const { s, a, doc, els, at } = await setup([['maya', 'front', 'character', 0, 0], ['maya', 'side', 'character', 300, 400], ['jo', 'front', 'character', 700, 0]])
    // A neighbour board right where the pictures are.
    const other = a.board({ x: 100, y: -40, width: 300, height: 200, title: 'Sketches', boardId: newId('board'), purpose: 'sketches' })
    a.transact((all) => [other, ...all], { undoable: false })
    const before = els.map((e) => ({ x: e.x, y: e.y }))
    const offer = gatherOffer(a.elements(), doc(), els.map((e) => e.id))!
    expect(offer).toMatchObject({ purpose: 'character', title: 'Characters' })
    expect(offer.existing).toBeUndefined()
    const depth = a.undo.depth().undo
    const frameId = await gatherIntoBoard(a, s, offer)
    expect(a.undo.depth().undo).toBe(depth + 1)
    const frame = a.elements().find((e) => e.id === frameId)!
    expect(Object.values(doc().boards).map((b) => [b.title, b.purpose])).toEqual([['Characters', 'character']])
    expect(ov(frame, a.elements().find((e) => e.id === other.id)!, 24 - 1)).toBe(false)
    for (let i = 0; i < 3; i++) {
      expect(at(i).frameId).toBe(frameId)
      expect(inside(at(i), frame)).toBe(true)
    }
    // Maya's views share a row, front first; Jo on the next row.
    expect(at(0).y).toBe(at(1).y)
    expect(at(0).x).toBeLessThan(at(1).x)
    expect(at(2).y).toBeGreaterThan(at(0).y + 250)
    // One undo: the frame goes, the pictures are back where they were, and the document's board follows.
    const memory = new Map()
    reconcileBoards(a.elements(), doc(), memory)
    a.undoScene('undo')
    expect(a.elements().some((e) => e.id === frameId && !e.isDeleted)).toBe(false)
    expect(els.map((_, i) => ({ x: at(i).x, y: at(i).y }))).toEqual(before)
    expect(reconcileBoards(a.elements(), doc(), memory).remove).toEqual([boardIdOf(frame)])
    await s.close()
  })

  it('with a Characters board there it offers Move to Characters, which adds a new row and moves nothing already on it', async () => {
    const { s, a, doc, els, at } = await setup([['maya', 'front', 'character', 0, 0], ['maya', 'side', 'character', 300, 0], ['jo', 'front', 'character', 2000, 2000]])
    const board = a.board({ x: 1900, y: 1950, width: 400, height: 400, title: 'Characters', boardId: newId('board'), purpose: 'character' })
    a.transact((all) => [board, ...all.map((e) => (e.id === els[2].id ? a.patch(e, { frameId: board.id }) : e))], { undoable: false })
    await updateDoc(s, (d) => { d.boards[boardIdOf(board)!] = { id: boardIdOf(board)!, v: 1, field_v: {}, title: 'Characters', purpose: 'character', rank: 'a' } }, 'board')
    const jo = { x: at(2).x, y: at(2).y }
    const offer = gatherOffer(a.elements(), doc(), [els[0].id, els[1].id])!
    expect(offer).toMatchObject({ existing: board.id, title: 'Characters' })
    expect(moveIntoBoard(a, doc(), offer)).toBe(true)
    expect([at(2).x, at(2).y]).toEqual([jo.x, jo.y])
    const f = a.elements().find((e) => e.id === board.id)!
    for (let i = 0; i < 2; i++) {
      expect(at(i).frameId).toBe(board.id)
      expect(inside(at(i), f)).toBe(true)
      expect(ov(at(i), at(2))).toBe(false)
    }
    expect(at(0).y).toBe(at(1).y)
    expect(at(0).y).toBeGreaterThan(jo.y + 250)
    await s.close()
  })

  it('Move to Characters puts a key\'s new view in that key\'s row, right after its last view', async () => {
    const { s, a, doc, els, at } = await setup([['maya', 'front', 'character', 2016, 2022], ['jo', 'front', 'character', 2016, 2312], ['maya', 'side', 'character', 0, 0]])
    const board = a.board({ x: 2000, y: 2000, width: 600, height: 650, title: 'Characters', boardId: newId('board'), purpose: 'character' })
    a.transact((all) => [board, ...all.map((e) => (e.id === els[0].id || e.id === els[1].id ? a.patch(e, { frameId: board.id }) : e))], { undoable: false })
    const offer = gatherOffer(a.elements(), doc(), [els[2].id])!
    expect(offer.existing).toBe(board.id)
    moveIntoBoard(a, doc(), offer)
    expect([at(2).x, at(2).y, at(2).frameId]).toEqual([2016 + 200 + 40, 2022, board.id])
    expect([at(0).x, at(0).y, at(1).x, at(1).y]).toEqual([2016, 2022, 2016, 2312])
    await s.close()
  })

  it('offers nothing for one loose picture, mixed roles, or pictures already on their board; one on another purpose\'s board offers Move', async () => {
    const { s, a, doc, els } = await setup([['maya', 'front', 'character', 0, 0], ['beach', 'wide', 'location', 300, 0], ['jo', 'front', 'character', 600, 0]])
    expect(gatherOffer(a.elements(), doc(), [els[0].id])).toBeNull()
    expect(gatherOffer(a.elements(), doc(), [els[0].id, els[1].id])).toBeNull()
    const locs = a.board({ x: -50, y: -50, width: 900, height: 400, title: 'Locations', boardId: newId('board'), purpose: 'location' })
    const chars = a.board({ x: 0, y: 1000, width: 400, height: 300, title: 'Characters', boardId: newId('board'), purpose: 'character' })
    a.transact((all) => [locs, chars, ...all.map((e) => (els.some((p) => p.id === e.id) ? a.patch(e, { frameId: locs.id }) : e))], { undoable: false })
    expect(gatherOffer(a.elements(), doc(), [els[1].id])).toBeNull()
    expect(gatherOffer(a.elements(), doc(), [els[0].id])).toMatchObject({ existing: chars.id, title: 'Characters' })
    await s.close()
  })
})

describe('Tidy', () => {
  it('lines a Characters board up one key per row in view order, unnamed after, as one undo step; nothing moves the second time', async () => {
    const { s, a, doc, els, at } = await setup([['maya', 'side', 'character', 520, 40], ['maya', 'front', 'character', 280, 330], ['jo', 'front', 'character', 40, 40]])
    const loose = a.imageNode({ x: 40, y: 330, width: 200, height: 250, assetSha: SHA('x'), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA('x') } })
    const board = a.board({ x: 0, y: 0, width: 800, height: 700, title: 'Characters', boardId: newId('board'), purpose: 'character' })
    a.transact((all) => [board, ...all.map((e) => (els.some((p) => p.id === e.id) ? a.patch(e, { frameId: board.id }) : e)), a.patch(loose, { frameId: board.id })], { undoable: false })
    const lanes = lanesFor('character', unitsOf(a.elements().filter((e) => e.frameId === board.id)), a.elements(), doc())
    expect(lanes.map((l) => l.map((u) => u.ids[0]))).toEqual([[els[2].id], [els[1].id, els[0].id], [loose.id]])
    const depth = a.undo.depth().undo
    expect(tidyBoard(a, doc(), board.id)).toBe(true)
    expect(a.undo.depth().undo).toBe(depth + 1)
    const l = a.elements().find((e) => e.id === loose.id)!
    // Jo's row first (it was first in reading order), then Maya front, side; the unnamed one last.
    expect([at(2).x, at(2).y]).toEqual([16, 22])
    expect([at(1).x, at(1).y]).toEqual([16, 22 + 250 + 40])
    expect([at(0).x, at(0).y]).toEqual([16 + 240, 22 + 250 + 40])
    expect([l.x, l.y]).toEqual([16, 22 + 2 * (250 + 40)])
    expect(tidyBoard(a, doc(), board.id)).toBe(false)
    a.undoScene('undo')
    expect([at(2).x, at(2).y]).toEqual([40, 40])
    expect(a.elements().filter((e) => isBoard(e as CanvasElement))).toHaveLength(1)
    await s.close()
  })
})
