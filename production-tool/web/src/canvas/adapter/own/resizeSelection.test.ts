// Resize selected pictures (features/resize-selection.clan): the bar's entry, the shapes and the custom
// one, the remembered pick, the count, Auto, a mixed selection, the placement beside each original as one
// undo step, one job per picture × shape, a named picture's views on Redraw only, a scamp redrawn as a
// sketch, and still formats only from a picture.

import { describe, expect, it, vi } from 'vitest'
import type { AssetRef, JobInput, JobInputRef, NamedRef, ProductionDocument } from '../../../contracts/types'
import { OwnAdapter } from './adapter'
import type { CanvasElement } from '../../core/canvasAdapter'
import { cd } from '../../scene'
import { barFor, type SelInfo } from '../../selbar/selbar'
import { newId } from '../../../lib/ulid'
import { SHA } from '../../../test/model'
import { choicesFor, FILMS_FROM_VIDEO, rowsFor } from '../../../campaign/formats'
import { autoMethod, methodModels } from '../../../campaign/rules'
import {
  deliveryOf, frameOver, loadPick, makeWords, methodOf, mixedLine, otherViews, parseCustom, placeResults, planResize, planSlots, tooFarToExtend, tooFarWords,
  resizableIn, resizeInput, resizePictures, savePick, SHAPES, trayRows, knownProtect, type Source,
} from '../../../campaign/resizeSelection'

const models = methodModels()
const shape = (id: string) => SHAPES.find((s) => s.id === id)!

function canvasWith(n = 3, gap = 360) {
  const a = new OwnAdapter()
  const pics = Array.from({ length: n }, (_, i) => a.imageNode({ x: i * gap, y: 0, width: 300, height: 169, assetSha: SHA(String.fromCharCode(97 + i)), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA(String.fromCharCode(97 + i)) } }))
  a.transact((els) => [...els, ...pics], { undoable: false })
  const src = (e: CanvasElement, extra: Partial<Source> = {}): Source => ({ elId: e.id, nodeId: (e.customData as { id: string }).id, asset: (e.customData as { asset: string }).asset, w: 1920, h: 1080, kind: 'picture', ...extra })
  return { a, pics, sources: pics.map((p) => src(p)), src }
}

const boxes = (els: readonly CanvasElement[]) => els.filter((e) => !e.isDeleted && e.type !== 'arrow').map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.width, h: e.height }))
const overlap = (p: { x: number; y: number; w: number; h: number }, q: { x: number; y: number; w: number; h: number }) => p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y

describe('shapes', () => {
  it('has the seven chips, and a custom size in pixels or a ratio', () => {
    expect(SHAPES.map((s) => s.id)).toEqual(['9:16', '4:5', '1:1', '16:9', '2:3', '3:2', '21:9'])
    expect(parseCustom('1200x628')).toEqual({ id: '1200×628', w: 1200, h: 628, px: true })
    expect(parseCustom(' 1200 × 628 ')?.id).toBe('1200×628')
    expect(parseCustom('4:1')).toMatchObject({ id: '4:1', w: 4, h: 1 })
    expect(parseCustom('9:1')).toBeNull() // past 8:1
    expect(parseCustom('20x20')).toBeNull()
    expect(parseCustom('wide')).toBeNull()
  })
  it('a ratio is delivered at 2048 on its long side; a custom size as it is', () => {
    expect(deliveryOf(shape('9:16'))).toEqual({ width: 1152, height: 2048 })
    expect(deliveryOf(shape('21:9'))).toEqual({ width: 2048, height: 878 })
    expect(deliveryOf(parseCustom('1200x628')!)).toEqual({ width: 1200, height: 628 })
  })
})

