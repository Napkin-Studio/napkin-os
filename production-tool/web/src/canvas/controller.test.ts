// The canvas controller on a sketch area (features/frame-aspect.clan), over a fake
// CanvasAdapter, a fake runner and the snapshot document store: what Generate sends,
// Wren's ask, the landing, the views' shape, and a person's frame becoming an area.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// No FileReader in node: a picture's data URL is not read here.
vi.mock('./scene', async (importOriginal) => {
  const real = await importOriginal<typeof import('./scene')>()
  return {
    ...real,
    assetData: async (sha: string) => ({ sha256: sha, dataURL: 'data:image/png;base64,', mimeType: 'image/png' }),
    // No createImageBitmap in node: a drawing's picture is kept as exported.
    downscale: async (blob: Blob) => ({ blob, w: 512, h: 512, changed: false }),
  }
})
vi.mock('../jobs/assets', () => ({
  assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }),
}))

import type { Services } from '../app/context'
import type { Job, JobInput, ProductionDocument } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { removeSketch, sketchDeleteText } from '../doc/remove'
import { applyFrame, croppedTo } from '../jobs/handlers'
import { putBlobAs } from '../lib/blobs'
import { framesOf, mainStoryboard } from '../model/selectors'
import { snapshotDoc } from '../test/jobFixtures'
import { addFrame, addShots, asset, job as docJob } from '../test/model'
import { answerLocally, LAYOUT_ONLY, SKETCH_ASK, sketchAsk } from '../ui/asks'
import { whereIs } from '../ui/tray'
import { describeWrite } from '../doc/describe'
import { lineage } from '../model/lineage'
import { purposeNode, purposeOf, purposeWords } from '../model/purpose'
import { mockImageSize } from '../relay/mockRender'
import { CanvasController, nodeSize } from './controller'
import type { CanvasAdapter, CanvasAsset, FrameIntent, ImageNodeIntent, RegionExport } from './core/canvasAdapter'
import type { El } from './scene'

type Rec = Record<string, unknown>
const SHA = (c: string) => `sha256:${c.repeat(64)}`

