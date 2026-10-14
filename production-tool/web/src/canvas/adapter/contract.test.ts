// The CanvasAdapter v2 contract (features/engine-adapter.clan): one set of cases
// run against both engines' adapters. Excalidraw does not load in node, so its
// package is replaced by a stand-in that keeps a scene and applies Excalidraw's
// own coordinate formula; the own adapter runs as it is, with a raster that
// records what an export asked for.

import { describe, expect, it, vi } from 'vitest'

const exported = vi.hoisted(() => ({ sizes: [] as [number, number][] }))

vi.mock('@excalidraw/excalidraw', () => {
  let n = 0
  type Rec = Record<string, unknown>
  const box = (els: Rec[]) => {
    const xs = els.flatMap((e) => [e.x as number, (e.x as number) + (e.width as number)])
    const ys = els.flatMap((e) => [e.y as number, (e.y as number) + (e.height as number)])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  return {
    CaptureUpdateAction: { IMMEDIATELY: 'IMMEDIATELY', NEVER: 'NEVER', EVENTUALLY: 'EVENTUALLY' },
    convertToExcalidrawElements: (skels: Rec[], opts?: { regenerateIds?: boolean }) =>
      skels.map((s) => ({ isDeleted: false, frameId: null, groupIds: [], version: 1, width: 0, height: 0, ...s, id: opts?.regenerateIds === false && s.id ? s.id : `ex${++n}` })),
    newElementWith: (el: Rec, fields: Rec) => ({ ...el, ...fields, version: ((el.version as number) ?? 0) + 1 }),
    getCommonBounds: box,
    getSceneVersion: (els: Rec[]) => els.reduce((s, e) => s + ((e.version as number) ?? 0), 0),
    getVisibleSceneBounds: (st: Rec) => {
      const z = (st.zoom as { value: number }).value
      return [-(st.scrollX as number), -(st.scrollY as number), -(st.scrollX as number) + (st.width as number) / z, -(st.scrollY as number) + (st.height as number) / z]
    },
    // Excalidraw's formulas (packages/common/src/utils.ts).
    sceneCoordsToViewportCoords: ({ sceneX, sceneY }: { sceneX: number; sceneY: number }, v: { zoom: { value: number }; offsetLeft: number; offsetTop: number; scrollX: number; scrollY: number }) =>
      ({ x: (sceneX + v.scrollX) * v.zoom.value + v.offsetLeft, y: (sceneY + v.scrollY) * v.zoom.value + v.offsetTop }),
    viewportCoordsToSceneCoords: ({ clientX, clientY }: { clientX: number; clientY: number }, v: { zoom: { value: number }; offsetLeft: number; offsetTop: number; scrollX: number; scrollY: number }) =>
      ({ x: (clientX - v.offsetLeft) / v.zoom.value - v.scrollX, y: (clientY - v.offsetTop) / v.zoom.value - v.scrollY }),
    exportToBlob: async (o: { getDimensions?: () => { width: number; height: number } }) => {
      const d = o.getDimensions?.()
      if (d) exported.sizes.push([d.width, d.height])
      return new Blob(['png'], { type: 'image/png' })
    },
    exportToSvg: async () => ({ outerHTML: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }),
    serializeAsJSON: (elements: unknown[], _st: unknown, files: unknown) => JSON.stringify({ type: 'excalidraw', elements, files }),
  }
})

import type { CanvasAdapter, CanvasElement, SceneStep } from '../core/canvasAdapter'
import { MAX_EXPORT_PIXELS } from '../core/canvasAdapter'
import { ExcalidrawAdapter } from './excalidraw/adapter'
import { canvasExportFile } from './index'
import { OwnAdapter, type Raster } from './own/adapter'

type Rec = Record<string, unknown>
const W = 800
const H = 600

/** Excalidraw's imperative API, kept as plain state. */
function fakeExcalidrawApi() {
  let elements: Rec[] = []
  let files: Rec = {}
  const st: Rec = {
    scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0, width: W, height: H, selectedElementIds: {},
    activeTool: { type: 'selection' }, newElement: null, selectionElement: null, selectedElementsAreBeingDragged: false,
    isResizing: false, isRotating: false, editingTextElement: null,
  }
  return {
    getSceneElements: () => elements.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    updateScene: (u: { elements?: Rec[]; appState?: Rec }) => {
      if (u.elements) elements = [...u.elements]
      if (u.appState) Object.assign(st, u.appState)
    },
    getFiles: () => files,
    addFiles: (fs: Rec[]) => {
      files = { ...files, ...Object.fromEntries(fs.map((f) => [f.id, f])) }
    },
    getAppState: () => st,
    scrollToContent: (els: Rec[], o: { viewportZoomFactor: number }) => {
      const xs = els.flatMap((e) => [e.x as number, (e.x as number) + (e.width as number)])
      const ys = els.flatMap((e) => [e.y as number, (e.y as number) + (e.height as number)])
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      const zoom = Math.min(W / (x1 - x0), H / (y1 - y0)) * o.viewportZoomFactor
      Object.assign(st, { zoom: { value: zoom }, scrollX: W / (2 * zoom) - (x0 + x1) / 2, scrollY: H / (2 * zoom) - (y0 + y1) / 2 })
    },
    refresh: () => {},
    onScrollChange: () => () => {},
    onPointerDown: () => () => {},
    onPointerUp: () => () => {},
    setActiveTool: (t: Rec) => {
      st.activeTool = t
    },
  }
}

interface Harness {
  name: string
  make(): { adapter: CanvasAdapter; exportedSize(): [number, number] | undefined }
}

const recordingRaster = (sizes: [number, number][]) => (w: number, h: number): Raster => {
  sizes.push([w, h])
  const noop = () => {}
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? undefined : noop), set: () => true })
  return { ctx: ctx as Raster['ctx'], toBlob: async () => new Blob(['png'], { type: 'image/png' }) }
}

