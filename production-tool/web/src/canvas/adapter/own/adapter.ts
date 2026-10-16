// OwnAdapter: CanvasAdapter v2 for our own engine (features/engine-adapter.clan,
// features/engine-ink.clan, under features/canvas-engine.clan). The scene is
// canvas-engine's SceneStore over a Y.Doc (the store Worker keeps its replica,
// live store and checkpoint); the tool reads it as CanvasElements
// (elementFromRecord) and writes through transact, which converts back and writes
// only the records and fields that changed. Deleted elements are kept as
// tombstones for the session, so the inline Undo can bring them back. The adapter
// keeps no undo stack: each undoable write is reported as a SceneStep for the
// UndoCoordinator (engine-select). Coordinates follow the same transform as
// Excalidraw's, so overlays and the contract tests read both engines alike:
// viewport = (scene + scroll) * zoom + offset.

import * as Y from 'yjs'
import { isSketchArea, sketchCopy } from '../../core/sketchCopy'
import { newId } from '../../../lib/ulid'
import {
  boundEnds, elementFromRecord, hitNodeOrLink, hitTitle, linkRoute, sceneLinkEnv, Ink, InputRouter, LIGHT_INK, recordsFromElements, SceneStore, SceneUndo, SelectTool, SketchTool, TextTool, TEXT_FONT, approxMeasure, type BoardEvent, type BoardLook, type Edge, type InkPalette, type InkTool, type LinkLook, type Intent, type Renderer, type SelectionFrame, type Measure, type TextLook, type TextSession, boardGrabAt,
} from '../../../../../canvas-engine/src'
import {
  MAX_EXPORT_PIXELS,
  type ActiveToolSpec, type Anchor, type Bounds, type CanvasAdapter, type CanvasAsset, type CanvasElement, type CanvasSnapshot, type Emphasis,
  type BoardIntent, type ExportPngOptions, type FrameIntent, type ImageNodeIntent, type InputCapabilities, type LinkIntent, type NodeIntent, type PointerSample, type Pt,
  type ProvenanceArrowIntent, type RegionExport, type SceneStep, type SketchAreaIntent, type ViewportTransform, type ViewSnapshot,
} from '../../core/canvasAdapter'
import { edgeAnchors } from '../../core/anchors'
import { elementBounds } from '../../core/geometry'
import { sceneDiff } from '../../core/sceneDiff'
import { drawElements, svgOf, type Ctx2D } from './draw'
import { ownChrome } from './chrome'
import type { CanvasChrome } from '../../chrome/controls'
import { DEFAULT_PEN, type PenChoice } from '../../chrome/penStyle'

/** What the canvas sits on and how boards look, in a theme (engine.ts reads them from the chrome's tokens). */
export interface Surface {
  background: string
  board: BoardLook | null
  link: LinkLook | null
  /** What the ink names mean in this theme (the --pen-* tokens); the light values when absent. */
  ink?: InkPalette
}

/** A surface to export onto: a 2D context and how to read it back as a PNG. */
export interface Raster {
  ctx: Ctx2D
  toBlob(): Promise<Blob>
}

export interface OwnOptions {
  /** A raster of w x h for exports (default: OffscreenCanvas, else a DOM canvas). */
  raster?: (w: number, h: number) => Raster
  /** Decode a picture for drawing (default: an HTMLImageElement when the DOM has one). */
  decode?: (asset: CanvasAsset, done: () => void) => CanvasImageSource | undefined
  /** Ids for new elements. */
  newId?: () => string
  /** The scene's Y.Doc (the mount opens it through the store Worker); a fresh one otherwise. */
  doc?: Y.Doc
  /** How wide a line of text is (default: the browser's canvas measureText, else canvas-engine's guess). */
  measure?: Measure
}

/** A line's width from the browser's own text metrics (made on first use), so a text's box fits its glyphs; canvas-engine's guess without a canvas. */
function browserMeasure(): Measure {
  let ctx: CanvasRenderingContext2D | null | undefined
  return (line, size, family) => {
    if (ctx === undefined) {
      try {
        ctx = typeof document !== 'undefined' && typeof OffscreenCanvas !== 'undefined' ? (new OffscreenCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D) : null
      } catch {
        ctx = null
      }
    }
    if (!ctx) return approxMeasure(line, size, family)
    ctx.font = `${size}px ${family || TEXT_FONT}, sans-serif`
    return ctx.measureText(line).width
  }
}

type OwnEl = CanvasElement & { assetSha?: string | null; startBinding?: { elementId: string }; endBinding?: { elementId: string } }

/** The cursor over each of a selected board's handles. */
const RESIZE_CURSOR: Record<string, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }
/** A run of arrow nudges is written this long after the last key (one undo step). */
export const NUDGE_IDLE_MS = 400

const CAPS_NONE: InputCapabilities = { coalesced: false, predicted: false, tilt: false, pressure: false }
/** The entered container's inside outline (container-select): the selection blue, lightened on the dark canvas. */
const SCOPE_LIGHT = '#2F64F5'
const SCOPE_DARK = '#8EA6FF'

function defaultRaster(w: number, h: number): Raster {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h)
    return { ctx: c.getContext('2d') as unknown as Ctx2D, toBlob: () => c.convertToBlob({ type: 'image/png' }) }
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return {
    ctx: c.getContext('2d') as unknown as Ctx2D,
    toBlob: () => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The export could not be drawn.'))), 'image/png')),
  }
}