/** CanvasAdapter over plain objects: it records commits and region exports. */
class FakeCanvas implements CanvasAdapter {
  readonly engine = 'own' as const
  els: El[] = []
  commits: { undoable: boolean; n: number }[] = []
  exports: RegionExport[] = []
  assets = new Map<string, CanvasAsset>()
  private n = 0
  elements(opts: { includeDeleted?: boolean } = {}) { return opts.includeDeleted ? [...this.els] : this.els.filter((e) => !e.isDeleted) }
  transact(fn: (els: readonly El[]) => readonly El[], opts: { undoable: boolean }) {
    const els = fn(this.els)
    this.els = [...els]
    this.commits.push({ undoable: opts.undoable, n: els.length })
  }
  gesture<T>(fn: () => T) { return fn() }
  onStep() { return () => {} }
  patch(el: El, fields: Partial<El>) { return { ...el, ...fields } as El }
  childrenOf(id: string) { return this.elements().filter((e) => e.frameId === id) }
  anchors() { return [] }
  setEmphasis() {}
  emphasis() { return {} }
  addAssets(a: CanvasAsset[]) { for (const x of a) this.assets.set(x.sha256, x) }
  imageOf(el: El) {
    if (el.type !== 'image') return null
    const sha = (el as El & { assetSha?: string }).assetSha ?? (el.customData as { asset?: string } | undefined)?.asset ?? null
    return { sha256: sha, loaded: !!sha && this.assets.has(sha) }
  }
  imageDataURL() { return null }
  withAsset(el: El, sha: string) { return { ...el, assetSha: sha, status: 'saved' } as El }
  capabilities() { return { coalesced: false, predicted: false, tilt: false, pressure: false } }
  async exportSvg() { return '<svg/>' }
  serialize() { return { engine: 'own' as const, elements: this.elements(), files: {} } }
  setTheme() {}
  destroy() {}
  private make(o: Rec): El { return { id: `el${++this.n}`, x: 0, y: 0, width: 0, height: 0, isDeleted: false, frameId: null, ...o } as unknown as El }
  imageNode(i: ImageNodeIntent) { return this.make({ type: 'image', ...i, ...(i.id ? { id: i.id } : {}) }) }
  provenanceArrow(i: { origin: { x: number; y: number }; customData: unknown }) { return this.make({ type: 'arrow', x: i.origin.x, y: i.origin.y, points: [[0, 0], [1, 1]], customData: i.customData }) }
  bindArrow(els: readonly El[]) { return [...els] }
  frameAround(i: FrameIntent) { return this.make({ type: 'frame', ...i }) }
  node(i: { id?: string; x: number; y: number; width: number; height: number; customData: unknown }) { return this.make({ type: 'rectangle', ...i }) }
  link(i: { linkId: string }) { return this.make({ type: 'arrow', customData: { kind: 'link', id: i.linkId } }) }
  board(i: { id?: string; x: number; y: number; width: number; height: number; title: string; boardId: string }) {
    return this.make({ type: 'frame', x: i.x, y: i.y, width: i.width, height: i.height, name: i.title, customData: { kind: 'board', id: i.boardId } })
  }
  sketchArea(i: { x: number; y: number; w: number; h: number; sketchId: string }) {
    return this.make({ type: 'rectangle', x: i.x, y: i.y, width: i.w, height: i.h, backgroundColor: '#ffffff', customData: { kind: 'sketch', id: i.sketchId } })
  }
  view() { return { scrollX: 0, scrollY: 0, zoom: 1, offsetLeft: 0, offsetTop: 0, selectedIds: [] } }
  selected: string[] = []
  select(ids: readonly string[]) { this.selected = [...ids] }
  visibleBounds() { return { minX: 0, minY: 0, maxX: 2000, maxY: 2000 } }
  sceneToViewport(p: { x: number; y: number }) { return p }
  viewportToScene(p: { x: number; y: number }) { return p }
  version() { return 0 }
  bounds() { return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 } }
  fit() {}
  refresh() {}
  onScroll() { return () => {} }
  onPointer() { return () => {} }
  onViewport() { return () => {} }
  isBusy() { return false }
  setActiveTool() {}
  async exportPng(_els?: readonly El[]) { return new Blob(['png']) }
  async exportRegion(req: RegionExport) { this.exports.push(req); return new Blob([`region ${this.exports.length}`], { type: 'image/png' }) }
}

interface Sent { op: string; input: JobInput; purpose: Rec; jobId: string }

function setup() {
  const canvas = new FakeCanvas()
  const doc = snapshotDoc()
  const sent: Sent[] = []
  const runner = {
    submit: vi.fn(async (op: string, input: JobInput, _parents: string[], purpose: Rec, jobId: string) => {
      sent.push({ op, input, purpose, jobId })
      return jobId
    }),
    cancel: vi.fn(),
  }
  const services = {
    doc, runner, relay: {}, project: { canvasKey: 'k' },
    ui: { get: () => ({ me: { participantId: 'p_1' } }) },
  } as unknown as Services
  const ctrl = new CanvasController(canvas, services)
  return { canvas, doc, sent, ctrl }
}

const stroke = (id: string, x: number, y: number, w = 20, h = 20, frameId: string | null = null) =>
  ({ id, type: 'freedraw', x, y, width: w, height: h, isDeleted: false, frameId, points: [[0, 0], [w, h]] }) as unknown as El
const frame = (id: string, x: number, y: number, w: number, h: number) =>
  ({ id, type: 'frame', x, y, width: w, height: h, isDeleted: false, frameId: null, name: 'Frame' }) as unknown as El
const text = (id: string, x: number, y: number, words: string) =>
  ({ id, type: 'text', x, y, width: 80, height: 20, isDeleted: false, frameId: null, text: words, originalText: words }) as unknown as El

