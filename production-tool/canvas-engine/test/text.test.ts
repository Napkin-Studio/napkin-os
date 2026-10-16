// The text tool (features/canvas-text.clan): an edit session is one write, so one
// undo step; an empty box leaves nothing; a text is hit, scaled (its font with
// it), moved and deleted with the sketch area it sits in, and joins a board as
// strokes do.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore, type Step } from '../src/model/store'
import { Renderer, type DrawContext } from '../src/render/renderer'
import { SelectTool } from '../src/select/select'
import { SceneUndo } from '../src/undo/sceneUndo'
import { LINE_HEIGHT, TEXT_SIZES, TextTool, textBox } from '../src/text/text'
import { boundEnds, linkRoute, sceneLinkEnv } from '../src/render/links'

const measure = (line: string, size: number) => line.length * size * 0.5

function setup(records: ElementRecord[] = []) {
  const scene = new SceneStore(new Y.Doc())
  if (records.length) scene.seed(records)
  const steps: Step[] = []
  scene.onStep((s) => steps.push(s))
  const undo = new SceneUndo(scene)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  let n = 0
  const text = new TextTool(scene, { newId: (p) => `${p}_${++n}`, measure })
  const select = new SelectTool(scene, (x, y) => r.hit(x, y))
  return { scene, steps, undo, r, text, select }
}

const written = (id: string, plain: string, x = 0, y = 0, extra: Partial<ElementRecord> = {}) =>
  element({ id, kind: 'text', z: `b${id}`, x, y, ...textBox(plain, 24, measure), style: { stroke: 'ink', fontSize: 24, fontFamily: 'Geist' }, props: { plain }, ...extra })

describe('TextTool', () => {
  it('a click and typing write one text, centred on the click, measured at its size, as one step', () => {
    const { scene, steps, text } = setup()
    text.look = { size: TEXT_SIZES.large, color: 'orange' }
    const s = text.begin({ x: 100, y: 200 })
    expect(s).toMatchObject({ fresh: true, x: 100, y: 200 - (36 * LINE_HEIGHT) / 2, look: { size: 36, color: 'orange' } })
    expect(scene.all()).toHaveLength(0)
    const r = text.commit('Hello\nworld!\n\n')!
    expect(steps).toHaveLength(1)
    expect(r).toMatchObject({ kind: 'text', x: 100, w: 6 * 36 * 0.5, h: 2 * 36 * LINE_HEIGHT, style: { stroke: 'orange', fontSize: 36 }, props: { plain: 'Hello\nworld!' } })
    expect(r.props.doc).toMatchObject({ type: 'doc' })
    expect(text.session).toBeNull()
  })

  it('an empty box writes nothing', () => {
    const { scene, steps, text } = setup()
    text.begin({ x: 0, y: 0 })
    expect(text.commit('  \n ')).toBeNull()
    expect(scene.all()).toHaveLength(0)
    expect(steps).toHaveLength(0)
  })

  it('editing a text is one step however much was typed; undo puts the old words back', () => {
    const { scene, steps, undo, text } = setup([written('t', 'Rain')])
    expect(text.edit('t')).toMatchObject({ fresh: false, plain: 'Rain', look: { size: 24, color: 'ink' } })
    text.restyleSession({ size: TEXT_SIZES.small })
    text.commit('Rain on the window')
    expect(steps).toHaveLength(1)
    expect(scene.get('t')).toMatchObject({ w: 18 * 16 * 0.5, style: { fontSize: 16 }, props: { plain: 'Rain on the window' } })
    undo.undo()
    expect(scene.get('t')).toMatchObject({ style: { fontSize: 24 }, props: { plain: 'Rain' } })
  })

  it('an unchanged edit writes nothing; an emptied text is removed in one step, and undo brings it back', () => {
    const { scene, steps, undo, text } = setup([written('t', 'Rain')])
    text.edit('t')
    text.commit('Rain')
    expect(steps).toHaveLength(0)
    text.edit('t')
    text.commit('')
    expect(scene.get('t')).toBeUndefined()
    expect(steps).toHaveLength(1)
    undo.undo()
    expect(scene.get('t')?.props.plain).toBe('Rain')
  })

  it('a locked text, or something that is not a text, is not edited', () => {
    const { text } = setup([written('t', 'Rain', 0, 0, { locked: true }), element({ id: 's', kind: 'shape', z: 'c', w: 10, h: 10 })])
    expect(text.edit('t')).toBeNull()
    expect(text.edit('s')).toBeNull()
  })

  it('restyles selected texts as one step, re-measuring them', () => {
    const { scene, steps, text } = setup([written('a', 'one'), written('b', 'three', 0, 100), element({ id: 's', kind: 'shape', z: 'c', w: 10, h: 10 })])
    expect(text.restyle(['a', 'b', 's'], { size: 36, color: '#ff0000' })).toBe(2)
    expect(steps).toHaveLength(1)
    expect(scene.get('b')).toMatchObject({ w: 5 * 36 * 0.5, h: 36 * LINE_HEIGHT, style: { fontSize: 36, stroke: '#ff0000' } })
  })
})

