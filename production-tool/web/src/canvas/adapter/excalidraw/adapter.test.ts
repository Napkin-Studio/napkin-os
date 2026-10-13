// ExcalidrawAdapter (features/canvas-core.clan): each method makes the same
// engine call the tool made before the adapter. The engine is replaced by
// recording stand-ins (it does not load in node), and the expected skeletons
// are copied from the factories as they were in canvas/scene.ts:106-161 and
// canvas/controller.ts:228 and :485.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  convert: [] as unknown[][],
  newWith: [] as unknown[][],
  toViewport: [] as unknown[][],
  toScene: [] as unknown[][],
  exportBlob: [] as unknown[][],
}))

vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { IMMEDIATELY: 'IMMEDIATELY', NEVER: 'NEVER', EVENTUALLY: 'EVENTUALLY' },
  convertToExcalidrawElements: (...args: unknown[]) => {
    calls.convert.push(args)
    return (args[0] as Record<string, unknown>[]).map((s) => ({ id: 'made-id', ...s }))
  },
  newElementWith: (...args: unknown[]) => {
    calls.newWith.push(args)
    return { ...(args[0] as object), ...(args[1] as object) }
  },
  getCommonBounds: (els: { x: number; y: number; width: number; height: number }[]) => [
    Math.min(...els.map((e) => e.x)), Math.min(...els.map((e) => e.y)),
    Math.max(...els.map((e) => e.x + e.width)), Math.max(...els.map((e) => e.y + e.height)),
  ],
  getSceneVersion: (els: { version?: number }[]) => els.reduce((n, e) => n + (e.version ?? 0), 0),
  getVisibleSceneBounds: (st: { scrollX: number; scrollY: number }) => [-st.scrollX, -st.scrollY, -st.scrollX + 800, -st.scrollY + 600],
  sceneCoordsToViewportCoords: (...args: unknown[]) => {
    calls.toViewport.push(args)
    return { x: 11, y: 22 }
  },
  viewportCoordsToSceneCoords: (...args: unknown[]) => {
    calls.toScene.push(args)
    return { x: 33, y: 44 }
  },
  exportToBlob: async (...args: unknown[]) => {
    calls.exportBlob.push(args)
    return new Blob(['png'])
  },
}))

import { commonBounds, ExcalidrawAdapter } from './adapter'
import type { SceneElement } from './types'

type Rec = Record<string, unknown>

function fakeApi(state: Rec = {}) {
  const log: { method: string; args: unknown[] }[] = []
  const rec = (method: string, ret?: unknown) => (...args: unknown[]) => {
    log.push({ method, args })
    return ret
  }
  const appState: Rec = {
    scrollX: 10, scrollY: 20, zoom: { value: 1.5 }, offsetLeft: 5, offsetTop: 6,
    selectedElementIds: { a: true, b: false, c: true },
    activeTool: { type: 'selection' }, newElement: null, selectionElement: null, selectedElementsAreBeingDragged: false,
    isResizing: false, isRotating: false, editingTextElement: null,
    ...state,
  }
  const api = {
    getSceneElements: rec('getSceneElements', [{ id: 'live' }]),
    getSceneElementsIncludingDeleted: rec('getSceneElementsIncludingDeleted', [{ id: 'live' }, { id: 'gone', isDeleted: true }]),
    updateScene: rec('updateScene'),
    getFiles: rec('getFiles', { f1: { id: 'f1' } }),
    addFiles: rec('addFiles'),
    getAppState: () => appState,
    scrollToContent: rec('scrollToContent'),
    refresh: rec('refresh'),
    onScrollChange: (cb: () => void) => {
      log.push({ method: 'onScrollChange', args: [cb] })
      return () => log.push({ method: 'unsubscribe', args: [] })
    },
    setActiveTool: rec('setActiveTool'),
    onPointerDown: (cb: unknown) => {
      log.push({ method: 'onPointerDown', args: [cb] })
      return () => log.push({ method: 'offPointerDown', args: [] })
    },
    onPointerUp: (cb: unknown) => {
      log.push({ method: 'onPointerUp', args: [cb] })
      return () => log.push({ method: 'offPointerUp', args: [] })
    },
  }
  return { api, log, appState }
}

const make = (state?: Rec) => {
  const f = fakeApi(state)
  return { ...f, adapter: new ExcalidrawAdapter(f.api as never) }
}

const el = (o: Rec): SceneElement => ({ id: 'x', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, ...o }) as unknown as SceneElement

beforeEach(() => {
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k].length = 0
})

