// + Node on our own engine (features/canvas-nodes.clan; ui-behaviour 3.3 Creating nodes), with a real
// contract-3 document: a new node is a new document entity of its kind with a node on the canvas,
// selected, in the board in view when its purpose fits, else in the middle of the view; a second and a
// third of a kind sit beside the first, and undo takes the node away as one step.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { modelStore, MAYA } from '../../../test/model'
import { boardIdOf, isBoard, jumpTo, seedBoards } from '../../boards/boards'
import { boardNotices } from '../../boards/fitting'
import { withAdBoards } from '../../../test/adBoards'
import { cardOf, createNode, isEmptyNode, seedNodes } from '../../nodes/nodes'
import { OwnAdapter } from './adapter'

async function seeded() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  await s.change((d) => { withAdBoards(d as unknown as ProductionDocument) }, { action: 'an existing project: the template boards', undo: false })
  const seed = seedBoards(a, s.get() as unknown as ProductionDocument)!
  a.transact((els) => seed.apply(els), { undoable: false })
  return { a, s, doc: () => s.get() as unknown as ProductionDocument }
}

const nodesOf = (a: OwnAdapter, kind: string) => a.elements().filter((e) => cardOf(e)?.kind === kind)
const boxOf = (e: { x: number; y: number; width: number; height: number }) => ({ x: e.x, y: e.y, w: e.width, h: e.height })
const overlap = (p: ReturnType<typeof boxOf>, q: ReturnType<typeof boxOf>) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h

