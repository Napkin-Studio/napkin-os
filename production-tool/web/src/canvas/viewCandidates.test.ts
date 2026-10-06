import { describe, expect, it } from 'vitest'
import { viewCandidates } from './viewCandidates'

const g = (id: string, op: string, extra: Record<string, unknown> = {}) => ({ id, op, state: 'completed', asset: 'sha256:' + id, ...extra })

describe('view slot candidates', () => {
  const gens = [g('front1', 'generate'), g('side1', 'view', { view: 'side' }), g('busy', 'view', { view: 'back', state: 'running' }), g('noasset', 'combine', { asset: undefined })]

  it('offers any finished picture for the Side slot, made-for-side first', () => {
    const { madeFor, others } = viewCandidates(gens, 'side')
    expect(madeFor.map((x) => x.id)).toEqual(['side1'])
    expect(others.map((x) => x.id)).toEqual(['front1'])
  })

  it('offers the front picture for an empty Back slot', () => {
    const { madeFor, others } = viewCandidates(gens, 'back')
    expect(madeFor).toEqual([])
    expect(others.map((x) => x.id)).toEqual(['front1', 'side1'])
  })

  it('never offers unfinished or empty jobs', () => {
    const all = Object.values(viewCandidates(gens, 'front')).flat().map((x) => x.id)
    expect(all).not.toContain('busy')
    expect(all).not.toContain('noasset')
  })
})
