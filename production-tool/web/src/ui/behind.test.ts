import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { adBehindLabel, behindCount, behindLabel } from './behind'

const d = {
  shots: [{ id: 's1', order: 1 }, { id: 's2', order: 2 }, { id: 's3', order: 3 }],
  frames: [{ id: 'f2', shot_id: 's2' }],
  takes: [{ id: 't3', shot_id: 's3' }],
  refs: [{ id: 'r1', key: 'maya', variant: 'front' }],
} as unknown as ProductionDocument

describe('what an out-of-date item is behind', () => {
  it('names the frame, clip, reference or shot that changed', () => {
    expect(behindLabel(d, { caused_by: { kind: 'frame', id: 'f2' } })).toBe('Behind frame 2')
    expect(behindLabel(d, { caused_by: { kind: 'take', id: 't3' } })).toBe('Behind clip 3')
    expect(behindLabel(d, { caused_by: { kind: 'ref', id: 'r1' } })).toBe('Behind @maya_front')
    expect(behindLabel(d, { caused_by: { kind: 'shot', id: 's1' } })).toBe('Behind shot 1')
  })
  it('still says something when the cause is gone', () => {
    expect(behindLabel(d, { caused_by: { kind: 'frame', id: 'gone' } })).toBe('Behind a frame')
    expect(behindLabel(d, { caused_by: { kind: 'ref', id: 'gone' } })).toBe('Behind a reference')
  })
  it('the ad is behind its clips or the shots; the bar counts what is behind', () => {
    expect(adBehindLabel("Shot 2's clip changed")).toBe('Behind the clips')
    expect(adBehindLabel('A shot was deleted')).toBe('Behind the shots')
    expect(behindCount(3)).toBe('3 behind your changes')
  })
})
