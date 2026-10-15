// Links as the owner asked (Shrey, 2026-10-15; features/canvas-nodes.clan): a key group shows one
// link, attached at the pile's outer bounds; links run under pictures and sketch areas and round
// them, as a gentle curve; a stacked pile's selection frame takes in its turned corners; ink over a
// node card is drawn again above the cards.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { element, type ElementRecord } from '../src/model/records'
import { SceneStore } from '../src/model/store'
import { recordBounds } from '../src/model/bounds'
import { encodePoints } from '../src/model/points'
import { gentleCurve, hitNodeOrLink, routeBetween, segmentHits, sceneLinkEnv, linkRoute } from '../src/render/links'
import { Renderer, type DrawContext } from '../src/render/renderer'
import { SelectTool } from '../src/select/select'

const G = 'key:samurai'
const node = (id: string, x: number, y: number) => element({ id, kind: 'node', z: 'a0', x, y, w: 200, h: 200, props: { nodeKind: 'script' }, customData: { kind: 'script', id: 'script_1' } })
// A pile of three turned photos round (1000, 100)-(1200, 400).
const view = (id: string, rotation: number, z: string) => element({
  id, kind: 'image', z, x: 1000, y: 100, w: 200, h: 300, rotation, groupIds: [G],
  props: { assetSha: null, status: 'saved', stack: { dx: 0, dy: 0, angle: 0 } },
})
const pile = () => [view('v1', 0.03, 'c2'), view('v2', -0.2, 'c0'), view('v3', 0.18, 'c1')]
const link = (id: string, from: string, to: string, z = 'd0', group?: string) =>
  element({ id, kind: 'link', z, props: { start: { elementId: from, ...(group ? { group } : {}) }, end: { elementId: to }, route: [], role: 'character' }, customData: { kind: 'link', id: `link_${id}` } })

function setup(records: ElementRecord[], points: Record<string, Uint8Array> = {}) {
  const scene = new SceneStore(new Y.Doc())
  scene.seed(records, points)
  const r = new Renderer(scene, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined })
  return { scene, r }
}

/** A context that logs what was drawn, in order: line segments (with alpha) and pictures. */
function recorder() {
  const ops: { op: string; from?: number[]; to?: number[]; alpha?: number }[] = []
  let at: number[] = [0, 0]
  const ctx = new Proxy({ globalAlpha: 1, lineWidth: 1, font: '', fillStyle: '', strokeStyle: '' } as Record<string, unknown>, {
    get(t, k) {
      if (k in t) return t[k as string]
      if (k === 'moveTo') return (x: number, y: number) => { at = [x, y] }
      if (k === 'lineTo') return (x: number, y: number) => { ops.push({ op: 'line', from: at, to: [x, y], alpha: t.globalAlpha as number }); at = [x, y] }
      if (k === 'drawImage' || k === 'fill' || k === 'fillRect') return () => { ops.push({ op: k as string }) }
      return () => {}
    },
  })
  return { ctx: ctx as unknown as DrawContext, ops }
}

const cam = { scrollX: 0, scrollY: 0, zoom: 1 }
const vp = { width: 2000, height: 1200 }

describe('a key group shows one link, at the pile’s edge', () => {
  it('links from each view of a stack to the same target are drawn as one; the key link is the one drawn', () => {
    const { r } = setup([...pile(), node('s', 0, 150), link('l1', 'v1', 's', 'd0'), link('l2', 'v2', 's', 'd1'), link('l3', 'v3', 's', 'd2', G)])
    const routes = r.linkRoutes()
    expect(routes).toHaveLength(1)
    expect(routes[0].link.id).toBe('l3')
    expect(routes[0].all.map((l) => l.id).sort()).toEqual(['l1', 'l2', 'l3'])
  })

  it('an arrow between two photos of one pile is not drawn (nothing lies between them)', () => {
    const { r } = setup([...pile(), link('l', 'v1', 'v2')])
    expect(r.linkRoutes()).toHaveLength(0)
  })

  it('attaches at the pile’s outer bounds, its turned corners included, on the side facing the target', () => {
    const { scene } = setup([...pile(), node('s', 0, 150), link('l', 'v1', 's', 'd0', G)])
    const route = linkRoute(sceneLinkEnv(scene), scene.get('l')!)!
    const left = Math.min(...pile().map((v) => recordBounds(v).x))
    // The pile's leftmost turned corner is well left of the front photo's own edge (1000).
    expect(left).toBeLessThan(990)
    expect(route.pts[0].x).toBeCloseTo(left, 6)
    expect(route.pts.at(-1)!.x).toBe(200)
  })

  it('a view-only link from a spread group leaves from that view', () => {
    const spread = [element({ id: 'a', kind: 'image', z: 'c0', x: 1000, y: 100, w: 100, h: 100, groupIds: [G], props: { assetSha: null } }),
      element({ id: 'b', kind: 'image', z: 'c1', x: 1000, y: 400, w: 100, h: 100, groupIds: [G], props: { assetSha: null } })]
    const { scene } = setup([...spread, node('s', 0, 350), link('l', 'b', 's')])
    const route = linkRoute(sceneLinkEnv(scene), scene.get('l')!)!
    expect(route.pts[0]).toEqual({ x: 1000, y: 450 })
  })
})