/** A person's 16:9 frame (320×180) with a stroke inside it and one crossing its right edge. */
function withFrame(t: ReturnType<typeof setup>, w = 320, h = 180) {
  t.canvas.els = [frame('F', 0, 0, w, h), stroke('in', 10, 10, 20, 20, 'F'), stroke('cross', w - 10, 40, 300, 10, 'F'), stroke('far', 2000, 2000)]
}

let t: ReturnType<typeof setup>
beforeEach(() => {
  t = setup()
})

describe('a person’s frame used in Generate becomes a sketch area', () => {
  it('in one undo step: the area at its exact bounds, the frame gone, its strokes unframed where they were', async () => {
    withFrame(t)
    await t.ctrl.generate(['F'], 'a jogger in the park')
    const area = t.canvas.els.find((e) => (e.customData as Rec | undefined)?.kind === 'sketch')!
    expect({ x: area.x, y: area.y, w: area.width, h: area.height }).toEqual({ x: 0, y: 0, w: 320, h: 180 })
    expect(t.canvas.els.find((e) => e.id === 'F')!.isDeleted).toBe(true)
    for (const id of ['in', 'cross']) {
      const s = t.canvas.els.find((e) => e.id === id)!
      expect(s.frameId).toBeNull()
    }
    expect(t.canvas.els.find((e) => e.id === 'in')!.x).toBe(10)
    expect(t.canvas.els.find((e) => e.id === 'cross')!.x).toBe(310)
    // The conversion is the first commit and an undoable one; the placing of the result is another.
    expect(t.canvas.commits[0].undoable).toBe(true)
    const sketchId = (area.customData as { id: string }).id
    const row = t.doc.get().sketches[sketchId]
    expect(row).toMatchObject({ aspect: { w: 320, h: 180 }, ratio: '16:9', drawn_by: 'human:p_1' })
  })

  it('a stroke in the frame selected alone converts the frame too', async () => {
    withFrame(t)
    await t.ctrl.generate(['in'], 'a jogger')
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].purpose.for).toBe('sketch')
  })

  it('two areas in one Generate are refused', async () => {
    t.canvas.els = [frame('F', 0, 0, 320, 180), frame('G', 500, 0, 320, 180)]
    await expect(t.ctrl.generate(['F', 'G'], 'x')).rejects.toThrow('Pick one sketch area for one Generate.')
    expect(t.sent).toEqual([])
  })
})

describe('Generate on a sketch area', () => {
  it('sends one export of exactly the area as a layout, at its ratio, and makes no drawn frame', async () => {
    withFrame(t)
    await t.ctrl.generate(['F'], 'a jogger in the park')
    const [ex] = t.canvas.exports
    expect(ex.rect).toEqual({ x: 0, y: 0, w: 320, h: 180 })
    expect([...ex.elementIds].sort()).toEqual(['cross', 'in'])
    expect([ex.outW, ex.outH, ex.background]).toEqual([1536, 864, '#ffffff'])
    const [s] = t.sent
    expect(s.op).toBe('generate')
    expect(s.input.ratio).toBe('16:9')
    expect(s.input.aspect).toBeUndefined()
    expect(s.input.text).toBe('a jogger in the park')
    expect(s.input.refs).toHaveLength(1)
    expect(s.input.refs![0]).toMatchObject({ role: 'layout', kind: 'drawing' })
    expect(s.input.refs![0].id).toBe(s.purpose.sketchId)
    expect(t.canvas.els.some((e) => (e.customData as Rec | undefined)?.kind === 'drawn')).toBe(false)
    // The new node sits right of the area at the true shape.
    const gen = t.canvas.els.find((e) => e.id === s.jobId)!
    expect(gen.x).toBeGreaterThan(320)
    expect(gen.height / gen.width).toBeCloseTo(9 / 16, 2)
  })

  it('an area of an exact format shape sends its aspect, not a ratio', async () => {
    withFrame(t, 191, 100)
    await t.ctrl.generate(['F'], 'a banner')
    expect(t.sent[0].input.aspect).toEqual({ w: 191, h: 100 })
    expect(t.sent[0].input.ratio).toBeUndefined()
    expect([t.canvas.exports[0].outW, t.canvas.exports[0].outH]).toEqual([1536, 804])
  })

  it('words typed inside the area go as words', async () => {
    withFrame(t)
    t.canvas.els.push(text('label', 40, 120, 'golden hour'))
    await t.ctrl.generate(['F'], '')
    expect(t.sent[0].input.text).toBe('golden hour')
  })
})

