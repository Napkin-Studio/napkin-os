// The Image editor's edits list (ui-behaviour 3.12, features/image-editor.clan).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EMPTY, addEdit, applyLine, clearMask, editCount, editLabel, editsForFrame, layersOf, leaveAsk, nextStep, notApplied,
  toggleHidden, undoEdit, undoMaskOp, upscaleSize, withMaskOp, nothingToTake, undoLast, redoUndone, hiddenCount, keptAfterApply, leftOutLine, NOTHING_TO_TAKE,
  type EditSession, type MaskOp,
} from './edits'

const SPEC = readFileSync(new URL('../../../../../docs/production-tool/ui-behaviour.md', import.meta.url), 'utf8')
const stroke = (mode: 'add' | 'sub' = 'add'): MaskOp => ({ t: 'brush', mode, r: 0.02, soft: 0.2, pts: [{ x: 0.5, y: 0.5 }] })

describe('the words match 3.12', () => {
  it('says what Apply makes, what is not applied, and asks before leaving', () => {
    expect(applyLine(3, 3)).toBe('Apply saves your 3 edits as v4. v3 stays.')
    expect(SPEC).toContain(applyLine(3, 3))
    expect(SPEC).toContain(leaveAsk(3))
    expect(SPEC).toContain(notApplied(3))
    expect(notApplied(1)).toBe('1 edit not applied')
    expect(SPEC).toContain(leftOutLine(1))
    expect(SPEC).toContain(NOTHING_TO_TAKE)
  })
  it('names the next Runway step for a painted mask with no fill', () => {
    const s = withMaskOp(EMPTY, stroke())
    expect(nextStep(s)).toBe('Next: Fill Mask 1')
    expect(SPEC).toContain(nextStep(s)!)
    const m = s.edits[0].id
    expect(nextStep(addEdit(s, { id: 'f', kind: 'fill', maskId: m, words: 'drops', keepOutside: true, jobId: 'job_1' }))).toBeUndefined()
  })
  it('gives the upscale output size from our 1344 x 768 frames (providers.md fact 7)', () => {
    expect(upscaleSize(1344, 768, 2)).toBe('→ 2688 × 1536')
    expect(upscaleSize(1344, 768, 4)).toBe('→ 5376 × 3072')
    expect(SPEC).toContain(upscaleSize(1344, 768, 2))
  })
})

describe('masks', () => {
  it('starts Mask 1 on the first stroke and adds later strokes to it', () => {
    let s = withMaskOp(EMPTY, stroke())
    s = withMaskOp(s, stroke())
    expect(s.edits).toHaveLength(1)
    expect(s.edits[0]).toMatchObject({ kind: 'mask', name: 'Mask 1' })
    expect(s.active).toBe(s.edits[0].id)
    expect(editLabel(s.edits[0], s)).toBe('Mask 1 · painting')
  })
  it('erasing with no mask does nothing, and ⌘Z takes back the last stroke only', () => {
    expect(withMaskOp(EMPTY, stroke('sub'))).toBe(EMPTY)
    let s = withMaskOp(withMaskOp(EMPTY, stroke()), stroke('sub'))
    s = undoMaskOp(s)
    expect(s.edits[0]).toMatchObject({ ops: [{ mode: 'add' }] })
  })
  it('Clear mask empties the mask, which then does not count', () => {
    const s = clearMask(withMaskOp(EMPTY, stroke()))
    expect(s.edits[0]).toMatchObject({ ops: [] })
    expect(editCount(s)).toBe(0)
  })
  it('names a second mask Mask 2', () => {
    let s = withMaskOp(EMPTY, stroke())
    s = withMaskOp({ ...s, active: undefined }, stroke())
    expect(s.edits.map((e) => e.kind === 'mask' && e.name)).toEqual(['Mask 1', 'Mask 2'])
  })
})

describe('what a step paints into (features/image-editor-masks-layers.clan)', () => {
  const lassoOp = (mode: 'add' | 'sub'): MaskOp => ({ t: 'lasso', mode, pts: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }] })
  const pick = (mode: 'add' | 'sub'): MaskOp => ({ t: 'pick', mode, w: 2, h: 2, rle: [0, 4] })
  it('any taking away with no mask (brush, lasso, pick, snap) changes nothing', () => {
    for (const op of [stroke('sub'), lassoOp('sub'), pick('sub'), { t: 'snap', cutout: 'c' } as MaskOp]) {
      expect(nothingToTake(EMPTY, op)).toBe(true)
      expect(withMaskOp(EMPTY, op)).toBe(EMPTY)
    }
    expect(nothingToTake(EMPTY, lassoOp('add'))).toBe(false)
    const s = withMaskOp(EMPTY, stroke())
    expect(nothingToTake(s, lassoOp('sub'))).toBe(false)
  })
  it('painting into a hidden active mask shows it', () => {
    let s = withMaskOp(EMPTY, stroke())
    const m = s.edits[0].id
    s = toggleHidden(s, m)
    expect(s.hidden).toEqual([m])
    s = withMaskOp(s, stroke())
    expect(s.hidden).toEqual([])
    expect(s.edits[0]).toMatchObject({ ops: [{}, {}] })
  })
  it('⌘Z takes back the active mask’s last stroke, and ⇧⌘Z puts it back', () => {
    let s = withMaskOp(EMPTY, stroke())
    s = withMaskOp(s, lassoOp('add'))
    const r = undoLast(s)
    expect(r.session.edits[0]).toMatchObject({ ops: [{ t: 'brush' }] })
    expect(r.undone).toMatchObject({ t: 'op', op: { t: 'lasso' } })
    expect(redoUndone(r.session, r.undone!)).toEqual(s)
  })
  it('with no stroke to take back, ⌘Z takes the last edit and what depends on it, and ⇧⌘Z brings them back', () => {
    let s = withMaskOp(EMPTY, stroke())
    const m = s.edits[0].id
    s = addEdit(s, { id: 't', kind: 'text', text: 'Hi', x: 0, y: 0, size: 0.1 })
    s = { ...clearMask(s), hidden: ['t'] }
    const r = undoLast(s)
    expect(r.session.edits.map((e) => e.id)).toEqual([m])
    expect(r.session.hidden).toEqual([])
    const back = redoUndone(r.session, r.undone!)
    expect(back.edits.map((e) => e.id)).toEqual([m, 't'])
    expect(back.hidden).toEqual(['t'])
    expect(undoLast(EMPTY)).toEqual({ session: EMPTY })
  })
})

