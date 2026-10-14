// CanvasAdapter v2 (features/engine-adapter.clan, under features/canvas-engine.clan;
// v1 was frame-aspect's): every call the tool makes on its canvas engine, as
// one interface over one engine-neutral element type. The engines live behind
// it in src/canvas/adapter/<engine>/, reached only through src/canvas/adapter/index.ts;
// this file and the rest of src/canvas/core import no engine, no sync library
// and no adapter (eslint.config.js enforces it).
//
// v2 over v1: transact(fn) and gesture(fn) in place of commit(els), with each
// undoable write reported as a field-level SceneStep; pointer capabilities
// (coalesced and predicted points, tilt); containers (childrenOf); anchors and
// emphasis for overlays; exportSvg; pictures keyed by sha256 in place of
// dataURL files; serialize(), setTheme() and destroy(); and the engine module's
// mount() and exportFile(), so no caller imports an adapter.

import type { LinkRole } from './links'
import type { NodeKind } from './nodes'

/**
 * An element as the tool reads it, whatever engine holds it. Both engines' elements satisfy it
 * structurally; anything else an engine keeps on its elements passes through untouched.
 */
export interface CanvasElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  angle?: number
  isDeleted?: boolean
  customData?: unknown
  /** The container (a drawn frame or a board) the element sits in: parentId in the napkin/1 records. */
  frameId?: string | null
  groupIds?: readonly string[]
  /** An image's picture: 'pending' while a job makes it, 'saved' once it is there. */
  status?: string
  text?: string
  originalText?: string
  /** The shape or arrow a text is bound to: boundTo in the napkin/1 records. */
  containerId?: string | null
  /** A line, arrow or stroke's points, relative to x, y. */
  points?: readonly (readonly [number, number])[]
}

/** v1's name for the fields every element has; kept as an alias of CanvasElement. */
export type SceneElementBase = CanvasElement

/**
 * The fields the pure planners read: no geometry. A superset of today's
 * PlainEl (canvas/selection.ts), plus groupIds for ink groups.
 */
export interface ElementLike {
  id: string
  type: string
  isDeleted?: boolean
  customData?: unknown
  frameId?: string | null
  text?: string
  originalText?: string
  groupIds?: readonly string[]
  /** Geometry, when the planner has it: a stroke that meets a sketch area belongs to it (frame-aspect). */
  x?: number
  y?: number
  width?: number
  height?: number
  points?: readonly (readonly [number, number])[]
}

export type Pt = { x: number; y: number }

/** A box in scene coordinates. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  w: number
  h: number
}

/** What the viewport shows, as plain numbers, read at one moment. */
export interface ViewSnapshot {
  scrollX: number
  scrollY: number
  zoom: number
  offsetLeft: number
  offsetTop: number
  selectedIds: string[]
}

/** A picture's bytes, keyed by its sha256 (the document's asset id). */
export interface CanvasAsset {
  sha256: string
  mimeType: string
  dataURL: string
}

/** A file inside a saved snapshot, as the engine keeps it (engine-owned id). */
export interface CanvasFile {
  id: string
  dataURL: string
  mimeType: string
  created: number
}

/** v1's name for a file; kept as an alias. */
export type FileDataBase = CanvasFile

export type EngineId = 'excalidraw' | 'own'

/**
 * The scene as this browser keeps it between visits (under the project's canvasKey) and as the
 * export reads it. Its shape belongs to the engine named by `engine` (absent: Excalidraw).
 */
export interface CanvasSnapshot {
  engine?: EngineId
  elements: CanvasElement[]
  files: Record<string, CanvasFile>
}

/** A tool to switch to: one of ours (a custom tool) or the engine's own (selection, hand, freedraw, …). */
export type ActiveToolSpec = { type: 'custom'; id: string } | { type: 'native'; id: string }

// ── intents: what a new element is, not how the engine spells it ──

/** An image node: a picture (saved) or a placeholder a job will fill (pending, no picture yet). */
export interface ImageNodeIntent {
  /** Keep this id (a gen placeholder is its job id). Without it the engine makes one. */
  id?: string
  x: number
  y: number
  width: number
  height: number
  /** The picture's sha256; null for a placeholder. Its bytes come through addAssets. */
  assetSha: string | null
  customData: unknown
  status: 'pending' | 'saved'
  /** Keep `id` as given (true for a gen placeholder). */
  keepIds?: boolean
}

/** A curved provenance arrow, bound at both ends so it follows them. */
export interface ProvenanceArrowIntent {
  /** Where the curve starts, in scene coordinates. */
  origin: Pt
  /** The curve's points, relative to origin. */
  points: [number, number][]
  /** The elements it leaves and arrives at. */
  fromElId: string
  toElId: string
  color: string
  customData: unknown
}

