// Pictures on our own engine (ui-behaviour 3.6, 3.18): the Picture tool, a drop and a paste all place
// `pic` nodes, kept by their sha256 with their asset in the document, as one undoable step, selected
// (so the selection bar offers naming them); and the bar's Picture tool is on once the canvas has it.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/fitImage', () => ({ downscale: async (b: Blob) => ({ blob: b, w: 600, h: 400, changed: false }) }))
vi.mock('../../../lib/blobs', () => ({
  putBlob: async (b: Blob) => `sha256:${(await b.text()).padEnd(64, '0').slice(0, 64)}`,
  idbLocation: (sha: string) => ({ kind: 'idb', key: sha }),
}))
vi.mock('../../scene', () => ({ assetData: async (sha: string, b: Blob) => ({ sha256: sha, dataURL: 'data:image/png;base64,AA==', mimeType: b.type }) }))

import { canvasActions } from '../../chrome/actions'
import { BOARD_GAP, BOARD_PAD } from '../../../../../canvas-engine/src'
import { newId } from '../../../lib/ulid'
import { boardNotices } from '../../boards/fitting'
import { imageFiles, pictureRow, placePictures, PICTURE_W } from '../../nodes/pictures'
import { snapshotDoc } from '../../../test/jobFixtures'
import { OwnAdapter } from './adapter'
import { ownChrome } from './chrome'

const png = (s: string) => new Blob([s], { type: 'image/png' })

