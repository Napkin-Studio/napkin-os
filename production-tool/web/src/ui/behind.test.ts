import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { adBehindLabel, behindCount, behindLabel, driftLabel, notMadeCount, oldWordsLine } from './behind'

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
  it('a change to the item\'s own shot says what changed; the shot row says what the item still uses', () => {
    expect(behindLabel(d, { caused_by: { kind: 'shot', id: 's3' }, reason: "Shot 3's words changed" })).toBe('Words changed')
    expect(behindLabel(d, { caused_by: { kind: 'shot', id: 's3' }, reason: "Shot 3's camera move changed" })).toBe('Camera move changed')
    expect(behindLabel(d, { caused_by: { kind: 'shot', id: 's2' }, reason: 'Shot 2 was deleted' })).toBe('Behind shot 2')
    expect(oldWordsLine('frame', 3, { reason: "Shot 3's words changed" })).toBe('Frame 3 uses the old words')
    expect(oldWordsLine('take', 3, { reason: "Shot 3's length changed" })).toBe('Clip 3 uses the old length')
    expect(driftLabel(2)).toBe('Drawn from an older frame 2')
  })
  it('the ad is behind its clips or the shots; the bar counts what is out of date, and what is not made yet apart', () => {
    expect(adBehindLabel("Shot 2's clip changed")).toBe('Behind the clips')
    expect(adBehindLabel('A shot was deleted')).toBe('Behind the shots')
    expect(behindCount(3)).toBe('3 out of date')
    expect(notMadeCount(0, 3)).toBe('3 clips not made yet')
    expect(notMadeCount(1, 2)).toBe('1 frame and 2 clips not made yet')
  })
})