describe('links go under and round what lies between', () => {
  const between = () => [
    element({ id: 'sk', kind: 'sketch', z: 'b0', x: 400, y: 150, w: 160, h: 120, props: { ratio: '4:3' } }),
    element({ id: 'pic', kind: 'image', z: 'b1', x: 650, y: 120, w: 150, h: 220, props: { assetSha: null } }),
  ]

  it('a straight line would cross the picture and the sketch area; the route does not', () => {
    const { scene } = setup([...between(), node('s', 0, 150), element({ id: 't', kind: 'image', z: 'c0', x: 1000, y: 150, w: 200, h: 200, props: { assetSha: null } }), link('l', 't', 's')])
    const route = linkRoute(sceneLinkEnv(scene), scene.get('l')!)!
    const crosses = (pts: { x: number; y: number }[], r: ElementRecord) => pts.slice(1).some((p, i) => segmentHits(pts[i], p, recordBounds(r)))
    const straight = [route.pts[0], route.pts.at(-1)!]
    for (const r of between()) {
      expect(crosses(straight, r)).toBe(true)
      expect(crosses(route.pts, r)).toBe(false)
    }
    // It still runs from the source's facing edge to the target's.
    expect(route.pts[0].x).toBe(1000)
    expect(route.pts.at(-1)!.x).toBe(200)
  })

  it('with nothing between, a link is a gentle curve (or straight when in line)', () => {
    const curve = routeBetween({ x: 0, y: 0 }, 'right', { x: 400, y: 100 }, 'left', () => [])
    expect(curve).toEqual(gentleCurve({ x: 0, y: 0 }, 'right', { x: 400, y: 100 }, 'left'))
    expect(curve.length).toBeGreaterThan(2)
    expect(routeBetween({ x: 0, y: 0 }, 'right', { x: 400, y: 0 }, 'left', () => [])).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }])
  })

  it('the route is the same every time (deterministic)', () => {
    const { scene } = setup([...between(), node('s', 0, 150), element({ id: 't', kind: 'image', z: 'c0', x: 1000, y: 150, w: 200, h: 200, props: { assetSha: null } }), link('l', 't', 's')])
    const a = linkRoute(sceneLinkEnv(scene), scene.get('l')!)!.pts
    const b = linkRoute(sceneLinkEnv(scene), scene.get('l')!)!.pts
    expect(a).toEqual(b)
  })

  it('a link made after a picture is still drawn before (under) it', () => {
    const { r } = setup([...between(), node('s', 0, 150), element({ id: 't', kind: 'image', z: 'c0', x: 1000, y: 150, w: 200, h: 200, props: { assetSha: null } }), link('l', 't', 's', 'z9')])
    const { ctx, ops } = recorder()
    r.draw(ctx, cam, vp, 1)
    const firstLine = ops.findIndex((o) => o.op === 'line')
    const firstPicture = ops.findIndex((o) => o.op === 'fillRect' || o.op === 'drawImage')
    // The background clear is the first fillRect; the pictures (no bitmap: a grey box) come after the link.
    const pictures = ops.map((o, i) => (o.op === 'fillRect' ? i : -1)).filter((i) => i > 0)
    expect(firstLine).toBeGreaterThan(-1)
    expect(firstPicture).toBe(0)
    expect(pictures.every((i) => i > firstLine)).toBe(true)
  })

  it('a link is hit along its route, not along the straight line', () => {
    const { scene } = setup([...between(), node('s', 0, 150), element({ id: 't', kind: 'image', z: 'c0', x: 1000, y: 150, w: 200, h: 200, props: { assetSha: null } }), link('l', 't', 's')])
    const route = linkRoute(sceneLinkEnv(scene), scene.get('l')!)!
    const mid = route.pts[Math.floor(route.pts.length / 2)]
    expect(hitNodeOrLink(scene, mid, 1)?.id).toBe('l')
    // Over the picture, where the straight line ran: not the link.
    expect(hitNodeOrLink(scene, { x: 725, y: 250 }, 1)?.id).not.toBe('l')
  })
})

describe('a stack’s selection frame', () => {
  it('encloses the whole turned pile, so its handles sit on that box', () => {
    const { scene, r } = setup(pile())
    const tool = new SelectTool(scene, (x, y) => r.hit(x, y))
    tool.set(['v1', 'v2', 'v3'])
    const f = tool.frame()!.box
    for (const v of pile()) {
      const b = recordBounds(v)
      expect(f.x).toBeLessThanOrEqual(b.x)
      expect(f.y).toBeLessThanOrEqual(b.y)
      expect(f.x + f.w).toBeGreaterThanOrEqual(b.x + b.w)
      expect(f.y + f.h).toBeGreaterThanOrEqual(b.y + b.h)
    }
    // Wider than the front photo's own box (200 wide), which is all the frame used to take.
    expect(f.w).toBeGreaterThan(260)
    expect(tool.handleAt({ x: f.x - 6, y: f.y - 6 }, 1)).toBe('nw')
  })
})