describe('Wren’s ask on a sketch with no words and nothing linked', () => {
  it('asks first and sends nothing until it is answered', async () => {
    withFrame(t)
    const r = await t.ctrl.generate(['F'], '')
    expect('ask' in r).toBe(true)
    const ask = (r as { ask: { id: string } }).ask
    const row = t.doc.get().asks[ask.id]
    expect(row).toMatchObject({ crew: 'wren', state: 'open', node: { kind: 'sketch' }, question: { text: 'What is this sketch of?' } })
    expect(row.job_id).toBeUndefined()
    expect(row.question.options.map((o) => o.label)).toEqual(['Use it as a layout only', 'Describe it'])
    expect(t.sent).toEqual([])
    expect(t.canvas.exports).toEqual([])
    // Asking again on the same area finds the open ask, not a second one.
    const area = t.canvas.els.find((e) => (e.customData as Rec | undefined)?.kind === 'sketch')!
    const again = await t.ctrl.generate([area.id], '')
    expect((again as { ask: { id: string } }).ask.id).toBe(ask.id)
    expect(Object.keys(t.doc.get().asks)).toHaveLength(1)
  })

  it('"Use it as a layout only" goes ahead with no words; "Describe it" sends its words', async () => {
    withFrame(t)
    await t.ctrl.generate(['F'], '')
    const area = t.canvas.els.find((e) => (e.customData as Rec | undefined)?.kind === 'sketch')!
    await t.ctrl.generate([area.id], '', { layoutOnly: true })
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].input.text).toBeUndefined()
    await t.ctrl.generate([area.id], 'a jogger crossing the path')
    expect(t.sent[1].input.text).toBe('a jogger crossing the path')
    expect(LAYOUT_ONLY).toBe('layout_only')
  })
})

describe('landing a sketch’s frame', () => {
  it('writes frames[id] with sketch_id, cropped_to and the crew, and sizes the node at the true shape', async () => {
    withFrame(t)
    await t.ctrl.generate(['F'], 'a jogger')
    const { jobId, purpose } = t.sent[0]
    const sketchId = purpose.sketchId as string
    await systemUpdate(t.doc, (d) => {
      d.jobs[jobId] = { ...docJob(d, 'generate', [], SHA('e')), id: jobId, purpose: 'sketch', node: { kind: 'sketch', id: sketchId } }
      d.assets[SHA('e')] = asset(SHA('e'), 'image', { w: 1344, h: 756 })
    }, 'sync')
    await putBlobAs(SHA('e'), new Blob(['png'], { type: 'image/png' }))
    const out = { sha256: SHA('e'), url: 'https://cdn.test/out', mime: 'image/png', w: 1344, h: 756, croppedFrom: { w: 1344, h: 768 } }
    await t.ctrl.land({ jobId, op: 'generate', state: 'completed', outputs: [out], kind: 'generated', crew: 'wren' } as unknown as Job)
    const frames = Object.values(t.doc.get().frames)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ sketch_id: sketchId, cropped_to: { from: { w: 1344, h: 768 }, to: { w: 16, h: 9 } }, crew: 'wren', version: 1, asset: SHA('e') })
    expect(frames[0].shot_id).toBeUndefined()
    const gen = t.canvas.els.find((e) => e.id === jobId)!
    expect(gen.height).toBe(Math.round((gen.width * 756) / 1344))
  })
})