/** A frame around a box (a drawing's frame). */
export interface FrameIntent {
  x: number
  y: number
  width: number
  height: number
  name: string
  customData: unknown
}

export interface ExportPngOptions {
  padding: number
  background: string
}

/** A sketch area (frame-aspect; ui-behaviour 3.7): a white rectangle tagged {kind:'sketch', id}. */
export interface SketchAreaIntent {
  x: number
  y: number
  w: number
  h: number
  sketchId: string
}

/**
 * Export exactly a box of the scene: the canvas is the box's size whatever the elements' extent,
 * elements crossing its edge are clipped to it, and nothing moves (core/sketch.ts exportPlan).
 */
export interface RegionExport {
  rect: { x: number; y: number; w: number; h: number }
  elementIds: readonly string[]
  outW: number
  outH: number
  background: string
}

/** The largest export: 4096 x 4096 (Safari refuses canvases past about 16.7 MP). */
export const MAX_EXPORT_PIXELS = 4096 * 4096

/** One point of a pointer's path, in scene coordinates. */
export interface PointerPoint {
  x: number
  y: number
  pressure: number
}

/** One pointer event in scene coordinates (a pen's pressure, 0.5 for a mouse). */
export interface PointerSample {
  phase: 'down' | 'move' | 'up'
  x: number
  y: number
  pointerType: 'mouse' | 'pen' | 'touch'
  pressure: number
  /** The points the browser coalesced into this move, when capabilities().coalesced. */
  coalesced?: PointerPoint[]
  /** The browser's predicted next points, when capabilities().predicted. */
  predicted?: PointerPoint[]
  /** Pen tilt in degrees, when capabilities().tilt. */
  tiltX?: number
  tiltY?: number
}

/** What the engine's pointer stream carries on this device (probed at mount; ui-behaviour 8). */
export interface InputCapabilities {
  coalesced: boolean
  predicted: boolean
  tilt: boolean
  /** Real pressure from a pen, not the fixed 0.5 of a mouse. */
  pressure: boolean
}

/** The viewport transform, whenever it changes (overlays follow it). */
export interface ViewportTransform {
  scrollX: number
  scrollY: number
  zoom: number
}

/** A point on an element's edge where a link or arrow can attach. */
export interface Anchor {
  side: 'n' | 'e' | 's' | 'w'
  x: number
  y: number
}

/** Overlay emphasis: glow some elements, dim others (scope focus, the send tray). Never in the scene. */
export interface Emphasis {
  glow?: readonly string[]
  dim?: readonly string[]
  /** Free tags an overlay reads back (which feature asked for the emphasis). */
  tags?: readonly string[]
}

/** One field of one element before and after a write (absent: the field was not there). */
export interface FieldChange {
  id: string
  field: string
  before: unknown
  after: unknown
}

/**
 * One undoable step on the scene: every field an undoable transact (or a whole gesture) changed.
 * The UndoCoordinator (engine-select) keeps these as field inverses on clan-store's LocalUndo.
 */
export interface SceneStep {
  changes: FieldChange[]
}

// ── what a tool commits: new nodes and links, applied as one undoable commit ──

/** A node to create. `ref` names it within one commit, so a LinkSpec can point at it. */
export interface NodeSpec {
  ref: string
  kind: NodeKind
  at: Pt
  size?: { w: number; h: number }
  /** A board's purpose. */
  purpose?: string
  /** A sketch area's ratio ('16:9'). */
  ratio?: string
}

/** A link to create, between existing node ids or the refs of NodeSpecs in the same commit. */
export interface LinkSpec {
  from: string
  to: string
  role: LinkRole
}

export interface CanvasAdapter {
  readonly engine: EngineId

  // ── reads and writes ──
  /** The scene's elements; deleted ones only with includeDeleted. */
  elements(opts?: { includeDeleted?: boolean }): CanvasElement[]
  /**
   * Write the scene: `fn` gets every element (deleted ones too) and returns the scene as it should be.
   * `undoable`: one step of the person's undo (reported through onStep); false for system writes.
   */
  transact(fn: (els: readonly CanvasElement[]) => readonly CanvasElement[], opts: { undoable: boolean }): void
  /** Run `fn`; every undoable transact inside it is one step together. */
  gesture<T>(fn: () => T): T
  /** Each undoable step, as field changes, once it lands. */
  onStep(cb: (step: SceneStep) => void): () => void
  /** A new version of an element with these fields changed (not yet written). */
  patch(el: CanvasElement, fields: Partial<CanvasElement>): CanvasElement

