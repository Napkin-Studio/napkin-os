// @vitest-environment happy-dom
// Naming routes (features/board-autolayout.clan): a loose picture named for a role goes to the first
// board of that role, in its key's row, as its own canvas step that keeps the name, and the stage hears
// "Moved to Characters"; with no such board it stays loose; one already on a board stays (BA3).

import { describe, expect, it, vi } from 'vitest'
import type { Services } from '../../../app/context'
import type { ProductionDocument } from '../../../contracts/types'
import { CanvasController, type Routed } from '../../controller'
import { newId } from '../../../lib/ulid'
import { snapshotDoc } from '../../../test/jobFixtures'
import { OwnAdapter } from './adapter'

vi.mock('../../../lib/idb', () => ({ idbPut: async () => {}, idbGet: async () => undefined }))

const SHA = 'sha256:' + 'a'.repeat(64)

function setup(withBoard = true) {
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  const doc = snapshotDoc()
  const pic = (x: number, y: number) => a.imageNode({ x, y, width: 200, height: 250, assetSha: SHA, status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA } })
  const loose = pic(2000, 0)
  const front = pic(16, 22)
  const boardId = newId('board')
  const board = a.board({ x: 0, y: 0, width: 500, height: 600, title: 'Characters', boardId, purpose: 'character' })
  a.transact(() => [...(withBoard ? [board] : []), withBoard ? a.patch(front, { frameId: board.id }) : front, loose], { undoable: false })
  if (withBoard) doc.change((d) => { (d as unknown as ProductionDocument).boards[boardId] = { id: boardId, v: 1, field_v: {}, title: 'Characters', purpose: 'character', rank: 'a' } }, { action: 'board', undo: false })
  const services = { doc, runner: {}, relay: {}, project: { canvasKey: 'k' }, ui: { get: () => ({ me: { participantId: 'p_1' } }) } } as unknown as Services
  const ctrl = new CanvasController(a, services)
  const id = (e: { customData?: unknown }) => (e.customData as { id: string }).id
  const at = (e: { id: string }) => a.elements().find((x) => x.id === e.id)!
  return { a, doc, ctrl, board, loose, front, id, at }
}

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('naming routes a loose picture to its board', () => {
  it('goes after its key\'s front on Characters, as one canvas step that keeps the name; the stage hears it', async () => {
    const { a, doc, ctrl, board, loose, front, id, at } = setup()
    const heard: Routed[] = []
    ctrl.onRouted((r) => heard.push(r))
    ctrl.name(id(front), 'maya', 'front')
    await settle()
    expect(heard).toEqual([]) // already on its board
    const depth = a.undo.depth().undo
    ctrl.name(id(loose), 'maya', 'side')
    await settle()
    expect(at(loose).frameId).toBe(board.id)
    expect([at(loose).x, at(loose).y]).toEqual([16 + 200 + 40, 22])
    expect(a.undo.depth().undo).toBe(depth + 1)
    expect(heard.map((r) => r.title)).toEqual(['Characters'])
    // Undo of the move keeps the name.
    a.undoScene('undo')
    expect([at(loose).x, at(loose).frameId ?? null]).toEqual([2000, null])
    expect(Object.values((doc.get() as unknown as ProductionDocument).refs).some((r) => r.key === 'maya' && r.variant === 'side')).toBe(true)
    // The chip's Undo puts it back the same way.
    ctrl.unroute(heard[0])
    expect(at(loose).frameId ?? null).toBeNull()
  })

  it('with no board for its role, it stays loose', async () => {
    const { ctrl, loose, id, at } = setup(false)
    ctrl.name(id(loose), 'maya', 'side')
    await settle()
    expect([at(loose).x, at(loose).frameId ?? null]).toEqual([2000, null])
  })
})
