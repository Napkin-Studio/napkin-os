import { describe, expect, it } from 'vitest'
import { emptyDocument } from './store'
import { roots, sweep, unused } from './gc'

const SHA = (c: string) => `sha256:${c.repeat(64)}`

function doc() {
  const d = emptyDocument()
  for (const c of 'abcdefgh') d.assets.push({ sha256: SHA(c), kind: 'image', mime: 'image/png', origin: 'generated', locations: [] })
  d.refs.push({ id: 'ref_x', key: 'maya', variant: 'front', asset: SHA('a') }) // solid: named, node long gone
  d.frames = [{ id: 'frame_x', shot_id: 'shot_x', asset: SHA('b'), job_id: 'job_x', selected: false, kind: 'mock' }]
  d.shots = [{ id: 'shot_x', order: 1, duration_s: 5, composition: 'wide', action: 'x', camera_move: 'static', storyboard_frame: SHA('c') }]
  d.exports = [{ id: 'exp_x', kind: 'ad_mp4', asset: SHA('d'), created_at: '2026-10-07T10:00:00Z' }]
  // A job still names f and g as its input and output: history, not a reason to keep them.
  d.jobs.push({ id: 'job_y', op: 'generate', state: 'completed', parent_ids: [], input_hashes: [SHA('f')], outputs: [SHA('g')], created_at: '2026-10-07T10:00:00Z' })
  return d
}

describe('Clean up: mark and sweep from roots, no counters', () => {
  it('named images, the canvas, frames, shots and exports stay; the rest goes', () => {
    const d = doc()
    expect([...roots(d, [SHA('e')])].sort()).toEqual([SHA('a'), SHA('b'), SHA('c'), SHA('d'), SHA('e')])
    expect(unused(d, [SHA('e')])).toEqual([SHA('f'), SHA('g'), SHA('h')])
  })

  it('an image taken off the canvas goes at the next clean-up, unless it has a name', () => {
    const d = doc()
    expect(unused(d, [SHA('e')])).not.toContain(SHA('e'))
    expect(unused(d, [])).toContain(SHA('e'))
    d.refs.push({ id: 'ref_y', key: 'maya', variant: 'side', asset: SHA('e') })
    expect(unused(d, [])).not.toContain(SHA('e'))
  })

  it('sweep takes exactly those assets out, and jobs stay', () => {
    const d = doc()
    sweep(d, unused(d, []))
    expect(d.assets.map((a) => a.sha256)).toEqual([SHA('a'), SHA('b'), SHA('c'), SHA('d')])
    expect(d.jobs).toHaveLength(1)
  })
})
