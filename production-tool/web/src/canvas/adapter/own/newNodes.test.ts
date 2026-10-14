// + Node on our own engine (features/canvas-nodes.clan; ui-behaviour 3.3 Creating nodes), with a real
// contract-3 document: a new node is a new document entity of its kind with a node on the canvas,
// selected, in the board in view when its purpose fits, else in the middle of the view; a second and a
// third of a kind sit beside the first, and undo takes the node away as one step.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { modelStore, MAYA } from '../../../test/model'
import { boardIdOf, jumpTo, seedBoards } from '../../boards/boards'
import { cardOf, createNode, isEmptyNode, seedNodes } from '../../nodes/nodes'
import { OwnAdapter } from './adapter'

async function seeded() {
  const s = modelStore()
  await s.create(MAYA, 'Rain')
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  a.transact((els) => [...els, ...seedNodes(a, s.get() as unknown as ProductionDocument)], { undoable: false })
  const seed = seedBoards(a, s.get() as unknown as ProductionDocument)!
  a.transact((els) => seed.apply(els), { undoable: false })
  await s.change((d) => { for (const b of seed.boards) (d as unknown as ProductionDocument).boards[b.id] = b }, { action: 'create boards', undo: false })
  return { a, s, doc: () => s.get() as unknown as ProductionDocument }
}

const nodesOf = (a: OwnAdapter, kind: string) => a.elements().filter((e) => cardOf(e)?.kind === kind)
const boxOf = (e: { x: number; y: number; width: number; height: number }) => ({ x: e.x, y: e.y, w: e.width, h: e.height })
const overlap = (p: ReturnType<typeof boxOf>, q: ReturnType<typeof boxOf>) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h

describe('+ Node makes a new node (ui-behaviour 3.3)', () => {
  it('a new Script is its own empty script, a second node, selected, in the Script board in view, and undo takes it away', async () => {
    const { a, s, doc } = await seeded()
    const scriptBoard = Object.values(doc().boards).find((b) => b.purpose === 'script')!
    jumpTo(a, doc(), Object.values(doc().boards).sort((x, y) => (x.rank < y.rank ? -1 : 1)).indexOf(scriptBoard), false)
    const first = nodesOf(a, 'script')[0]
    const el = await createNode({ canvas: a, doc: s }, 'script')
    const scripts = Object.values(doc().scripts)
    expect(scripts).toHaveLength(2)
    const made = cardOf(el)!
    expect(made.kind).toBe('script')
    expect(made.id).not.toBe(cardOf(first)!.id)
    expect(doc().scripts[made.id].title).toBe('Script 2')
    expect(isEmptyNode(doc(), 'script', made.id)).toBe(true)
    expect(nodesOf(a, 'script')).toHaveLength(2)
    expect(a.view().selectedIds).toEqual([el.id])
    // In the Script board (it was in view), clear of the first script, the board grown to hold it.
    const frame = a.elements().find((e) => boardIdOf(e) === scriptBoard.id)!
    expect(el.frameId).toBe(frame.id)
    expect(overlap(boxOf(el), boxOf(first))).toBe(false)
    expect(el.x + el.width).toBeLessThanOrEqual(frame.x + frame.width)
    expect(el.y + el.height).toBeLessThanOrEqual(frame.y + frame.height)
    // One undo step takes the node (and the board's growth) away.
    a.undoScene('undo')
    expect(nodesOf(a, 'script')).toHaveLength(1)
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
