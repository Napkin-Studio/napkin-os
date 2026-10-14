// planGraph and the planSelection projection (features/canvas-core.clan).
// planSelection is now planGraph's projection; ORACLE below is a frozen copy of
// planSelection as it was before (canvas/selection.ts:46-82), and the two must
// agree on 2,000 seeded random v2 scenes.

import { describe, expect, it } from 'vitest'
import type { CustomData } from '../../contracts/types'
import { planSelection, type PlainEl, type SelectionPlan } from '../selection'
import { planGraph, STILL_BEING_MADE } from './plan'

// ── the oracle: today's planSelection, frozen (do not edit) ──

function oracleCdOf(e: PlainEl | undefined): CustomData | undefined {
  const c = e?.customData as CustomData | undefined
  return c && typeof c === 'object' && 'kind' in c ? c : undefined
}

function ORACLE(all: readonly PlainEl[], selectedIds: readonly string[]): SelectionPlan {
  const live = new Map(all.filter((e) => !e.isDeleted).map((e) => [e.id, e]))
  const plan: SelectionPlan = { images: [], strokes: [], notes: [], pending: [] }
  const seen = new Set<string>()
  const addImage = (e: PlainEl) => {
    const c = oracleCdOf(e)
    if (seen.has(e.id)) return
    seen.add(e.id)
    if (c?.kind === 'gen') {
      if (c.asset && c.state === 'completed') plan.images.push({ elId: e.id, nodeId: c.id, asset: c.asset, kind: 'gen' })
      else plan.pending.push(e.id)
    } else if (c?.kind === 'pic' || c?.kind === 'drawn') {
      plan.images.push({ elId: e.id, nodeId: c.id, asset: c.asset, kind: c.kind })
    }
  }
  for (const id of selectedIds) {
    const e = live.get(id)
    if (!e) continue
    const c = oracleCdOf(e)
    if (c?.kind === 'provenance' || (c?.kind as string | undefined) === 'pin') continue
    if (c?.kind === 'pic' || c?.kind === 'drawn' || c?.kind === 'gen') {
      addImage(e)
      continue
    }
    if (e.type === 'text') {
      const text = (e.originalText ?? e.text ?? '').trim()
      if (text) plan.notes.push({ elId: e.id, nodeId: c?.kind === 'note' ? c.id : undefined, text })
      continue
    }
    if (e.type === 'arrow' || e.type === 'frame' || e.type === 'magicframe' || e.type === 'image') continue
    // A stroke or shape: part of a drawing node, or loose.
    const frame = e.frameId ? live.get(e.frameId) : undefined
    if (frame && oracleCdOf(frame)?.kind === 'drawn') addImage(frame)
    else plan.strokes.push(e.id)
  }
  return plan
}

// ── seeded random v2 scenes ──

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const GEN_STATES = ['queued', 'submitted', 'running', 'completed', 'failed', 'cancelled']
const STROKE_TYPES = ['freedraw', 'rectangle', 'ellipse', 'diamond', 'line']

