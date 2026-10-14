// ExcalidrawAdapter: CanvasAdapter v0 over Excalidraw's imperative API
// (features/canvas-core.clan). Each method wraps one call the tool made before
// the adapter; the element factories moved here line for line from
// canvas/scene.ts and canvas/controller.ts.

import {
  CaptureUpdateAction, convertToExcalidrawElements, exportToBlob, getCommonBounds, getSceneVersion, getVisibleSceneBounds,
  newElementWith, sceneCoordsToViewportCoords, viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types'
import type { ExcalidrawFrameElement, ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'
import {
  MAX_EXPORT_PIXELS,
  type ActiveToolSpec, type Bounds, type CanvasAdapter, type ExportPngOptions, type FrameIntent, type ImageNodeIntent, type PointerSample, type Pt,
  type ProvenanceArrowIntent, type RegionExport, type SketchAreaIntent, type ViewportTransform, type ViewSnapshot,
} from '../../core/canvasAdapter'
import type { FileData, FileId, FileMap, SceneElement } from './types'

type El = SceneElement

/** The common bounds of some elements (getCommonBounds), as a box. */
export function commonBounds(els: readonly El[]): Bounds {
  const [minX, minY, maxX, maxY] = getCommonBounds(els)
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

const engineView = (v: ViewSnapshot) => ({
  zoom: { value: v.zoom as NormalizedZoomValue }, offsetLeft: v.offsetLeft, offsetTop: v.offsetTop, scrollX: v.scrollX, scrollY: v.scrollY,
})

export class ExcalidrawAdapter implements CanvasAdapter<SceneElement, FileData> {
  private readonly api: ExcalidrawImperativeAPI

  constructor(api: ExcalidrawImperativeAPI) {
    this.api = api
  }

  // ── reads and writes ──

  elements(opts: { includeDeleted?: boolean } = {}): El[] {
    return (opts.includeDeleted ? this.api.getSceneElementsIncludingDeleted() : this.api.getSceneElements()) as El[]
  }

  commit(els: readonly El[], opts: { undoable: boolean }) {
    this.api.updateScene({ elements: els, captureUpdate: opts.undoable ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER })
  }

  patch(el: El, fields: Partial<El>): El {
    return newElementWith(el, fields as never)
  }

  // ── intent factories ──

  imageNode(i: ImageNodeIntent): El {
    const skeleton = {
      type: 'image' as const, ...(i.id !== undefined ? { id: i.id } : {}), x: i.x, y: i.y, width: i.width, height: i.height,
      fileId: i.fileId as unknown as FileId, customData: i.customData as Record<string, unknown>,
    }
    const [el] = i.keepIds ? convertToExcalidrawElements([skeleton], { regenerateIds: false }) : convertToExcalidrawElements([skeleton])
    return newElementWith(el as ExcalidrawImageElement, i.status === 'pending' ? { status: 'pending', fileId: null } : { status: 'saved' })
  }

  provenanceArrow(i: ProvenanceArrowIntent): El {
    const xs = i.points.map((p) => p[0])
    const ys = i.points.map((p) => p[1])
    const [arrow] = convertToExcalidrawElements(
      [{
        type: 'arrow', x: i.origin.x, y: i.origin.y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
        points: i.points as never, roundness: { type: 2 },
        strokeColor: i.color, strokeWidth: 2, strokeStyle: 'dashed', roughness: 0, endArrowhead: 'arrow',
        customData: i.customData,
      } as never],
    )
    return newElementWith(arrow, {
      startBinding: { elementId: i.fromElId, focus: 0, gap: 8 },
      endBinding: { elementId: i.toElId, focus: 0, gap: 8 },
    } as never)
  }

  bindArrow(els: readonly El[], arrow: El): El[] {
    const a = arrow as El & { startBinding?: { elementId: string }; endBinding?: { elementId: string } }
    const ids = [a.startBinding?.elementId, a.endBinding?.elementId]
    return els.map((e) =>
      ids.includes(e.id) ? newElementWith(e, { boundElements: [...(e.boundElements ?? []), { id: arrow.id, type: 'arrow' }] }) : e,
    )
  }

  frameAround(i: FrameIntent): El {
    const [frame] = convertToExcalidrawElements(
      [{ type: 'frame', x: i.x, y: i.y, width: i.width, height: i.height, name: i.name, children: [], customData: i.customData as Record<string, unknown> }],
    )
    return frame
  }

  sketchArea(i: SketchAreaIntent): El {
    const [rect] = convertToExcalidrawElements(
      [{
        type: 'rectangle', x: i.x, y: i.y, width: i.w, height: i.h,
        backgroundColor: '#ffffff', fillStyle: 'solid', strokeColor: 'transparent', strokeWidth: 1, roughness: 0, roundness: null,
        customData: { kind: 'sketch', id: i.sketchId },
      } as never],
    )
    return rect
  }

  // ── files ──

  files(): FileMap {
    return this.api.getFiles()
  }

  addFiles(files: FileData[]) {
    this.api.addFiles(files)
  }

  // ── view ──

  view(): ViewSnapshot {
    const st = this.api.getAppState()
    const selectedIds = Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k])
    return { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, offsetLeft: st.offsetLeft, offsetTop: st.offsetTop, selectedIds }
  }

  select(ids: readonly string[]) {
    const selectedElementIds = Object.fromEntries(ids.map((id) => [id, true as const]))
    this.api.updateScene({ appState: { selectedElementIds }, captureUpdate: CaptureUpdateAction.NEVER })
  }

  visibleBounds() {
    const [minX, minY, maxX, maxY] = getVisibleSceneBounds(this.api.getAppState())
    return { minX, minY, maxX, maxY }
  }

  sceneToViewport(p: Pt, view: ViewSnapshot): Pt {
    return sceneCoordsToViewportCoords({ sceneX: p.x, sceneY: p.y }, engineView(view))
  }

  viewportToScene(p: Pt, view: ViewSnapshot): Pt {
    return viewportCoordsToSceneCoords({ clientX: p.x, clientY: p.y }, engineView(view))
  }

  // ── the rest ──

  version(els: readonly El[]): number {
    return getSceneVersion(els)
  }

  bounds(els: readonly El[]): Bounds {
    return commonBounds(els)
  }

  fit(els: readonly El[], opts: { zoomFactor: number; animate: boolean }) {
    this.api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: opts.zoomFactor, animate: opts.animate })
  }

  refresh() {
    this.api.refresh()
  }

  onScroll(cb: () => void): () => void {
    return this.api.onScrollChange(() => cb())
  }

  onPointer(cb: (p: PointerSample) => void): () => void {
    const sample = (phase: PointerSample['phase'], e: { clientX: number; clientY: number; pointerType?: string; pressure?: number }) => {
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, this.api.getAppState())
      const pointerType = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse'
      cb({ phase, x: p.x, y: p.y, pointerType, pressure: pointerType === 'mouse' ? 0.5 : e.pressure ?? 0.5 })
    }
    const move = (e: PointerEvent) => sample('move', e)
    const stopMoves = () => globalThis.removeEventListener?.('pointermove', move)
    const offDown = this.api.onPointerDown((_tool, _state, e) => {
      sample('down', e)
      stopMoves()
      globalThis.addEventListener?.('pointermove', move)
    })
    const offUp = this.api.onPointerUp((_tool, _state, e) => {
      stopMoves()
      sample('up', e)
    })
    return () => {
      stopMoves()
      offDown()
      offUp()
    }
  }

  onViewport(cb: (v: ViewportTransform) => void): () => void {
    return this.api.onScrollChange((scrollX, scrollY, zoom) => cb({ scrollX, scrollY, zoom: zoom.value }))
  }

  isBusy(): boolean {
    const st = this.api.getAppState()
    return st.activeTool.type !== 'selection' || !!st.newElement || !!st.selectionElement || st.selectedElementsAreBeingDragged ||
      st.isResizing || st.isRotating || !!st.editingTextElement
  }

  setActiveTool(tool: ActiveToolSpec) {
    if (tool.type === 'custom') this.api.setActiveTool({ type: 'custom', customType: tool.id })
    else this.api.setActiveTool({ type: tool.id as never })
  }

  async exportPng(els: readonly El[], files: FileMap, opts: ExportPngOptions): Promise<Blob> {
    return await exportToBlob({
      elements: els,
      files,
      mimeType: 'image/png',
      exportPadding: opts.padding,
      appState: { exportBackground: true, viewBackgroundColor: opts.background, exportWithDarkMode: false },
    })
  }

  /**
   * Exactly `rect`, at outW x outH: the members are cloned into a transient frame of the box that is
   * never added to the scene, so the export is the box's size however far a stroke runs (and no
   * Safari canvas past 16.7 MP), strokes crossing the edge are clipped, and nothing on the canvas moves.
   */
  async exportRegion(req: RegionExport, files: FileMap): Promise<Blob> {
    if (req.outW * req.outH > MAX_EXPORT_PIXELS) throw new Error(`An export of ${req.outW}×${req.outH} is too large.`)
    const [frame] = convertToExcalidrawElements(
      [{ type: 'frame', x: req.rect.x, y: req.rect.y, width: req.rect.w, height: req.rect.h, name: '', children: [] }],
    ) as ExcalidrawFrameElement[]
    const ids = new Set(req.elementIds)
    const members = this.elements().filter((e) => ids.has(e.id)).map((e) => newElementWith(e, { frameId: frame.id } as never))
    return await exportToBlob({
      elements: [frame, ...members],
      files,
      mimeType: 'image/png',
      exportPadding: 0,
      exportingFrame: frame,
      getDimensions: () => ({ width: req.outW, height: req.outH, scale: req.outW / Math.max(1e-9, req.rect.w) }),
      appState: {
        exportBackground: true, viewBackgroundColor: req.background, exportWithDarkMode: false,
        frameRendering: { enabled: true, name: false, outline: false, clip: true },
      },
    })
  }
}
