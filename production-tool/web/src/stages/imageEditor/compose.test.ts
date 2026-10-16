// What Apply saves, Before / After shows and an action is sent (features/image-editor.clan).
import { describe, expect, it } from 'vitest'
import { EMPTY, addEdit, toggleHidden, type Edit } from './edits'
import { applyProblem, plan, sendPlan, untouched, type Pic } from './compose'

const FRAME: Pic = { sha: 'sha256:frame', w: 1344, h: 768 }
const results: Record<string, Pic> = {
  job_fill: { sha: 'sha256:fill', w: 1344, h: 768 },
  job_whole: { sha: 'sha256:whole', w: 1344, h: 768 },
  job_up: { sha: 'sha256:up', w: 2688, h: 1536 },
}
const resultOf = (e: Edit) => ('jobId' in e && e.jobId ? results[e.jobId] : undefined)
const kinds = (p: ReturnType<typeof plan>) => p.steps.map((s) => (s.kind === 'base' ? `base:${s.pic.sha}` : s.kind))

describe('plan', () => {
  it('is the frame alone with no edits, and says so', () => {
    const p = plan(EMPTY, FRAME, resultOf)
    expect(kinds(p)).toEqual(['base:sha256:frame'])
    expect(untouched(p, FRAME)).toBe(true)
  })
  it('puts a fill in its mask over the frame, then text in front, and crops last', () => {
    let s = addEdit(EMPTY, { id: 'f', kind: 'fill', maskId: 'm', ops: [], words: 'drops', keepOutside: true, jobId: 'job_fill' })
    s = addEdit(s, { id: 't', kind: 'text', text: 'Drink the morning.', x: 0.05, y: 0.86, size: 0.06 })
    s = addEdit(s, { id: 'k', kind: 'crop', x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    const p = plan(s, FRAME, resultOf)
    expect(kinds(p)).toEqual(['base:sha256:frame', 'fill', 'text'])
    expect(p.crop).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    expect(untouched(p, FRAME)).toBe(false)
    // What an action is sent: no text, no crop.
    expect(kinds(plan(s, FRAME, resultOf, { text: false, crop: false }))).toEqual(['base:sha256:frame', 'fill'])
  })
  it('a whole-frame change replaces what came before; an upscale also sets the size', () => {
    let s = addEdit(EMPTY, { id: 'f', kind: 'fill', maskId: 'm', ops: [], words: 'drops', keepOutside: true, jobId: 'job_fill' })
    s = addEdit(s, { id: 'w', kind: 'whole', words: 'warmer', jobId: 'job_whole' })
    expect(kinds(plan(s, FRAME, resultOf))).toEqual(['base:sha256:whole'])
    s = addEdit(s, { id: 'u', kind: 'upscale', scale: 2, jobId: 'job_up' })
    const p = plan(s, FRAME, resultOf)
    expect(kinds(p)).toEqual(['base:sha256:up'])
    expect([p.w, p.h]).toEqual([2688, 1536])
  })
  it('a result still running changes nothing yet', () => {
    const s = addEdit(EMPTY, { id: 'w', kind: 'whole', words: 'warmer', jobId: 'job_pending' })
    expect(kinds(plan(s, FRAME, resultOf))).toEqual(['base:sha256:frame'])
  })
  it('hidden layers are left out; hiding the frame leaves a fill on transparency', () => {
    let s = addEdit(EMPTY, { id: 'c', kind: 'fill', maskId: 'm', ops: [], words: 'drops', keepOutside: true, jobId: 'job_fill' })
    s = addEdit(s, { id: 't', kind: 'text', text: 'Hi', x: 0, y: 0, size: 0.1 })
    s = toggleHidden(toggleHidden(s, 'frame'), 't')
    expect(kinds(plan(s, FRAME, resultOf))).toEqual(['fill'])
  })
  it('Before shows the frame as saved', () => {
    const s = addEdit(EMPTY, { id: 't', kind: 'text', text: 'Hi', x: 0, y: 0, size: 0.1 })
    expect(kinds(plan(s, FRAME, resultOf, { before: true }))).toEqual(['base:sha256:frame'])
  })
})

describe('what is sent and applied: what is visible (features/image-editor-masks-layers.clan, IM1)', () => {
  const fillThenChange = () => {
    let s = addEdit(EMPTY, { id: 'm', kind: 'mask', name: 'Mask 1', ops: [] })
    s = addEdit(s, { id: 'f', kind: 'fill', maskId: 'm', ops: [], words: 'drops', keepOutside: true, jobId: 'job_fill' })
    s = addEdit(s, { id: 'c', kind: 'whole', words: 'warmer', jobId: 'job_pending' })
    return addEdit(s, { id: 't', kind: 'text', text: 'Hi', x: 0, y: 0, size: 0.1 })
  }
  it('hiding Frame drops only the original picture: a fill stays', () => {
    const s = toggleHidden(fillThenChange(), 'frame')
    expect(kinds(plan(s, FRAME, resultOf))).toEqual(['fill', 'text'])
  })
  it('hiding Frame keeps a Change or Upscale result that replaced it', () => {
    let s = addEdit(EMPTY, { id: 'w', kind: 'whole', words: 'warmer', jobId: 'job_whole' })
    s = toggleHidden(s, 'frame')
    expect(kinds(plan(s, FRAME, resultOf))).toEqual(['base:sha256:whole'])
    s = addEdit(s, { id: 'u', kind: 'upscale', scale: 2, jobId: 'job_up' })
    expect(kinds(plan(s, FRAME, resultOf))).toEqual(['base:sha256:up'])
  })
  it('with nothing hidden, an action gets the plan without text or crop and Apply the whole plan', () => {
    const s = fillThenChange()
    const action = sendPlan(s, FRAME, resultOf, 'action')
    expect(action.plan).toEqual(plan(s, FRAME, resultOf, { text: false, crop: false }))
    expect(action.leftOut).toBe(0)
    expect(sendPlan(s, FRAME, resultOf, 'apply').plan).toEqual(plan(s, FRAME, resultOf))
  })
  it('counts the hidden layers each one leaves out', () => {
    let s = toggleHidden(fillThenChange(), 't')
    expect(sendPlan(s, FRAME, resultOf, 'apply')).toMatchObject({ leftOut: 1 })
    expect(sendPlan(s, FRAME, resultOf, 'action')).toMatchObject({ leftOut: 0 }) // a send has no text anyway
    s = toggleHidden(toggleHidden(s, 'c'), 'frame')
    expect(sendPlan(s, FRAME, resultOf, 'action')).toMatchObject({ leftOut: 2 })
    expect(kinds(sendPlan(s, FRAME, resultOf, 'action').plan)).toEqual(['fill'])
  })
})

describe('Apply refuses what it cannot save as seen (fix/editor-apply-keeps-edits)', () => {
  const ring = { t: 'brush' as const, mode: 'add' as const, r: 0.1, soft: 0, pts: [{ x: 0.5, y: 0.5 }] }
  it('a fill with its result and its mask as sent: Apply can save it, even with the mask cleared since', () => {
    let s = addEdit(EMPTY, { id: 'm', kind: 'mask', name: 'Mask 1', ops: [] }) // cleared after the send
    s = addEdit(s, { id: 'f', kind: 'fill', maskId: 'm', ops: [ring], words: 'drops', keepOutside: true, jobId: 'job_fill' })
    expect(applyProblem(s, FRAME, resultOf)).toBeUndefined()
    const step = plan(s, FRAME, resultOf).steps[1]
    expect(step).toMatchObject({ kind: 'fill', key: 'f', ops: [ring] })
  })
  it('a visible result that has not come back, or a fill with an empty mask: says which', () => {
    const waiting = addEdit(EMPTY, { id: 'w', kind: 'whole', words: 'warmer', jobId: 'job_pending' })
    expect(applyProblem(waiting, FRAME, resultOf)).toMatch(/^Change whole frame: "warmer" has no result/)
    expect(applyProblem(toggleHidden(addEdit(waiting, { id: 't', kind: 'text', text: 'Hi', x: 0, y: 0, size: 0.1 }), 'w'), FRAME, resultOf)).toBeUndefined()
    let empty = addEdit(EMPTY, { id: 'm', kind: 'mask', name: 'Mask 1', ops: [ring] })
    empty = addEdit(empty, { id: 'f', kind: 'fill', maskId: 'm', ops: [], words: '', keepOutside: true, jobId: 'job_fill', remove: true })
    expect(applyProblem(empty, FRAME, resultOf)).toMatch(/^Remove Mask 1 has no area/)
  })
  it('a painted mask alone changes nothing: says so instead of saving a copy', () => {
    const s = addEdit(EMPTY, { id: 'm', kind: 'mask', name: 'Mask 1', ops: [ring] })
    expect(applyProblem(s, FRAME, resultOf)).toMatch(/Mask 1 is painted but not filled or removed/)
  })
})
