// What is in a container goes with it when board sizing places it (owner screenshot 2026-10-15): a drawn
// frame's strokes (frameId) and a sketch area's ink (by geometry) move with the unit fitInto places, as
// one step; the area keeps its size and ratio.

import { describe, expect, it } from 'vitest'
import { newId } from '../../../lib/ulid'
import { fitInto, withFields } from '../../boards/fitting'
import { OwnAdapter } from './adapter'

describe('fitInto moves a container with what is in it', () => {
  it('a drawn frame takes its strokes, a sketch area its ink, and nothing else moves', () => {
    const a = new OwnAdapter()
    const board = a.board({ x: 0, y: 0, width: 900, height: 400, title: 'Samurai', boardId: newId('board'), purpose: 'character' })
    const frame = a.frameAround({ x: 2000, y: 0, width: 112, height: 212, name: 'Drawing', customData: { kind: 'drawn', id: 'n1', asset: 'sha256:' + '0'.repeat(64) } })
    const stroke = { ...a.patch(a.node({ x: 2016, y: 16, width: 80, height: 180, customData: undefined as never }), { frameId: frame.id }), type: 'rectangle', customData: undefined }
    const area = a.sketchArea({ x: 3000, y: 0, w: 320, h: 180, sketchId: 'sketch_1' })
    const ink = { ...a.node({ x: 3100, y: 20, width: 60, height: 60, customData: undefined as never }), type: 'rectangle', customData: undefined }
    const far = { ...a.node({ x: 5000, y: 20, width: 60, height: 60, customData: undefined as never }), type: 'rectangle', customData: undefined }
    a.transact(() => [board, frame, stroke, area, ink, far], { undoable: false })
    const fit = fitInto(a.elements(), board.id, [[frame.id], [area.id]])
    a.transact((all) => withFields(a, all, fit.fields), { undoable: true })
    const at = (id: string) => a.elements().find((e) => e.id === id)!
    expect(at(frame.id).frameId).toBe(board.id)
    expect([at(stroke.id).x - at(frame.id).x, at(stroke.id).y - at(frame.id).y]).toEqual([16, 16])
    expect(at(stroke.id).frameId).toBe(frame.id)
    expect([at(ink.id).x - at(area.id).x, at(ink.id).y - at(area.id).y]).toEqual([100, 20])
    expect([at(area.id).width, at(area.id).height]).toEqual([320, 180])
    expect([at(far.id).x, at(far.id).y]).toEqual([5000, 20])
    a.undoScene('undo')
    expect([at(stroke.id).x, at(ink.id).x]).toEqual([2016, 3100])
  })
})