describe('the shape of a Generate without an area, and of the views', () => {
  it('a picture’s shape snapped to the nearest of the four; words only, the storyboard’s ratio', async () => {
    await systemUpdate(t.doc, (d) => { d.assets[SHA('p')] = asset(SHA('p'), 'image', { w: 600, h: 800, origin: 'uploaded' }) }, 'sync')
    t.canvas.els = [{ id: 'P', type: 'image', x: 0, y: 0, width: 300, height: 400, isDeleted: false, frameId: null, customData: { kind: 'pic', id: 'node_p', asset: SHA('p') } } as unknown as El]
    await t.ctrl.generate(['P'], 'in red')
    expect(t.sent[0].input.ratio).toBe('4:5')
    await t.ctrl.generate([], 'a lighthouse at dusk')
    expect(t.sent[1].input.ratio).toBe(mainStoryboard(t.doc.get())?.ratio ?? '16:9')
    expect(JSON.stringify(t.sent.map((s) => s.input))).not.toContain("'4:5' as const")
  })

  it('the views send the front’s own aspect', async () => {
    await systemUpdate(t.doc, (d: ProductionDocument) => {
      d.assets[SHA('f')] = asset(SHA('f'), 'image', { w: 896, h: 1120, origin: 'generated' })
      const kid = 'key_01K7A00000000000000000KEY1'
      d.keys[kid] = { id: kid, v: 1, field_v: {}, key: 'maya', role: 'character' }
      const rid = 'ref_01K7A00000000000000000REF1'
      d.refs[rid] = { id: rid, v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: SHA('f'), node: 'node_f' }
    }, 'sync')
    t.canvas.els = [{ id: 'Fr', type: 'image', x: 0, y: 0, width: 300, height: 375, isDeleted: false, frameId: null, customData: { kind: 'pic', id: 'node_f', asset: SHA('f') } } as unknown as El]
    await t.ctrl.makeViews('maya', ['side'])
    expect(t.sent[0].op).toBe('view')
    expect(t.sent[0].input.aspect).toEqual({ w: 896, h: 1120 })
    expect(t.sent[0].input.ratio).toBeUndefined()
  })

  it('a node’s size keeps 300 wide, at most 400 tall', () => {
    expect(nodeSize({ w: 16, h: 9 })).toEqual({ w: 300, h: 169 })
    expect(nodeSize({ w: 4, h: 5 })).toEqual({ w: 300, h: 375 })
    expect(nodeSize({ w: 9, h: 16 })).toEqual({ w: 225, h: 400 })
  })
})

describe('a view made again takes back its name (owner, 2026-10-15: no Stack, no link to the Script)', () => {
  const KID = 'key_01K7A00000000000000000KEY1'
  const view = (id: string, v: string, asset?: string) => ({ id, type: 'image', x: 400, y: 0, width: 300, height: 375, isDeleted: false, frameId: null,
    customData: { kind: 'gen', id, op: 'view', parentIds: ['node_f'], state: asset ? 'completed' : 'running', view: v, ...(asset ? { asset } : {}) } }) as unknown as El
  async function named(sideNode: string) {
    await systemUpdate(t.doc, (d: ProductionDocument) => {
      d.keys[KID] = { id: KID, v: 1, field_v: {}, key: 'maya', role: 'character' }
      d.refs.ref_01K7A00000000000000000REF1 = { id: 'ref_01K7A00000000000000000REF1', v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: SHA('f'), node: 'node_f' }
      d.refs.ref_01K7A00000000000000000REF2 = { id: 'ref_01K7A00000000000000000REF2', v: 1, field_v: {}, key: 'maya', variant: 'side', role: 'character', asset: SHA('o'), node: sideNode }
    }, 'sync')
    t.canvas.els = [{ id: 'Fr', type: 'image', x: 0, y: 0, width: 300, height: 375, isDeleted: false, frameId: null, customData: { kind: 'pic', id: 'node_f', asset: SHA('f') } } as unknown as El]
  }
  const sideRef = () => Object.values(t.doc.get().refs).filter((r) => r.key === 'maya' && r.variant === 'side')

  it('the name of a deleted view moves to the new one, on open as on landing', async () => {
    await named('job_old')
    t.canvas.els.push(view('job_new', 'side', SHA('n')))
    expect(t.ctrl.claimViewNames()).toBe(1)
    await vi.waitFor(() => expect(sideRef().map((r) => r.node)).toEqual(['job_new']))
    expect(sideRef()[0].asset).toBe(SHA('n'))
  })

  it('a name a picture on the canvas still holds stays; an unfinished view takes none', async () => {
    await named('job_old')
    t.canvas.els.push(view('job_old', 'side', SHA('o')), view('job_new', 'side', SHA('n')), view('job_back', 'back'))
    expect(t.ctrl.claimViewNames()).toBe(0)
    expect(sideRef().map((r) => r.node)).toEqual(['job_old'])
  })
})