describe('the bar entry and a mixed selection', () => {
  it('pictures, results and scamps (a Drawing, a sketch area) are resizable; notes, strokes, nodes and unfinished results are not', () => {
    const a = new OwnAdapter()
    const pic = a.imageNode({ x: 0, y: 0, width: 300, height: 200, assetSha: SHA('a'), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA('a') } })
    const gen = a.imageNode({ x: 0, y: 300, width: 300, height: 200, assetSha: SHA('b'), status: 'saved', customData: { kind: 'gen', id: newId('job'), op: 'generate', parentIds: [], state: 'completed', asset: SHA('b') } })
    const pending = a.imageNode({ x: 0, y: 600, width: 300, height: 200, assetSha: null, status: 'pending', customData: { kind: 'gen', id: newId('job'), op: 'generate', parentIds: [], state: 'running' } })
    const drawing = a.frameAround({ x: 400, y: 0, width: 200, height: 200, name: 'Drawing', customData: { kind: 'drawn', id: newId('node'), asset: SHA('c') } })
    const area = a.sketchArea({ x: 700, y: 0, w: 320, h: 180, sketchId: newId('sketch') })
    const node = a.node({ x: 0, y: 900, width: 300, height: 200, customData: { kind: 'script', id: newId('script') } })
    const r = resizableIn([pic, gen, pending, drawing, area, node])
    expect(r.items.map((e) => e.id)).toEqual([pic.id, gen.id, drawing.id, area.id])
    expect(r.total).toBe(6)
    // Loose pen strokes are one drawing (wrapped as a Drawing when sent); those inside a selected sketch area are its own.
    const stroke = (id: string, x: number, y: number) => ({ ...pic, id, type: 'freedraw', customData: undefined, x, y, width: 80, height: 40 }) as CanvasElement
    const ink = stroke('ink1', 1200, 0)
    const ink2 = stroke('ink2', 1300, 0)
    const inArea = stroke('ink3', 720, 20)
    const withInk = resizableIn([pic, area, ink, ink2, inArea])
    expect(withInk.strokes.map((e) => e.id)).toEqual([ink.id, ink2.id])
    expect(withInk.count).toBe(3)
    expect(withInk.total).toBe(3)
    expect(mixedLine(3, 5)).toBe('3 of 5 selected are pictures')
    expect(mixedLine(1, 2)).toBe('1 of 2 selected is a picture')
    expect(mixedLine(3, 3)).toBeUndefined()
  })
  it('the node bar offers Resize… only when pictures are among the selection', () => {
    const sel = (s: Partial<SelInfo>): SelInfo => ({ cards: [], links: 0, group: null, units: 1, locked: false, ...s })
    expect(barFor(sel({ cards: ['script'], units: 3, pictures: 2 })).map((x) => x.id)).toEqual(['resize', 'group', 'move-to-board', 'delete'])
    expect(barFor(sel({ cards: ['script'], units: 3 })).map((x) => x.id)).toEqual(['group', 'move-to-board', 'delete'])
    expect(barFor(sel({ group: { ink: false, key: { label: 'Samurai · 3 views', stacked: false } }, pictures: 3 })).map((x) => x.id)).toEqual(['stack', 'resize', 'move-to-board', 'delete'])
    expect(barFor(sel({ cards: ['script'], units: 3, pictures: 2 }))[0]).toMatchObject({ label: 'Resize…' })
    expect(barFor(sel({ group: { ink: true }, pictures: 1 })).map((x) => x.id)).toEqual(['generate', 'convert', 'resize', 'ungroup', 'move-to-board', 'delete'])
  })
})

