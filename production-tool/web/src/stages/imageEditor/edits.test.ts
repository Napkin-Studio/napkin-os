// The Image editor's edits list (ui-behaviour 3.12, features/image-editor.clan).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EMPTY, addEdit, applyLine, textLayerName, clearMask, editCount, editLabel, editsForFrame, layersOf, nextStep, notApplied,
  toggleHidden, undoEdit, undoMaskOp, upscaleSize, fillPlaceholder, withMaskOp, nothingToTake, undoLast, redoUndone, hiddenCount, leftOutLine, NOTHING_TO_TAKE,
  afterSend, hasFill, newMask, pendingCount, rowFirst, sendRow,
  type EditSession, type MaskOp,
} from './edits'

const SPEC = readFileSync(new URL('../../../../../docs/production-tool/ui-behaviour.md', import.meta.url), 'utf8')
const stroke = (mode: 'add' | 'sub' = 'add'): MaskOp => ({ t: 'brush', mode, r: 0.02, soft: 0.2, pts: [{ x: 0.5, y: 0.5 }] })

describe('the words match 3.12', () => {
  it('says what Apply makes and what is not applied', () => {
    expect(applyLine(3, 3)).toBe('Apply saves your 3 edits as v4. v3 stays.')
    expect(SPEC).toContain(applyLine(3, 3))
    expect(SPEC).toContain(notApplied(3))
    expect(notApplied(1)).toBe('1 edit not applied')
    expect(SPEC).toContain(leftOutLine(1))
    expect(SPEC).toContain(NOTHING_TO_TAKE)
  })
  it('names the next Runway step for a painted mask with no fill', () => {
    const s = withMaskOp(EMPTY, stroke())
    expect(nextStep(s)).toBe('Next: Fill or remove Mask 1')
    expect(SPEC).toContain(nextStep(s)!)
    const m = s.edits[0].id
    expect(nextStep(addEdit(s, { id: 'f', kind: 'fill', maskId: m, ops: [stroke()], words: 'drops', keepOutside: true, jobId: 'job_1' }))).toBeUndefined()
  })
  it('gives the upscale output size from our 1344 x 768 frames (providers.md fact 7)', () => {
    expect(upscaleSize(1344, 768, 2)).toBe('→ 2688 × 1536')
    expect(upscaleSize(1344, 768, 4)).toBe('→ 5376 × 3072')
    // What Runway returned in UAT round 2 (R2-8): a 1638 x 2048 picture read at 1536 a side, then 2x.
    expect(upscaleSize(1638, 2048, 2)).toBe('→ 2458 × 3072')
    expect(upscaleSize(1365, 768, 2)).toBe('→ 2730 × 1536')
    expect(fillPlaceholder(true, false)).toMatch(/^What goes in the blue area/)
    expect(fillPlaceholder(true, true)).toMatch(/^Filled\./)
    expect(fillPlaceholder(false, false)).toBe('Paint or lasso an area first')
    expect(fillPlaceholder(true, false, 'Mask 1')).toBe('Mask 1 is hidden. Show it to fill.')
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
  it('any taking away with no mask (brush, lasso) changes nothing', () => {
    for (const op of [stroke('sub'), lassoOp('sub')]) {
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
    s = addEdit(s, { id: 'c', kind: 'whole', words: 'warmer', jobId: 'job_w' })
    s = addEdit(s, { id: 't', kind: 'text', text: 'Drink the morning.', x: 0.05, y: 0.86, size: 0.06 })
    s = addEdit(s, { id: 'f', kind: 'fill', maskId: m, ops: [stroke()], words: 'drops', keepOutside: true, jobId: 'job_1' })
    return s
  }
  it('undoing a mask takes its fill with it', () => {
    const s = base()
    const out = undoEdit(s, s.edits[0].id)
    expect(out.edits.map((e) => e.id)).toEqual(['c', 't'])
    expect(out.active).toBeUndefined()
  })
  it('undoing a whole-frame change leaves the mask', () => {
    const out = undoEdit(base(), 'c')
    expect(out.edits[0]).toMatchObject({ kind: 'mask', ops: [{ t: 'brush' }] })
  })
  it('undoing the text leaves the rest', () => {
    expect(undoEdit(base(), 't').edits.map((e) => e.kind)).toEqual(['mask', 'whole', 'fill'])
  })
  it('lists text, masks, results and then the locked frame, front first', () => {
    let s = toggleHidden(base(), 'frame')
    s = addEdit(s, { id: 'u', kind: 'upscale', scale: 2, jobId: 'job_2' })
    const layers = layersOf(s, 3)
    expect(layers.map((l) => l.kind)).toEqual(['text', 'mask', 'upscale', 'fill', 'whole', 'frame'])
    expect(layers.at(-1)).toMatchObject({ label: 'Frame', locked: true, hidden: true })
  })
  it('names a text layer by its words, cut to fit (re-test R3)', () => {
    expect(textLayerName('KEEP ME')).toBe('"KEEP ME"')
    expect(textLayerName('  Drink   the morning, every single day of the week ')).toBe('"Drink the morning, ever…"')
    expect(textLayerName('   ')).toBe('Text')
    const s = addEdit(addEdit(EMPTY, { id: 'a', kind: 'text', text: 'KEEP ME', x: 0, y: 0, size: 0.06 }), { id: 'b', kind: 'text', text: 'HIDE ME', x: 0, y: 0, size: 0.06 })
    expect(layersOf(s, 1).map((l) => l.label)).toEqual(['"HIDE ME"', '"KEEP ME"', 'Frame'])
  })
  it('keeps the edits on the frame it makes, at most 64', () => {
    const ops = editsForFrame(base())
    expect(ops.map((o) => o.op)).toEqual(['mask', 'whole', 'text', 'fill'])
    expect(ops[3].params).toMatchObject({ words: 'drops', keep_outside: true })
  })
})

describe('hidden layers (features/image-editor-masks-layers.clan, IM1; owner 2026-11-18 replaces IM3)', () => {
  const session = (): EditSession => {
    let s = withMaskOp(EMPTY, stroke())
    const m = s.edits[0].id
    s = addEdit(s, { id: 'f', kind: 'fill', maskId: m, ops: [stroke()], words: 'drops', keepOutside: true, jobId: 'job_1' })
    s = addEdit(s, { id: 't', kind: 'text', text: 'Hi', x: 0, y: 0, size: 0.1 })
    return s
  }
  it('counts hidden edits apart from the ones Apply saves', () => {
    const s = toggleHidden(toggleHidden(session(), 't'), 'frame')
    expect(editCount(s)).toBe(1) // the fill; the mask is never applied
    expect(hiddenCount(s)).toBe(2) // the text and Frame
    expect(hiddenCount(s, ['text'])).toBe(1)
    expect(leftOutLine(1)).toBe('1 hidden layer is left out')
    expect(leftOutLine(2)).toBe('2 hidden layers are left out')
  })
  it('a frame keeps only the applied edits', () => {
    const s = toggleHidden(session(), 't')
    expect(editsForFrame(s).map((e) => e.op)).toEqual(['mask', 'fill'])
  })
  it('the Apply line says hidden layers stay out of the new version and are not kept', () => {
    expect(applyLine(1, 1)).toBe('Apply saves your 1 edit as v2. v1 stays.')
    expect(applyLine(1, 1, 1)).toBe('Apply saves your 1 edit as v2. v1 stays. 1 hidden layer is left out and not kept.')
    expect(applyLine(2, 3, 2)).toBe('Apply saves your 2 edits as v4. v3 stays. 2 hidden layers are left out and not kept.')
  })
})

describe('fixes from the live test of 2026-11-17 (features/production-new-ui.clan P5)', () => {
  const op = { t: 'brush' as const, mode: 'add' as const, r: 0.05, soft: 0, pts: [{ x: 0.2, y: 0.2 }] }
  it('after a fill is sent the next stroke starts Mask 2; New mask starts one on purpose', () => {
    let s = withMaskOp(EMPTY, op)
    s = addEdit(s, { id: 'f1', kind: 'fill', maskId: s.active!, ops: [op], words: 'a balloon', keepOutside: true, jobId: 'job_1' })
    expect(hasFill(s, s.active!)).toBe(true) // the editor then starts the next stroke on a new mask
    s = afterSend(s)
    s = withMaskOp(s, op)
    const names = s.edits.filter((e) => e.kind === 'mask').map((e) => (e as { name: string }).name)
    expect(names).toEqual(['Mask 1', 'Mask 2'])
    const n = newMask(s)
    expect(n.edits.find((e) => e.id === n.active)).toMatchObject({ kind: 'mask', name: 'Mask 3', ops: [] })
  })
  it('a mask is not an edit in the count; the leave ask counts an unfilled mask and hidden edits', () => {
    let s = withMaskOp(EMPTY, op)
    expect(editCount(s)).toBe(0)
    expect(pendingCount(s)).toBe(1)
    s = addEdit(s, { id: 'f1', kind: 'fill', maskId: s.active!, ops: [op], words: 'x', keepOutside: true, jobId: 'job_1' })
    expect(editCount(s)).toBe(1)
    expect(pendingCount(s)).toBe(1)
    expect(pendingCount(toggleHidden(s, 'f1'))).toBe(1)
  })
  it('an empty mask that is not being painted is not a layer', () => {
    const s = { edits: [{ id: 'm1', kind: 'mask' as const, name: 'Mask 1', ops: [] }], hidden: [] }
    expect(layersOf(s, 1).map((l) => l.id)).toEqual(['frame'])
    expect(layersOf({ ...s, active: 'm1' }, 1).map((l) => l.id)).toEqual(['m1', 'frame'])
  })
  it('the row is in the session, written down, the moment the person confirms; it goes if the first send fails', async () => {
    let s: EditSession = EMPTY
    const set = (f: (x: EditSession) => EditSession) => { s = f(s) }
    let kept = 0
    const a = rowFirst(set, { id: 'w1', kind: 'whole', words: 'golden hour' }, 'job_A', () => { kept++ })
    // Before anything async: the row with its words, not sent, and written down (re-test N1).
    expect(s.edits).toEqual([{ id: 'w1', kind: 'whole', words: 'golden hour', jobId: 'job_A', unsent: true }])
    expect(kept).toBe(1)
    let release!: (id: string) => void
    const p = sendRow(set, a, () => new Promise((r) => { release = r }), { dropOnFail: true })
    expect(s.edits[0]).toMatchObject({ unsent: true })
    release('job_A')
    await p
    expect(s.edits).toEqual([{ id: 'w1', kind: 'whole', words: 'golden hour', jobId: 'job_A' }])
    const b = rowFirst(set, { id: 'w2', kind: 'whole', words: 'no' }, 'job_B', () => {})
    await expect(sendRow(set, b, () => Promise.reject(new Error('refused')), { dropOnFail: true })).rejects.toThrow('refused')
    expect(s.edits.map((e) => e.id)).toEqual(['w1'])
  })
  it('Send again goes with the same job id, and a failed one stays not sent', async () => {
    let s: EditSession = EMPTY
    const set = (f: (x: EditSession) => EditSession) => { s = f(s) }
    const a = rowFirst(set, { id: 'f1', kind: 'fill', maskId: 'm1', ops: [], words: 'a red kite', keepOutside: true }, 'job_C', () => {})
    const ids: string[] = []
    await expect(sendRow(set, a, (e) => { ids.push(e.jobId); return Promise.reject(new Error('offline')) }, { dropOnFail: false })).rejects.toThrow('offline')
    expect(s.edits[0]).toMatchObject({ jobId: 'job_C', unsent: true, words: 'a red kite' })
    await sendRow(set, a, async (e) => { ids.push(e.jobId); return e.jobId }, { dropOnFail: false })
    expect(ids).toEqual(['job_C', 'job_C'])
    expect(s.edits[0]).not.toHaveProperty('unsent')
  })
})

describe('a text just placed (re-test 6c)', () => {
  it('starts empty: it is no edit, never in the frame’s record, until it has words', () => {
    let s = addEdit(EMPTY, { id: 't1', kind: 'text', text: '', x: 0.1, y: 0.1, size: 0.06 })
    expect(editCount(s)).toBe(0)
    expect(editsForFrame(s)).toEqual([])
    expect(editLabel(s.edits[0], s)).toBe('Text · typing')
    s = { ...s, edits: s.edits.map((e) => (e.kind === 'text' ? { ...e, text: 'Lumo.' } : e)) }
    expect(editCount(s)).toBe(1)
    expect(editsForFrame(s)).toEqual([{ op: 'text', params: { text: 'Lumo.' } }])
  })
})

// UAT round 3 R3-4: 2x of an upscaled 3072 x 1318 picture promised 3072 x 1318 again, and was paid for.
describe('Upscale only when it makes the picture bigger (pt-canvas-r3)', () => {
  it('is off for 2x of a picture already past twice what the upscaler reads, and says why; 4x still grows it', async () => {
    const { upscaleGrows, upscaleWhyNot, sameLine } = await import('./edits')
    expect(upscaleGrows(3072, 1318, 2)).toBe(false)
    expect(upscaleWhyNot(3072, 1318, 2)).toBe('Already full size: the upscaler reads at most 1536 px a side, so 2× gives 3072 px, as it is now. 4× makes it bigger.')
    expect(upscaleGrows(3072, 1318, 4)).toBe(true)
    expect(upscaleWhyNot(2048, 878, 2)).toBeUndefined()
    expect(upscaleGrows(1536, 864, 2)).toBe(true)
    const { editLabel } = await import('./edits')
    const mask = { id: 'm', kind: 'mask' as const, name: 'Mask 1', ops: [{ t: 'lasso' as const, mode: 'add' as const, pts: [] }] }
    const fill = { id: 'f', kind: 'fill' as const, maskId: 'm', ops: [], words: 'x', keepOutside: true, jobId: 'j' }
    expect(editLabel(mask, { edits: [mask], hidden: [], active: 'm' })).toBe('Mask 1 · painting')
    expect(editLabel(mask, { edits: [mask, fill], hidden: [], active: 'm' })).toBe('Mask 1') // spent (R3-3)
    expect(sameLine({ id: 'f', kind: 'fill', maskId: 'm', ops: [], words: 'x', keepOutside: true, jobId: 'j' })).toBe('The fill came back unchanged.')
  })
})
