// Containers selected as one thing (features/container-select.clan, phase 2): a click on
// a Drawing's strokes, edge or empty inside selects the Drawing; a double press (mouse,
// pen or touch: within 350 ms and 16 screen px) enters it and picks the member alone;
// Esc leaves it with the container selected; a click outside leaves it; the scope drops
// when the container goes. Sketch areas and groups follow the same rule.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodePoints, type InkPoint } from '../src/model/points'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { Renderer } from '../src/render/renderer'
import { hitBoardTitle } from '../src/render/links'
import { DOUBLE_PRESS_MS, DOUBLE_PRESS_PX, SelectTool } from '../src/select/select'

const pt = (x: number, y: number): InkPoint => ({ x, y, pressure: 0.5 })

/** A vertical stroke at (x, y), `len` tall (its points span its box, so it is drawn at scale 1). */
function stick(id: string, x: number, y: number, len: number, extra: Partial<ElementRecord> = {}) {
  return {
    rec: element({ id, kind: 'stroke', z: `c${id}`, x, y, w: 1, h: len, style: { width: 4 }, props: { tool: 'pen' }, ...extra }),
    pts: encodePoints([pt(0, 0), pt(0, len), pt(1, len)], { x: 0, y: 0 }),
  }
}

function setup(records: ElementRecord[], points: Record<string, Uint8Array> = {}) {
  const scene = new SceneStore(new Y.Doc())
  scene.seed(records, points)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  let t = 0
  const tool = new SelectTool(scene, (x, y) => hitBoardTitle(scene, { x, y }, 1) ?? r.hit(x, y), { now: () => t })
  /** A click (press and release) at time `at` ms, by a pointer kind. */
  const click = (x: number, y: number, at: number, by: 'mouse' | 'pen' | 'touch' = 'mouse') => {
    t = at
    tool.press({ x, y }, { by, zoom: 1 })
    tool.release({ x, y })
  }
  return { scene, tool, click, sel: () => [...tool.selected].sort() }
}

/** A Drawing: a drawn frame with two stroke members, and a loose picture above part of it. */
function drawing(extra: ElementRecord[] = []) {
  const frame = element({ id: 'D', kind: 'frame', z: 'a1', x: 0, y: 0, w: 300, h: 300, props: { name: 'Drawing' } })
  const s1 = stick('s1', 100, 50, 200, { parentId: 'D' })
  const s2 = stick('s2', 200, 50, 200, { parentId: 'D' })
  return setup([frame, s1.rec, s2.rec, ...extra], { s1: s1.pts, s2: s2.pts })
}

describe('a Drawing is selected as one thing', () => {
  it('a click on a stroke, on the empty inside, or in a stroke’s box off its line selects the Drawing', () => {
    const { click, sel } = drawing()
    click(100, 150, 0)
    expect(sel()).toEqual(['D'])
    click(20, 20, 1000)
    expect(sel()).toEqual(['D'])
    click(110, 150, 2000)
    expect(sel()).toEqual(['D'])
  })

  it('a non-member above the Drawing wins where it lies', () => {
    const pic = element({ id: 'p', kind: 'image', z: 'z9', x: 80, y: 120, w: 60, h: 60, props: { assetSha: null, status: 'saved' } })
    const { click, sel } = drawing([pic])
    click(100, 150, 0)
    expect(sel()).toEqual(['p'])
  })

  it('a drag on the Drawing moves the frame and its strokes together', () => {
    const { scene, tool } = drawing()
    tool.press({ x: 100, y: 150 }, { zoom: 1 })
    tool.release({ x: 140, y: 170 })
    expect(scene.get('D')).toMatchObject({ x: 40, y: 20 })
    expect(scene.get('s1')).toMatchObject({ x: 140, y: 70 })
    expect(scene.get('s2')).toMatchObject({ x: 240, y: 70 })
  })

  it('a double press enters it and picks the stroke; a click then picks another alone; Esc leaves with the Drawing selected', () => {
    const { tool, click, sel } = drawing()
    click(100, 150, 0)
    click(100, 152, 200)
    expect(tool.scope).toBe('D')
    expect(sel()).toEqual(['s1'])
    click(200, 150, 2000)
    expect(sel()).toEqual(['s2'])
    expect(tool.exitScope()).toBe(true)
    expect(tool.scope).toBeNull()
    expect(sel()).toEqual(['D'])
    expect(tool.exitScope()).toBe(false)
  })

  it('a click outside the entered Drawing leaves it and acts as a normal click there', () => {
    const pic = element({ id: 'p', kind: 'image', z: 'z9', x: 500, y: 0, w: 60, h: 60, props: { assetSha: null, status: 'saved' } })
    const { tool, click, sel } = drawing([pic])
    click(100, 150, 0)
    click(100, 150, 100)
    expect(tool.scope).toBe('D')
    click(520, 20, 2000)
    expect(tool.scope).toBeNull()
    expect(sel()).toEqual(['p'])
    // On empty canvas too.
    click(100, 150, 3000)
    click(100, 150, 3100)
    click(900, 900, 5000)
    expect(tool.scope).toBeNull()
    expect(sel()).toEqual([])
  })

  it('a marquee on the empty inside of the entered Drawing selects members only, each alone', () => {
    const { tool, click, sel } = drawing()
    click(100, 150, 0)
    click(100, 150, 100)
    tool.press({ x: 10, y: 10 }, { zoom: 1 })
    tool.release({ x: 290, y: 290 })
    expect(sel()).toEqual(['s1', 's2'])
    expect(tool.scope).toBe('D')
  })

  it('the scope drops when someone else deletes the Drawing', () => {
    const { scene, tool, click } = drawing()
    click(100, 150, 0)
    click(100, 150, 100)
    expect(tool.scope).toBe('D')
    scene.change((tx) => tx.remove(['D']))
    tool.prune()
    expect(tool.scope).toBeNull()
  })

  it('the entered Drawing has an inside outline box', () => {
    const { tool, click } = drawing()
    expect(tool.scopeBox()).toBeNull()
    click(100, 150, 0)
    click(100, 150, 100)
    expect(tool.scopeBox()).toEqual({ x: 0, y: 0, w: 300, h: 300 })
  })

  it('a Drawing and its strokes count as one thing', () => {
    const { tool } = drawing()
    tool.set(['D', 's1', 's2'])
    expect(tool.selectionKind()).toEqual({ kind: 'one' })
  })
})