describe('an area’s lifecycle', () => {
  it('deleting it removes sketches[id]; the frames made from it stay without their sketch_id', async () => {
    withFrame(t)
    await t.ctrl.generate(['F'], 'a jogger')
    const sketchId = t.sent[0].purpose.sketchId as string
    await systemUpdate(t.doc, (d) => {
      const out = { sha256: SHA('a'), url: 'https://x', mime: 'image/png', w: 1344, h: 756, croppedFrom: { w: 1344, h: 768 } }
      d.frames['frame_01K7A00000000000000000FRM1'] = {
        id: 'frame_01K7A00000000000000000FRM1', v: 1, field_v: {}, sketch_id: sketchId, version: 1, kind: 'generated', asset: SHA('a'), crew: 'wren',
        cropped_to: croppedTo(out as never, { w: 16, h: 9 }),
      }
    }, 'sync')
    const d = structuredClone(t.doc.get())
    const r = removeSketch(d, sketchId)
    expect(d.sketches[sketchId]).toBeUndefined()
    expect(d.frames['frame_01K7A00000000000000000FRM1'].sketch_id).toBeUndefined()
    expect(r.note).toBe('the 1 frame made from it stay')
    expect(sketchDeleteText(2)).toBe('Delete this sketch area? The 2 frames made from it stay.')
    expect(sketchDeleteText(1)).toBe('Delete this sketch area? The frame made from it stays.')
  })

  it('the canvas sync takes the row out when the area goes and puts it back when it comes back', async () => {
    withFrame(t)
    await t.ctrl.generate(['F'], 'a jogger')
    const sketchId = t.sent[0].purpose.sketchId as string
    const area = t.canvas.els.find((e) => (e.customData as Rec | undefined)?.kind === 'sketch')!
    t.canvas.els = t.canvas.els.map((e) => (e.id === area.id ? ({ ...e, isDeleted: true } as El) : e))
    await t.ctrl.sync.sketches(t.canvas.els)
    expect(t.doc.get().sketches[sketchId]).toBeUndefined()
    t.canvas.els = t.canvas.els.map((e) => (e.id === area.id ? ({ ...e, isDeleted: false } as El) : e))
    await t.ctrl.sync.sketches(t.canvas.els)
    expect(t.doc.get().sketches[sketchId]).toMatchObject({ ratio: '16:9' })
  })
})

describe('storyboard frames', () => {
  it('a cropped frame writes cropped_to; framesOf ignores frames with no shot', async () => {
    const d = t.doc.get()
    const draft = structuredClone(d)
    const [shot] = addShots(draft, 1)
    const out = { sha256: SHA('b'), url: 'https://x', mime: 'image/png', w: 756, h: 1344, croppedFrom: { w: 768, h: 1344 } }
    const f = applyFrame(draft, { jobId: 'job_01K7A00000000000000000JOB1', op: 'frame', outputs: [out], kind: 'generated' } as unknown as Job, { shotId: shot.id })!
    expect(f.cropped_to).toEqual({ from: { w: 768, h: 1344 }, to: { w: 9, h: 16 } })
    const g = addFrame(draft, shot, SHA('c'))
    expect(g.cropped_to).toBeUndefined()
    draft.frames['frame_01K7A00000000000000000SKF1'] = { id: 'frame_01K7A00000000000000000SKF1', v: 1, field_v: {}, version: 1, kind: 'generated', asset: SHA('d'), crew: 'wren' }
    expect(framesOf(draft, shot.id).map((x) => x.id).sort()).toEqual([f.id, g.id].sort())
  })
})