describe('pictures on the own engine', () => {
  it('places dropped pictures as pic nodes in a row on the point, one undo step, selected, assets in the document', async () => {
    const a = new OwnAdapter()
    a.resize(1200, 800, 0, 0)
    const doc = snapshotDoc()
    const els = await placePictures(a, doc, [png('a'), png('b')], { x: 1000, y: 500 })
    expect(els).toHaveLength(2)
    for (const e of els) {
      expect(e.type).toBe('image')
      expect(e.customData).toMatchObject({ kind: 'pic', asset: expect.stringMatching(/^sha256:/) })
      expect(a.imageOf(e)).toMatchObject({ loaded: true })
      expect(doc.get().assets[(e.customData as { asset: string }).asset]).toMatchObject({ kind: 'image', w: 600, h: 400, origin: 'uploaded' })
    }
    expect(els[0].width).toBe(PICTURE_W)
    expect(els[0].height).toBe(200)
    expect((els[0].x + els[1].x + els[1].width) / 2).toBeCloseTo(1000, 0)
    expect(a.view().selectedIds.sort()).toEqual(els.map((e) => e.id).sort())
    a.undoScene('undo')
    expect(a.elements().filter((e) => e.type === 'image')).toHaveLength(0)
  })

  // Board sizing (owner decision, Shrey 2026-10-15): a board is a space; what is dropped on it fills its
  // rows, and it grows to hold them, down first, never over a neighbour.
  const characters = (a: OwnAdapter, w = 700, h = 300) => {
    const f = a.board({ x: 0, y: 0, width: w, height: h, title: 'Characters', boardId: newId('board'), purpose: 'character' })
    a.transact((all) => [f, ...all], { undoable: false })
    return f
  }
  const frame = (a: OwnAdapter, id: string) => a.elements().find((e) => e.id === id)!

  it('pictures dropped on a board go in, in rows from its top left, and it grows down to hold them, as one undo step', async () => {
    const a = new OwnAdapter()
    a.resize(1200, 800, 0, 0)
    const f = characters(a)
    const doc = snapshotDoc()
    // Five 300 x 200 pictures on a 700-wide board: two to a row (16, 356), three rows.
    const els = await placePictures(a, doc, ['a', 'b', 'c', 'd', 'e'].map(png), { x: 100, y: 100 })
    expect(els.every((e) => e.frameId === f.id)).toBe(true)
    const row1 = BOARD_PAD.top
    const row2 = row1 + 200 + BOARD_GAP
    const row3 = row2 + 200 + BOARD_GAP
    expect(els.map((e) => [e.x, e.y])).toEqual([[16, row1], [16 + 300 + BOARD_GAP, row1], [16, row2], [16 + 300 + BOARD_GAP, row2], [16, row3]])
    const b = frame(a, f.id)
    expect([b.x, b.y, b.width]).toEqual([0, 0, 700])
    expect(b.height).toBe(row3 + 200 + BOARD_PAD.bottom)
    // One step: the pictures and the growth go together.
    a.undoScene('undo')
    expect(a.elements().filter((e) => e.type === 'image')).toHaveLength(0)
    expect(frame(a, f.id).height).toBe(300)
  })

  it('a board hemmed in on every side does not grow over its neighbours: what does not fit lands just outside, on no board, and it says so', async () => {
    const a = new OwnAdapter()
    a.resize(1200, 800, 0, 0)
    const f = characters(a, 700, 300)
    const below = a.board({ x: 0, y: 324, width: 1400, height: 300, title: 'Storyboard', boardId: newId('board'), purpose: 'storyboard' })
    const right = a.board({ x: 724, y: 0, width: 400, height: 300, title: 'Locations', boardId: newId('board'), purpose: 'location' })
    const above = a.board({ x: -400, y: -324, width: 1600, height: 300, title: 'Above', boardId: newId('board'), purpose: 'none' })
    const left = a.board({ x: -424, y: 0, width: 400, height: 300, title: 'Left', boardId: newId('board'), purpose: 'none' })
    a.transact((all) => [below, right, above, left, ...all], { undoable: false })
    const heard: string[] = []
    const off = boardNotices.subscribe((n) => heard.push(n.frameId))
    const els = await placePictures(a, snapshotDoc(), ['a', 'b', 'c'].map(png), { x: 100, y: 100 })
    off()
    expect(els.map((e) => e.frameId ?? null)).toEqual([f.id, f.id, null])
    expect([frame(a, f.id).width, frame(a, f.id).height]).toEqual([700, 300])
    const out = els[2]
    for (const b of [f, below, right, above, left]) {
      const r = frame(a, b.id)
      expect(out.x < r.x + r.width && r.x < out.x + out.width && out.y < r.y + r.height && r.y < out.y + out.height).toBe(false)
    }
    expect(heard).toEqual([f.id])
  })

  it('three pastes with no board under the middle of the view give three disjoint pictures, none over a board edge', async () => {
    const a = new OwnAdapter()
    a.resize(1200, 800, 0, 0)
    const v = a.visibleBounds()
    const mid = { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 }
    // A board just right of the middle: a centred paste would straddle its left edge.
    const side = a.board({ x: mid.x + 60, y: mid.y - 200, width: 420, height: 400, title: 'Characters', boardId: newId('board'), purpose: 'character' })
    a.transact((all) => [side, ...all], { undoable: false })
    const doc = snapshotDoc()
    const got = [
      ...(await placePictures(a, doc, [png('p1')])),
      ...(await placePictures(a, doc, [png('p2')])),
      ...(await placePictures(a, doc, [png('p3')])),
    ]
    const ov = (p: { x: number; y: number; width: number; height: number }, q: typeof p) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height
    for (let i = 0; i < 3; i++) {
      expect(got[i].frameId ?? null).toBeNull()
      expect(ov(got[i], side)).toBe(false)
      for (let j = i + 1; j < 3; j++) expect(ov(got[i], got[j])).toBe(false)
    }
  })

  it('keeps only image files, and lays a row out centred', () => {
    expect(imageFiles([png('x'), new Blob(['t'], { type: 'text/plain' })])).toHaveLength(1)
    const row = pictureRow({ x: 0, y: 0 }, [{ w: 100, h: 100 }, { w: 200, h: 100 }])
    expect(row[0].x).toBe(-(PICTURE_W * 2 + 40) / 2)
    expect(row[1].h).toBe(150)
  })

  it('the bar\'s Picture tool is on once the canvas registers it, and runs it', () => {
    const chrome = ownChrome(new OwnAdapter())
    expect(chrome.supports!('image')).toBe(false)
    let asked = 0
    const off = canvasActions.register({ picture: () => { asked++ } })
    expect(chrome.supports!('image')).toBe(true)
    chrome.setTool('image')
    expect(asked).toBe(1)
    off()
  })
})