function randomScene(rand: () => number): { all: PlainEl[]; selected: string[] } {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
  const n = 1 + Math.floor(rand() * 18)
  const all: PlainEl[] = []
  const frames: string[] = []
  for (let i = 0; i < n; i++) {
    const id = `e${i}`
    const r = rand()
    let el: PlainEl
    if (r < 0.08) el = { id, type: 'image', customData: { kind: 'pic', id: `node_${i}`, asset: SHA('a') } }
    else if (r < 0.16) {
      el = { id, type: 'frame', customData: { kind: 'drawn', id: `node_${i}`, asset: SHA('d') } }
      frames.push(id)
    } else if (r < 0.26) {
      const state = pick(GEN_STATES)
      const asset = rand() < 0.8 ? { asset: SHA('g') } : {}
      el = { id, type: 'image', customData: { kind: 'gen', id: `job_${i}`, op: pick(['generate', 'view']), parentIds: [], state, ...asset } }
    } else if (r < 0.33) el = { id, type: 'text', text: pick(['make it red', '  ', '', 'When happy']), customData: { kind: 'note', id: `node_${i}` } }
    else if (r < 0.41) {
      const words = pick(['loose words', '   ', ''])
      el = { id, type: 'text', ...(rand() < 0.5 ? { text: words } : { originalText: words, text: 'wrapped' }) }
    } else if (r < 0.45) el = { id, type: 'rectangle', customData: { kind: 'pin', id: `rev_${i}`, genId: 'job_1', region: { x: 0, y: 0, w: 1, h: 1 } } }
    else if (r < 0.50) el = { id, type: 'arrow', customData: { kind: 'provenance', from: 'node_0', to: 'job_1' } }
    // 'sketch' is a live tag since frame-aspect, so it is not among the unknown tags here.
    else if (r < 0.55) el = { id, type: pick(['rectangle', 'text', 'frame', 'image']), customData: { kind: pick(['mystery', 'board', 'script', 'storyboard', 'video', 'link']), id: `x_${i}` } }
    else if (r < 0.58) el = { id, type: pick(['frame', 'magicframe']) }
    else if (r < 0.60) el = { id, type: 'image' }
    else if (r < 0.62) el = { id, type: 'arrow' }
    else if (r < 0.64) el = { id, type: pick(STROKE_TYPES), customData: pick([null, 'odd', { notKind: 1 }, 7]) as unknown }
    else if (r < 0.66) el = { id, type: 'rectangle', customData: { kind: 'note', id: `node_${i}` } }
    else {
      const frameId = rand() < 0.5 && frames.length ? pick(frames) : rand() < 0.2 ? pick(['nowhere', `e${n - 1}`]) : null
      el = { id, type: pick(STROKE_TYPES), frameId }
    }
    if (rand() < 0.08) el = { ...el, isDeleted: true }
    all.push(el)
  }
  const ids = all.map((e) => e.id)
  const k = Math.floor(rand() * (n + 3))
  const selected = Array.from({ length: k }, () => (rand() < 0.08 ? 'unknown-id' : pick(ids)))
  // Shuffle the scene, so a drawn frame may come after its strokes.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return { all, selected }
}

describe('planSelection is planGraph’s projection, and equals today’s', () => {
  it('on 2,000 seeded random v2 scenes', () => {
    const rand = mulberry32(20261013)
    let nonEmpty = 0
    for (let s = 0; s < 2000; s++) {
      const { all, selected } = randomScene(rand)
      const want = ORACLE(all, selected)
      const { sketches, ...got } = planSelection(all, selected)
      expect(got, `scene ${s}`).toEqual(want)
      expect(sketches).toEqual([]) // no geometry, no areas: v2 scenes plan no sketch
      if (want.images.length || want.strokes.length || want.notes.length || want.pending.length) nonEmpty++
    }
    // The scenes exercise the planner, not just empty selections.
    expect(nonEmpty).toBeGreaterThan(1500)
  })

  it('the pinned divergence: a rectangle with an unknown or v3 tag is a stroke to planSelection', () => {
    const els: PlainEl[] = [{ id: 'r', type: 'rectangle', customData: { kind: 'board', id: 'b' } }]
    expect(planSelection(els, ['r']).strokes).toEqual(['r'])
    expect(planGraph({ elements: els, selectedIds: ['r'] }).nodes).toEqual({ unknown: ['r'] })
  })
})

