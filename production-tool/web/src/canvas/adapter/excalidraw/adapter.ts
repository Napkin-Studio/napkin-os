// ExcalidrawAdapter: CanvasAdapter v2 over Excalidraw's imperative API
// (features/canvas-core.clan, features/engine-adapter.clan). Each method wraps
// the engine call the tool made before the adapter; the element factories moved
// here line for line from canvas/scene.ts and canvas/controller.ts. Excalidraw's
// own ids (file ids, its element types) stay in this folder: the tool sees
// CanvasElement and pictures by sha256.

import {
  CaptureUpdateAction, convertToExcalidrawElements, exportToBlob, exportToSvg, getCommonBounds, getSceneVersion, getVisibleSceneBounds,
  newElementWith, sceneCoordsToViewportCoords, viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types'
import type { ExcalidrawFrameElement, ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types'
import {
  MAX_EXPORT_PIXELS,
  type ActiveToolSpec, type Anchor, type Bounds, type CanvasAdapter, type CanvasAsset, type CanvasElement, type CanvasSnapshot, type Emphasis,
  type BoardIntent, type ExportPngOptions, type FrameIntent, type ImageNodeIntent, type InputCapabilities, type LinkIntent, type NodeIntent, type PointerSample, type Pt,
  type ProvenanceArrowIntent, type RegionExport, type SceneStep, type SketchAreaIntent, type ViewportTransform, type ViewSnapshot,
} from '../../core/canvasAdapter'
import { edgeAnchors } from '../../core/anchors'
import { sceneDiff } from '../../core/sceneDiff'
import { hexOf } from '../../../lib/hash'
import type { FileData, FileId, FileMap, SceneElement } from './types'
import { excalidrawChrome } from './chrome'
import type { CanvasChrome } from '../../chrome/controls'

type El = SceneElement

/** Excalidraw's id for the file of a picture: the first 40 hex digits of its sha256. */
export function fileIdFor(sha: string): FileId {
  return hexOf(sha).slice(0, 40) as FileId
}

/** The common bounds of some elements (getCommonBounds), as a box. */
export function commonBounds(els: readonly CanvasElement[]): Bounds {
  const [minX, minY, maxX, maxY] = getCommonBounds(els as readonly El[])
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

const engineView = (v: ViewSnapshot) => ({
  zoom: { value: v.zoom as NormalizedZoomValue }, offsetLeft: v.offsetLeft, offsetTop: v.offsetTop, scrollX: v.scrollX, scrollY: v.scrollY,
})

/** Excalidraw's bookkeeping, which changes on every write and is never a step's content. */
const BOOKKEEPING = new Set(['version', 'versionNonce', 'updated', 'seed'])

const asEl = (e: CanvasElement) => e as unknown as El
const asEls = (els: readonly CanvasElement[]) => els as unknown as readonly El[]
const fileIdOf = (e: CanvasElement): string | null => (e as { fileId?: string | null }).fileId ?? null
const assetOf = (e: CanvasElement): string | undefined => {
  const c = e.customData as { asset?: unknown } | undefined
  return typeof c?.asset === 'string' ? c.asset : undefined
}

/** What the mount gives the adapter: the theme and the unmount, which live in React. */
export interface ExcalidrawLifetime {
  setTheme(theme: 'light' | 'dark'): void
  destroy(): void
}

export class ExcalidrawAdapter implements CanvasAdapter {
  readonly engine = 'excalidraw' as const
  private readonly api: ExcalidrawImperativeAPI
  private readonly lifetime: ExcalidrawLifetime | null
  private readonly stepCbs = new Set<(s: SceneStep) => void>()
  /** Inside gesture(): its depth, and the scene before its first undoable write. */
  private depth = 0
  private gestureBefore: readonly CanvasElement[] | null = null
  /** sha256 of the files this adapter was given, by Excalidraw file id. */
  private readonly shaByFile = new Map<string, string>()
  private emph: Emphasis = {}

  constructor(api: ExcalidrawImperativeAPI, lifetime: ExcalidrawLifetime | null = null) {
    this.api = api
    this.lifetime = lifetime
  }

  /** The tool bar's and zoom pill's controls on Excalidraw. */
  chrome(): CanvasChrome {
    return excalidrawChrome(this.api)
  }

  // ── reads and writes ──

  elements(opts: { includeDeleted?: boolean } = {}): CanvasElement[] {
    return (opts.includeDeleted ? this.api.getSceneElementsIncludingDeleted() : this.api.getSceneElements()) as unknown as CanvasElement[]
  }

  transact(fn: (els: readonly CanvasElement[]) => readonly CanvasElement[], opts: { undoable: boolean }) {
    const before = this.elements({ includeDeleted: true })
    const after = fn(before)
    if (!opts.undoable) {
      this.api.updateScene({ elements: asEls(after), captureUpdate: CaptureUpdateAction.NEVER })
      return
    }
    if (this.depth > 0) {
      // Inside a gesture: Excalidraw holds the change for the gesture's one IMMEDIATELY at its end.
      this.gestureBefore ??= before
      this.api.updateScene({ elements: asEls(after), captureUpdate: CaptureUpdateAction.EVENTUALLY })
      return
    }
    this.api.updateScene({ elements: asEls(after), captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    this.emitStep(before, after)
  }

  gesture<T>(fn: () => T): T {
    this.depth++
    try {
      return fn()
    } finally {
      this.depth--
      if (this.depth === 0 && this.gestureBefore) {
        const before = this.gestureBefore
        this.gestureBefore = null
        const after = this.elements({ includeDeleted: true })
        this.api.updateScene({ elements: asEls(after), captureUpdate: CaptureUpdateAction.IMMEDIATELY })
        this.emitStep(before, after)
      }
    }
  }

  onStep(cb: (step: SceneStep) => void): () => void {
    this.stepCbs.add(cb)
    return () => void this.stepCbs.delete(cb)
  }

  private emitStep(before: readonly CanvasElement[], after: readonly CanvasElement[]) {
    if (!this.stepCbs.size) return
    const changes = sceneDiff(before, after, BOOKKEEPING)
    if (!changes.length) return
    for (const cb of this.stepCbs) cb({ changes })
  }

  patch(el: CanvasElement, fields: Partial<CanvasElement>): CanvasElement {
    return newElementWith(asEl(el), fields as never) as unknown as CanvasElement
  }

  // ── intent factories ──

  imageNode(i: ImageNodeIntent): CanvasElement {
    const fileId = i.assetSha ? fileIdFor(i.assetSha) : null
    if (i.assetSha) this.shaByFile.set(fileId!, i.assetSha)
    const skeleton = {
      type: 'image' as const, ...(i.id !== undefined ? { id: i.id } : {}), x: i.x, y: i.y, width: i.width, height: i.height,
      fileId: fileId as unknown as FileId, customData: i.customData as Record<string, unknown>,
    }
    const [el] = i.keepIds ? convertToExcalidrawElements([skeleton], { regenerateIds: false }) : convertToExcalidrawElements([skeleton])
    return newElementWith(el as ExcalidrawImageElement, i.status === 'pending' ? { status: 'pending', fileId: null } : { status: 'saved' }) as unknown as CanvasElement
  }

  provenanceArrow(i: ProvenanceArrowIntent): CanvasElement {
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
    } as never) as unknown as CanvasElement
  }

  bindArrow(els: readonly CanvasElement[], arrow: CanvasElement): CanvasElement[] {
    const a = arrow as CanvasElement & { startBinding?: { elementId: string }; endBinding?: { elementId: string } }
    const ids = [a.startBinding?.elementId, a.endBinding?.elementId]
    return asEls(els).map((e) =>
      ids.includes(e.id) ? newElementWith(e, { boundElements: [...(e.boundElements ?? []), { id: arrow.id, type: 'arrow' }] }) : e,
    ) as unknown as CanvasElement[]
  }

  frameAround(i: FrameIntent): CanvasElement {
    const [frame] = convertToExcalidrawElements(
      [{ type: 'frame', x: i.x, y: i.y, width: i.width, height: i.height, name: i.name, children: [], customData: i.customData as Record<string, unknown> }],
    )
    return frame as unknown as CanvasElement
  }

  sketchArea(i: SketchAreaIntent): CanvasElement {
    const [rect] = convertToExcalidrawElements(
      [{
        type: 'rectangle', x: i.x, y: i.y, width: i.w, height: i.h,
        backgroundColor: '#ffffff', fillStyle: 'solid', strokeColor: 'transparent', strokeWidth: 1, roughness: 0, roundness: null,
        customData: { kind: 'sketch', id: i.sketchId },
      } as never],
    )
    return rect as unknown as CanvasElement
  }

  node(i: NodeIntent): CanvasElement {
    const [rect] = convertToExcalidrawElements(
      [{
        type: 'rectangle', ...(i.id ? { id: i.id } : {}), x: i.x, y: i.y, width: i.width, height: i.height,
        backgroundColor: 'transparent', strokeColor: 'transparent', roughness: 0, customData: i.customData,
      } as never],
      i.id ? { regenerateIds: false } : undefined,
    )
    return rect as unknown as CanvasElement
  }

  link(i: LinkIntent): CanvasElement {
    const [arrow] = convertToExcalidrawElements(
      [{ type: 'arrow', x: 0, y: 0, width: 1, height: 1, points: [[0, 0], [1, 1]] as never, strokeColor: '#4a7fd4', roughness: 0, endArrowhead: 'arrow', customData: { kind: 'link', id: i.linkId } } as never],
    )
    return newElementWith(arrow, {
      startBinding: { elementId: i.fromElId, focus: 0, gap: 8 },
      endBinding: { elementId: i.toElId, focus: 0, gap: 8 },
    } as never) as unknown as CanvasElement
  }

  board(i: BoardIntent): CanvasElement {
    const [frame] = convertToExcalidrawElements(
      [{ type: 'frame', ...(i.id ? { id: i.id } : {}), x: i.x, y: i.y, width: i.width, height: i.height, name: i.title, children: [], customData: { kind: 'board', id: i.boardId } } as never],
      i.id ? { regenerateIds: false } : undefined,
    )
    return frame as unknown as CanvasElement
  }

  // ── containers and overlays ──

  childrenOf(id: string): CanvasElement[] {
    return this.elements().filter((e) => e.frameId === id)
  }

  anchors(id: string): Anchor[] {
    const el = this.elements().find((e) => e.id === id)
    return el ? edgeAnchors(this.bounds([el])) : []
  }

  setEmphasis(e: Emphasis) {
    this.emph = { ...e }
  }

  emphasis(): Emphasis {
    return this.emph
  }

  // ── pictures, by sha256 ──

  addAssets(assets: CanvasAsset[]) {
    if (!assets.length) return
    const have = this.api.getFiles()
    const images = this.elements({ includeDeleted: true }).filter((e) => e.type === 'image')
    const add: FileData[] = []
    for (const a of assets) {
      // Its own file id, and the ids of elements already showing this picture under another file id
      // (a picture dropped on the canvas keeps the id Excalidraw gave it).
      const ids = new Set<string>([fileIdFor(a.sha256)])
      for (const e of images) if (assetOf(e) === a.sha256 && fileIdOf(e)) ids.add(fileIdOf(e)!)
      for (const id of ids) {
        this.shaByFile.set(id, a.sha256)
        if (!have[id]) add.push({ id: id as FileId, dataURL: a.dataURL as FileData['dataURL'], mimeType: a.mimeType as FileData['mimeType'], created: Date.now() })
      }
    }
    if (add.length) this.api.addFiles(add)
  }

  imageOf(el: CanvasElement, known?: Iterable<string>): { sha256: string | null; loaded: boolean } | null {
    if (el.type !== 'image') return null
    const fileId = fileIdOf(el)
    let sha = assetOf(el) ?? (fileId ? this.shaByFile.get(fileId) : undefined)
    if (!sha && fileId && known) for (const s of known) if (fileIdFor(s) === fileId) { sha = s; break }
    return { sha256: sha ?? null, loaded: !!fileId && !!this.api.getFiles()[fileId] }
  }

  imageDataURL(el: CanvasElement): string | null {
    const fileId = fileIdOf(el)
    return (fileId && this.api.getFiles()[fileId]?.dataURL) || null
  }

  withAsset(el: CanvasElement, sha256: string): CanvasElement {
    const fileId = fileIdFor(sha256)
    this.shaByFile.set(fileId, sha256)
    return newElementWith(asEl(el) as ExcalidrawImageElement, { fileId, status: 'saved' }) as unknown as CanvasElement
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

  version(els: readonly CanvasElement[]): number {
    return getSceneVersion(asEls(els))
  }

  bounds(els: readonly CanvasElement[]): Bounds {
    return commonBounds(els)
  }

  fit(els: readonly CanvasElement[], opts: { zoomFactor: number; animate: boolean }) {
    this.api.scrollToContent(asEls(els), { fitToViewport: true, viewportZoomFactor: opts.zoomFactor, animate: opts.animate })
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

  /** Excalidraw hands on single events: no coalesced or predicted points and no tilt; a pen's pressure is real. */
  capabilities(): InputCapabilities {
    return { coalesced: false, predicted: false, tilt: false, pressure: true }
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

  async exportPng(els: readonly CanvasElement[], opts: ExportPngOptions): Promise<Blob> {
    return await exportToBlob({
      elements: asEls(els),
      files: this.api.getFiles(),
      mimeType: 'image/png',
      exportPadding: opts.padding,
      appState: { exportBackground: true, viewBackgroundColor: opts.background, exportWithDarkMode: false },
    })
  }

  async exportSvg(els: readonly CanvasElement[], opts: ExportPngOptions): Promise<string> {
    const svg = await exportToSvg({
      elements: asEls(els),
      files: this.api.getFiles(),
      exportPadding: opts.padding,
      appState: { exportBackground: true, viewBackgroundColor: opts.background, exportWithDarkMode: false },
    })
    return svg.outerHTML
  }

  /**
   * Exactly `rect`, at outW x outH: the members are cloned into a transient frame of the box that is
   * never added to the scene, so the export is the box's size however far a stroke runs (and no
   * Safari canvas past 16.7 MP), strokes crossing the edge are clipped, and nothing on the canvas moves.
   */
  async exportRegion(req: RegionExport): Promise<Blob> {
    if (req.outW * req.outH > MAX_EXPORT_PIXELS) throw new Error(`An export of ${req.outW}×${req.outH} is too large.`)
    const [frame] = convertToExcalidrawElements(
      [{ type: 'frame', x: req.rect.x, y: req.rect.y, width: req.rect.w, height: req.rect.h, name: '', children: [] }],
    ) as ExcalidrawFrameElement[]
    const ids = new Set(req.elementIds)
    const members = asEls(this.elements()).filter((e) => ids.has(e.id)).map((e) => newElementWith(e, { frameId: frame.id } as never))
    return await exportToBlob({
      elements: [frame, ...members],
      files: this.api.getFiles(),
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

  // ── lifetime ──

  /** The live elements and the files they use: what save() kept in this browser before v2. */
  serialize(): CanvasSnapshot {
    const elements = this.elements()
    const used = new Set(elements.map(fileIdOf).filter((x): x is string => !!x))
    const files: FileMap = {}
    for (const [k, v] of Object.entries(this.api.getFiles())) if (used.has(k)) files[k] = v
    return { elements, files }
  }

  setTheme(theme: 'light' | 'dark') {
    this.lifetime?.setTheme(theme)
  }

  destroy() {
    this.lifetime?.destroy()
  }
}
