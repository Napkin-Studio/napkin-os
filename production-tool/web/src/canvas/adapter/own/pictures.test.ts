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
