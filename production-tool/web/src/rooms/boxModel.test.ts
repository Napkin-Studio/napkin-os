// The Box tab's models for a box made together (live test 2026-11-16): a model whose one-video limits
// the box is past (planRuns would quietly make it on another) is greyed with why and never picked.
import { describe, expect, it } from 'vitest'
import { modelChoicesFor } from '../capabilities'
import { CONFIGS } from '../contracts/load'
import type { Config, ProductionDocument } from '../contracts/types'
import { modelEntry } from '../jobs/runs'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addFrame, addShots } from '../test/model'
import { boxModel, boxModelLimit, boxModelWhyNot } from './boxModel'
import type { Box } from './model'

const on: Config = { ...CONFIGS.live, flags: { ...CONFIGS.live.flags, connectedVideo: true } }
const omni = { provider: 'runway' as const, model: 'gemini_omni_flash_1.1' }
const wan3 = { provider: 'runway' as const, model: 'wan3' }
const veo = { provider: 'runway' as const, model: 'veo3.1_fast' }

function together(lengths: number[]): { doc: ProductionDocument; box: Box } {
  const doc = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
  const shots = addShots(doc, lengths.length)
  shots.forEach((s, i) => { s.duration_s = lengths[i]; s.action = `Action ${i + 1}.`; addFrame(doc, s, SHA(String(i + 1)), { pick: true }) })
  const lengthS = lengths.reduce((a, b) => a + b, 0)
  return { doc, box: { key: 'b1', n: 1, shotIds: shots.map((s) => s.id), together: true, endCard: false, lengthS } as Box }
}

describe('a 15 s box of 4 shots made together', () => {
  const { doc, box } = together([3.75, 3.75, 3.75, 3.75])
  it('greys Gemini Omni Flash 1.1 with why, as planRuns would not make it there', () => {
    expect(modelEntry('runway', 'gemini_omni_flash_1.1')!.video.take?.maxS).toBe(10)
    expect(boxModelWhyNot(doc, box, omni)).toBe('Longer than Gemini Omni Flash 1.1 makes in one go (10 s)')
    expect(boxModelWhyNot(doc, box, wan3)).toBeUndefined()
    expect(boxModelWhyNot(doc, box, veo)).toBe("Can't make several shots as one video")
  })
  it('never falls on it unpicked; picked, it is kept and the box says it is too long (join-or-cut-shots)', () => {
    const unpicked = boxModel(doc, box, on)
    expect(boxModelWhyNot(doc, box, unpicked!)).toBeUndefined()
    expect(modelChoicesFor('clip', on).some((o) => o.model === unpicked!.model)).toBe(true)
    // A joined box keeps the earlier box's model: it is never quietly swapped (Make waits on the box's limits).
    expect(boxModel(doc, box, on, omni)).toEqual(omni)
    expect(boxModelLimit(box, omni)).toBe('Longer than Gemini Omni Flash 1.1 makes in one go (10 s)')
    // A model that cannot make shots together at all is still never kept.
    expect(boxModel(doc, box, on, veo)?.model).not.toBe('veo3.1_fast')
  })
  it('a 10 s box keeps Omni Flash, and more shots than a model takes is greyed too', () => {
    const short = together([2.5, 2.5, 2.5, 2.5])
    expect(boxModelWhyNot(short.doc, short.box, omni)).toBeUndefined()
    expect(boxModel(short.doc, short.box, on, omni)).toEqual(omni)
    const many = together([1, 1, 1, 1, 1, 1, 1])
    expect(boxModelWhyNot(many.doc, many.box, wan3)).toBe('More shots than WAN 3 makes in one go (6)')
  })
})
