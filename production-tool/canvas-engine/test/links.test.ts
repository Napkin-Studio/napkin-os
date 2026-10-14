// Links between nodes (features/canvas-nodes.clan): drawn between their ends'
// edges wherever the ends are, quiet until an end is selected, never culled,
// and hit by the node layer's test along with the nodes.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { boundEnds, hitNodeOrLink, linkSegment } from '../src/render/links'
import { Renderer, type DrawContext } from '../src/render/renderer'
import { recordsFromElements, elementFromRecord } from '../src/model/elements'

const node = (id: string, x: number, y: number, kind: string) => element({ id, kind: 'node', z: `a${x}${y}`, x, y, w: 300, h: 200, props: { nodeKind: kind }, customData: { kind, id: `${kind}_1` } })
const link = (id: string, from: string, to: string, role: string) => element({ id, kind: 'link', z: 'b0', props: { start: { elementId: from }, end: { elementId: to }, route: [], role }, customData: { kind: 'link', id: `link_${id}` } })

function setup() {
  const scene = new SceneStore(new Y.Doc())
  scene.seed([node('s', 0, 0, 'script'), node('b', 0, 400, 'storyboard'), node('v', 500, 400, 'video'), link('l1', 's', 'b', 'drives'), link('l2', 'b', 'v', 'renders')])
  return scene
}

/** A context that records the line segments and the alpha they were drawn at. */
function recorder() {
  const lines: { from: number[]; to: number[]; alpha: number }[] = []
  let at: number[] = [0, 0]
  const ctx = new Proxy({ globalAlpha: 1, lineWidth: 1, font: '', fillStyle: '', strokeStyle: '' } as Record<string, unknown>, {
    get(t, k) {
      if (k in t) return t[k as string]
      if (k === 'moveTo') return (x: number, y: number) => { at = [x, y] }
      if (k === 'lineTo') return (x: number, y: number) => { lines.push({ from: at, to: [x, y], alpha: t.globalAlpha as number }); at = [x, y] }
      return () => {}
    },
  })
  return { ctx: ctx as unknown as DrawContext, lines }
}

describe('links', () => {
  it('run from the source’s output edge to the target’s input edge: below goes bottom to top, beside goes right to left', () => {
    const s = setup()
    const get = (id: string) => s.get(id)
    const e1 = boundEnds(get, s.get('l1')!)!
    expect(linkSegment(e1.from, e1.to)).toEqual({ a: { x: 150, y: 200 }, b: { x: 150, y: 400 } })
    const e2 = boundEnds(get, s.get('l2')!)!
    expect(linkSegment(e2.from, e2.to)).toEqual({ a: { x: 300, y: 500 }, b: { x: 500, y: 500 } })
  })

  it('follow a moved node, and are quiet until an end is selected', () => {
    const s = setup()
    const r = new Renderer(s, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
    s.change((tx) => tx.put([{ ...tx.get('v')!, x: 900, y: 1000 } as ElementRecord]))
    const quiet = recorder()
    r.draw(quiet.ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 100, height: 100 }, 1)
    // The link to the moved video is drawn though its own box is off screen, at 0.3.
    expect(quiet.lines.some((l) => l.to[0] === 900 && l.to[1] === 1000 + 100)).toBe(true)
    expect(quiet.lines.find((l) => l.to[0] === 900)!.alpha).toBe(0.3)
    r.selected = new Set(['v'])
    const lit = recorder()
    r.draw(lit.ctx, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 100, height: 100 }, 1)
    expect(lit.lines.find((l) => l.to[0] === 900)!.alpha).toBe(1)
  })

  it('a node is hit before what is under it, and a link along its line', () => {
    const s = setup()
    expect(hitNodeOrLink(s, { x: 10, y: 10 }, 1)?.id).toBe('s')
    expect(hitNodeOrLink(s, { x: 153, y: 300 }, 1)?.id).toBe('l1')
    expect(hitNodeOrLink(s, { x: 400, y: 300 }, 1)).toBeUndefined()
  })

  it('a link keeps its role through the element view', () => {
    const s = setup()
    const el = elementFromRecord(s.get('l1')!)
    expect(el.role).toBe('drives')
    const { records } = recordsFromElements([elementFromRecord(s.get('s')!), elementFromRecord(s.get('b')!), el], (id) => s.get(id))
    expect(records.find((r) => r.id === 'l1')!.props).toMatchObject({ role: 'drives', start: { elementId: 's' }, end: { elementId: 'b' } })
  })
})
