// The sketch area tool (features/canvas-edit-tools.clan; ui-behaviour 3.7): the
// ghost and the area keep the next area's ratio whichever way the drag goes.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { SceneStore, type Step } from '../src/model/store'
import { lockedRect, SketchTool } from '../src/select/sketchTool'

const setup = () => {
  const scene = new SceneStore(new Y.Doc())
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  let n = 0
  return { scene, steps, tool: new SketchTool(scene, { newId: (p) => `${p}_${++n}` }) }
}

describe('SketchTool', () => {
  it('locks the box to the ratio, led by the longer way, in every direction', () => {
    expect(lockedRect({ x: 0, y: 0 }, { x: 160, y: 10 }, 16 / 9)).toEqual({ x: 0, y: 0, w: 160, h: 90 })
    expect(lockedRect({ x: 0, y: 0 }, { x: 10, y: 90 }, 16 / 9)).toEqual({ x: 0, y: 0, w: 160, h: 90 })
    const up = lockedRect({ x: 100, y: 100 }, { x: 60, y: 0 }, 9 / 16)
    expect(up).toEqual({ x: 100 - 56.25, y: 0, w: 56.25, h: 100 })
  })

  it('draws a ghost while dragging and writes one white area at its ratio, as one step', () => {
    const { scene, steps, tool } = setup()
    tool.ratio = '4:5'
    tool.press({ x: 10, y: 10 })
    tool.drag({ x: 90, y: 30 })
    expect(tool.ghost).toEqual({ x: 10, y: 10, w: 80, h: 100, ratio: '4:5' })
    expect(scene.all()).toHaveLength(0)
    const r = tool.release({ x: 90, y: 30 })!
    expect(steps).toHaveLength(1)
    expect(r).toMatchObject({ kind: 'sketch', x: 10, y: 10, w: 80, h: 100, props: { ratio: '4:5' }, style: { fill: '#ffffff' }, customData: { kind: 'sketch', id: 'sketch_2' } })
    expect(tool.ghost).toBeNull()
  })

  it('a click draws nothing', () => {
    const { scene, tool } = setup()
    tool.press({ x: 10, y: 10 })
    expect(tool.release({ x: 14, y: 12 })).toBeNull()
    expect(scene.all()).toHaveLength(0)
  })
})