describe('how, and the count', () => {
  it('Redraw is regenerate, Extend extend, Crop crop; a way the agency has off is null', () => {
    const p = { w: 1920, h: 1080 }
    expect(methodOf('regenerate', p, shape('9:16'), models)).toBe('regenerate')
    expect(methodOf('extend', p, shape('4:5'), models)).toBe('extend')
    expect(methodOf('crop', p, shape('9:16'), models)).toBe('crop')
    expect(methodOf('extend', p, shape('4:5'), { regenerate: models.regenerate })).toBeNull()
  })
  it('Extend to a shape past three steps of 35 % is a Redraw at that shape, said in plain words (UAT round 4 S1-1)', () => {
    // The live repro: a 1536 x 864 sunset to 9:16 (3.2x) stacked four suns in three bigger steps.
    const p = { w: 1536, h: 864 }
    expect(methodOf('extend', p, shape('9:16'), models)).toBe('regenerate')
    expect(methodOf('extend', p, shape('21:9'), models)).toBe('extend')
    expect(methodOf('extend', p, shape('9:16'), { extend: models.extend })).toBeNull() // Redraw off: nothing is made
    const far = tooFarToExtend('extend', [p], [shape('9:16'), shape('21:9'), shape('4:5')])
    expect(far.map((s) => s.id)).toEqual(['9:16'])
    expect(tooFarToExtend('regenerate', [p], [shape('9:16')])).toEqual([])
    expect(tooFarWords(far, models)).toBe("9:16 is too far from this picture's shape to extend without repeating it, so it is redrawn at that shape from the picture instead (Redraw).")
    expect(trayRows(planResize([{ ...p, elId: 'a', asset: 'x', kind: 'picture' } as never], [shape('9:16')], 'extend', models), models, () => 'P')[0].words).toBe('Redraw · Gemini 3 Pro')
  })
  it('Auto: crop when little is lost, extend when close, redraw when the picture would sit small', () => {
    expect(autoMethod({ w: 1920, h: 1080 }, { w: 3, h: 2 })).toBe('crop')
    expect(autoMethod({ w: 1920, h: 1080 }, { w: 1, h: 1 })).toBe('extend')
    expect(autoMethod({ w: 1920, h: 1080 }, { w: 9, h: 16 })).toBe('regenerate')
    expect(autoMethod({ w: 1920, h: 1080 }, { w: 1, h: 1 }, new Set(['crop', 'regenerate']))).toBe('regenerate')
  })
  it('the footer counts pictures × shapes exactly; the tray names each with its method and model, no price', () => {
    const { sources } = canvasWith()
    const planned = planResize(sources, [shape('9:16'), shape('1:1')], 'regenerate', models)
    expect(planned).toHaveLength(6)
    expect(makeWords(planned.length)).toBe('Make 6 pictures')
    expect(makeWords(1)).toBe('Make 1 picture')
    const rows = trayRows(planned, models, (_s, i) => `Picture ${i + 1}`)
    expect(rows[0]).toMatchObject({ name: 'Picture 1 · 9:16', words: 'Redraw · Gemini 3 Pro' })
    expect(rows[5].name).toBe('Picture 3 · 1:1')
    expect(trayRows(planResize(sources, [shape('9:16')], 'crop', models), models, () => 'P')[0].words).toBe('Crop')
    expect(JSON.stringify(rows)).not.toMatch(/\$|USD|credit|cost/i)
  })
  it('the preview draws a crop inside the picture and an extend or a redraw round it', () => {
    const p = { w: 1600, h: 900 }
    const c = frameOver(p, shape('1:1'), 'crop')
    expect(c).toEqual({ x: 350, y: 0, w: 900, h: 900 })
    const e = frameOver(p, shape('1:1'), 'extend')
    expect(e).toEqual({ x: 0, y: -350, w: 1600, h: 1600 })
  })
})

describe('the last How, in this browser (never the shapes: UAT round 1 IMG-17)', () => {
  it('is kept and read back; old saved shapes are ignored; broken or missing storage starts afresh', () => {
    const mem = new Map<string, string>()
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    savePick({ how: 'extend' }, store)
    expect(loadPick(store)).toEqual({ how: 'extend' })
    expect(mem.get('napkin.resize.last')).toBe('{"how":"extend"}')
    mem.set('napkin.resize.last', JSON.stringify({ shapes: [shape('9:16')], how: 'crop' }))
    expect(loadPick(store)).toEqual({ how: 'crop' })
    mem.set('napkin.resize.last', '{nope')
    expect(loadPick(store)).toEqual({ how: 'regenerate' })
    expect(loadPick({ getItem: () => { throw new Error('blocked') } })).toEqual({ how: 'regenerate' })
    expect(() => savePick({ how: 'crop' }, { setItem: () => { throw new Error('full') } })).not.toThrow()
  })
})

