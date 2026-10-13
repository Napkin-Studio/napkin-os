// The NodeRegistry, classify and groupOf (features/canvas-core.clan), against
// ui-behaviour.md 3.3 and 3.4 and the v2 readers in canvas/sceneRead.ts.

import { describe, expect, it } from 'vitest'
import { imageOf, isText, isUserDrawing } from '../sceneRead'
import type { ElementLike } from './canvasAdapter'
import { canLink } from './links'
import { classify, GENERATING_KINDS, groupOf, NODE_REGISTRY, nodeEntry, type Classified } from './nodes'

const SHA = `sha256:${'a'.repeat(64)}`

describe('the registry', () => {
  it('has every kind of 3.3 and 3.4, the two system entries and the shot', () => {
    expect(NODE_REGISTRY.map((e) => e.kind).sort()).toEqual([
      'board', 'document', 'drawing', 'format_set', 'generated', 'group', 'ink_group', 'note', 'picture',
      'pin', 'provenance', 'script', 'shot', 'sketch', 'storyboard', 'video',
    ])
    // 3.3's card labels.
    for (const label of ['Script', 'Storyboard', 'Video', 'Reference', 'Frame', 'Sketch area', 'Ink group', 'Document', 'Format set']) {
      expect(NODE_REGISTRY.some((e) => e.label === label)).toBe(true)
    }
  })

  it('the v2 tags are exactly pic, drawn, note, gen, pin and provenance; pin and provenance are system entries', () => {
    const v2 = NODE_REGISTRY.filter((e) => e.tagStatus === 'v2')
    expect(v2.map((e) => e.tag).sort()).toEqual(['drawn', 'gen', 'note', 'pic', 'pin', 'provenance'])
    expect(NODE_REGISTRY.filter((e) => e.system).map((e) => e.kind).sort()).toEqual(['pin', 'provenance'])
  })

  it('the v3 tags are contract-v3’s; document, format set and ink group are unassigned', () => {
    expect(NODE_REGISTRY.filter((e) => e.tagStatus === 'v3' && e.tag).map((e) => e.tag).sort()).toEqual(['board', 'script', 'sketch', 'storyboard', 'video'])
    for (const k of ['document', 'format_set', 'ink_group'] as const) expect(nodeEntry(k).tagStatus).toBe('unassigned')
  })

  it('the generating kinds are exactly script, storyboard, video, sketch and format set', () => {
    expect([...GENERATING_KINDS].sort()).toEqual(['format_set', 'script', 'sketch', 'storyboard', 'video'])
  })

  it('a shot is a link endpoint, not on the canvas', () => {
    expect(nodeEntry('shot')).toMatchObject({ onCanvas: false, element: null })
  })

  it('port colours: script coral, storyboard blue, video ink, a reference grey', () => {
    expect(['script', 'storyboard', 'video', 'picture'].map((k) => nodeEntry(k as never).port)).toEqual(['coral', 'blue', 'ink', 'grey'])
  })

  it('a board with purpose brand is a brand board: it feeds as brand, a plain board as input', () => {
    expect(canLink({ kind: 'board', purpose: 'brand' }, 'script')).toEqual({ ok: true, roles: ['brand'] })
    expect(canLink({ kind: 'board', purpose: 'location' }, 'script')).toEqual({ ok: true, roles: ['input'] })
  })
})

// The v2 fixture: every kind of element the scene holds today.
const F: Record<string, ElementLike> = {
  pic: { id: 'pic', type: 'image', customData: { kind: 'pic', id: 'n1', asset: SHA } },
  picPending: { id: 'picPending', type: 'image' },
  drawn: { id: 'drawn', type: 'frame', customData: { kind: 'drawn', id: 'n2', asset: SHA } },
  genDone: { id: 'genDone', type: 'image', customData: { kind: 'gen', id: 'j1', op: 'generate', parentIds: [], state: 'completed', asset: SHA } },
  genRunning: { id: 'genRunning', type: 'image', customData: { kind: 'gen', id: 'j2', op: 'generate', parentIds: [], state: 'running' } },
  note: { id: 'note', type: 'text', text: 'hi', customData: { kind: 'note', id: 'n3' } },
  loose: { id: 'loose', type: 'text', text: 'loose words' },
  pin: { id: 'pin', type: 'rectangle', customData: { kind: 'pin', id: 'r1', genId: 'j1', region: {} } },
  prov: { id: 'prov', type: 'arrow', customData: { kind: 'provenance', from: 'n1', to: 'j1' } },
  stroke: { id: 'stroke', type: 'freedraw' },
  rect: { id: 'rect', type: 'rectangle' },
  ellipse: { id: 'ellipse', type: 'ellipse', frameId: 'drawn' },
  userArrow: { id: 'userArrow', type: 'arrow' },
  userFrame: { id: 'userFrame', type: 'frame' },
  magic: { id: 'magic', type: 'magicframe' },
  odd: { id: 'odd', type: 'freedraw', customData: 'not an object' },
}

