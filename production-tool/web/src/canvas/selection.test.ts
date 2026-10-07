import { describe, expect, it } from 'vitest'
import { bendFor, curvePoints } from './curve'
import { instruction, planSelection, type PlainEl } from './selection'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const pic = (id: string, sha = SHA('a')): PlainEl => ({ id, type: 'image', customData: { kind: 'pic', id: `node_${id}`, asset: sha } })
const gen = (id: string, state = 'completed'): PlainEl => ({ id, type: 'image', customData: { kind: 'gen', id: `job_${id}`, op: 'generate', parentIds: [], state, ...(state === 'completed' ? { asset: SHA('g') } : {}) } })
const drawn = (id: string): PlainEl => ({ id, type: 'frame', customData: { kind: 'drawn', id: `node_${id}`, asset: SHA('d') } })
const stroke = (id: string, frameId: string | null = null): PlainEl => ({ id, type: 'freedraw', frameId })
const text = (id: string, words: string): PlainEl => ({ id, type: 'text', text: words, originalText: words })
const arrow = (id: string): PlainEl => ({ id, type: 'arrow', customData: { kind: 'provenance', from: 'a', to: 'b' } })

describe('planSelection: any mix of nodes goes into one Generate', () => {
  it('pictures, results, drawings and notes, in selection order', () => {
    const els = [pic('p'), gen('g'), drawn('d'), stroke('s1', 'd'), stroke('loose'), text('t', 'make it red'), arrow('a')]
    const plan = planSelection(els, ['g', 'p', 's1', 'loose', 't', 'a'])
    expect(plan.images.map((i) => [i.elId, i.kind])).toEqual([['g', 'gen'], ['p', 'pic'], ['d', 'drawn']])
    expect(plan.strokes).toEqual(['loose'])
    expect(plan.notes).toEqual([{ elId: 't', nodeId: undefined, text: 'make it red' }])
    expect(plan.pending).toEqual([])
  })

  it('a stroke stands for its drawing once, however many of its strokes are selected', () => {
    const els = [drawn('d'), stroke('s1', 'd'), stroke('s2', 'd')]
    expect(planSelection(els, ['s1', 's2', 'd']).images.map((i) => i.nodeId)).toEqual(['node_d'])
  })

  it('a result still being made is pending, and deleted or empty things are left out', () => {
    const els = [gen('g', 'submitted'), { ...pic('gone'), isDeleted: true }, text('t', '   ')]
    const plan = planSelection(els, ['g', 'gone', 't'])
    expect(plan.pending).toEqual(['g'])
    expect(plan.images).toEqual([])
    expect(plan.notes).toEqual([])
  })

  it('the instruction is the typed words, then the notes, within 1000 characters', () => {
    expect(instruction('  a hat ', [{ text: 'When happy' }, { text: 'When dancing' }])).toBe('a hat\nWhen happy\nWhen dancing')
    expect(instruction('', [{ text: 'x'.repeat(1200) }])).toHaveLength(1000)
  })
})

describe('curved arrows', () => {
  it('the middle point leaves the straight line, and the ends stay where they are', () => {
    const [a, m, b] = curvePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 0.15)
    expect(a).toEqual([0, 0])
    expect(b).toEqual([200, 0])
    expect(m[0]).toBe(100)
    expect(m[1]).toBeCloseTo(30)
  })

  it('arrows into one node never lie straight and alternate sides, wider each pair', () => {
    const bends = [0, 1, 2, 3].map(bendFor)
    expect(bends).toEqual([0.15, -0.15, 0.3, -0.3])
    expect(new Set(bends).size).toBe(4)
  })
})