describe('a crop keeps what must stay, and can be moved (UAT round 1 IMG-4)', () => {
  const wide = { elId: 'p', nodeId: 'n', asset: SHA('w'), w: 1600, h: 900, kind: 'picture' as const }
  const person = { role: 'subject' as const, x: 120, y: 200, w: 200, h: 600 }
  const ref = (sha: string): AssetRef => ({ sha256: sha, url: `https://cdn.test/${sha.slice(7, 12)}`, mime: 'image/png' })

  it('the preview frame is the relay\'s crop: round the subject when one is marked, the middle otherwise', () => {
    const middle = frameOver(wide, shape('4:5'), 'crop')
    expect(middle.x).toBe((1600 - middle.w) / 2)
    const kept = frameOver({ ...wide, protect: [person] }, shape('4:5'), 'crop')
    expect(kept.x).toBeLessThanOrEqual(person.x)
    expect(kept.x + kept.w).toBeGreaterThanOrEqual(person.x + person.w)
    expect(frameOver(wide, shape('4:5'), 'crop', { x: 10, y: 0, w: 720, h: 900 })).toEqual({ x: 10, y: 0, w: 720, h: 900 })
  })

  it('the job carries what must stay, and a moved crop on a crop only', () => {
    const src = { ...wide, protect: [person] }
    const crop = resizeInput({ source: src, shape: shape('4:5'), method: 'crop', crop: { x: 10.4, y: 0, w: 720, h: 900 } }, ref(SHA('w')))
    expect(crop.resize).toMatchObject({ method: 'crop', protect: [person], crop: { x: 10, y: 0, w: 720, h: 900 }, masterSize: { w: 1600, h: 900 } })
    const redraw = resizeInput({ source: src, shape: shape('4:5'), method: 'regenerate', crop: { x: 10, y: 0, w: 720, h: 900 } }, ref(SHA('w')))
    expect(redraw.resize).toMatchObject({ protect: [person] })
    expect(redraw.resize?.crop).toBeUndefined()
    expect(resizeInput({ source: wide, shape: shape('4:5'), method: 'crop' }, ref(SHA('w'))).resize?.protect).toBeUndefined()
  })

  it('uses a Make all sizes set\'s boxes for the same picture, scaled to its pixels', () => {
    const doc = { format_sets: { fs1: { master: { kind: 'picture', id: 'n', w: 3200, h: 1800 }, protect: { boxes: [{ ...person, x: 240, y: 400, w: 400, h: 1200 }] } } } } as never
    expect(knownProtect(doc, wide)).toEqual([person])
    expect(knownProtect({ format_sets: {} } as never, wide)).toBeUndefined()
  })
})