describe('+ Node makes a new node (ui-behaviour 3.3)', () => {
  it('a new Script is its own empty script, a second node, selected; the Script board is hemmed in below and to the right, so it grows up to hold it (nothing on it moves), and undo takes it away', async () => {
    const { a, s, doc } = await seeded()
    const scriptBoard = Object.values(doc().boards).find((b) => b.purpose === 'script')!
    jumpTo(a, doc(), Object.values(doc().boards).sort((x, y) => (x.rank < y.rank ? -1 : 1)).indexOf(scriptBoard), false)
    const first = nodesOf(a, 'script')[0]
    const heard: string[] = []
    const off = boardNotices.subscribe((n) => heard.push(n.frameId))
    const frame0 = boxOf(a.elements().find((e) => boardIdOf(e) === scriptBoard.id)!)
    const el = await createNode({ canvas: a, doc: s }, 'script')
    off()
    const scripts = Object.values(doc().scripts)
    expect(scripts).toHaveLength(2)
    const made = cardOf(el)!
    expect(made.kind).toBe('script')
    expect(made.id).not.toBe(cardOf(first)!.id)
    expect(doc().scripts[made.id].title).toBe('Script 2')
    expect(isEmptyNode(doc(), 'script', made.id)).toBe(true)
    expect(nodesOf(a, 'script')).toHaveLength(2)
    expect(a.view().selectedIds).toEqual([el.id])
    // The Script board has Characters to its right and Storyboard below (owner decision 2026-10-15): it
    // does not grow over them; it grows up, toward free canvas, and the new script goes above the first
    // (BA1: make space, never shuffle). Nothing is full.
    const frame = a.elements().find((e) => boardIdOf(e) === scriptBoard.id)!
    const fb = boxOf(frame)
    expect([fb.x, fb.w, fb.y + fb.h]).toEqual([frame0.x, frame0.w, frame0.y + frame0.h])
    expect(fb.y).toBeLessThan(frame0.y)
    expect(el.frameId).toBe(frame.id)
    expect(el.y + el.height).toBeLessThan(first.y)
    expect(boxOf(nodesOf(a, 'script').find((e) => e.id === first.id)!)).toEqual(boxOf(first))
    for (const other of a.elements().filter((e) => e.id !== el.id && e.id !== frame.id && !e.isDeleted && (isBoard(e) || cardOf(e)))) expect(overlap(boxOf(el), boxOf(other))).toBe(false)
    expect(heard).toEqual([])
    // One undo step takes the node away.
    a.undoScene('undo')
    expect(nodesOf(a, 'script')).toHaveLength(1)
    await s.close()
  })

  it('"Storyboard 2" goes in the Storyboard board, which grows down, never over the Video board beside it (one undo step)', async () => {
    const { a, s, doc } = await seeded()
    const ranked = Object.values(doc().boards).sort((x, y) => (x.rank < y.rank ? -1 : 1))
    const sbBoard = ranked.find((b) => b.purpose === 'storyboard')!
    const vBoard = ranked.find((b) => b.purpose === 'video')!
    jumpTo(a, doc(), ranked.indexOf(sbBoard), false)
    const frameOf = (id: string) => a.elements().find((e) => boardIdOf(e) === id)!
    const before = boxOf(frameOf(sbBoard.id))
    const video = boxOf(frameOf(vBoard.id))
    const first = nodesOf(a, 'storyboard')[0]
    const el = await createNode({ canvas: a, doc: s }, 'storyboard')
    expect(doc().storyboards[cardOf(el)!.id].title).toBe('Storyboard 2')
    const after = boxOf(frameOf(sbBoard.id))
    expect(el.frameId).toBe(frameOf(sbBoard.id).id)
    expect(overlap(boxOf(el), boxOf(first))).toBe(false)
    // Down: the same left, top and width, taller, holding the new card; clear of the Video board.
    expect([after.x, after.y, after.w]).toEqual([before.x, before.y, before.w])
    expect(after.h).toBeGreaterThan(before.h)
    expect(el.y).toBeGreaterThan(first.y + first.height)
    expect(el.y + el.height).toBeLessThanOrEqual(after.y + after.h)
    expect(overlap(after, video)).toBe(false)
    expect(boxOf(frameOf(vBoard.id))).toEqual(video)
    // One undo step: the node and the growth.
    a.undoScene('undo')
    expect(nodesOf(a, 'storyboard')).toHaveLength(1)
    expect(boxOf(frameOf(sbBoard.id))).toEqual(before)
    await s.close()
  })

  it('a Storyboard and a Video made where no board fits go in the middle of the view, unboarded, and never on top of each other', async () => {
    const { a, s, doc } = await seeded()
    // The Characters board in view: its purpose fits none of the three.
    const chars = Object.values(doc().boards).sort((x, y) => (x.rank < y.rank ? -1 : 1))
    jumpTo(a, doc(), chars.findIndex((b) => b.purpose === 'character'), false)
    const sb = await createNode({ canvas: a, doc: s }, 'storyboard')
    const v1 = await createNode({ canvas: a, doc: s }, 'video')
    const v2 = await createNode({ canvas: a, doc: s }, 'video')
    expect(sb.frameId ?? null).toBeNull()
    expect(Object.keys(doc().storyboards)).toHaveLength(2)
    expect(Object.keys(doc().videos)).toHaveLength(3)
    expect(doc().videos[cardOf(v2)!.id].title).toBe('Video 3')
    expect(overlap(boxOf(v1), boxOf(v2))).toBe(false)
    const vb = a.visibleBounds()
    const mid = { x: (vb.minX + vb.maxX) / 2, y: (vb.minY + vb.maxY) / 2 }
    // Centred on the middle of the view, nudged (diagonally) only as far as it takes to clear the nodes there.
    const dx = sb.x + sb.width / 2 - mid.x
    const dy = sb.y + sb.height / 2 - mid.y
    expect(dx).toBeGreaterThanOrEqual(0)
    expect(dx).toBeCloseTo(dy, 0)
    expect(dx).toBeLessThan(600)
    for (const other of a.elements().filter((e) => cardOf(e) && e.id !== sb.id)) expect(overlap(boxOf(sb), boxOf(other))).toBe(false)
    // A storyboard and a video made new are empty: their cards offer the start.
    expect(isEmptyNode(doc(), 'storyboard', cardOf(sb)!.id)).toBe(true)
    expect(isEmptyNode(doc(), 'video', cardOf(v1)!.id)).toBe(true)
    await s.close()
  })

  it('at a point: centred there (a link dropped on empty canvas makes its node there)', async () => {
    const { a, s } = await seeded()
    const el = await createNode({ canvas: a, doc: s }, 'video', { x: 5000, y: 4000 })
    expect(el.x + el.width / 2).toBeCloseTo(5000, 0)
    expect(el.y + el.height / 2).toBeCloseTo(4000, 0)
    await s.close()
  })
})