describe('a text on the canvas', () => {
  it('is hit inside its box and selected by a click', () => {
    const { select, r } = setup([written('t', 'Hello', 50, 50)])
    expect(r.hit(60, 60)?.id).toBe('t')
    select.press({ x: 60, y: 60 })
    select.release({ x: 60, y: 60 })
    expect([...select.selected]).toEqual(['t'])
  })

  it('the corner handles scale its font with its box', () => {
    const { scene, select } = setup([written('t', 'Hello', 0, 0)])
    select.set(['t'])
    const { box } = select.frame()!
    select.press({ x: box.x + box.w + 6, y: box.y + box.h + 6 }, { zoom: 1 })
    select.release({ x: box.w * 2, y: box.h * 2 })
    const t = scene.get('t')!
    expect(t.style.fontSize).toBe(48)
    expect(t.w).toBeCloseTo(box.w * 2)
  })

  it('moves and goes with the sketch area it is written in', () => {
    const area = element({ id: 'A', kind: 'sketch', z: 'a1', x: 0, y: 0, w: 320, h: 180, style: { fill: '#ffffff' }, props: { ratio: '16:9' }, customData: { kind: 'sketch', id: 'sketch_1' } })
    const { scene, select, undo } = setup([area, written('t', 'a man runs', 20, 20), written('far', 'elsewhere', 1000, 1000)])
    select.set(['A'])
    select.press({ x: 300, y: 170 })
    select.release({ x: 400, y: 270 })
    expect([scene.get('t')!.x, scene.get('t')!.y]).toEqual([120, 120])
    expect(scene.get('far')!.x).toBe(1000)
    select.set(['A'])
    expect(select.deleteSelected()).toBe(2)
    expect(scene.get('t')).toBeUndefined()
    undo.undo()
    expect(scene.get('t')).toBeDefined()
  })

  it('joins a board when dropped on it, as a stroke does', () => {
    const board = element({ id: 'B', kind: 'board', z: 'a0', x: 0, y: 0, w: 600, h: 400, props: { name: 'Shots', purpose: 'storyboard' } })
    const { scene, select } = setup([board, written('t', 'note', 1000, 50)])
    select.press({ x: 1005, y: 55 })
    select.release({ x: 105, y: 105 })
    expect(scene.get('t')!.parentId).toBe('B')
  })

  it('is not drawn while it is being edited (the editor shows it)', () => {
    const { r } = setup([written('t', 'Hello', 0, 0)])
    const said: string[] = []
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'fillText' ? (s: string) => said.push(s) : () => {}) }) as unknown as DrawContext
    r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1)
    expect(said).toEqual(['Hello'])
    said.length = 0
    r.editing = 't'
    r.draw(ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }, 1)
    expect(said).toEqual([])
  })
})

describe('a text as a link end (owner 2026-10-16)', () => {
  it('a link bound to a text routes from the text\'s edge, and goes undrawn once the text is gone', () => {
    const node = element({ id: 'N', kind: 'node', z: 'a1', x: 600, y: 0, w: 300, h: 200 })
    const link = element({ id: 'L', kind: 'link', z: 'a2', props: { start: { elementId: 't' }, end: { elementId: 'N' }, role: 'note' } })
    const { scene, select } = setup([written('t', 'Rain', 0, 80), node, link])
    const env = sceneLinkEnv(scene)
    const route = linkRoute(env, scene.get('L')!)!
    const t = scene.get('t')!
    expect(route.pts[0]).toEqual({ x: t.x + t.w, y: t.y + t.h / 2 })
    expect(route.pts.at(-1)!.x).toBe(600)
    select.set(['t'])
    select.deleteSelected()
    expect(boundEnds((id) => scene.get(id), scene.get('L')!)).toBeNull()
  })
})