describe('placing the results', () => {
  it('each result lands beside its original, labelled with its shape, with an arrow from it, clear of everything; one undo takes them all', () => {
    const { a, sources } = canvasWith()
    const before = a.elements().length
    const planned = planResize(sources, [shape('9:16'), shape('1:1')], 'regenerate', models)
    const ids = placeResults(a, planned)
    expect(ids).toHaveLength(6)
    const gens = a.elements().filter((e) => cd(e)?.kind === 'gen')
    expect(gens.map((g) => (cd(g) as { shape?: string }).shape)).toEqual(['9:16', '1:1', '9:16', '1:1', '9:16', '1:1'])
    expect(gens.every((g) => (cd(g) as { op: string }).op === 'resize')).toBe(true)
    const arrows = a.elements().filter((e) => cd(e)?.kind === 'provenance')
    expect(arrows).toHaveLength(6)
    expect(arrows.map((x) => (cd(x) as { from: string }).from)).toEqual(planned.map((p) => p.source.nodeId))
    // Nothing overlaps anything.
    const all = boxes(a.elements())
    for (const p of all) for (const q of all) if (p.id !== q.id) expect(overlap(p, q), `${p.id} over ${q.id}`).toBe(false)
    // Pictures in a row: each picture's results go under it, nearest its original.
    const pics = sources.map((s) => a.elements().find((e) => e.id === s.elId)!)
    gens.forEach((g, i) => {
      const pic = pics[Math.floor(i / 2)]
      expect(g.x).toBe(pic.x)
      expect(g.y).toBeGreaterThan(pic.y + pic.height)
    })
    // One undo step.
    expect(a.undoScene('undo')).toBe(true)
    expect(a.elements().length).toBe(before)
    expect(a.elements().some((e) => cd(e)?.kind === 'gen' || cd(e)?.kind === 'provenance')).toBe(false)
  })

  it('one picture: its results in a row to its right; a crowded row goes to the next free place', () => {
    const { a, pics } = canvasWith(1)
    const p = pics[0]
    const [row] = planSlots(a.elements(), [{ el: p, sizes: [{ w: 169, h: 300 }, { w: 300, h: 300 }] }])
    expect(row[0]).toEqual({ x: p.x + p.width + 80, y: p.y })
    expect(row[1]).toEqual({ x: row[0].x + 169 + 40, y: p.y })
    // Something to the right and something below: past what is in the way.
    const right = a.imageNode({ x: 400, y: 0, width: 200, height: 200, assetSha: SHA('x'), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA('x') } })
    const below = a.imageNode({ x: 0, y: 260, width: 300, height: 300, assetSha: SHA('y'), status: 'saved', customData: { kind: 'pic', id: newId('node'), asset: SHA('y') } })
    a.transact((els) => [...els, right, below], { undoable: false })
    const [moved] = planSlots(a.elements(), [{ el: a.elements().find((e) => e.id === p.id)!, sizes: [{ w: 169, h: 300 }] }])
    expect(moved[0].x).toBeGreaterThanOrEqual(600 + 80)
    expect(moved[0].y).toBe(0)
  })

  it('a result whose original is on a board goes on that board', () => {
    const { a, pics, src } = canvasWith(1)
    const board = a.board({ x: -40, y: -60, width: 400, height: 300, title: 'Refs', boardId: newId('board'), purpose: 'refs' })
    a.transact((els) => [board, ...els.map((e) => (e.id === pics[0].id ? a.patch(e, { frameId: board.id }) : e))], { undoable: false })
    placeResults(a, planResize([src(pics[0])], [shape('1:1')], 'crop', models))
    const gen = a.elements().find((e) => cd(e)?.kind === 'gen')!
    expect(gen.frameId).toBe(board.id)
  })
})