  // ── intent factories (not yet written) ──
  imageNode(intent: ImageNodeIntent): CanvasElement
  provenanceArrow(intent: ProvenanceArrowIntent): CanvasElement
  /** Add an arrow to its endpoints' bound elements so the engine moves it with them. */
  bindArrow(els: readonly CanvasElement[], arrow: CanvasElement): CanvasElement[]
  frameAround(intent: FrameIntent): CanvasElement
  sketchArea(intent: SketchAreaIntent): CanvasElement

  // ── containers and overlays ──
  /** The live elements whose container is `id`. */
  childrenOf(id: string): CanvasElement[]
  /** Where links and arrows attach to an element (its edges' midpoints); [] when it is gone. */
  anchors(id: string): Anchor[]
  setEmphasis(e: Emphasis): void
  emphasis(): Emphasis

  // ── pictures, by sha256 ──
  /** Give the engine pictures' bytes. Elements that show these assets draw them. */
  addAssets(assets: CanvasAsset[]): void
  /**
   * An image element's picture: its sha256 when the engine can tell (its customData, an asset it was
   * given, or one of `known`, the document's assets), and whether its bytes are loaded. null: not an image.
   */
  imageOf(el: CanvasElement, known?: Iterable<string>): { sha256: string | null; loaded: boolean } | null
  /** The bytes the engine holds for an image element, as a data URL (a picture dropped on the canvas). */
  imageDataURL(el: CanvasElement): string | null
  /** The element showing this asset (saved), not yet written. */
  withAsset(el: CanvasElement, sha256: string): CanvasElement

  // ── view ──
  view(): ViewSnapshot
  /** Set the selection. Never an undo step. */
  select(ids: readonly string[]): void
  /** The part of the scene the viewport shows now. */
  visibleBounds(): { minX: number; minY: number; maxX: number; maxY: number }
  /** A scene point in viewport (client) coordinates, under the given view. */
  sceneToViewport(p: Pt, view: ViewSnapshot): Pt
  /** A viewport (client) point in scene coordinates, under the given view. */
  viewportToScene(p: Pt, view: ViewSnapshot): Pt

  // ── the rest ──
  /** A number that changes whenever these elements change. */
  version(els: readonly CanvasElement[]): number
  bounds(els: readonly CanvasElement[]): Bounds
  /** Bring these elements into view, covering `zoomFactor` of the viewport. */
  fit(els: readonly CanvasElement[], opts: { zoomFactor: number; animate: boolean }): void
  /** Re-measure the container (after it was hidden). */
  refresh(): void
  onScroll(cb: () => void): () => void
  /** Every pointer down, move (while down) and up on the canvas, in scene coordinates. */
  onPointer(cb: (p: PointerSample) => void): () => void
  capabilities(): InputCapabilities
  /** The viewport transform each time it changes (scroll or zoom). */
  onViewport(cb: (v: ViewportTransform) => void): () => void
  /** Is the person in the middle of something: drawing, dragging, typing, another tool? */
  isBusy(): boolean
  setActiveTool(tool: ActiveToolSpec): void
  exportPng(els: readonly CanvasElement[], opts: ExportPngOptions): Promise<Blob>
  /** An SVG document of these elements, pictures embedded. */
  exportSvg(els: readonly CanvasElement[], opts: ExportPngOptions): Promise<string>
  /** A PNG of exactly `rect` at outW x outH (frame-aspect). */
  exportRegion(req: RegionExport): Promise<Blob>

  // ── lifetime ──
  /** The scene to keep in this browser: live elements and the files they use. */
  serialize(): CanvasSnapshot
  setTheme(theme: 'light' | 'dark'): void
  /** Unmount the engine from its host element. */
  destroy(): void
}

export interface MountOptions {
  /** The saved scene to open with (read once). */
  initial: CanvasSnapshot | null
  /** Called on every scene or view change. */
  onChange: () => void
  theme: 'light' | 'dark'
  /**
   * Fill the engine's scene doc (a Y.Doc, typed loosely so core stays free of yjs) from the store
   * Worker and keep it in step (features/engine-store.clan). Absent: the scene lives in memory.
   */
  openScene?: (doc: unknown) => Promise<{ readOnly: string | null }>
}

/** An engine module: what src/canvas/adapter/index.ts loads by dynamic import. */
export interface CanvasEngine {
  readonly id: EngineId
  /** Mount the engine into `host` and hand back its adapter once it is ready. */
  mount(host: HTMLElement, opts: MountOptions): Promise<CanvasAdapter>
}

/** The scene as a file inside an export, made from a saved snapshot without a mounted engine. */
export interface CanvasExportFile {
  name: string
  bytes: Uint8Array
}