describe('what the document says about sketches', () => {
  it('a sketch job’s purpose round-trips through the document', () => {
    const p = { for: 'sketch' as const, sketchId: 'sketch_01K7A00000000000000000SK01' }
    const d = t.doc.get()
    expect(purposeWords(p)).toBe('sketch')
    expect(purposeNode(d, p, 'job_x')).toEqual({ kind: 'sketch', id: p.sketchId })
    expect(purposeOf({ purpose: 'sketch', node: { kind: 'sketch', id: p.sketchId }, inputs: [] })).toEqual(p)
    expect(purposeOf({ purpose: 'sketch', node: { kind: 'shot', id: 'shot_1' }, inputs: [] })).toBeNull()
    expect(whereIs({ op: 'generate' }, { ...p } as never)).toEqual({ stage: 'character' })
  })

  it('a frame made from a sketch hangs under the sketch’s decision in the tree', () => {
    const docId = 'doc_1'
    const d = structuredClone(t.doc.get())
    const sk = 'sketch_01K7A00000000000000000SK01'
    const fr = 'frame_01K7A00000000000000000FR01'
    d.sketches[sk] = { id: sk, v: 1, field_v: {}, aspect: { w: 16, h: 9 }, ratio: '16:9', drawn_by: 'human:p_1' }
    d.frames[fr] = { id: fr, v: 1, field_v: {}, sketch_id: sk, version: 1, kind: 'generated', asset: SHA('a'), crew: 'wren' }
    const chain = [
      { id: 'd_2', agent: 'wren', action: 'render frames[v1] from the sketch', timestamp: '2026-10-13T10:01:00Z', targets: [`${docId}#frames[${fr}]`] },
      { id: 'd_1', agent: 'human:p_1', action: 'create sketch area 16:9', timestamp: '2026-10-13T10:00:00Z', targets: [`${docId}#sketches[${sk}]`] },
    ]
    const tree = lineage(chain, d, docId)
    expect(tree.byId.get('d_2')!.parent).toBe('d_1')
  })

  it('the chain says what happened to an area, its ask and the answer', () => {
    const before = t.doc.get()
    const after = structuredClone(before)
    const sk = 'sketch_01K7A00000000000000000SK01'
    after.sketches[sk] = { id: sk, v: 1, field_v: {}, aspect: { w: 191, h: 100 }, drawn_by: 'human:p_1' }
    expect(describeWrite('sketch area', before, after)?.action).toBe('create sketch area 191:100')
    const ask = sketchAsk(sk)
    const asked = structuredClone(after)
    asked.asks[ask.id] = ask
    expect(describeWrite(SKETCH_ASK, after, asked)?.action).toBe('ask What is this sketch of?')
    const answered = structuredClone(asked)
    answered.asks[ask.id] = { ...ask, state: 'answered', answers: [{ option_id: LAYOUT_ONLY, by: 'human:p_1', at: '2026-10-13T10:00:00Z' }] }
    expect(describeWrite('answer', asked, answered)).toMatchObject({ action: 'answer What is this sketch of?', rationale: expect.stringContaining('Use it as a layout only') })
  })

  it('an ask with no job is answered in the document, as the person', async () => {
    withFrame(t)
    const r = await t.ctrl.generate(['F'], '')
    const ask = (r as { ask: { id: string } }).ask
    await answerLocally(t.doc, ask.id, { text: 'a jogger' }, 'human:p_1', '2026-10-13T10:00:00Z')
    expect(t.doc.get().asks[ask.id]).toMatchObject({ state: 'answered', answers: [{ text: 'a jogger', by: 'human:p_1', at: '2026-10-13T10:00:00Z' }] })
  })

  it('the browser-only mock draws the cropped size and says what it was cut from', () => {
    expect(mockImageSize({ ratio: '16:9' }, { w: 768, h: 1024 })).toEqual({ w: 1344, h: 756, croppedFrom: { w: 1344, h: 768 } })
    expect(mockImageSize({ aspect: { w: 9, h: 16 } }, { w: 768, h: 1024 })).toEqual({ w: 756, h: 1344, croppedFrom: { w: 768, h: 1344 } })
    expect(mockImageSize({ ratio: '1:1' }, { w: 768, h: 1024 })).toEqual({ w: 1024, h: 1024 })
    expect(mockImageSize({}, { w: 768, h: 1024 })).toEqual({ w: 768, h: 1024 })
  })
})

