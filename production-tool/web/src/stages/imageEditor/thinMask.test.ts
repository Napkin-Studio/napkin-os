// UAT round 4 (features/pt-canvas-r4.clan). S2-3: a 2 %-wide Fill over a sky came back unchanged twice, and Try again
// sent the identical request and was charged again. R3-4: the editor offered 2x on top of a pending upscale. S3-9: a
// Fill on a 2048 px picture came back at the model's 1536 px; Apply keeps the picture's own size.

import { describe, expect, it } from 'vitest'
import { EMPTY, addEdit, pendingUpscale, type MaskOp } from './edits'
import { maskWidthShare, RETRY_MASK, sendableMask, strongerWords, THIN_MASK, widenedOps } from './mask'
import { plan, type Pic } from './compose'

// The live repro: a 2048 x 878 picture, a vertical stroke 2.1 % of the width wide down the sky (region w 0.021, h 0.615).
const ASPECT = 2048 / 878
const stroke: MaskOp = { t: 'brush', mode: 'add', r: 0.0105, soft: 0, pts: [{ x: 0.1, y: 0.02 }, { x: 0.1, y: 0.6 }] }

describe('a very thin Fill area is widened before it is sent (S2-3, UX 2)', () => {
  it('measures the live repro as thinner than the minimum', () => {
    expect(maskWidthShare([stroke], ASPECT)).toBeLessThan(THIN_MASK)
  })
  it('widens it to at least THIN_MASK of the shorter side, and says so', () => {
    const out = sendableMask([stroke], ASPECT)
    expect('ops' in out && out.widened).toBe(true)
    if (!('ops' in out)) return
    expect(maskWidthShare(out.ops, ASPECT)).toBeGreaterThanOrEqual(THIN_MASK * 0.9)
  })
  it('sends a wide enough area as it is', () => {
    const wide: MaskOp = { ...stroke, r: 0.06 }
    expect(sendableMask([wide], ASPECT)).toEqual({ ops: [wide], widened: false })
  })
  it('refuses a thin lasso shape it cannot widen, in plain words', () => {
    const sliver: MaskOp = { t: 'lasso', mode: 'add', pts: [{ x: 0.1, y: 0.1 }, { x: 0.105, y: 0.1 }, { x: 0.105, y: 0.6 }, { x: 0.1, y: 0.6 }] }
    expect(sendableMask([sliver], ASPECT)).toEqual({ problem: expect.stringContaining('Paint it wider') })
  })
  it('leaves a subtract stroke as it is', () => {
    const sub: MaskOp = { ...stroke, mode: 'sub' }
    const out = widenedOps([stroke, sub], ASPECT, THIN_MASK)!
    expect(out[1]).toBe(sub)
    expect((out[0] as { r: number }).r).toBeGreaterThan(stroke.r)
  })
})

describe('Try again is never the identical request (S2-3)', () => {
  it('widens the mask further than the first send and says the change more strongly', () => {
    const first = sendableMask([stroke], ASPECT)
    const again = sendableMask('ops' in first ? first.ops : [], ASPECT, RETRY_MASK)
    expect('ops' in again && again.widened).toBe(true)
    if ('ops' in first && 'ops' in again) expect(JSON.stringify(again.ops)).not.toBe(JSON.stringify(first.ops))
    expect(strongerWords('fill', 'clear blue sky')).toBe('Repaint this whole area so it clearly changes: clear blue sky.')
    expect(strongerWords('fill', 'Repaint this whole area so it clearly changes: clear blue sky.')).toBe('Repaint this whole area so it clearly changes: clear blue sky.')
    expect(strongerWords('fill', '')).toBe('Repaint this whole area so it clearly changes.')
    expect(strongerWords('whole', 'warmer light')).toBe('Make this change clearly visible: warmer light.')
  })
})

describe('Upscale once per version (R3-4)', () => {
  it('is not offered again while an upscale waits in the edits; a hidden or failed one does not count', () => {
    const s = addEdit(EMPTY, { id: 'u', kind: 'upscale', scale: 2, jobId: 'job_up' })
    expect(pendingUpscale(s)).toMatch(/Apply it first/)
    expect(pendingUpscale({ ...s, hidden: ['u'] })).toBeUndefined()
    expect(pendingUpscale(s, () => true)).toBeUndefined()
    expect(pendingUpscale(EMPTY)).toBeUndefined()
  })
})

describe('a Fill keeps the picture at its own size (S3-9)', () => {
  it('Apply draws the 1536 px result into the 2048 px picture, cut by its mask', () => {
    const frame: Pic = { sha: 'sha256:frame', w: 2048, h: 878 }
    const result: Pic = { sha: 'sha256:fill', w: 1536, h: 659 }
    const s = addEdit(EMPTY, { id: 'f', kind: 'fill', maskId: 'm', ops: [stroke], words: 'sky', keepOutside: true, jobId: 'job_fill' })
    const p = plan(s, frame, (e) => (e.id === 'f' ? result : undefined))
    expect([p.w, p.h]).toEqual([2048, 878])
    expect(p.steps.map((x) => x.kind)).toEqual(['base', 'fill'])
  })
})
