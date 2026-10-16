// Grouping on the own engine (features/canvas-edit-tools.clan; ui-behaviour 3.8, 7):
// groupIds run innermost to outermost (as Excalidraw's, the import and core/nodes.ts
// groupOf read them); Ctrl+G adds an outermost group, Ctrl+Shift+G takes it off, each
// one step of the person's undo, and a click selects the whole outermost group.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodePoints } from '../src/model/points'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { SelectTool } from '../src/select/select'
import { SceneUndo } from '../src/undo/sceneUndo'

function setup(records: ElementRecord[], points: Record<string, Uint8Array> = {}) {
  const scene = new SceneStore(new Y.Doc())
  scene.seed(records, points)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  let n = 0
  const tool = new SelectTool(scene, (x, y) => r.hit(x, y), { newId: () => `g${++n}` })
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  return { scene, tool, steps, undo: new SceneUndo(scene) }
}

// Filled, so a click anywhere inside hits it (an unfilled shape is hit only on its outline: hitStroke.test.ts).
const box = (id: string, x: number, extra: Partial<ElementRecord> = {}) => element({ id, kind: 'shape', z: `a${x / 100}`, x, y: 0, w: 50, h: 50, style: { fill: '#dddddd' }, props: { geo: 'rect' }, ...extra })
const click = (tool: SelectTool, x: number, y = 10, shift = false) => {
  tool.press({ x, y }, { shift })
  tool.release({ x, y })
}

describe('groups', () => {
  it('a click selects the whole outermost group (the last group id), not just the innermost', () => {
    // a and b are an ink group (i) inside a person's group (o) with c.
    const { tool } = setup([box('a', 0, { groupIds: ['i', 'o'] }), box('b', 100, { groupIds: ['i', 'o'] }), box('c', 200, { groupIds: ['o'] }), box('d', 300)])
    click(tool, 210)
    expect([...tool.selected].sort()).toEqual(['a', 'b', 'c'])
    click(tool, 10)
    expect([...tool.selected].sort()).toEqual(['a', 'b', 'c'])
  })

  it('Group adds one outermost group to the selection, as one step; a click then takes them all', () => {
    const { scene, tool, steps } = setup([box('a', 0, { groupIds: ['i'] }), box('b', 100, { groupIds: ['i'] }), box('c', 200), box('d', 300)])
    tool.set(['a', 'b', 'c'])
    expect(tool.group()).toBe('g1')
    expect(steps).toHaveLength(1)
    expect(scene.get('a')!.groupIds).toEqual(['i', 'g1'])
    expect(scene.get('c')!.groupIds).toEqual(['g1'])
    expect(scene.get('d')!.groupIds).toEqual([])
    click(tool, 210)
    expect([...tool.selected].sort()).toEqual(['a', 'b', 'c'])
  })

  it('Group needs two or more things; one group alone is already one', () => {
    const { tool, steps } = setup([box('a', 0, { groupIds: ['i'] }), box('b', 100, { groupIds: ['i'] }), box('c', 200)])
    tool.set(['c'])
    expect(tool.group()).toBeNull()
    tool.set(['a', 'b'])
    expect(tool.group()).toBeNull()
    expect(steps).toHaveLength(0)
  })

  it('Ungroup takes off the outermost group only, as one step, and keeps the selection', () => {
    const { scene, tool, steps } = setup([box('a', 0, { groupIds: ['i', 'o'] }), box('b', 100, { groupIds: ['i', 'o'] }), box('c', 200, { groupIds: ['o'] })])
    click(tool, 210)
    expect(tool.ungroup()).toBe(true)
    expect(steps).toHaveLength(1)
    expect(scene.get('a')!.groupIds).toEqual(['i'])
    expect(scene.get('c')!.groupIds).toEqual([])
    expect([...tool.selected].sort()).toEqual(['a', 'b', 'c'])
    // Now a click on a takes its ink group only.
    click(tool, 600, 600)
    click(tool, 10)
    expect([...tool.selected].sort()).toEqual(['a', 'b'])
    expect(tool.ungroup()).toBe(true)
    expect(scene.get('a')!.groupIds).toEqual([])
    expect(tool.ungroup()).toBe(false)
  })

  it('group and ungroup are undone as the person’s steps', () => {
    const { scene, tool, undo } = setup([box('a', 0), box('b', 100)])
    tool.set(['a', 'b'])
    tool.group()
    undo.undo()
    expect(scene.get('a')!.groupIds).toEqual([])
    undo.redo()
    expect(scene.get('b')!.groupIds).toEqual(['g1'])
  })

  it('locked elements are not regrouped', () => {
    const { scene, tool } = setup([box('a', 0), box('b', 100), box('c', 200, { locked: true })])
    tool.set(['a', 'b', 'c'])
    tool.group()
    expect(scene.get('c')!.groupIds).toEqual([])
  })

  it('the selection says what it is: one group (ink when every member is a pen stroke), or several things', () => {
    const stroke = (id: string, x: number, g: string[]) => element({ id, kind: 'stroke', z: `b${x}`, x, y: 0, w: 40, h: 20, groupIds: g, props: { tool: 'pen' } })
    // Each stroke is a line across its box at y = 10, where the click lands (a stroke is hit only near its line).
    // The points span the 40 x 20 box, so the stroke is drawn at scale 1.
    const across = encodePoints([{ x: 0, y: 10, pressure: 0.5 }, { x: 40, y: 10, pressure: 0.5 }, { x: 40, y: 20, pressure: 0.5 }], { x: 0, y: 0 })
    const { tool } = setup([stroke('s1', 0, ['i']), stroke('s2', 50, ['i']), stroke('s3', 100, ['i']), box('c', 300), box('d', 400)], { s1: across, s2: across, s3: across })
    click(tool, 10)
    expect(tool.selectionKind()).toEqual({ kind: 'group', group: 'i', ink: true, count: 3 })
    tool.set(['c'])
    expect(tool.selectionKind()).toEqual({ kind: 'one' })
    tool.set(['c', 'd'])
    expect(tool.selectionKind()).toEqual({ kind: 'several', count: 2 })
    tool.set(['c', 's1', 's2', 's3'])
    expect(tool.selectionKind()).toEqual({ kind: 'several', count: 2 })
    tool.set([])
    expect(tool.selectionKind()).toEqual({ kind: 'none' })
  })
})
