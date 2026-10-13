import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { mainVideo } from '../model/selectors'
import { addFrame, addShots, addTake, asset, id, job, MAYA, SHA, T } from '../test/model'
import { emptyDocument } from './store'
import { roots, sweep, unused } from './gc'

const e = <X extends object>(prefix: string, rest: X) => ({ id: id(prefix), v: 1, field_v: {}, ...rest })

/** Every kind of thing that names an asset (a..k), and assets nothing names (x, y, z). */
function doc(): ProductionDocument {
  const d = emptyDocument(MAYA, 'Rain')
  for (const c of 'abcdefghijkxyz') d.assets[SHA(c)] = asset(SHA(c))
  const ref = e('ref', { key: 'maya', variant: 'front', role: 'character' as const, asset: SHA('a') }) // named, its node long gone
  d.refs[ref.id] = ref
  const [s] = addShots(d, 1)
  addFrame(d, s, SHA('b'), { pick: true })
  const j = job(d, 'clip', [SHA('b')], SHA('c'))
  d.jobs[j.id] = j
  const t = addTake(d, s, SHA('c'), j, { pick: true })
  const render = e('render', { video_id: mainVideo(d)!.id, version: 1, asset: SHA('d'), job_id: j.id })
  d.renders[render.id] = render
  const docu = e('doc', { title: 'Brief', file_name: 'brief.pdf', asset: SHA('e'), pages: 2, read: { state: 'read' as const, pages_read: 2 } })
  d.documents[docu.id] = docu
  const set = e('fset', { master: { kind: 'frame' as const, id: Object.keys(d.frames)[0] }, pack: { pack_id: 'social', pack_version: '1' } })
  d.format_sets[set.id] = set
  const size = e('size', {
    set_id: set.id, rank: 'a0', format: { pack_id: 'social', pack_version: '1', format_id: 'square' }, aspect: { w: 1, h: 1 },
    delivery: { width: 1080, height: 1080 }, method: 'crop' as const, media: 'image' as const, asset: SHA('f'),
  })
  d.sizes[size.id] = size
  const note = e('rev', { target: { kind: 'take' as const, id: t.id }, still: SHA('g'), by: `human:${MAYA.id}`, state: 'open' as const, created_at: T })
  d.reviews[note.id] = note
  const exp = e('exp', { kind: 'ad_mp4' as const, asset: SHA('h'), created_at: T })
  d.exports[exp.id] = exp
  // A job's outputs are its record: kept. Its inputs (x) are history, not a reason to keep them.
  const g = job(d, 'generate', [SHA('x')], SHA('i'))
  d.jobs[g.id] = g
  const font = e('ref', { key: 'brand', variant: 'type', role: 'typography' as const, font: { family: 'Lumen Sans', file: SHA('j') } })
  d.refs[font.id] = font
  return d
}

describe('Clean up: mark and sweep from roots, no counters', () => {
  it('everything an entity names stays, and the canvas; the rest goes', () => {
    const d = doc()
    expect([...roots(d, [SHA('k')])].sort()).toEqual([...'abcdefghijk'].map(SHA).sort())
    expect(unused(d, [SHA('k')]).sort()).toEqual([SHA('x'), SHA('y'), SHA('z')])
  })

  it('an image taken off the canvas goes at the next clean-up, unless something names it', () => {
    const d = doc()
    expect(unused(d, [SHA('k')])).not.toContain(SHA('k'))
    expect(unused(d, [])).toContain(SHA('k'))
    const side = e('ref', { key: 'maya', variant: 'side', role: 'character' as const, asset: SHA('k') })
    d.refs[side.id] = side
    expect(unused(d, [])).not.toContain(SHA('k'))
  })

  it('sweep takes exactly those assets out, and jobs stay', () => {
    const d = doc()
    const jobs = structuredClone(d.jobs)
    sweep(d, unused(d, []))
    expect(Object.keys(d.assets).sort()).toEqual([...'abcdefghij'].map(SHA).sort())
    expect(d.jobs).toEqual(jobs)
  })
})
