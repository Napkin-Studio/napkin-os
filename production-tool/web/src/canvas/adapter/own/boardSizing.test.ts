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
import { elementBounds } from '../../core/geometry'
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
    // Right after its source in its row, a gap apart (the next free slot: BA1).
    expect([gen.x, gen.y]).toEqual([16 + 200 + 40, 22])
    const f = frame()
    expect(f.x + f.width).toBe(gen.x + at.w + 16)
    expect(f.height).toBe(300)
    // The provenance arrow stays bound to both ends.
    const arrow = a.elements().find((e) => (e.customData as { kind?: string } | undefined)?.kind === 'provenance') as Box & { startBinding?: { elementId: string }; endBinding?: { elementId: string } }
    expect([arrow.startBinding?.elementId, arrow.endBinding?.elementId]).toEqual([src.id, gen.id])
  })

  it('a generated picture whose source fills a hemmed-in board (Ad template Characters) lands on that board, growing it up; never above it, outside', () => {
    const { a, board, pic, frame } = setup()
    // The source fills the board; Script to the left, Locations to the right, Storyboard below, each 48 away.
    const src = pic(16, 22, { width: 368, height: 244 })
    const script = a.board({ x: -388, y: 0, width: 340, height: 440, title: 'Script', boardId: newId('board'), purpose: 'script' })
    const locs = a.board({ x: 448, y: 0, width: 420, height: 300, title: 'Locations', boardId: newId('board'), purpose: 'location' })
    const story = a.board({ x: -388, y: 488, width: 1300, height: 236, title: 'Storyboard', boardId: newId('board'), purpose: 'storyboard' })
    a.transact(() => [board, script, locs, story, src], { undoable: false })
    const services = { doc: snapshotDoc(), runner: {}, relay: {}, project: { canvasKey: 'k' }, ui: { get: () => ({ me: { participantId: 'p_1' } }) } } as unknown as Services
    const ctrl = new CanvasController(a, services)
    const id = (src.customData as { id: string }).id
    const at = { x: 16 + 368 + 80, y: 22, w: 200, h: 250 }
    ;(ctrl as unknown as { placeGen: (...args: unknown[]) => void }).placeGen('job_1', 'generate', [id], [{ el: src, id }], at)
    const gen = a.elements().find((e) => e.id === 'job_1')!
    const f = frame()
    expect(gen.frameId).toBe(board.id)
    expect(gen.x >= f.x && gen.y >= f.y && gen.x + gen.width <= f.x + f.width && gen.y + gen.height <= f.y + f.height).toBe(true)
    // Up: the bottom, left and width stay; the source does not move; no neighbour is covered.
    expect([f.x, f.width, f.y + f.height]).toEqual([0, 400, 300])
    expect(f.y).toBeLessThan(0)
    expect(gen.y + gen.height).toBeLessThanOrEqual(22)
    expect([a.elements().find((e) => e.id === src.id)!.x, a.elements().find((e) => e.id === src.id)!.y]).toEqual([16, 22])
    for (const n of [script, locs, story]) expect(overlap(f, n)).toBe(false)
  })

  it('a key\'s other views land in its row after the front, wrapping below it before the board gets too wide; nothing there moves', () => {
    const { a, board, pic, frame } = setup()
    const src = pic(16, 22, { width: 300, height: 375 })
    const loc = a.board({ x: 0, y: 1400, width: 2400, height: 300, title: 'Locations', boardId: newId('board'), purpose: 'location' })
    a.transact(() => [board, src, loc], { undoable: false })
    const services = { doc: snapshotDoc(), runner: {}, relay: {}, project: { canvasKey: 'k' }, ui: { get: () => ({ me: { participantId: 'p_1' } }) } } as unknown as Services
    const ctrl = new CanvasController(a, services) as unknown as { onSourceBoard: (els: unknown[], gen: unknown, source: unknown, after?: unknown) => typeof els }
    let prev: ReturnType<OwnAdapter['elements']>[number] | undefined
    const views: string[] = []
    for (let i = 0; i < 6; i++) {
      const gen = a.patch(a.imageNode({ x: 0, y: 0, width: 300, height: 375, assetSha: null, status: 'saved', customData: { kind: 'gen', id: `job_${i}` } }), {})
      const all = ctrl.onSourceBoard([...a.elements(), gen], gen, src, prev) as ReturnType<OwnAdapter['elements']>
      a.transact(() => all, { undoable: false })
      prev = a.elements().find((e) => e.id === gen.id)
      views.push(gen.id)
    }
    const f = frame()
    const placed = views.map((id) => a.elements().find((e) => e.id === id)!)
    expect(f.width).toBeLessThanOrEqual(1400)
    for (const v of placed) {
      expect(v.frameId).toBe(board.id)
      expect(overlap(v, a.elements().find((e) => e.id === src.id)!)).toBe(false)
    }
    // The first goes right after the front; the row wraps back to the front's left.
    expect([placed[0].x, placed[0].y]).toEqual([16 + 300 + 40, 22])
    const rows = [...new Set(placed.map((v) => v.y))]
    expect(rows.length).toBeGreaterThan(1)
    expect(Math.min(...placed.filter((v) => v.y === rows[1]).map((v) => v.x))).toBe(16)
    const s = a.elements().find((e) => e.id === src.id)!
    expect([s.x, s.y]).toEqual([16, 22])
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false)
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
    // Piled at the board's padding, the turned cards' corners stick out: the board grows to hold them.
    const pile = elementBounds(members())
    const held = frame()
    expect(pile.minX).toBeGreaterThanOrEqual(held.x + 16 - 1e-6)
    expect(pile.minY).toBeGreaterThanOrEqual(held.y + 22 - 1e-6)
    expect(pile.maxX).toBeLessThanOrEqual(held.x + held.width - 16 + 1e-6)
    a.transact((all) => all.map((e) => (e.id === board.id ? a.patch(e, { width: 300 }) : e)), { undoable: false })
    setStacked(a, members(), false)
    const b = frame()
    for (const m of members()) expect(m.x + m.width).toBeLessThanOrEqual(b.x + b.width)
    expect(members().every((m) => m.frameId === board.id)).toBe(true)
    for (const other of a.elements().filter((e) => e.id !== board.id && e.type === 'frame')) expect(overlap(b, other)).toBe(false)
  })
})
