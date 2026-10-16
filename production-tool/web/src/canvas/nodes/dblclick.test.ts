// The double-click rule on pictures (features/edit-canvas-pictures.clan): a picture on its own opens; a
// group's picture opens once it is selected alone (the first double-click picks it out); never a drawing.
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
  it('opens a picture on its own, selected alone or with others', () => {
    expect(pictureToOpen(els, ['e1'], { x: 50, y: 50 })).toEqual({ el: 'e1', node: 'node_a' })
    expect(pictureToOpen(els, ['e1', 'e3'], { x: 50, y: 50 })).toEqual({ el: 'e1', node: 'node_a' })
  })
  it('in a group: the canvas picks the view out first (the group was selected), then it opens', () => {
    expect(pictureToOpen(els, ['e2', 'e4'], { x: 250, y: 50 })).toBeNull()
    expect(pictureToOpen(els, ['e2'], { x: 250, y: 50 })).toEqual({ el: 'e2', node: 'job_b' })
  })
  it('the topmost thing there decides: a picture under something else, a drawing, a result still being made do not open', () => {
    const over = { ...el('e9', undefined, 0), type: 'rectangle' } as CanvasElement
    expect(pictureToOpen([pic, over], ['e1'], { x: 50, y: 50 })).toBeNull()
    expect(pictureToOpen(els, ['e3'], { x: 650, y: 50 })).toBeNull()
    expect(pictureToOpen(els, [], { x: 150, y: 50 })).toBeNull()
    expect(editablePicture(el('e5', { kind: 'gen', id: 'job_x', op: 'generate', parentIds: [], state: 'running' }))).toBeNull()
  })
})