function defaultDecode(a: CanvasAsset, done: () => void): CanvasImageSource | undefined {
  if (typeof Image === 'undefined') return undefined
  const img = new Image()
  img.onload = done
  img.src = a.dataURL
  return img
}

let seq = 0
const defaultId = () => `own_${Date.now().toString(36)}_${(seq++).toString(36)}`

export class OwnAdapter implements CanvasAdapter {
  readonly engine = 'own' as const
  readonly doc: Y.Doc
  readonly scene: SceneStore
  readonly ink: Ink
  readonly router = new InputRouter()
  /** This person's scene steps (the scene part of the UndoCoordinator; engine-select). */
  readonly undo: SceneUndo
  readonly selector: SelectTool
  /** The sketch area tool (S): ratio-locked areas (ui-behaviour 3.7). */
  readonly sketch: SketchTool
  /** The text tool (T): write and edit text in place (features/canvas-text.clan). */
  readonly text: TextTool
  /** The ink tool the drawing tools use (freedraw is the pen, or the highlighter when the pen's options say so). */
  inkTool: InkTool = 'pen'
  /** The pen's options (canvas/chrome/penStyle): ink names, painted in the theme's values. */
  private pen: PenChoice = DEFAULT_PEN
  /** What the next stroke draws with: the look of the ink tool in use. */
  get inkStyle(): { color: string; width: number } {
    return this.inkTool === 'highlighter' ? this.pen.highlighter : this.pen.pen
  }
  /** Elements deleted this session, so includeDeleted and the inline Undo still see them. */
  private readonly tombstones = new Map<string, CanvasElement>()
  private cache: CanvasElement[] | null = null
  private renderer: Renderer | null = null
  private readonly assets = new Map<string, CanvasAsset>()
  private readonly decoded = new Map<string, CanvasImageSource>()
  /** A per-element revision, so version() changes when those elements change. */
  private readonly rev = new Map<string, number>()
  private vp = { scrollX: 0, scrollY: 0, zoom: 1, offsetLeft: 0, offsetTop: 0, width: 800, height: 600 }
  private emph: Emphasis = {}
  private tool: ActiveToolSpec = { type: 'native', id: 'selection' }
  private theme: 'light' | 'dark' = 'light'
  private caps: InputCapabilities = CAPS_NONE
  private depth = 0
  private gestureBefore: readonly CanvasElement[] | null = null
  /** Pointers down on the canvas now: the engine's own gestures, which make it busy. */
  private pointersDown = 0
  private readonly stepCbs = new Set<(s: SceneStep) => void>()
  private readonly scrollCbs = new Set<() => void>()
  private readonly viewportCbs = new Set<(v: ViewportTransform) => void>()
  private readonly pointerCbs = new Set<(p: PointerSample) => void>()
  private readonly changeCbs = new Set<() => void>()
  private teardown: (() => void) | null = null
  private readonly opts: Required<Omit<OwnOptions, 'doc' | 'measure'>>

  constructor(initial: CanvasSnapshot | null = null, opts: OwnOptions = {}) {
    const { doc, ...rest } = opts
    this.opts = { raster: rest.raster ?? defaultRaster, decode: rest.decode ?? defaultDecode, newId: rest.newId ?? defaultId }
    this.doc = doc ?? new Y.Doc()
    this.scene = new SceneStore(this.doc)
    this.ink = new Ink(this.scene)
    this.undo = new SceneUndo(this.scene)
    // Node cards and links sit above the canvas: they come before boards and elements (grabOrder).
    this.selector = new SelectTool(this.scene, (x, y) => this.hitAt(x, y), { above: (x, y) => hitNodeOrLink(this.scene, { x, y }, this.vp.zoom) })
    this.selector.onChange(() => this.changed())
    // A finger's long press grabs what a press would pick up (board-move; ui-behaviour 8).
    this.router.canGrab = (x, y) => this.canGrab(x, y)
    // A drawn area's sketch id is a document id (sketch_ + a ULID): links into it are checked against the contract.
    this.sketch = new SketchTool(this.scene, { newId: (p) => (p === 'sketch' ? newId('sketch') : this.opts.newId()) })
    this.text = new TextTool(this.scene, { newId: () => this.opts.newId(), measure: rest.measure ?? browserMeasure() })
    this.scene.onChange((ids, remote) => {
      // Someone else changed what this person is nudging or dragging: a nudge is written now (on top
      // of their change), a drag's preview is dropped rather than written over it.
      if (remote) {
        const touched = (set: ReadonlySet<string>) => ids.some((id) => set.has(id))
        if (this.selector.nudgePending && touched(this.selector.nudgeIds())) queueMicrotask(() => this.flushNudge())
        else if (this.selector.preview && touched(this.selector.preview.ids)) this.selector.cancel()
      }
      this.cache = null
      for (const id of ids) this.rev.set(id, (this.rev.get(id) ?? 0) + 1)
      this.changed()
    })
    // A scene kept in this browser before the live store existed: put it in once.
    if (initial?.elements?.length && !this.scene.all().length && !this.scene.readOnly) {
      const { records, points } = recordsFromElements(initial.elements.filter((e) => !e.isDeleted) as never, () => undefined)
      this.scene.seed(records, points)
    }
  }

  /** Why the scene cannot be written (a checkpoint or doc from a newer build), or null. */
  readOnly(): string | null {
    return this.scene.readOnly
  }

  // ── reads and writes ──

  elements(opts: { includeDeleted?: boolean } = {}): CanvasElement[] {
    this.cache ??= this.served()
    return opts.includeDeleted ? [...this.cache, ...this.tombstones.values()] : [...this.cache]
  }