describe('ink over a card', () => {
  it('a stroke drawn after a card it crosses is drawn again above the cards; one under it is not', () => {
    const pts = encodePoints([{ x: 0, y: 0, pressure: 0.5 }, { x: 300, y: 10, pressure: 0.5 }], { x: 0, y: 0 })
    const stroke = (id: string, z: string) => element({ id, kind: 'stroke', z, x: -50, y: 100, w: 300, h: 10, style: { stroke: 'orange', width: 4 }, props: { tool: 'pen' } })
    const { r } = setup([node('s', 0, 0), stroke('over', 'b0'), stroke('under', '0')], { over: pts, under: pts })
    const { ctx, ops } = recorder()
    expect(r.drawOver(ctx, cam, vp, 1)).toBe(1)
    expect(ops.filter((o) => o.op === 'fill')).toHaveLength(1)
  })
})

describe('provenance arrows are bound (owner, 2026-10-15: they stayed behind when things moved)', () => {
  const sketch = element({ id: 'sk', kind: 'sketch', z: 'b0', x: 0, y: 0, w: 160, h: 90, props: { ratio: '16:9' } })
  const result = element({ id: 'gen', kind: 'image', z: 'b1', x: 400, y: 0, w: 160, h: 90, props: { assetSha: null } })
  // Stored as made: a static route from (168, 45) to (392, 45).
  const arrow = element({ id: 'ar', kind: 'arrow', z: 'c0', x: 168, y: 45, w: 224, h: 0, style: { stroke: '#FF4F2E', width: 2, dash: 'dashed' },
    props: { start: { elementId: 'sk' }, end: { elementId: 'gen' }, route: [0, 0, 112, -20, 224, 0] }, customData: { kind: 'provenance', from: 'sk', to: 'job_1' } })

  it('follows its ends when they move, and is never drawn from where it was made', () => {
    const { scene, r } = setup([sketch, result, arrow])
    scene.change((tx) => tx.put([{ ...tx.get('gen')!, x: 900, y: 600 } as ElementRecord]))
    const { ctx, ops } = recorder()
    r.draw(ctx, cam, vp, 1)
    const lines = ops.filter((o) => o.op === 'line')
    // Nothing from the old static route (it ended at 392, 45).
    expect(lines.some((l) => l.to![0] === 168 + 224 && l.to![1] === 45)).toBe(false)
    // It now arrives at the moved result's facing edge.
    expect(lines.some((l) => Math.abs(l.to![0] - 900) < 1e-6 || Math.abs(l.to![1] - 600) < 1e-6)).toBe(true)
  })

  it('a link or arrow whose end is gone draws nothing: never a line to nowhere', () => {
    const { scene, r } = setup([sketch, result, arrow, node('s', 0, 400), link('l', 'gen', 's')])
    scene.change((tx) => tx.remove(['gen']))
    const { ctx, ops } = recorder()
    r.draw(ctx, cam, vp, 1)
    expect(r.linkRoutes()).toHaveLength(0)
    expect(ops.filter((o) => o.op === 'line').every((l) => [...l.from!, ...l.to!].every(Number.isFinite))).toBe(true)
    expect(ops.filter((o) => o.op === 'line')).toHaveLength(0)
  })
})

describe('a quiet arrow (a key’s views from its front) shows only with its selection', () => {
  const pic = (id: string, x: number, tag: Record<string, string>) =>
    element({ id, kind: 'image', z: 'b0', x, y: 0, w: 200, h: 200, props: { assetSha: null, status: 'saved' }, customData: tag as never })
  const arrow = (id: string, from: string, to: string) =>
    element({ id, kind: 'arrow', z: 'e0', props: { start: { elementId: from }, end: { elementId: to } }, style: { stroke: '#ff5b2e', dash: 'dashed' }, customData: { kind: 'provenance', from, to } })
  const scene = () => [pic('front', 0, { kind: 'pic', id: 'node_f' }), pic('side', 400, { kind: 'gen', id: 'side', op: 'view' }), pic('other', 800, { kind: 'gen', id: 'other', op: 'generate' }),
    arrow('a1', 'front', 'side'), arrow('a2', 'front', 'other')]
  function quietSetup() {
    const s = new SceneStore(new Y.Doc())
    s.seed(scene(), {})
    const quiet = (r: ElementRecord) => {
      const end = r.props.end as { elementId?: string } | undefined
      const to = end?.elementId ? s.get(end.elementId) : undefined
      return to?.customData?.op === 'view'
    }
    return new Renderer(s, { newPath: () => ({ moveTo() {}, lineTo() {}, closePath() {} }), bitmap: () => undefined, quiet })
  }

  it('is not drawn while nothing of it is selected; the other generation arrow is', () => {
    const r = quietSetup()
    expect(r.linkRoutes().map((x) => x.link.id)).toEqual(['a2'])
  })

  it('is drawn when its source, its view or itself is selected', () => {
    const r = quietSetup()
    for (const id of ['front', 'side', 'a1']) {
      r.selected = new Set([id])
      expect(r.linkRoutes().map((x) => x.link.id).sort()).toEqual(['a1', 'a2'])
    }
  })
})
