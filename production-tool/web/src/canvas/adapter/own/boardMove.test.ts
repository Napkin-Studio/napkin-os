// @vitest-environment happy-dom
// Moving boards on the own engine (features/board-move.clan; ui-behaviour 3.2 "Moving a board", 8):
// the cursor says what a press would do, arrow keys nudge as one step (never from a text field), a
// finger's tap selects and its long press grabs only what a press would pick up, and the board's
// title chip is the engine's one rect.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { boardTitleRect } from '../../../../../canvas-engine/src'
import { newId } from '../../../lib/ulid'
import { NUDGE_IDLE_MS, OwnAdapter } from './adapter'
import { ownEngine } from './engine'

vi.mock('../../../lib/idb', () => ({ idbPut: async () => {}, idbGet: async () => undefined }))

function setup() {
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  a.setActiveTool({ type: 'native', id: 'selection' })
  const board = a.board({ x: 0, y: 0, width: 400, height: 300, title: 'Characters', boardId: newId('board'), purpose: 'character' })
  const pic = a.patch(a.imageNode({ x: 50, y: 60, width: 100, height: 80, assetSha: 'sha256:' + '0'.repeat(64), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: 'sha256:' + '0'.repeat(64) } }), { frameId: board.id })
  a.transact(() => [board, pic], { undoable: false })
  const at = (id: string) => a.elements().find((e) => e.id === id)!
  return { a, board, pic, at }
}

afterEach(() => vi.useRealTimers())

describe('board-move on the own engine', () => {
  it('the cursor: grab on the chip and edge, nothing on an unselected inside, grab inside once selected, resize on handles, grabbing while moving', () => {
    const { a, board } = setup()
    const chip = boardTitleRect({ x: 0, y: 0, w: 400, h: 300, props: { name: 'Characters' } }, 1)
    expect(a.cursorAt({ x: chip.x + 5, y: chip.y + 5 })).toBe('grab')
    expect(a.cursorAt({ x: 2, y: 150 })).toBe('grab')
    expect(a.cursorAt({ x: 300, y: 200 })).toBe('')
    a.select([board.id])
    expect(a.cursorAt({ x: 300, y: 200 })).toBe('grab')
    expect(a.cursorAt({ x: 400, y: 300 })).toBe('nwse-resize')
    a.press({ x: 300, y: 200 })
    a.drag({ x: 320, y: 200 })
    expect(a.cursorAt({ x: 320, y: 200 })).toBe('grabbing')
    a.release({ x: 320, y: 200 })
  })

  it('arrow nudges are screen pixels, one step written after the idle time, and undo takes the run back', () => {
    vi.useFakeTimers()
    const { a, board, pic, at } = setup()
    a.setViewport({ zoom: 0.5 })
    a.select([board.id])
    for (let i = 0; i < 3; i++) a.nudge(10, 0)
    expect(at(board.id).x).toBe(0)
    vi.advanceTimersByTime(NUDGE_IDLE_MS + 1)
    expect([at(board.id).x, at(pic.id).x]).toEqual([60, 110])
    expect(a.undo.depth().undo).toBe(1)
    a.nudge(0, 2)
    // Undo writes the waiting nudge first, then takes it back: one step each.
    a.undoScene('undo')
    expect([at(board.id).x, at(board.id).y]).toEqual([60, 0])
    a.undoScene('undo')
    expect(at(board.id).x).toBe(0)
  })

  it('a tool change and a press write a waiting nudge at once', () => {
    const { a, pic, at } = setup()
    a.select([pic.id])
    a.nudge(5, 0)
    a.setActiveTool({ type: 'native', id: 'hand' })
    expect(at(pic.id).x).toBe(55)
    a.setActiveTool({ type: 'native', id: 'selection' })
    a.nudge(5, 0)
    a.press({ x: 5000, y: 5000 })
    expect(at(pic.id).x).toBe(60)
  })

  it('a tap selects what is under it, as a click: the board from its inside, nothing from empty canvas', () => {
    const { a, board } = setup()
    a.tap({ x: 300, y: 200 })
    expect(a.view().selectedIds).toEqual([board.id])
    a.tap({ x: 3000, y: 3000 })
    expect(a.view().selectedIds).toEqual([])
  })

  it('a finger’s long press grabs only what a press would pick up (viewport points)', () => {
    const { a, board } = setup()
    expect(a.canGrab(30, 0)).toBe(true)
    expect(a.canGrab(300, 200)).toBe(false)
    a.select([board.id])
    expect(a.canGrab(300, 200)).toBe(true)
    a.setActiveTool({ type: 'native', id: 'hand' })
    expect(a.canGrab(30, 0)).toBe(false)
  })
})

describe('arrow keys on the mounted canvas', () => {
  it('nudge the selection, and never while a text field has the keys', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const a = (await ownEngine.mount(host, { initial: null, onChange: () => {}, theme: 'light' })) as OwnAdapter
    const pic = a.imageNode({ x: 0, y: 0, width: 100, height: 80, assetSha: 'sha256:' + '0'.repeat(64), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: 'sha256:' + '0'.repeat(64) } })
    a.transact(() => [pic], { undoable: false })
    a.select([pic.id])
    const field = document.createElement('textarea')
    host.appendChild(field)
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    vi.advanceTimersByTime(NUDGE_IDLE_MS + 1)
    expect(a.elements()[0].y).toBe(0)
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }))
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    vi.advanceTimersByTime(NUDGE_IDLE_MS + 1)
    const z = a.view().zoom
    expect(a.elements()[0].y).toBeCloseTo(10 / z)
    expect(a.elements()[0].x).toBeCloseTo(1 / z)
    a.destroy()
  })
})