  /**
   * The records as elements. A bound arrow (a generation's provenance arrow) is served where it is
   * drawn now, from its ends (canvas-engine linkRoute), so hover cards and exports see the live line.
   */
  private served(): CanvasElement[] {
    const all = this.scene.all().sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0))
    const env = all.some((r) => r.kind === 'arrow' && boundEnds((id) => this.scene.get(id), r)) ? sceneLinkEnv(this.scene) : null
    return all.map((r) => {
      const el = elementFromRecord(r, this.scene.points(r.id)) as unknown as CanvasElement
      const route = env && r.kind === 'arrow' ? linkRoute(env, r) : null
      // Bound, but with no line (both ends in one closed pile): not drawn, so served with no points, and
      // never hovered or hit at the box it had when it was made (the pile's "ghost").
      if (!route && env && r.kind === 'arrow' && boundEnds((id) => this.scene.get(id), r)) return { ...el, width: 0, height: 0, points: [] }
      if (!route) return el
      const o = route.pts[0]
      const xs = route.pts.map((p) => p.x)
      const ys = route.pts.map((p) => p.y)
      return { ...el, x: o.x, y: o.y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points: route.pts.map((p) => [p.x - o.x, p.y - o.y] as [number, number]) }
    })
  }

  transact(fn: (els: readonly CanvasElement[]) => readonly CanvasElement[], opts: { undoable: boolean }) {
    const before = this.elements({ includeDeleted: true })
    const after = fn(before)
    const live = after.filter((e) => !e.isDeleted)
    for (const e of after) {
      if (e.isDeleted) this.tombstones.set(e.id, { ...e, isDeleted: true })
      else this.tombstones.delete(e.id)
    }
    const converted = recordsFromElements(live as never, (id) => this.scene.get(id))
    const { points } = converted
    // A bound link's or arrow's geometry is derived from its ends: what it was served as is never written back.
    const records = converted.records.map((r) => {
      const cur = this.scene.get(r.id)
      if (!cur || (r.kind !== 'arrow' && r.kind !== 'link') || !boundEnds((id) => this.scene.get(id), r)) return r
      return { ...r, x: cur.x, y: cur.y, w: cur.w, h: cur.h, props: { ...r.props, route: cur.props.route ?? [] } }
    })
    const keep = new Set(records.map((r) => r.id as string))
    this.scene.change((tx) => {
      const put = records.filter((r) => {
        const cur = tx.get(r.id)
        return !cur || JSON.stringify(cur) !== JSON.stringify(r)
      })
      if (put.length) tx.put(put)
      const gone = this.scene.all().filter((r) => !keep.has(r.id)).map((r) => r.id as string)
      if (gone.length) tx.remove(gone)
      for (const [id, p] of Object.entries(points)) if (!this.scene.points(id)) tx.setPoints(id, p)
    }, { undoable: opts.undoable })
    if (opts.undoable) {
      if (this.depth > 0) this.gestureBefore ??= before
      else this.emitStep(sceneDiff(before, after))
    }
    this.cache = null
    this.changed()
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
        this.emitStep(sceneDiff(before, this.elements({ includeDeleted: true })))
      }
    }
  }

  onStep(cb: (step: SceneStep) => void): () => void {
    this.stepCbs.add(cb)
    return () => void this.stepCbs.delete(cb)
  }

  private emitStep(changes: SceneStep['changes']) {
    if (!changes.length) return
    for (const cb of this.stepCbs) cb({ changes })
  }

  patch(el: CanvasElement, fields: Partial<CanvasElement>): CanvasElement {
    return { ...el, ...fields }
  }

  // ── intent factories ──

  private make(fields: Partial<OwnEl> & { type: string }): OwnEl {
    return { id: this.opts.newId(), x: 0, y: 0, width: 0, height: 0, isDeleted: false, frameId: null, groupIds: [], angle: 0, ...fields }
  }

  imageNode(i: ImageNodeIntent): CanvasElement {
    return this.make({
      ...(i.id !== undefined ? { id: i.id } : {}), type: 'image', x: i.x, y: i.y, width: i.width, height: i.height,
      customData: i.customData, status: i.status, assetSha: i.status === 'pending' ? null : i.assetSha,
    })
  }

  provenanceArrow(i: ProvenanceArrowIntent): CanvasElement {
    const xs = i.points.map((p) => p[0])
    const ys = i.points.map((p) => p[1])
    return this.make({
      type: 'arrow', x: i.origin.x, y: i.origin.y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      points: i.points, strokeColor: i.color, strokeWidth: 2, strokeStyle: 'dashed', customData: i.customData,
      startBinding: { elementId: i.fromElId }, endBinding: { elementId: i.toElId },
    } as Partial<OwnEl> & { type: string })
  }

  /** Bindings live on the arrow (startBinding, endBinding); the ends need no back-reference. */
  bindArrow(els: readonly CanvasElement[]): CanvasElement[] {
    return [...els]
  }

  frameAround(i: FrameIntent): CanvasElement {
    return this.make({ type: 'frame', x: i.x, y: i.y, width: i.width, height: i.height, name: i.name, customData: i.customData } as Partial<OwnEl> & { type: string })
  }

  sketchArea(i: SketchAreaIntent): CanvasElement {
    return this.make({
      type: 'rectangle', x: i.x, y: i.y, width: i.w, height: i.h, backgroundColor: '#ffffff', strokeColor: 'transparent',
      customData: { kind: 'sketch', id: i.sketchId },
    } as Partial<OwnEl> & { type: string })
  }

  dragOffset() {
    return this.selector.preview
  }

  node(i: NodeIntent): CanvasElement {
    return this.make({
      ...(i.id ? { id: i.id } : {}), type: 'rectangle', x: i.x, y: i.y, width: i.width, height: i.height,
      strokeColor: 'transparent', backgroundColor: 'transparent', customData: i.customData,
    } as Partial<OwnEl> & { type: string })
  }

  link(i: LinkIntent): CanvasElement {
    return this.make({
      type: 'arrow', points: [[0, 0], [1, 1]], role: i.role, customData: { kind: 'link', id: i.linkId },
      startBinding: { elementId: i.fromElId, ...(i.fromGroup ? { group: i.fromGroup } : {}) }, endBinding: { elementId: i.toElId },
    } as Partial<OwnEl> & { type: string })
  }

  board(i: BoardIntent): CanvasElement {
    return this.make({
      ...(i.id ? { id: i.id } : {}), type: 'frame', x: i.x, y: i.y, width: i.width, height: i.height, name: i.title,
      customData: { kind: 'board', id: i.boardId }, ...(i.purpose ? { purpose: i.purpose } : {}),
    } as Partial<OwnEl> & { type: string })
  }

  // ── containers and overlays ──

  childrenOf(id: string): CanvasElement[] {
    return this.elements().filter((e) => e.frameId === id)
  }

  anchors(id: string): Anchor[] {
    const el = this.elements().find((e) => e.id === id)
    return el ? edgeAnchors(this.bounds([el])) : []
  }

  animate(from: ReadonlyMap<string, { x: number; y: number; angle: number }>, ms: number) {
    if (!this.renderer || !from.size) return
    this.renderer.tween = { from: new Map([...from].map(([id, p]) => [id, { x: p.x, y: p.y, rotation: p.angle }])), t0: performance.now(), ms }
    if (typeof requestAnimationFrame === 'undefined') return
    const step = () => {
      this.changed()
      if (this.renderer?.animating()) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  setEmphasis(e: Emphasis) {
    this.emph = { ...e }
    this.changed()
  }

  emphasis(): Emphasis {
    return this.emph
  }

  // ── pictures, by sha256 ──

  addAssets(assets: CanvasAsset[]) {
    for (const a of assets) {
      if (this.assets.has(a.sha256)) continue
      this.assets.set(a.sha256, a)
      const img = this.opts.decode(a, () => this.changed())
      if (img) this.decoded.set(a.sha256, img)
    }
    if (assets.length) this.changed()
  }

  private shaOf(el: CanvasElement): string | null {
    const own = (el as OwnEl).assetSha
    if (own) return own
    const c = el.customData as { asset?: unknown } | undefined
    return typeof c?.asset === 'string' ? c.asset : null
  }

  imageOf(el: CanvasElement): { sha256: string | null; loaded: boolean } | null {
    if (el.type !== 'image') return null
    const sha = this.shaOf(el)
    return { sha256: sha, loaded: !!sha && this.assets.has(sha) }
  }

  imageDataURL(el: CanvasElement): string | null {
    const sha = this.shaOf(el)
    return (sha && this.assets.get(sha)?.dataURL) || null
  }

  withAsset(el: CanvasElement, sha256: string): CanvasElement {
    return { ...el, assetSha: sha256, status: 'saved' } as OwnEl
  }

  // ── view ──

  view(): ViewSnapshot {
    const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = this.vp
    return { scrollX, scrollY, zoom, offsetLeft, offsetTop, selectedIds: [...this.selector.selected] }
  }

  select(ids: readonly string[]) {
    this.selector.set(ids)
    this.changed()
  }

  visibleBounds() {
    const { scrollX, scrollY, zoom, width, height } = this.vp
    return { minX: -scrollX, minY: -scrollY, maxX: -scrollX + width / zoom, maxY: -scrollY + height / zoom }
  }

  sceneToViewport(p: Pt, v: ViewSnapshot): Pt {
    return { x: (p.x + v.scrollX) * v.zoom + v.offsetLeft, y: (p.y + v.scrollY) * v.zoom + v.offsetTop }
  }

  viewportToScene(p: Pt, v: ViewSnapshot): Pt {
    return { x: (p.x - v.offsetLeft) / v.zoom - v.scrollX, y: (p.y - v.offsetTop) / v.zoom - v.scrollY }
  }

  // ── the rest ──

  version(els: readonly CanvasElement[]): number {
    let n = 0
    for (const e of els) n += (this.rev.get(e.id) ?? 0) + 1
    return n
  }

  bounds(els: readonly CanvasElement[]): Bounds {
    return elementBounds(els)
  }

  /** Centre the elements and zoom so they cover `zoomFactor` of the viewport (no animation yet). */
  fit(els: readonly CanvasElement[], opts: { zoomFactor: number; animate: boolean }) {
    if (!els.length) return
    const b = this.bounds(els)
    const { width, height } = this.vp
    const zoom = Math.min(30, Math.max(0.1, Math.min(width / Math.max(1, b.w), height / Math.max(1, b.h)) * opts.zoomFactor))
    this.setViewport({ zoom, scrollX: width / (2 * zoom) - (b.minX + b.w / 2), scrollY: height / (2 * zoom) - (b.minY + b.h / 2) })
  }

  refresh() {
    this.changed()
  }

  onScroll(cb: () => void): () => void {
    this.scrollCbs.add(cb)
    return () => void this.scrollCbs.delete(cb)
  }

  onPointer(cb: (p: PointerSample) => void): () => void {
    this.pointerCbs.add(cb)
    return () => void this.pointerCbs.delete(cb)
  }

  capabilities(): InputCapabilities {
    return { ...this.caps }
  }

  onViewport(cb: (v: ViewportTransform) => void): () => void {
    this.viewportCbs.add(cb)
    return () => void this.viewportCbs.delete(cb)
  }

  isBusy(): boolean {
    return this.depth > 0 || this.pointersDown > 0 || !(this.tool.type === 'native' && this.tool.id === 'selection')
  }

  /** The tool's names (Excalidraw's, as the stage passes them) onto the router and the ink tools. */
  /** The tool in use (the chrome's tool bar reads it). */
  activeTool(): ActiveToolSpec {
    return this.tool
  }

  /** The tool bar's and zoom pill's controls on this engine. */
  chrome(): CanvasChrome {
    return ownChrome(this)
  }

  /** The board the rail last jumped to (a document board id), drawn in the tool colour. */
  setCurrentBoard(boardId: string | null) {
    const el = boardId ? this.elements().find((e) => (e.customData as { kind?: string; id?: string } | undefined)?.kind === 'board' && (e.customData as { id?: string }).id === boardId) : undefined
    this.currentBoard = el?.id ?? null
    this.changed()
  }

  private currentBoard: string | null = null
  /** The surface for a theme; null draws the plain white or near-black canvas. */
  surfaceFor: ((theme: 'light' | 'dark') => Surface) | null = null
  /** Give the canvas the keyboard again (the mounted engine's host), so ⌘Z after a chrome action is the canvas's. */
  focusCanvas: (() => void) | null = null
  private surface: { theme: string; s: Surface } | null = null

  setActiveTool(tool: ActiveToolSpec) {
    this.flushNudge()
    this.tool = tool
    const id = tool.type === 'native' ? tool.id : ''
    if (id !== 'sketch') this.sketch.cancel()
    this.textPress = null
    if (id === 'freedraw' || id === 'pen') {
      this.router.tool = 'ink'
      this.inkTool = this.pen.mode
    } else if (id === 'highlighter' || id === 'eraser') {
      this.router.tool = 'ink'
      this.inkTool = id
    } else this.router.tool = id === 'hand' ? 'hand' : 'select'
    this.changed()
  }

  /** The pen's options: pen or highlighter, and each one's ink and width. */
  setPen(p: PenChoice) {
    this.pen = p
    if (this.inkTool !== 'eraser') this.inkTool = p.mode
    this.changed()
  }

  /** The ink names' values in the current theme (the --pen-* tokens), for the live stroke. */
  inkPalette(): InkPalette {
    return this.surfaceNow()?.ink ?? LIGHT_INK
  }

  private surfaceNow(): Surface | null {
    if (this.surfaceFor && this.surface?.theme !== this.theme) this.surface = { theme: this.theme, s: this.surfaceFor(this.theme) }
    return this.surface?.s ?? null
  }

  private image = (sha: string) => this.decoded.get(sha)

  // ── select, group and the sketch area tool (features/canvas-edit-tools.clan) ──

  /** The router's press, drag and release: the sketch area tool's while it is the tool, else the select tool's. */
  press(p: Pt, opts: { shift?: boolean; by?: 'mouse' | 'pen' | 'touch' } = {}) {
    if (this.texting()) this.textPress = p
    else if (this.sketching()) this.sketch.press(p)
    else this.selector.press(p, { ...opts, zoom: this.vp.zoom })
    this.changed()
  }

  drag(p: Pt) {
    if (this.texting()) return
    if (this.sketching()) this.sketch.drag(p)
    else this.selector.drag(p)
    this.changed()
  }

  release(p: Pt) {
    if (this.texting()) {
      // T, then a click: the editor opens there, or on the text clicked.
      const at = this.textPress ?? p
      this.textPress = null
      const hit = this.textAt(at)
      if (hit) this.editText(hit)
      else this.startText(at)
      return
    }
    if (!this.sketching()) {
      this.selector.release(p)
      return
    }
    const area = this.sketch.release(p)
    // As a drawn shape: back to Select, with the new area selected.
    if (area) {
      this.setActiveTool({ type: 'native', id: 'selection' })
      this.selector.set([area.id])
    }
    this.changed()
  }

  // ── text (features/canvas-text.clan) ──

  private textPress: Pt | null = null

  private texting() {
    return this.tool.type === 'native' && this.tool.id === 'text'
  }

  /** The text at a scene point (the topmost thing there, when it is a text), or null. */
  textAt(p: Pt): string | null {
    const r = this.hitAt(p.x, p.y)
    return r?.kind === 'text' && !r.locked ? r.id : null
  }

  /** The edit session open now (the mount shows its editor), or null. */
  textSession(): TextSession | null {
    return this.text.session
  }

  /** A new text at a scene point: the mount opens its editor. */
  startText(p: Pt): TextSession {
    if (this.text.session) this.commitText(this.text.session.plain)
    const s = this.text.begin(p)
    this.changed()
    return s
  }

  /** Edit a text in place (a double-click, or T on a text). False when it cannot be edited. */
  editText(id: string): boolean {
    if (this.scene.readOnly) return false
    const s = this.text.edit(id)
    if (s) this.selector.set([id])
    this.changed()
    return !!s
  }

  /** End the session with what was typed: one step. Back to Select with the text selected. */
  commitText(typed: string): string | null {
    if (!this.text.session) return null
    let r = null
    try {
      r = this.text.commit(typed)
    } catch (e) {
      console.warn('the text was not kept', e)
    }
    if (this.texting()) this.setActiveTool({ type: 'native', id: 'selection' })
    this.selector.set(r ? [r.id] : [])
    this.changed()
    return r?.id ?? null
  }

  /** The look the next text takes (the Text tool's options). */
  setTextLook(look: TextLook) {
    this.text.look = { ...look }
    this.changed()
  }

  /** The selected texts' look (the first one's), or null when no text is selected. */
  selectedText(): TextLook | null {
    const s = this.text.session
    if (s) return s.look
    for (const id of this.selector.selected) {
      const r = this.scene.get(id)
      if (r?.kind === 'text') return { size: r.style.fontSize ?? 20, color: r.style.stroke ?? 'ink' }
    }
    return null
  }

  /** The options changed: the text being typed takes it, else the selected texts (one step). */
  styleText(change: Partial<TextLook>) {
    if (this.text.session) this.text.restyleSession(change)
    else this.text.restyle(this.selector.selected, change)
    this.changed()
  }

  private sketching() {
    return this.tool.type === 'native' && this.tool.id === 'sketch'
  }

  /** The ratio of the next sketch area (the picker's; ui-behaviour 3.7). An existing area's never changes. */
  setSketchRatio(ratio: string) {
    this.sketch.ratio = ratio
  }

  /** The one sketch area selected, if that is the selection: the picker then offers copies (owner decision 2026-10-14). */
  selectedSketchArea(): CanvasElement | null {
    const ids = [...this.selector.selected]
    if (ids.length !== 1) return null
    const e = this.elements().find((x) => x.id === ids[0])
    return e && isSketchArea(e) ? e : null
  }

  /**
   * "Make a 9:16 copy": a new area of `ratio` beside the selected one, its strokes scaled to fit
   * (canvas/core/sketchCopy), one undo step, the copy selected. The original is untouched. Returns the copy's id.
   */
  copySketchArea(ratio: string): string | null {
    const area = this.selectedSketchArea()
    if (!area) return null
    const made = sketchCopy(this.elements(), area, ratio, (p) => (p === 'sketch' ? newId('sketch') : this.opts.newId()))
    if (!made) return null
    this.transact((all) => [...all, made.area, ...made.strokes], { undoable: true })
    this.select([made.area.id])
    // The picker had the focus: the next ⌘Z or Delete is the canvas's, on the copy.
    this.focusCanvas?.()
    return made.area.id
  }

  /** Group the selection (Ctrl/Cmd+G), one step of the person's. Returns the group id, or null. */
  group(): string | null {
    return this.selector.group()
  }

  /** The element at a scene point alone, even inside a group (a double-click): its id, or null. */
  pickOne(p: Pt): string | null {
    const id = this.selector.pickOne(p)
    this.changed()
    return id
  }

  /** Ungroup the outermost group of the selection (Ctrl/Cmd+Shift+G), one step. */
  ungroup(): boolean {
    return this.selector.ungroup()
  }

  /** What the selection is, for the selection bar (ui-behaviour 3.9). */
  selectionKind() {
    return this.selector.selectionKind()
  }

  /** The selection's frame: dashed round a group, with handles when it can be scaled, the ink group's label. */
  selectionFrame(): SelectionFrame | null {
    // A text being edited shows its editor, not its frame and handles.
    if (this.text.session) return null
    // A selected board: its edge and corner handles (it resizes; owner decision 2026-10-15).
    const board = this.selector.soleBoard()
    if (board) {
      // Moving (a drag or a run of nudges): the handles go with the board.
      const mv = this.selector.preview?.ids.has(board.id) ? this.selector.preview : null
      const box = this.selector.resizing?.rect ?? { x: board.x + (mv?.dx ?? 0), y: board.y + (mv?.dy ?? 0), w: board.w, h: board.h }
      return { box, dashed: false, handles: false, edges: true }
    }
    const f = this.selector.frame()
    if (!f) return null
    const k = this.selector.selectionKind()
    const dashed = k.kind === 'group'
    const label = k.kind === 'group' && k.ink ? `Ink · ${k.count} ${k.count === 1 ? 'stroke' : 'strokes'} · one group` : undefined
    if (!dashed && !f.scalable) return null
    return { box: f.box, dashed, handles: f.scalable, ...(label ? { label } : {}) }
  }

  // ── boards as spaces (owner decision 2026-10-15; canvas-engine boards/sizing) ──

  /** A board was full (what was dropped landed outside it), or things left it on a resize. */
  onBoardEvent(cb: (e: BoardEvent) => void): () => void {
    return this.selector.onBoard(cb)
  }

  /** Fit to contents on a board frame: round what is on it with its padding, one undo step. */
  fitBoard(frameId: string): boolean {
    const done = this.selector.fitBoard(frameId)
    if (done) this.changed()
    return done
  }

  /** The container a click would take whole, outlined faintly under the pointer (container-select). */
  private hover: { x: number; y: number; w: number; h: number } | null = null

  /** Point the hover outline at a scene point (null: the pointer left). True when it changed, so the caller redraws. */
  hoverAt(p: Pt | null): boolean {
    const next = p && !this.sketching() && !this.pointersDown ? this.selector.hoverBox(p) : null
    const same = next === this.hover || (!!next && !!this.hover && next.x === this.hover.x && next.y === this.hover.y && next.w === this.hover.w && next.h === this.hover.h)
    this.hover = next
    return !same
  }

  /** The selected board's square handle under a scene point (the cursor shows it), or null. */
  boardHandleAt(p: Pt): Edge | null {
    return this.sketching() ? null : this.selector.boardHandleAt(p, this.vp.zoom)
  }

  /**
   * The cursor over a scene point (board-move): a selected board's handles resize, a board's title
   * chip and edge (and a selected board's inside) grab, and 'grabbing' while something moves.
   */
  cursorAt(p: Pt): string {
    if (this.sketching() || this.router.tool !== 'select') return ''
    if (this.selector.preview && !this.selector.nudgePending) return 'grabbing'
    const edge = this.boardHandleAt(p)
    if (edge) return RESIZE_CURSOR[edge]
    // The board rows of grabOrder, read cheaply on every hover (node cards are DOM above the canvas).
    const g = boardGrabAt(this.scene, p, this.vp.zoom)
    if (!g) return ''
    if (g.part === 'title') return 'grab'
    if (this.hitAt(p.x, p.y)) return ''
    return g.part === 'edge' || this.selector.selected.has(g.board.id) ? 'grab' : ''
  }

  /** Would a press at this viewport point pick something up? (The router asks when a finger's long press fires.) */
  canGrab(x: number, y: number): boolean {
    if (this.sketching() || this.router.tool === 'hand') return false
    return this.selector.grabbableAt(this.viewportToScene({ x, y }, this.view()), this.vp.zoom)
  }

  /** A one-finger tap selects what is under it, as a click does (ui-behaviour 8). */
  tap(p: Pt) {
    if (this.sketching()) return
    this.selector.press(p, { by: 'touch', zoom: this.vp.zoom })
    this.selector.release(p)
    this.changed()
  }

  /** A press called off (a palm or a second finger during a finger's grab): nothing it previewed is written. */
  cancelPress() {
    this.selector.cancel()
    this.sketch.cancel()
    this.changed()
  }

  private nudgeTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Arrow keys: nudge the selection by (dx, dy) screen pixels. A run of nudges is one step, written
   * NUDGE_IDLE_MS after the last key, or at once on undo or redo, a press, a tool change, blur or a
   * remote change to what is nudged. False when nothing is selected that can move.
   */
  nudge(dx: number, dy: number): boolean {
    const z = this.vp.zoom
    if (!this.selector.nudgePending && !this.selector.selected.size) return false
    const moved = this.selector.nudge(dx / z, dy / z)
    if (!this.selector.nudgePending) return false
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer)
    this.nudgeTimer = setTimeout(() => this.flushNudge(), NUDGE_IDLE_MS)
    this.changed()
    return moved
  }

  /** Write a waiting run of nudges now (one step). */
  flushNudge(): boolean {
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer)
    this.nudgeTimer = null
    if (!this.selector.nudgePending) return false
    const done = this.selector.flushNudge()
    this.changed()
    return done
  }

  /** The topmost element at a scene point (never a board: boards are grabbed by boards/grab): the renderer's index when mounted, else the boxes. */
  private hitAt(x: number, y: number) {
    // Lines (strokes, unfilled shapes) count only near their line, with a reach in screen pixels
    // (container-select). Node cards and links (above), board titles and Drawing labels are the select
    // tool's own grabOrder rows.
    if (this.renderer) return this.renderer.hit(x, y, this.vp.zoom)
    return this.scene.all()
      .filter((r) => r.kind !== 'board' && r.kind !== 'node' && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h)
      .sort((a, b) => (a.z < b.z ? 1 : a.z > b.z ? -1 : 0))[0]
  }

  private readonly noticeCbs = new Set<(message: string) => void>()

  /** Words for the person (the undo skip notice). */
  onNotice(cb: (message: string) => void): () => void {
    this.noticeCbs.add(cb)
    return () => void this.noticeCbs.delete(cb)
  }

  /** Undo or redo this person's last scene step; says so when part of it was skipped (ui-behaviour 4.5). */
  undoScene(dir: 'undo' | 'redo'): boolean {
    // A run of arrow nudges is a step of its own: written first, so undo takes it back.
    this.flushNudge()
    const r = dir === 'undo' ? this.undo.undo() : this.undo.redo()
    if (!r) return false
    if (r.skipped) {
      const msg = r.applied ? 'Someone changed part of this after you, so undo skipped that part.' : 'Someone changed this after you, so undo skipped it.'
      for (const cb of this.noticeCbs) cb(msg)
    }
    this.selector.prune()
    return true
  }

  /** A decoded picture, for the renderer. */
  imageFor(sha: string): CanvasImageSource | undefined {
    return this.decoded.get(sha)
  }

  private readonly intentCbs = new Set<(i: Intent) => void>()

  /** The router's intents the ink tools do not use (press, drag, tap, undo, long press…), for engine-select. */
  onIntent(cb: (i: Intent) => void): () => void {
    this.intentCbs.add(cb)
    return () => void this.intentCbs.delete(cb)
  }

  emitIntent(i: Intent) {
    for (const cb of this.intentCbs) cb(i)
  }

  private async rasterOf(box: { x: number; y: number; w: number; h: number }, ids: ReadonlySet<string> | null, outW: number, outH: number, background: string): Promise<Blob> {
    const r = this.opts.raster(outW, outH)
    const ctx = r.ctx
    ctx.save()
    ctx.fillStyle = background
    ctx.fillRect(0, 0, outW, outH)
    ctx.scale(outW / Math.max(1e-9, box.w), outH / Math.max(1e-9, box.h))
    ctx.translate(-box.x, -box.y)
    ctx.beginPath()
    ctx.rect(box.x, box.y, box.w, box.h)
    ctx.clip()
    drawElements(ctx, ids ? this.elements().filter((e) => ids.has(e.id)) : this.elements(), this.image)
    ctx.restore()
    return await r.toBlob()
  }

  async exportPng(els: readonly CanvasElement[], opts: ExportPngOptions): Promise<Blob> {
    const b = this.bounds(els)
    const box = { x: b.minX - opts.padding, y: b.minY - opts.padding, w: b.w + opts.padding * 2, h: b.h + opts.padding * 2 }
    const scale = Math.min(1, Math.sqrt(MAX_EXPORT_PIXELS / Math.max(1, box.w * box.h)))
    return await this.rasterOf(box, new Set(els.map((e) => e.id)), Math.max(1, Math.round(box.w * scale)), Math.max(1, Math.round(box.h * scale)), opts.background)
  }

  async exportSvg(els: readonly CanvasElement[], opts: ExportPngOptions): Promise<string> {
    const b = this.bounds(els)
    const box = { x: b.minX - opts.padding, y: b.minY - opts.padding, w: b.w + opts.padding * 2, h: b.h + opts.padding * 2 }
    return svgOf(els, box, opts.background, (sha) => this.assets.get(sha)?.dataURL)
  }

  async exportRegion(req: RegionExport): Promise<Blob> {
    if (req.outW * req.outH > MAX_EXPORT_PIXELS) throw new Error(`An export of ${req.outW}×${req.outH} is too large.`)
    return await this.rasterOf(req.rect, new Set(req.elementIds), req.outW, req.outH, req.background)
  }

  // ── lifetime ──

  serialize(): CanvasSnapshot {
    return { engine: 'own', elements: this.elements(), files: {} }
  }

  setTheme(theme: 'light' | 'dark') {
    this.theme = theme
    this.changed()
  }

  destroy() {
    this.teardown?.()
    this.teardown = null
  }

  // ── for the mount (engine.ts): the surface drives these ──

  /** The engine's renderer (the mount makes it with the browser's Path2D and bitmaps). */
  useRenderer(r: Renderer | null) {
    this.renderer = r
    if (r) r.selected = this.selector.selected
  }

  /** Draw the scene onto the screen's context, in device pixels at `dpr`. */
  /** The ink over the node cards, on the canvas above them (after drawTo, which sets the renderer's state). */
  drawOverTo(ctx: Ctx2D, dpr: number) {
    const { scrollX, scrollY, zoom, width, height } = this.vp
    this.renderer?.drawOver(ctx as never, { scrollX, scrollY, zoom }, { width, height }, dpr)
  }

  drawTo(ctx: Ctx2D, dpr: number) {
    const { scrollX, scrollY, zoom, width, height } = this.vp
    if (this.renderer) {
      this.renderer.selected = this.selector.selected
      this.renderer.moving = this.selector.preview
      this.renderer.scaling = this.selector.scaling
      this.renderer.resizing = this.selector.resizing
      this.renderer.landing = this.selector.landing
      this.renderer.frame = this.selectionFrame()
      // The entered Drawing, sketch area or group: a dashed inside outline, readable on either theme.
      this.renderer.scope = this.selector.scopeBox()
      this.renderer.hover = this.hover
      this.renderer.scopeColour = this.theme === 'dark' ? SCOPE_DARK : SCOPE_LIGHT
      this.surfaceNow()
      this.renderer.inkPalette = this.surface?.s.ink ?? LIGHT_INK
      this.renderer.boardLook = this.surface?.s.board ?? null
      this.renderer.linkLook = this.surface?.s.link ?? null
      this.renderer.currentBoard = this.currentBoard
      this.renderer.editing = this.text.session?.fresh === false ? this.text.session.id : null
      this.renderer.draw(ctx as never, { scrollX, scrollY, zoom }, { width, height }, dpr, this.surface?.s.background ?? (this.theme === 'dark' ? '#121212' : '#ffffff'))
      return
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.theme === 'dark' ? '#121212' : '#ffffff'
    ctx.fillRect(0, 0, width * dpr, height * dpr)
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * zoom * scrollX, dpr * zoom * scrollY)
    drawElements(ctx, this.elements(), this.image, this.theme, this.surfaceNow()?.ink)
  }

  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb)
    return () => void this.changeCbs.delete(cb)
  }

  attach(teardown: () => void, caps: InputCapabilities) {
    this.teardown = teardown
    this.caps = caps
  }

  resize(width: number, height: number, offsetLeft: number, offsetTop: number) {
    Object.assign(this.vp, { width, height, offsetLeft, offsetTop })
    this.changed()
  }

  setViewport(v: Partial<ViewportTransform>) {
    Object.assign(this.vp, v)
    const t = { scrollX: this.vp.scrollX, scrollY: this.vp.scrollY, zoom: this.vp.zoom }
    for (const cb of this.viewportCbs) cb(t)
    for (const cb of this.scrollCbs) cb()
    this.changed()
  }

  pointer(p: PointerSample) {
    if (p.phase === 'down') this.pointersDown++
    if (p.phase === 'up') this.pointersDown = Math.max(0, this.pointersDown - 1)
    for (const cb of this.pointerCbs) cb(p)
  }

  private changed() {
    for (const cb of this.changeCbs) cb()
  }
}