describe('reads and writes', () => {
  it('elements() reads the live scene, and includeDeleted the whole one', () => {
    const { adapter, log } = make()
    expect(adapter.elements().map((e) => e.id)).toEqual(['live'])
    expect(adapter.elements({ includeDeleted: true }).map((e) => e.id)).toEqual(['live', 'gone'])
    expect(log.map((l) => l.method)).toEqual(['getSceneElements', 'getSceneElementsIncludingDeleted'])
  })

  it('undoable true is one step of the undo (IMMEDIATELY); false is a system write (NEVER)', () => {
    const { adapter, log } = make()
    const els = [el({ id: 'a' })]
    adapter.commit(els, { undoable: true })
    adapter.commit(els, { undoable: false })
    expect(log.map((l) => l.args[0])).toEqual([
      { elements: els, captureUpdate: 'IMMEDIATELY' },
      { elements: els, captureUpdate: 'NEVER' },
    ])
  })

  it('patch is newElementWith with the fields', () => {
    const { adapter } = make()
    const e = el({ id: 'a' })
    expect(adapter.patch(e, { isDeleted: true })).toMatchObject({ id: 'a', isDeleted: true })
    expect(calls.newWith).toEqual([[e, { isDeleted: true }]])
  })
})

describe('the intent factories make the elements the old factories made', () => {
  it('a gen placeholder: kept id (regenerateIds false), pending, no file', () => {
    const { adapter } = make()
    const customData = { kind: 'gen', id: 'job_1', op: 'generate', parentIds: ['n'], state: 'queued' }
    const out = adapter.imageNode({ id: 'job_1', x: 1, y: 2, width: 300, height: 400, fileId: null, customData, status: 'pending', keepIds: true })
    expect(calls.convert).toEqual([[
      [{ type: 'image', id: 'job_1', x: 1, y: 2, width: 300, height: 400, fileId: null, customData }],
      { regenerateIds: false },
    ]])
    expect(calls.newWith[0][1]).toEqual({ status: 'pending', fileId: null })
    expect(out).toMatchObject({ id: 'job_1', status: 'pending', fileId: null })
  })

  it('a library picture: a new id (no options), saved, its file', () => {
    const { adapter } = make()
    const customData = { kind: 'pic', id: 'node_1', asset: 'sha256:a' }
    adapter.imageNode({ x: 5, y: 6, width: 300, height: 200, fileId: 'abc', customData, status: 'saved' })
    expect(calls.convert).toEqual([[[{ type: 'image', x: 5, y: 6, width: 300, height: 200, fileId: 'abc', customData }]]])
    expect(calls.convert[0]).toHaveLength(1)
    expect(calls.newWith[0][1]).toEqual({ status: 'saved' })
  })

  it('a provenance arrow: curved, dashed, accent, bound at both ends with gap 8', () => {
    const { adapter } = make()
    const points: [number, number][] = [[0, 0], [50, -20], [100, 10]]
    const customData = { kind: 'provenance', from: 'n1', to: 'job_1' }
    adapter.provenanceArrow({ origin: { x: 10, y: 20 }, points, fromElId: 'A', toElId: 'B', color: '#FF4F2E', customData })
    expect(calls.convert).toEqual([[[{
      type: 'arrow', x: 10, y: 20, width: 100, height: 30,
      points, roundness: { type: 2 },
      strokeColor: '#FF4F2E', strokeWidth: 2, strokeStyle: 'dashed', roughness: 0, endArrowhead: 'arrow',
      customData,
    }]]])
    expect(calls.newWith[0][1]).toEqual({
      startBinding: { elementId: 'A', focus: 0, gap: 8 },
      endBinding: { elementId: 'B', focus: 0, gap: 8 },
    })
  })

  it('bindArrow adds the arrow to both ends’ boundElements, and leaves the rest', () => {
    const { adapter } = make()
    const a = el({ id: 'A', boundElements: [{ id: 'old', type: 'arrow' }] })
    const b = el({ id: 'B' })
    const c = el({ id: 'C' })
    const arrow = el({ id: 'arr', type: 'arrow', startBinding: { elementId: 'A' }, endBinding: { elementId: 'B' } })
    const out = adapter.bindArrow([a, b, c, arrow], arrow) as unknown as Rec[]
    expect(out[0].boundElements).toEqual([{ id: 'old', type: 'arrow' }, { id: 'arr', type: 'arrow' }])
    expect(out[1].boundElements).toEqual([{ id: 'arr', type: 'arrow' }])
    expect(out[2]).toBe(c)
    expect(out[3]).toBe(arrow)
  })

  it('frameAround: a frame skeleton with no children, and nothing else', () => {
    const { adapter } = make()
    const customData = { kind: 'drawn', id: 'node_d', asset: 'sha256:d' }
    adapter.frameAround({ x: -16, y: -16, width: 132, height: 82, name: 'Drawing', customData })
    expect(calls.convert).toEqual([[[{ type: 'frame', x: -16, y: -16, width: 132, height: 82, name: 'Drawing', children: [], customData }]]])
    expect(calls.newWith).toEqual([])
  })
})