describe('planGraph', () => {
  const SH = SHA('a')
  const els: PlainEl[] = [
    { id: 'p', type: 'image', customData: { kind: 'pic', id: 'n_p', asset: SH } },
    { id: 'd', type: 'frame', customData: { kind: 'drawn', id: 'n_d', asset: SH } },
    { id: 's1', type: 'freedraw', frameId: 'd' },
    { id: 'loose', type: 'freedraw' },
    { id: 'g', type: 'image', customData: { kind: 'gen', id: 'j_g', op: 'generate', parentIds: [], state: 'completed', asset: SH } },
    { id: 'run', type: 'image', customData: { kind: 'gen', id: 'j_r', op: 'generate', parentIds: [], state: 'running' } },
    { id: 't', type: 'text', text: 'red', customData: { kind: 'note', id: 'n_t' } },
    { id: 'lt', type: 'text', text: 'blue' },
    { id: 'a', type: 'arrow', customData: { kind: 'provenance', from: 'n_p', to: 'j_g' } },
  ]

  it('gives the selected nodes by kind, a stroke in a drawing counting as its drawing', () => {
    const plan = planGraph({ elements: els, selectedIds: ['p', 's1', 'loose', 'g', 'run', 't', 'lt', 'a'] })
    expect(plan.nodes).toEqual({ picture: ['p'], drawing: ['d'], stroke: ['loose'], generated: ['g', 'run'], note: ['t', 'lt'] })
  })

  it('refuses a generated image still being made, with the reason', () => {
    const plan = planGraph({ elements: els, selectedIds: ['g', 'run'] })
    expect(plan.pending).toEqual(['run'])
    expect(plan.refused).toEqual([{ elId: 'run', reason: STILL_BEING_MADE }])
    expect(plan.images.map((i) => i.elId)).toEqual(['g'])
  })
})

describe('planGraph: sketch areas (features/frame-aspect.clan)', () => {
  const area = (id: string, x = 0, y = 0, w = 160, h = 90): PlainEl =>
    ({ id, type: 'rectangle', x, y, width: w, height: h, customData: { kind: 'sketch', id: `sketch_${id}` } })
  const stroke = (id: string, x: number, y: number, w = 20, h = 20, more: Partial<PlainEl> = {}): PlainEl =>
    ({ id, type: 'freedraw', x, y, width: w, height: h, ...more })
  const scene = [area('A'), stroke('in', 10, 10), stroke('cross', 150, 40, 100, 10), stroke('out', 400, 400), area('B', 1000, 0)]

  it('the area alone plans to that sketch', () => {
    const plan = planGraph({ elements: scene, selectedIds: ['A'] })
    expect(plan.sketches).toEqual([{ elId: 'A', sketchId: 'sketch_A' }])
    expect(plan.nodes).toEqual({ sketch: ['A'] })
    expect(plan.strokes).toEqual([])
  })

  it('strokes inside or crossing an area stand for it, once; a stroke outside stays loose', () => {
    const plan = planGraph({ elements: scene, selectedIds: ['in', 'cross', 'out'] })
    expect(plan.sketches).toEqual([{ elId: 'A', sketchId: 'sketch_A' }])
    expect(plan.strokes).toEqual(['out'])
    expect(plan.images).toEqual([])
  })

  it('a deleted area holds nothing, and a stroke in a drawing stays the drawing’s', () => {
    const els = [{ ...area('A'), isDeleted: true }, stroke('in', 10, 10)]
    expect(planGraph({ elements: els, selectedIds: ['in', 'A'] }).sketches).toEqual([])
    const drawn: PlainEl = { id: 'd', type: 'frame', customData: { kind: 'drawn', id: 'n_d', asset: SHA('d') } }
    const plan = planGraph({ elements: [area('A'), drawn, stroke('s', 10, 10, 20, 20, { frameId: 'd' })], selectedIds: ['s'] })
    expect(plan.sketches).toEqual([])
    expect(plan.images.map((i) => i.elId)).toEqual(['d'])
  })

  it('planSelection projects the areas', () => {
    expect(planSelection(scene, ['B', 'in']).sketches).toEqual([{ elId: 'B', sketchId: 'sketch_B' }, { elId: 'A', sketchId: 'sketch_A' }])
  })

  it('a sketch tag on anything but a rectangle is not an area', () => {
    const els: PlainEl[] = [{ id: 't', type: 'text', text: 'hi', customData: { kind: 'sketch', id: 's' } }]
    expect(planGraph({ elements: els, selectedIds: ['t'] }).sketches).toEqual([])
  })
})
