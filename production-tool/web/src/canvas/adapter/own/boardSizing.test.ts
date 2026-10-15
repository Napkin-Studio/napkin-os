// @vitest-environment happy-dom
// Board sizing on the own engine (owner decision, Shrey 2026-10-15; features/art-boards.clan): a
// generated picture lands beside its source on the source's board, the board growing toward it; a
// selected board resizes from its handles through the adapter, letting go of what the edge passed
// (said with Undo); Fit to contents is one step; spreading a stack on a board grows it to hold the views.

import { describe, expect, it, vi } from 'vitest'
import type { Services } from '../../../app/context'
import { CanvasController } from '../../controller'
import { newId } from '../../../lib/ulid'
import { snapshotDoc } from '../../../test/jobFixtures'
import { setStacked } from '../../nodes/stack'
import { OwnAdapter } from './adapter'

vi.mock('../../../lib/idb', () => ({ idbPut: async () => {}, idbGet: async () => undefined }))

type Box = { x: number; y: number; width: number; height: number }
const overlap = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height

function setup() {
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  const board = a.board({ x: 0, y: 0, width: 400, height: 300, title: 'Characters', boardId: newId('board'), purpose: 'character' })
  const pic = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    a.patch(a.imageNode({ x, y, width: 200, height: 150, assetSha: 'sha256:' + '0'.repeat(64), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: 'sha256:' + '0'.repeat(64) } }), { frameId: board.id, ...extra })
  return { a, board, pic, frame: () => a.elements().find((e) => e.id === board.id)! }
}

describe('board sizing on the own engine', () => {
  it('a generated picture lands beside its source on the source’s board, and the board grows toward it', () => {
    const { a, board, pic, frame } = setup()
    const src = pic(16, 22)
    a.transact(() => [board, src], { undoable: false })
    const services = { doc: snapshotDoc(), runner: {}, relay: {}, project: { canvasKey: 'k' }, ui: { get: () => ({ me: { participantId: 'p_1' } }) } } as unknown as Services
    const ctrl = new CanvasController(a, services)
    const at = { x: 16 + 200 + 80, y: 22, w: 200, h: 150 }
    ;(ctrl as unknown as { placeGen: (...args: unknown[]) => void }).placeGen('job_1', 'generate', [(src.customData as { id: string }).id], [{ el: src, id: (src.customData as { id: string }).id }], at)
    const gen = a.elements().find((e) => e.id === 'job_1')!
    expect(gen.frameId).toBe(board.id)
    expect([gen.x, gen.y]).toEqual([at.x, at.y])
    const f = frame()
    expect(f.x + f.width).toBe(at.x + at.w + 16)
    expect(f.height).toBe(300)
    // The provenance arrow stays bound to both ends.
    const arrow = a.elements().find((e) => (e.customData as { kind?: string } | undefined)?.kind === 'provenance') as Box & { startBinding?: { elementId: string }; endBinding?: { elementId: string } }
    expect([arrow.startBinding?.elementId, arrow.endBinding?.elementId]).toEqual([src.id, gen.id])
  })

  it('a selected board resizes from its handle as one step; what the edge passed leaves, is said, and Undo brings it back', () => {
    const { a, board, pic, frame } = setup()
    const p1 = pic(16, 22)
    const p2 = pic(16, 22 + 150 + 40)
    a.transact(() => [{ ...board, height: 420 }, p1, p2], { undoable: false })
    const heard: { kind: string; ids: string[] }[] = []
    a.onBoardEvent((e) => heard.push(e))
    a.select([board.id])
    expect(a.selectionFrame()).toMatchObject({ edges: true })
    expect(a.boardHandleAt({ x: 200, y: 420 })).toBe('s')
    a.press({ x: 200, y: 420 })
    a.drag({ x: 200, y: 200 })
    a.release({ x: 200, y: 200 })
    const f = frame()
    // Stopped under the first picture (with the padding); the second, whose centre it passed, left.
    expect(f.height).toBe(22 + 150 + 34)
    expect(a.elements().find((e) => e.id === p2.id)!.frameId ?? null).toBeNull()
    expect(a.elements().find((e) => e.id === p1.id)!.frameId).toBe(board.id)
    expect(heard).toEqual([{ kind: 'left', board: board.id, ids: [p2.id] }])
    expect(a.undo.depth().undo).toBe(1)
    a.undoScene('undo')
    expect(frame().height).toBe(420)
    expect(a.elements().find((e) => e.id === p2.id)!.frameId).toBe(board.id)
  })

  it('Fit to contents takes the board to what is on it with its padding, as one step, and never by itself', () => {
    const { a, board, pic, frame } = setup()
    const p1 = pic(100, 100)
    a.transact(() => [{ ...board, width: 900, height: 700 }, p1], { undoable: false })
    expect(a.fitBoard(board.id)).toBe(true)
    expect([frame().x, frame().y, frame().width, frame().height]).toEqual([84, 78, 232, 206])
    a.undoScene('undo')
    expect([frame().width, frame().height]).toEqual([900, 700])
  })

  it('spreading a stack on a board grows the board to hold its views, as the same step', () => {
    const { a, board, pic, frame } = setup()
    // Two views of a key laid out wider than the board, then stacked on it.
    const f = pic(16, 22, { groupIds: ['key:sam'] })
    const s = pic(16 + 240 + 200, 22, { groupIds: ['key:sam'] })
    a.transact(() => [{ ...board, width: 700 }, f, s], { undoable: false })
    const members = () => a.elements().filter((e) => e.groupIds?.includes('key:sam'))
    setStacked(a, members(), true)
    a.transact((all) => all.map((e) => (e.id === board.id ? a.patch(e, { width: 300 }) : e)), { undoable: false })
    setStacked(a, members(), false)
    const b = frame()
    for (const m of members()) expect(m.x + m.width).toBeLessThanOrEqual(b.x + b.width)
    expect(members().every((m) => m.frameId === board.id)).toBe(true)
    for (const other of a.elements().filter((e) => e.id !== board.id && e.type === 'frame')) expect(overlap(b, other)).toBe(false)
  })
})