describe('double press', () => {
  it('needs the same pointer kind, within 350 ms and 16 screen px', () => {
    for (const by of ['mouse', 'pen', 'touch'] as const) {
      const late = drawing()
      late.click(100, 150, 0, by)
      late.click(100, 150, DOUBLE_PRESS_MS + 1, by)
      expect(late.tool.scope).toBeNull()

      const far = drawing()
      far.click(100, 150, 0, by)
      far.click(100, 150 + DOUBLE_PRESS_PX + 1, 100, by)
      expect(far.tool.scope).toBeNull()

      const ok = drawing()
      ok.click(100, 150, 0, by)
      ok.click(100, 150 + DOUBLE_PRESS_PX - 1, DOUBLE_PRESS_MS, by)
      expect(ok.tool.scope).toBe('D')
    }
    const mixed = drawing()
    mixed.click(100, 150, 0, 'mouse')
    mixed.click(100, 150, 100, 'touch')
    expect(mixed.tool.scope).toBeNull()
  })

  it('the distance is in screen pixels: zoomed out, a small scene step is a big one', () => {
    const { tool } = drawing()
    tool.press({ x: 100, y: 100 }, { zoom: 0.25 })
    tool.release({ x: 100, y: 100 })
    // 70 scene px apart at zoom 0.25 is 17.5 screen px: not a double press.
    tool.press({ x: 100, y: 170 }, { zoom: 0.25 })
    tool.release({ x: 100, y: 170 })
    expect(tool.scope).toBeNull()
  })

  it('a double press on a board title is not an enter', () => {
    const board = element({ id: 'B', kind: 'board', z: 'a0', x: 0, y: 0, w: 400, h: 300, props: { name: 'Board', purpose: 'location' } })
    const { tool, click } = setup([board])
    click(20, -10, 0)
    click(20, -10, 100)
    expect(tool.scope).toBeNull()
  })
})

describe('groups and sketch areas follow the same rule', () => {
  it('a group: click takes it whole, a double press one member, Esc gives back the group', () => {
    const box = (id: string, x: number) => element({ id, kind: 'shape', z: `a${id}`, x, y: 0, w: 50, h: 50, style: { fill: '#dddddd' }, groupIds: ['K'], props: { geo: 'rect' } })
    const { tool, click, sel } = setup([box('v1', 0), box('v2', 100)])
    click(10, 10, 0)
    expect(sel()).toEqual(['v1', 'v2'])
    click(10, 10, 100)
    expect(tool.scope).toBe('K')
    expect(sel()).toEqual(['v1'])
    tool.exitScope()
    expect(sel()).toEqual(['v1', 'v2'])
  })

  it('ink inside a sketch area: a click selects the area, a double press edits one stroke', () => {
    const area = element({ id: 'A', kind: 'sketch', z: 'a1', x: 0, y: 0, w: 320, h: 180, style: { fill: '#ffffff' }, props: { ratio: '16:9' }, customData: { kind: 'sketch', id: 'sk_A' } })
    const ink = stick('i1', 100, 20, 120)
    const { tool, click, sel } = setup([area, ink.rec], { i1: ink.pts })
    click(100, 80, 0)
    expect(sel()).toEqual(['A'])
    click(100, 80, 100)
    expect(tool.scope).toBe('A')
    expect(sel()).toEqual(['i1'])
  })
})

describe('labels', () => {
  it('a press on a Drawing’s label takes the Drawing; a board title comes first', async () => {
    const { hitTitle } = await import('../src/render/links')
    const scene = new SceneStore(new Y.Doc())
    scene.seed([
      element({ id: 'D', kind: 'frame', z: 'a1', x: 0, y: 0, w: 300, h: 300, props: { name: 'Drawing' } }),
      element({ id: 'B', kind: 'board', z: 'a0', x: 400, y: 0, w: 300, h: 300, props: { name: 'Shots', purpose: 'location' } }),
    ])
    expect(hitTitle(scene, { x: 10, y: -8 }, 1)?.id).toBe('D')
    // Past the label's width, above the frame: nothing.
    expect(hitTitle(scene, { x: 250, y: -8 }, 1)).toBeUndefined()
    expect(hitTitle(scene, { x: 450, y: -8 }, 1)?.id).toBe('B')
    // Zoomed out, the band is wider in scene units.
    expect(hitTitle(scene, { x: 10, y: -50 }, 0.5)?.id).toBe('D')
  })
})