const HARNESSES: Harness[] = [
  {
    name: 'adapter/excalidraw',
    make() {
      exported.sizes.length = 0
      return { adapter: new ExcalidrawAdapter(fakeExcalidrawApi() as never), exportedSize: () => exported.sizes.at(-1) }
    },
  },
  {
    name: 'adapter/own',
    make() {
      const sizes: [number, number][] = []
      const adapter = new OwnAdapter(null, { raster: recordingRaster(sizes), decode: () => undefined })
      adapter.resize(W, H, 0, 0)
      return { adapter, exportedSize: () => sizes.at(-1) }
    },
  },
]

const SHA = 'sha256:' + 'ef'.repeat(32)

/** A sketch area: both engines make one from the same intent. */
const area = (a: CanvasAdapter, x = 0, y = 0, w = 320, h = 180) => a.sketchArea({ x, y, w, h, sketchId: 'sketch_1' })

describe.each(HARNESSES)('CanvasAdapter v2 contract: $name', (h) => {
  it('an undoable transact writes the scene and reports one step of field changes', () => {
    const { adapter } = h.make()
    const steps: SceneStep[] = []
    adapter.onStep((s) => steps.push(s))
    const a = area(adapter)
    adapter.transact((els) => [...els, a], { undoable: true })
    expect(adapter.elements().map((e) => e.id)).toEqual([a.id])
    expect(steps).toHaveLength(1)
    adapter.transact((els) => els.map((e) => adapter.patch(e, { x: 40 })), { undoable: true })
    expect(steps).toHaveLength(2)
    expect(steps[1].changes).toEqual([{ id: a.id, field: 'x', before: 0, after: 40 }])
  })

  it('a system write (undoable false) is no step', () => {
    const { adapter } = h.make()
    const steps: SceneStep[] = []
    adapter.onStep((s) => steps.push(s))
    adapter.transact((els) => [...els, area(adapter)], { undoable: false })
    expect(adapter.elements()).toHaveLength(1)
    expect(steps).toEqual([])
  })

  it('a gesture makes its undoable writes one step', () => {
    const { adapter } = h.make()
    const steps: SceneStep[] = []
    adapter.onStep((s) => steps.push(s))
    const a = area(adapter)
    adapter.transact(() => [a], { undoable: false })
    const out = adapter.gesture(() => {
      adapter.transact((els) => els.map((e) => adapter.patch(e, { x: 10 })), { undoable: true })
      adapter.transact((els) => els.map((e) => adapter.patch(e, { y: 20 })), { undoable: true })
      return 'done'
    })
    expect(out).toBe('done')
    expect(steps).toHaveLength(1)
    expect(steps[0].changes).toEqual([{ id: a.id, field: 'x', before: 0, after: 10 }, { id: a.id, field: 'y', before: 0, after: 20 }])
  })

  it('a deleted element stays in includeDeleted and leaves elements()', () => {
    const { adapter } = h.make()
    const a = area(adapter)
    adapter.transact(() => [a], { undoable: false })
    adapter.transact((els) => els.map((e) => adapter.patch(e, { isDeleted: true })), { undoable: true })
    expect(adapter.elements()).toEqual([])
    expect(adapter.elements({ includeDeleted: true }).map((e) => e.id)).toEqual([a.id])
  })

  it('select sets the selection and is never a step', () => {
    const { adapter } = h.make()
    const steps: SceneStep[] = []
    adapter.onStep((s) => steps.push(s))
    adapter.select(['a', 'b'])
    expect(adapter.view().selectedIds).toEqual(['a', 'b'])
    adapter.select([])
    expect(adapter.view().selectedIds).toEqual([])
    expect(steps).toEqual([])
  })

  it('viewport maths: scene to viewport and back, under the snapshot given', () => {
    const { adapter } = h.make()
    const v = { scrollX: 5, scrollY: 5, zoom: 2, offsetLeft: 100, offsetTop: 50, selectedIds: [] }
    expect(adapter.sceneToViewport({ x: 10, y: 20 }, v)).toEqual({ x: 130, y: 100 })
    const back = adapter.viewportToScene({ x: 130, y: 100 }, v)
    expect(back.x).toBeCloseTo(10)
    expect(back.y).toBeCloseTo(20)
  })

  it('fit brings far elements into view', () => {
    const { adapter } = h.make()
    const a = area(adapter, 5000, 4000, 300, 200)
    adapter.transact(() => [a], { undoable: false })
    adapter.fit([a], { zoomFactor: 0.85, animate: false })
    const vb = adapter.visibleBounds()
    expect(vb.minX).toBeLessThanOrEqual(5000)
    expect(vb.minY).toBeLessThanOrEqual(4000)
    expect(vb.maxX).toBeGreaterThanOrEqual(5300)
    expect(vb.maxY).toBeGreaterThanOrEqual(4200)
  })

  it('exportRegion draws exactly outW x outH, and refuses past MAX_EXPORT_PIXELS', async () => {
    const { adapter, exportedSize } = h.make()
    const a = area(adapter)
    adapter.transact(() => [a], { undoable: false })
    const blob = await adapter.exportRegion({ rect: { x: 0, y: 0, w: 320, h: 180 }, elementIds: [a.id], outW: 1536, outH: 864, background: '#ffffff' })
    expect(blob).toBeInstanceOf(Blob)
    expect(exportedSize()).toEqual([1536, 864])
    await expect(adapter.exportRegion({ rect: { x: 0, y: 0, w: 10, h: 10 }, elementIds: [], outW: 4097, outH: 4096, background: '#fff' })).rejects.toThrow('too large')
    expect(4097 * 4096).toBeGreaterThan(MAX_EXPORT_PIXELS)
  })

  it('exportSvg gives an SVG document', async () => {
    const { adapter } = h.make()
    const a = area(adapter)
    adapter.transact(() => [a], { undoable: false })
    expect(await adapter.exportSvg([a], { padding: 8, background: '#ffffff' })).toMatch(/^<svg[\s>]/)
  })

  it('isBusy is false at rest and true with a drawing tool', () => {
    const { adapter } = h.make()
    expect(adapter.isBusy()).toBe(false)
    adapter.setActiveTool({ type: 'native', id: 'freedraw' })
    expect(adapter.isBusy()).toBe(true)
    adapter.setActiveTool({ type: 'native', id: 'selection' })
    expect(adapter.isBusy()).toBe(false)
  })

  it('containers: childrenOf lists the live elements a frame holds', () => {
    const { adapter } = h.make()
    const f = adapter.frameAround({ x: 0, y: 0, width: 100, height: 100, name: 'Drawing', customData: { kind: 'drawn', id: 'n1' } })
    const kid = adapter.patch(area(adapter, 10, 10, 20, 20), { frameId: f.id })
    const gone = adapter.patch(area(adapter, 10, 10, 20, 20), { frameId: f.id, isDeleted: true })
    adapter.transact(() => [f, kid, gone], { undoable: false })
    expect(adapter.childrenOf(f.id).map((e) => e.id)).toEqual([kid.id])
  })

  it('anchors are the edge midpoints, and none for a missing element', () => {
    const { adapter } = h.make()
    const a = area(adapter, 0, 0, 100, 50)
    adapter.transact(() => [a], { undoable: false })
    expect(adapter.anchors(a.id)).toEqual([
      { side: 'n', x: 50, y: 0 }, { side: 'e', x: 100, y: 25 }, { side: 's', x: 50, y: 50 }, { side: 'w', x: 0, y: 25 },
    ])
    expect(adapter.anchors('nope')).toEqual([])
  })

  it('emphasis is kept for overlays and is never a step', () => {
    const { adapter } = h.make()
    const steps: SceneStep[] = []
    adapter.onStep((s) => steps.push(s))
    adapter.setEmphasis({ glow: ['a'], dim: ['b'], tags: ['scope'] })
    expect(adapter.emphasis()).toEqual({ glow: ['a'], dim: ['b'], tags: ['scope'] })
    expect(steps).toEqual([])
  })

  it('pictures by sha256: a placeholder gets its asset, and is loaded once its bytes are given', () => {
    const { adapter } = h.make()
    const gen = adapter.imageNode({ id: 'job_1', x: 0, y: 0, width: 300, height: 400, assetSha: null, customData: { kind: 'gen', id: 'job_1' }, status: 'pending', keepIds: true })
    expect(gen.id).toBe('job_1')
    expect(adapter.imageOf(gen)).toEqual({ sha256: null, loaded: false })
    const landed = adapter.withAsset(gen, SHA)
    adapter.transact(() => [landed], { undoable: false })
    expect(landed.status).toBe('saved')
    expect(adapter.imageOf(landed)).toEqual({ sha256: SHA, loaded: false })
    adapter.addAssets([{ sha256: SHA, dataURL: 'data:image/png;base64,AA==', mimeType: 'image/png' }])
    expect(adapter.imageOf(landed)).toEqual({ sha256: SHA, loaded: true })
    expect(adapter.imageDataURL(landed)).toBe('data:image/png;base64,AA==')
    expect(adapter.imageOf(area(adapter))).toBeNull()
  })

  it('version changes when an element changes', () => {
    const { adapter } = h.make()
    adapter.transact(() => [area(adapter)], { undoable: false })
    const v0 = adapter.version(adapter.elements())
    adapter.transact((els) => els.map((e) => adapter.patch(e, { x: 9 })), { undoable: false })
    expect(adapter.version(adapter.elements())).not.toBe(v0)
  })

  it('serialize keeps the live scene, and the export file is made from it without an engine', async () => {
    const { adapter } = h.make()
    const a = area(adapter)
    const b = adapter.patch(area(adapter), { isDeleted: true })
    adapter.transact(() => [a, b], { undoable: false })
    const snap = adapter.serialize()
    expect(snap.elements.map((e: CanvasElement) => e.id)).toEqual([a.id])
    const file = await canvasExportFile(snap)
    expect(file.name).toBe(adapter.engine === 'own' ? 'canvas.napkin.json' : 'canvas.excalidraw')
    const parsed = JSON.parse(new TextDecoder().decode(file.bytes)) as { elements: Rec[] }
    expect(parsed.elements.map((e) => e.id)).toEqual([a.id])
  })

  it('capabilities are plain flags', () => {
    const { adapter } = h.make()
    const c = adapter.capabilities()
    expect(Object.keys(c).sort()).toEqual(['coalesced', 'predicted', 'pressure', 'tilt'])
  })
})
