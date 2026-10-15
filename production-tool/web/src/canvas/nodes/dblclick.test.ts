// The double-click rule on pictures (features/edit-canvas-pictures.clan): the one picture selected opens;
// a picture in a group, with the group selected, is the canvas's own (picked out first); drawings never.
import { describe, expect, it } from 'vitest'
import type { CanvasElement } from '../core/canvasAdapter'
import { editablePicture, pictureToOpen } from './dblclick'

const SHA = 'sha256:' + 'a'.repeat(64)
const el = (id: string, customData: unknown, x = 0, groupIds: string[] = []) =>
  ({ id, type: 'image', x, y: 0, width: 100, height: 100, isDeleted: false, frameId: null, groupIds, customData }) as unknown as CanvasElement
const pic = el('e1', { kind: 'pic', id: 'node_a', asset: SHA })
const gen = el('e2', { kind: 'gen', id: 'job_b', op: 'view', parentIds: [], state: 'completed', asset: SHA }, 200, ['g'])
const gen2 = el('e4', { kind: 'gen', id: 'job_c', op: 'view', parentIds: [], state: 'completed', asset: SHA }, 400, ['g'])
const drawn = el('e3', { kind: 'drawn', id: 'node_d', asset: SHA }, 600)
const els = [pic, gen, gen2, drawn]

describe('a double-click on a picture', () => {
  it('opens the one picture selected (a picture on its own is selected by the first click)', () => {
    expect(pictureToOpen(els, ['e1'], { x: 50, y: 50 })).toBe('node_a')
  })
  it('opens a view picked out of its group (the next double-click)', () => {
    expect(pictureToOpen(els, ['e2'], { x: 250, y: 50 })).toBe('job_b')
  })
  it('leaves a group selected to the canvas, which picks the view out', () => {
    expect(pictureToOpen(els, ['e2', 'e4'], { x: 250, y: 50 })).toBeNull()
  })
  it('only where the picture is, and never a drawing or a result still being made', () => {
    expect(pictureToOpen(els, ['e1'], { x: 250, y: 50 })).toBeNull()
    expect(pictureToOpen(els, ['e3'], { x: 650, y: 50 })).toBeNull()
    expect(editablePicture(el('e5', { kind: 'gen', id: 'job_x', op: 'generate', parentIds: [], state: 'running' }))).toBeNull()
  })
})