describe('files and view', () => {
  it('files and addFiles go straight through', () => {
    const { adapter, log } = make()
    expect(adapter.files()).toEqual({ f1: { id: 'f1' } })
    const f = { id: 'f2', dataURL: 'data:', mimeType: 'image/png', created: 1 }
    adapter.addFiles([f as never])
    expect(log.at(-1)).toEqual({ method: 'addFiles', args: [[f]] })
  })

  it('view() is plain numbers and the selected ids', () => {
    const { adapter } = make()
    expect(adapter.view()).toEqual({ scrollX: 10, scrollY: 20, zoom: 1.5, offsetLeft: 5, offsetTop: 6, selectedIds: ['a', 'c'] })
  })

  it('select is never an undo step; select([]) clears', () => {
    const { adapter, log } = make()
    adapter.select([])
    adapter.select(['a', 'b'])
    expect(log.map((l) => l.args[0])).toEqual([
      { appState: { selectedElementIds: {} }, captureUpdate: 'NEVER' },
      { appState: { selectedElementIds: { a: true, b: true } }, captureUpdate: 'NEVER' },
    ])
  })

  it('visibleBounds reads the live view', () => {
    const { adapter } = make()
    expect(adapter.visibleBounds()).toEqual({ minX: -10, minY: -20, maxX: 790, maxY: 580 })
  })

  it('coordinates convert under the snapshot passed in, not the live state', () => {
    const { adapter } = make()
    const snap = { scrollX: 1, scrollY: 2, zoom: 0.5, offsetLeft: 3, offsetTop: 4, selectedIds: [] }
    expect(adapter.sceneToViewport({ x: 7, y: 8 }, snap)).toEqual({ x: 11, y: 22 })
    expect(adapter.viewportToScene({ x: 9, y: 10 }, snap)).toEqual({ x: 33, y: 44 })
    const engineView = { zoom: { value: 0.5 }, offsetLeft: 3, offsetTop: 4, scrollX: 1, scrollY: 2 }
    expect(calls.toViewport).toEqual([[{ sceneX: 7, sceneY: 8 }, engineView]])
    expect(calls.toScene).toEqual([[{ clientX: 9, clientY: 10 }, engineView]])
  })
})

describe('the rest', () => {
  it('version, bounds', () => {
    const { adapter } = make()
    expect(adapter.version([el({ version: 3 }), el({ version: 4 })])).toBe(7)
    expect(adapter.bounds([el({ x: 0, y: 0 }), el({ x: 20, y: 5, width: 30, height: 40 })])).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 45, w: 50, h: 45 })
    expect(commonBounds([el({ x: 1, y: 2 })])).toEqual({ minX: 1, minY: 2, maxX: 11, maxY: 12, w: 10, h: 10 })
  })

  it('fit fits to the viewport with the zoom factor and animation', () => {
    const { adapter, log } = make()
    const els = [el({ id: 'a' })]
    adapter.fit(els, { zoomFactor: 0.85, animate: true })
    expect(log.at(-1)).toEqual({ method: 'scrollToContent', args: [els, { fitToViewport: true, viewportZoomFactor: 0.85, animate: true }] })
  })

  it('refresh and onScroll (with its unsubscribe)', () => {
    const { adapter, log } = make()
    adapter.refresh()
    const cb = vi.fn()
    const off = adapter.onScroll(cb)
    ;(log.at(-1)!.args[0] as () => void)()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(log.map((l) => l.method)).toEqual(['refresh', 'onScrollChange', 'unsubscribe'])
  })

  it('isBusy reads exactly the seven flags ArrowCard read', () => {
    expect(make().adapter.isBusy()).toBe(false)
    const busy: Rec[] = [
      { activeTool: { type: 'freedraw' } }, { newElement: {} }, { selectionElement: {} }, { selectedElementsAreBeingDragged: true },
      { isResizing: true }, { isRotating: true }, { editingTextElement: {} },
    ]
    for (const st of busy) expect(make(st).adapter.isBusy()).toBe(true)
  })

  it('setActiveTool: a custom tool by its id, a native one by its type', () => {
    const { adapter, log } = make()
    adapter.setActiveTool({ type: 'custom', id: 'sketch-area' })
    adapter.setActiveTool({ type: 'native', id: 'freedraw' })
    expect(log.map((l) => l.args[0])).toEqual([{ type: 'custom', customType: 'sketch-area' }, { type: 'freedraw' }])
  })

  it('exportPng: a PNG with the padding and a white, light background', async () => {
    const { adapter } = make()
    const els = [el({ id: 'a' })]
    await adapter.exportPng(els, { f: {} } as never, { padding: 24, background: '#ffffff' })
    expect(calls.exportBlob).toEqual([[{
      elements: els, files: { f: {} }, mimeType: 'image/png', exportPadding: 24,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
    }]])
  })
})

