// A generation arrow inside a closed pile (owner screenshot 2026-10-15): the arrow from @samurai_front to
// the back view it made is not drawn while both lie in one pile, and its stored box is where the views
// lay when it was made (spread). Nothing about it may live at that "ghost" spot: no hit there, no
// selection handles there; a click on the pile hits a view of the pile.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { hitNodeOrLink } from '../src/render/links'
import { SelectTool } from '../src/select/select'

const view = (id: string, x: number, y: number, z: string, rotation: number, stack: { dx: number; dy: number; angle: number }) =>
  element({ id, kind: 'image', z, x, y, w: 300, h: 400, rotation, groupIds: ['key:samurai'], props: { assetSha: null, status: 'saved', stack } })

function setup() {
  const scene = new SceneStore(new Y.Doc())
  // The pile at (1000, 0); the back view's spread place was far to the left (dx -900).
  const front = view('front', 1000, 0, 'b2', 0.02, { dx: 0, dy: 0, angle: 0 })
  const back = view('back', 1040, 30, 'b1', -0.15, { dx: -900, dy: 40, angle: 0 })
  // Its provenance arrow, stored where it ran when the back view was made: spread, to the left.
  const arrow = element({ id: 'prov', kind: 'arrow', z: 'b3', x: 140, y: 100, w: 1100, h: 300, style: { stroke: '#FF4F2E', dash: 'dashed' },
    customData: { kind: 'provenance', from: 'n_front', to: 'job_back' }, props: { start: { elementId: 'front' }, end: { elementId: 'back' }, route: [] } })
  scene.seed([front, back, arrow] as ElementRecord[])
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  const hit = (x: number, y: number) => hitNodeOrLink(scene, { x, y }, 1) ?? r.hit(x, y)
  return { scene, r, hit, tool: new SelectTool(scene, hit) }
}

describe('nothing of a pile lives at its ghost spot', () => {
  it('the hidden arrow is not hit at its stored box, nor along a line it does not have', () => {
    const { hit } = setup()
    expect(hit(300, 250)).toBeUndefined()
    expect(hit(600, 250)).toBeUndefined()
  })

  it('a click on the pile hits a view of the pile, not the arrow over it', () => {
    const { hit, tool } = setup()
    expect(hit(1150, 200)?.id).toMatch(/^(front|back)$/)
    tool.press({ x: 1150, y: 200 })
    tool.release({ x: 1150, y: 200 })
    expect([...tool.selected].sort()).toEqual(['back', 'front'])
  })

  it('a selected bound arrow gets no handles at its stored box; a view picked in the pile has its frame on the pile', () => {
    const { tool } = setup()
    tool.set(['prov'])
    expect(tool.frame()).toBeNull()
    tool.set(['back'])
    const f = tool.frame()!
    expect(f.box.x).toBeGreaterThan(1000 - 60)
    expect(f.box.y).toBeLessThan(60)
  })
})
