// @vitest-environment happy-dom
// Ink drawn on a board is on it (features/board-move.clan): a Drawing made from that ink stays on
// the board, so moving the board takes the Drawing and its strokes along.

import { describe, expect, it, vi } from 'vitest'
import type { Services } from '../../../app/context'
import { CanvasController } from '../../controller'
import { newId } from '../../../lib/ulid'
import { snapshotDoc } from '../../../test/jobFixtures'
import { OwnAdapter } from './adapter'

vi.mock('../../../lib/idb', () => ({ idbPut: async () => {}, idbGet: async () => undefined }))
vi.mock('../../../lib/blobs', async (orig) => ({ ...(await orig<object>()), putBlob: async () => 'sha256:' + '1'.repeat(64) }))
vi.mock('../../scene', async (orig) => ({
  ...(await orig<object>()),
  exportElements: async () => new Blob(['png'], { type: 'image/png' }),
  downscale: async (b: Blob) => ({ blob: b, w: 10, h: 10 }),
}))

describe('a Drawing made of ink on a board', () => {
  it('stays on the board, and moves with it', async () => {
    const a = new OwnAdapter()
    a.resize(1600, 1000, 0, 0)
    a.setActiveTool({ type: 'native', id: 'selection' })
    const board = a.board({ x: 0, y: 0, width: 400, height: 300, title: 'Sketches', boardId: newId('board'), purpose: 'sketches' })
    a.transact(() => [board], { undoable: false })
    // A stroke drawn with the pen on the board: it joins it.
    a.ink.begin('pen', { x: 100, y: 100, pressure: 0.5 }, { color: 'ink', width: 4 })
    a.ink.add([{ x: 160, y: 150, pressure: 0.5 }])
    const stroke = a.ink.end()!
    expect(a.elements().find((e) => e.id === stroke.id)!.frameId).toBe(board.id)
    const services = { doc: snapshotDoc(), runner: {}, relay: {}, project: { canvasKey: 'k' }, ui: { get: () => ({ me: { participantId: 'p_1' } }) } } as unknown as Services
    const ctrl = new CanvasController(a, services)
    const frame = (await (ctrl as unknown as { wrapDrawing: (ids: string[]) => Promise<{ id: string } | null> }).wrapDrawing([stroke.id]))!
    expect(a.elements().find((e) => e.id === frame.id)!.frameId).toBe(board.id)
    // Picked up by its title chip, the board takes the Drawing and its stroke along.
    a.press({ x: 30, y: 0 })
    a.drag({ x: 30, y: 1000 })
    a.release({ x: 30, y: 1000 })
    const y = (id: string) => a.elements().find((e) => e.id === id)!.y
    expect(y(board.id)).toBe(1000)
    expect(y(frame.id)).toBeGreaterThan(1000)
    expect(y(stroke.id)).toBeGreaterThan(1000)
  })
})