describe('frame-aspect amendments (CanvasAdapter v1)', () => {
  it('sketchArea: a white, solid, borderless rectangle tagged {kind:"sketch", id}', () => {
    const { adapter } = make()
    const area = adapter.sketchArea({ x: 10, y: 20, w: 320, h: 180, sketchId: 'sketch_1' }) as unknown as Rec
    expect(calls.convert).toEqual([[[{
      type: 'rectangle', x: 10, y: 20, width: 320, height: 180,
      backgroundColor: '#ffffff', fillStyle: 'solid', strokeColor: 'transparent', strokeWidth: 1, roughness: 0, roundness: null,
      customData: { kind: 'sketch', id: 'sketch_1' },
    }]]])
    expect(area.customData).toEqual({ kind: 'sketch', id: 'sketch_1' })
  })

  it('exportRegion: a transient frame of exactly the box, cloned members in it, padding 0, the asked size', async () => {
    const { adapter, api, log } = make()
    const scene = [el({ id: 'in', type: 'freedraw' }), el({ id: 'cross', type: 'line', x: 150, width: 900 }), el({ id: 'other' })]
    api.getSceneElements = (() => scene) as never
    await adapter.exportRegion({ rect: { x: 0, y: 0, w: 320, h: 180 }, elementIds: ['in', 'cross'], outW: 1536, outH: 864, background: '#ffffff' }, { f: {} } as never)
    expect(calls.convert).toEqual([[[{ type: 'frame', x: 0, y: 0, width: 320, height: 180, name: '', children: [] }]]])
    const [[opts]] = calls.exportBlob as [Rec][]
    const frame = (opts.elements as Rec[])[0]
    expect(frame).toMatchObject({ id: 'made-id', type: 'frame', x: 0, y: 0, width: 320, height: 180 })
    expect((opts.elements as Rec[]).slice(1).map((e) => [e.id, e.frameId])).toEqual([['in', 'made-id'], ['cross', 'made-id']])
    expect(opts.exportingFrame).toBe(frame)
    expect(opts.exportPadding).toBe(0)
    expect(opts.files).toEqual({ f: {} })
    expect((opts.getDimensions as (w: number, h: number) => Rec)(5000, 5000)).toEqual({ width: 1536, height: 864, scale: 4.8 })
    expect(opts.appState).toEqual({
      exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false,
      frameRendering: { enabled: true, name: false, outline: false, clip: true },
    })
    // Nothing on the canvas moved: the scene was never written.
    expect(log.some((l) => l.method === 'updateScene')).toBe(false)
    expect(scene.map((e) => (e as unknown as Rec).frameId)).toEqual([undefined, undefined, undefined])
  })

  it('exportRegion refuses an export past 4096 x 4096', async () => {
    const { adapter } = make()
    await expect(adapter.exportRegion({ rect: { x: 0, y: 0, w: 10, h: 10 }, elementIds: [], outW: 5000, outH: 4000, background: '#fff' }, {} as never))
      .rejects.toThrow('too large')
    expect(calls.exportBlob).toEqual([])
  })

  it('onViewport: the scroll and the zoom value, with its unsubscribe', () => {
    const { adapter, log } = make()
    const cb = vi.fn()
    const off = adapter.onViewport(cb)
    ;(log.at(-1)!.args[0] as (x: number, y: number, z: { value: number }) => void)(5, -7, { value: 2 })
    expect(cb).toHaveBeenCalledWith({ scrollX: 5, scrollY: -7, zoom: 2 })
    off()
    expect(log.at(-1)!.method).toBe('unsubscribe')
  })

  it('onPointer: down and up in scene coordinates, a pen’s pressure, a mouse at 0.5', () => {
    const { adapter, log } = make()
    const cb = vi.fn()
    const off = adapter.onPointer(cb)
    const down = log.find((l) => l.method === 'onPointerDown')!.args[0] as (t: unknown, s: unknown, e: Rec) => void
    const up = log.find((l) => l.method === 'onPointerUp')!.args[0] as (t: unknown, s: unknown, e: Rec) => void
    down({}, {}, { clientX: 1, clientY: 2, pointerType: 'pen', pressure: 0.8 })
    up({}, {}, { clientX: 3, clientY: 4, pointerType: 'mouse', pressure: 0 })
    expect(cb.mock.calls.map((c) => c[0])).toEqual([
      { phase: 'down', x: 33, y: 44, pointerType: 'pen', pressure: 0.8 },
      { phase: 'up', x: 33, y: 44, pointerType: 'mouse', pressure: 0.5 },
    ])
    expect(calls.toScene.map((c) => c[0])).toEqual([{ clientX: 1, clientY: 2 }, { clientX: 3, clientY: 4 }])
    off()
    expect(log.slice(-2).map((l) => l.method)).toEqual(['offPointerDown', 'offPointerUp'])
  })
})