describe('each edit has its own undo', () => {
  const base = (): EditSession => {
    let s = withMaskOp(EMPTY, stroke())
    const m = s.edits[0].id
    s = addEdit(s, { id: 'c', kind: 'cutout', where: 'device', sha: 'sha256:x' })
    s = withMaskOp(s, { t: 'snap', cutout: 'c' })
    s = addEdit(s, { id: 't', kind: 'text', text: 'Drink the morning.', x: 0.05, y: 0.86, size: 0.06 })
    s = addEdit(s, { id: 'f', kind: 'fill', maskId: m, words: 'drops', keepOutside: true, jobId: 'job_1' })
    return s
  }
  it('undoing a mask takes its fill with it', () => {
    const s = base()
    const out = undoEdit(s, s.edits[0].id)
    expect(out.edits.map((e) => e.id)).toEqual(['c', 't'])
    expect(out.active).toBeUndefined()
  })
  it("undoing a cut-out drops the mask's snap to it, and the mask stays", () => {
    const out = undoEdit(base(), 'c')
    expect(out.edits[0]).toMatchObject({ kind: 'mask', ops: [{ t: 'brush' }] })
  })
  it('undoing the text leaves the rest', () => {
    expect(undoEdit(base(), 't').edits.map((e) => e.kind)).toEqual(['mask', 'cutout', 'fill'])
  })
  it('lists text, masks, cut-outs, results and then the locked frame, front first', () => {
    let s = toggleHidden(base(), 'frame')
    s = addEdit(s, { id: 'u', kind: 'upscale', scale: 2, jobId: 'job_2' })
    const layers = layersOf(s, 3)
    expect(layers.map((l) => l.kind)).toEqual(['text', 'mask', 'cutout', 'upscale', 'fill', 'frame'])
    expect(layers.at(-1)).toMatchObject({ label: 'Frame', locked: true, hidden: true })
  })
  it('keeps the edits on the frame it makes, at most 64', () => {
    const ops = editsForFrame(base())
    expect(ops.map((o) => o.op)).toEqual(['mask', 'cutout', 'text', 'fill'])
    expect(ops[3].params).toMatchObject({ words: 'drops', keep_outside: true })
  })
})

describe('hidden layers (features/image-editor-masks-layers.clan, IM1 and IM3)', () => {
  const session = (): EditSession => {
    let s = withMaskOp(EMPTY, stroke())
    const m = s.edits[0].id
    s = addEdit(s, { id: 'f', kind: 'fill', maskId: m, words: 'drops', keepOutside: true, jobId: 'job_1' })
    s = addEdit(s, { id: 't', kind: 'text', text: 'Hi', x: 0, y: 0, size: 0.1 })
    return s
  }
  it('counts hidden edits apart from the ones Apply saves', () => {
    const s = toggleHidden(toggleHidden(session(), 't'), 'frame')
    expect(editCount(s)).toBe(2)
    expect(hiddenCount(s)).toBe(2) // the text and Frame
    expect(hiddenCount(s, ['text'])).toBe(1)
    expect(leftOutLine(1)).toBe('1 hidden layer is left out')
    expect(leftOutLine(2)).toBe('2 hidden layers are left out')
  })
  it('a frame keeps only the applied edits', () => {
    const s = toggleHidden(session(), 't')
    expect(editsForFrame(s).map((e) => e.op)).toEqual(['mask', 'fill'])
  })
  it('after Apply the hidden edits stay, hidden, with the masks their fills need', () => {
    expect(keptAfterApply(session())).toBeUndefined()
    const s = session()
    const m = s.edits[0].id
    const kept = keptAfterApply(toggleHidden(toggleHidden(toggleHidden(s, 'f'), 't'), 'frame'))!
    expect(kept.edits.map((e) => e.id)).toEqual([m, 'f', 't'])
    expect(kept.hidden).toEqual([m, 'f', 't'])
    expect(editCount(kept)).toBe(0)
  })
})