describe('the jobs', () => {
  const ref = (sha: string): AssetRef => ({ sha256: sha, url: `https://cdn.test/${sha.slice(7, 12)}`, mime: 'image/png' })
  const views: NamedRef[] = [
    { id: 'ref_front', v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: SHA('a') },
    { id: 'ref_side', v: 1, field_v: {}, key: 'maya', variant: 'side', role: 'character', asset: SHA('s') },
    { id: 'ref_back', v: 1, field_v: {}, key: 'maya', variant: 'back', role: 'character', asset: SHA('t') },
    { id: 'ref_other', v: 1, field_v: {}, key: 'bob', variant: 'front', role: 'character', asset: SHA('u') },
  ]
  const doc = { refs: Object.fromEntries(views.map((r) => [r.id, r])) } as unknown as ProductionDocument

  function run(how: 'regenerate' | 'extend' | 'crop', named = true, fail?: number) {
    const { a, sources } = canvasWith()
    sources[0].named = named ? views[0] : undefined
    const sent: { op: string; input: JobInput; purpose: unknown; jobId: string }[] = []
    let n = 0
    const runner = {
      submit: vi.fn(async (op: string, input: JobInput, _p: string[], purpose: unknown, jobId?: string) => {
        if (n++ === fail) throw new Error('spend stop')
        sent.push({ op, input, purpose, jobId: jobId! })
        return jobId!
      }),
    }
    const deps = { canvas: a, runner: runner as never, ref: async (sha: string) => ref(sha), named: async (r: NamedRef): Promise<JobInputRef> => ({ id: r.id, name: `${r.key}_${r.variant}`, role: r.role, kind: 'picture', asset: ref(r.asset!) }), doc: () => doc }
    return { a, sources, sent, runner, go: () => resizePictures(deps, planResize(sources, [shape('9:16'), shape('1:1')], how, models)) }
  }

  it('one resize job per picture × shape, for the canvas, each named by its result', async () => {
    const { sent, go, a } = run('regenerate')
    const ids = await go()
    expect(sent).toHaveLength(6)
    expect(sent.every((s) => s.op === 'resize' && (s.purpose as { for: string }).for === 'canvas')).toBe(true)
    expect(new Set(sent.map((s) => s.jobId))).toEqual(new Set(ids))
    sent.sort((x, y) => ids.indexOf(x.jobId) - ids.indexOf(y.jobId))
    expect(ids.every((id) => a.elements().some((e) => e.id === id))).toBe(true)
    expect(sent[0].input).toMatchObject({ aspect: { w: 1152, h: 2048 }, delivery: { width: 1152, height: 2048 }, resize: { method: 'regenerate', masterSize: { w: 1920, h: 1080 }, previewMaxPx: 2048 } })
  })

  it('Redraw of a named picture sends its key\'s other views; its other pictures and Extend send the picture only', async () => {
    const r = run('regenerate')
    const ids = await r.go()
    r.sent.sort((x, y) => ids.indexOf(x.jobId) - ids.indexOf(y.jobId))
    expect(r.sent[0].input.refs?.map((x) => x.id)).toEqual(['ref_side', 'ref_back'])
    expect(r.sent[2].input.refs).toBeUndefined()
    const e = run('extend')
    await e.go()
    // 1:1 extends and sends the picture only; 9:16 is past three extend steps of a 16:9 picture, so it is a Redraw.
    const extended = e.sent.filter((s) => s.input.resize?.method === 'extend')
    expect(extended.length).toBeGreaterThan(0)
    expect(extended.every((s) => !s.input.refs)).toBe(true)
    expect(e.sent.some((s) => s.input.aspect?.h === 2048 && s.input.resize?.method === 'regenerate' && s.input.resize.masterSize.w === 1920)).toBe(true)
    expect(otherViews(doc, views[0]).map((x) => x.id)).toEqual(['ref_side', 'ref_back'])
    expect(otherViews(doc, undefined)).toEqual([])
  })

  it('a failed send leaves the others going', async () => {
    const r = run('crop', false, 1)
    const ids = await r.go()
    expect(ids).toHaveLength(6)
    expect(r.sent).toHaveLength(5)
  })

  it('a scamp is redrawn as a sketch; cropped or extended as a picture', () => {
    const s: Source = { elId: 'e', nodeId: 'sketch_1', asset: SHA('k'), w: 1600, h: 900, kind: 'sketch' }
    expect(resizeInput({ source: s, shape: shape('1:1'), method: 'regenerate' }, ref(SHA('k'))).resize).toMatchObject({ method: 'regenerate', source: 'sketch' })
    expect(resizeInput({ source: { ...s, kind: 'drawing' }, shape: shape('1:1'), method: 'regenerate' }, ref(SHA('k'))).resize?.source).toBe('sketch')
    expect(resizeInput({ source: s, shape: shape('1:1'), method: 'crop' }, ref(SHA('k'))).resize?.source).toBeUndefined()
    expect(resizeInput({ source: { ...s, kind: 'picture' }, shape: shape('1:1'), method: 'regenerate' }, ref(SHA('k'))).resize?.source).toBeUndefined()
    expect(resizeInput({ source: s, shape: parseCustom('1200x628')!, method: 'crop' }, ref(SHA('k')))).toMatchObject({ aspect: { w: 1200, h: 628 }, delivery: { width: 1200, height: 628 } })
  })
})

describe('Make all sizes from a picture or a scamp: stills only (owner, 2026-10-16)', () => {
  it('Campaign launch from a picture is its 17 stills, no film; from a Film node the films are there', () => {
    const still = rowsFor({ kind: 'plan', id: 'campaign-launch' }, 'image')
    expect(still).toHaveLength(17)
    expect(still.every((r) => r.media === 'image')).toBe(true)
    expect(rowsFor({ kind: 'plan', id: 'campaign-launch' }, 'video').some((r) => r.media === 'video')).toBe(true)
    expect(choicesFor('image').some((c) => c.id === 'film')).toBe(false)
    expect(choicesFor('video').some((c) => c.id === 'film')).toBe(true)
    expect(FILMS_FROM_VIDEO).toBe('Films come from a Film node.')
  })
})