const EXPECTED: Record<string, Classified> = {
  pic: 'picture', picPending: 'unknown', drawn: 'drawing', genDone: 'generated', genRunning: 'generated', note: 'note', loose: 'note',
  pin: 'pin', prov: 'provenance', stroke: 'stroke', rect: 'stroke', ellipse: 'stroke', userArrow: 'unknown', userFrame: 'unknown',
  magic: 'unknown', odd: 'stroke',
}

describe('classify', () => {
  it('reads each v2 element as the registry says', () => {
    for (const [k, el] of Object.entries(F)) expect([k, classify(el)]).toEqual([k, EXPECTED[k]])
  })

  it('agrees with imageOf and isText on every fixture', () => {
    const imageKind = { pic: 'picture', drawn: 'drawing', gen: 'generated' } as const
    for (const el of Object.values(F)) {
      const img = imageOf(el)
      const k = classify(el)
      expect(img ? imageKind[img.kind] : undefined).toBe(['picture', 'drawing', 'generated'].includes(k) ? k : undefined)
      expect(isText(el)).toBe(k === 'note')
    }
  })

  it('agrees with isUserDrawing on elements without customData', () => {
    for (const el of Object.values(F).filter((e) => e.customData === undefined)) expect([el.id, isUserDrawing(el)]).toEqual([el.id, classify(el) === 'stroke'])
  })

  it('returns unknown for a tag it does not know, and for a v3 tag until its contract lands', () => {
    expect(classify({ id: 'a', type: 'rectangle', customData: { kind: 'mystery', id: 'x' } })).toBe('unknown')
    expect(classify({ id: 'b', type: 'frame', customData: { kind: 'board', id: 'x' } })).toBe('unknown')
    expect(classify({ id: 'c', type: 'rectangle', customData: { kind: 'script', id: 'x' } })).toBe('unknown')
  })

  it('the known divergence: a rectangle with an unknown or v3 tag is unknown here, a stroke to planSelection, not a drawing to isUserDrawing', () => {
    // planSelection's side is pinned in plan.test.ts; this is classify's and isUserDrawing's.
    for (const kind of ['mystery', 'board', 'sketch']) {
      const el: ElementLike = { id: 'r', type: 'rectangle', customData: { kind, id: 'x' } }
      expect(classify(el)).toBe('unknown')
      expect(isUserDrawing(el)).toBe(false)
    }
  })
})

describe('groupOf', () => {
  it('finds an ink group from groupIds whose members are all untagged strokes', () => {
    const els: ElementLike[] = [
      { id: 's1', type: 'freedraw', groupIds: ['g1'] },
      { id: 's2', type: 'line', groupIds: ['g1'] },
      { id: 'p', type: 'image', customData: { kind: 'pic', id: 'n', asset: SHA }, groupIds: ['g2'] },
      { id: 's3', type: 'freedraw', groupIds: ['g2'] },
      { id: 'lone', type: 'freedraw' },
    ]
    expect(groupOf(els)).toEqual([
      { id: 'g1', kind: 'ink_group', memberIds: ['s1', 's2'] },
      { id: 'g2', kind: 'group', memberIds: ['p', 's3'] },
    ])
  })

  it('gives the outermost group only, and ignores deleted members', () => {
    const els: ElementLike[] = [
      { id: 's1', type: 'freedraw', groupIds: ['inner', 'outer'] },
      { id: 's2', type: 'freedraw', groupIds: ['outer'] },
      { id: 't', type: 'text', text: 'x', groupIds: ['outer'], isDeleted: true },
    ]
    expect(groupOf(els)).toEqual([{ id: 'outer', kind: 'ink_group', memberIds: ['s1', 's2'] }])
  })

  it('text in a group makes it a plain group', () => {
    expect(groupOf([{ id: 's', type: 'freedraw', groupIds: ['g'] }, { id: 't', type: 'text', text: 'x', groupIds: ['g'] }])[0].kind).toBe('group')
  })
})
