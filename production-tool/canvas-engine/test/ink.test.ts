// The ink tools (features/engine-ink.clan): one undoable step per stroke, written
// once with its points; highlighter; eraser in one step; ink groups by time and
// distance; z on top.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { GROUP_MS, GROUP_PX, HIGHLIGHTER, Ink } from '../src/ink/ink'
import { decodePoints } from '../src/model/points'
import { element } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { zBetween, zKeys, zTop } from '../src/model/z'

function setup() {
  const scene = new SceneStore(new Y.Doc())
  let t = 0
  let n = 0
  const ink = new Ink(scene, { now: () => t, newId: (p) => `${p}${++n}` })
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  return { scene, ink, steps, at: (ms: number) => (t = ms) }
}

const line = (x0: number, y0: number, x1: number, y1: number, k = 10) =>
  Array.from({ length: k + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / k, y: y0 + ((y1 - y0) * i) / k, pressure: 0.5 + i / (4 * k) }))

function draw(ink: Ink, pts: ReturnType<typeof line>, tool: 'pen' | 'highlighter' | 'eraser' = 'pen') {
  ink.begin(tool, pts[0], { color: '#1e1e1e', width: 3 })
  ink.add(pts.slice(1, 5))
  ink.add(pts.slice(5))
  return ink.end()
}

describe('Ink', () => {
  it('a stroke is one step, at its top-left, with its points written once', () => {
    const { scene, ink, steps } = setup()
    const pts = line(100, 200, 160, 180)
    ink.begin('pen', pts[0], { color: '#a33b2b', width: 4 })
    ink.add(pts.slice(1))
    expect(ink.live()?.points).toHaveLength(pts.length)
    expect(scene.all()).toEqual([])
    const r = ink.end()!
    expect(steps).toHaveLength(1)
    expect([r.x, r.y, r.w, r.h]).toEqual([100, 180, 60, 20])
    expect(r.style).toEqual({ stroke: '#a33b2b', width: 4 })
    const back = decodePoints(scene.points(r.id)!, { x: r.x, y: r.y })
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(pts[i].x, 1)
      expect(p.y).toBeCloseTo(pts[i].y, 1)
    })
    expect(ink.live()).toBeNull()
  })

  it('new strokes go on top', () => {
    const { scene, ink } = setup()
    scene.seed([element({ id: 'b', kind: 'shape', z: 'a5', props: { geo: 'rect' } })])
    const r = draw(ink, line(0, 0, 10, 10))!
    expect(r.z > 'a5').toBe(true)
  })

  it('a highlighter is translucent and keeps the width it is given (the pen options offer three)', () => {
    const { ink } = setup()
    const r = draw(ink, line(0, 0, 50, 0), 'highlighter')!
    expect(r.opacity).toBe(HIGHLIGHTER.opacity)
    expect(r.style.width).toBe(3)
    expect(r.props.tool).toBe('highlighter')
    ink.begin('highlighter', { x: 0, y: 0, pressure: 0.5 }, { color: 'amber', width: 0 })
    ink.add([{ x: 40, y: 0, pressure: 0.5 }])
    expect(ink.end()!.style).toEqual({ stroke: 'amber', width: HIGHLIGHTER.width })
  })

  it('a stroke keeps its ink name, so it is redrawn in each theme\'s value', () => {
    const { ink } = setup()
    ink.begin('pen', { x: 0, y: 0, pressure: 0.5 }, { color: 'ink', width: 4 })
    ink.add([{ x: 30, y: 10, pressure: 0.5 }])
    expect(ink.end()!.style.stroke).toBe('ink')
  })

  it('strokes close in time and space share a group; far or late ones do not', () => {
    const { scene, ink, at } = setup()
    at(0)
    const a = draw(ink, line(0, 0, 40, 0))!
    at(GROUP_MS - 100)
    const b = draw(ink, line(60, 0, 100, 0))!
    const group = scene.get(b.id)!.groupIds[0]
    expect(group).toBeDefined()
    expect(scene.get(a.id)!.groupIds).toEqual([group])
    at(GROUP_MS * 3)
    const c = draw(ink, line(120, 0, 160, 0))!
    expect(c.groupIds).toEqual([])
    at(GROUP_MS * 3 + 100)
    const d = draw(ink, line(160 + GROUP_PX + 50, 0, 400, 0))!
    expect(d.groupIds).toEqual([])
  })

  it('the eraser removes what its path crosses, between samples too, in one step', () => {
    const { scene, ink, steps } = setup()
    const a = draw(ink, line(0, 0, 100, 0))!
    const b = draw(ink, line(0, 100, 100, 100))!
    const c = draw(ink, line(0, 300, 100, 300))!
    const before = steps.length
    // Two samples far apart: the path between them crosses both a and b.
    ink.begin('eraser', { x: 50, y: -20, pressure: 0.5 }, { color: '', width: 0 })
    ink.add([{ x: 50, y: 120, pressure: 0.5 }])
    expect([...ink.marked()].sort()).toEqual([a.id, b.id].sort())
    expect(ink.end()).toBeNull()
    expect(steps.length).toBe(before + 1)
    expect(scene.all().map((r) => r.id)).toEqual([c.id])
  })

  it('a cancelled stroke writes nothing', () => {
    const { scene, ink } = setup()
    ink.begin('pen', { x: 0, y: 0, pressure: 0.5 }, { color: '#000', width: 2 })
    ink.add([{ x: 5, y: 5, pressure: 0.5 }])
    ink.cancel()
    expect(ink.end()).toBeNull()
    expect(scene.all()).toEqual([])
  })
})

describe('z keys', () => {
  it('make keys between, in order, and on top, even next to keys that are not fractional indices', () => {
    const ks = zKeys(5)
    expect([...ks].sort()).toEqual(ks)
    const mid = zBetween(ks[1], ks[2])
    expect(mid > ks[1] && mid < ks[2]).toBe(true)
    expect(zTop(['a000005', 'a000009']) > 'a000009').toBe(true)
    expect(zBetween('a000005', 'a000009') > 'a000005' && zBetween('a000005', 'a000009') < 'a000009').toBe(true)
  })

  it('the eraser hits a sparse stroke mid-segment, far from its points (container-select phase 1)', () => {
    const { scene, ink } = setup()
    // Two points 300 px apart: the eraser crosses the middle, nowhere near either.
    draw(ink, line(0, 100, 300, 100, 1))
    expect(scene.all().filter((r) => r.kind === 'stroke')).toHaveLength(1)
    ink.begin('eraser', { x: 150, y: 90, pressure: 0.5 }, { color: '#000', width: 1 })
    ink.add([{ x: 150, y: 104, pressure: 0.5 }])
    ink.end()
    expect(scene.all().filter((r) => r.kind === 'stroke')).toHaveLength(0)
  })
})