describe('a resized area keeps its shape', () => {
  it('is put back on its aspect as one system write, and a correct one is left alone', async () => {
    withFrame(t)
    await t.ctrl.generate(['F'], 'a jogger')
    const area = t.canvas.els.find((e) => (e.customData as Rec | undefined)?.kind === 'sketch')!
    t.canvas.els = t.canvas.els.map((e) => (e.id === area.id ? ({ ...e, width: 640, height: 200 } as El) : e))
    const commits = t.canvas.commits.length
    expect(t.ctrl.lockAreas()).toBe(1)
    const now = t.canvas.els.find((e) => e.id === area.id)!
    expect({ x: now.x, y: now.y, w: now.width, h: now.height }).toEqual({ x: 0, y: 0, w: 640, h: 360 })
    expect(t.canvas.commits.slice(commits)).toEqual([{ undoable: false, n: t.canvas.els.length }])
    expect(t.ctrl.lockAreas()).toBe(0)
  })
})

describe('loose strokes become a Drawing', () => {
  it('Generate leaves the new Drawing selected, not its strokes (features/container-select.clan)', async () => {
    t.canvas.els = [stroke('a', 100, 100), stroke('b', 140, 120)]
    await t.ctrl.generate(['a', 'b'], 'a jogger')
    const drawn = t.canvas.els.find((e) => (e.customData as Rec | undefined)?.kind === 'drawn')!
    expect(t.canvas.selected).toEqual([drawn.id])
    expect(t.canvas.els.filter((e) => e.frameId === drawn.id).map((e) => e.id).sort()).toEqual(['a', 'b'])
    expect(t.sent).toHaveLength(1)
  })

  it('a Drawing whose strokes changed gets a new picture; moving it whole does not', async () => {
    t.canvas.exportPng = async (els: readonly El[]) => new Blob([els.map((e) => `${e.id}@${e.x - Math.min(...els.map((x) => x.x))}`).join(' ')], { type: 'image/png' })
    t.canvas.els = [stroke('a', 100, 100), stroke('b', 140, 120)]
    await t.ctrl.generate(['a', 'b'], 'a jogger')
    const id = t.canvas.els.find((e) => (e.customData as Rec | undefined)?.kind === 'drawn')!.id
    const asset = () => (t.canvas.els.find((e) => e.id === id)!.customData as { asset: string }).asset
    await t.ctrl.refreshDrawings()
    const first = asset()
    // The whole Drawing moved: the same picture.
    t.canvas.els = t.canvas.els.map((e) => (e.id === id || e.frameId === id ? ({ ...e, x: e.x + 50 } as El) : e))
    await t.ctrl.refreshDrawings()
    expect(asset()).toBe(first)
    // One stroke left it: a new picture, made of the stroke that stayed.
    t.canvas.els = t.canvas.els.map((e) => (e.id === 'b' ? ({ ...e, frameId: null, x: 900 } as El) : e))
    await t.ctrl.refreshDrawings()
    expect(asset()).not.toBe(first)
    expect(t.canvas.commits.at(-1)).toMatchObject({ undoable: false })
  })
})
