// CanvasAdapter v0 (features/canvas-core.clan): every call the tool makes on its
// canvas engine, as one interface. The engine's own code lives behind it in
// src/canvas/adapter/<engine>/; this file and the rest of src/canvas/core import
// no engine, no sync library and no adapter (eslint.config.js enforces it).
//
// The interface is generic over the engine's element type E. Only E is
// engine-specific: writes say `undoable`, the view is plain numbers, files are
// records, and new elements are made through intent factories rather than the
// engine's skeletons. Expected amendments (from canvas-spikes): a pointer stream
// (pointerType, pressure), a viewport-transform subscription and region export.

/** The fields every engine element has, as the tool reads them. */
export interface SceneElementBase {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  isDeleted?: boolean
  customData?: unknown
  frameId?: string | null
  groupIds?: readonly string[]
}

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

/** An image file the canvas holds, keyed by its id. */
export interface FileDataBase {
  id: string
  dataURL: string
  mimeType: string
  created: number
}

/** A tool to switch to: one of ours (a custom tool) or the engine's own (selection, hand, freedraw, …). */
export type ActiveToolSpec = { type: 'custom'; id: string } | { type: 'native'; id: string }

// ── intents: what a new element is, not how the engine spells it ──

/** An image node: a picture (saved) or a placeholder a job will fill (pending, no file yet). */
export interface ImageNodeIntent {
  /** Keep this id (a gen placeholder is its job id). Without it the engine makes one. */
  id?: string
  x: number
  y: number
  width: number
  height: number
  fileId: string | null
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

export interface CanvasAdapter<E extends SceneElementBase, F extends FileDataBase = FileDataBase> {
  // ── reads and writes ──
  /** The scene's elements; deleted ones only with includeDeleted. */
  elements(opts?: { includeDeleted?: boolean }): E[]
  /** Replace the scene's elements. `undoable`: one step of the person's undo; false for system writes. */
  commit(els: readonly E[], opts: { undoable: boolean }): void
  /** A new version of an element with these fields changed (not yet committed). */
  patch(el: E, fields: Partial<E>): E

  // ── intent factories (not yet committed) ──
  imageNode(intent: ImageNodeIntent): E
  provenanceArrow(intent: ProvenanceArrowIntent): E
  /** Add an arrow to its endpoints' bound elements so the engine moves it with them. */
  bindArrow(els: readonly E[], arrow: E): E[]
  frameAround(intent: FrameIntent): E

  // ── files ──
  files(): Record<string, F>
  addFiles(files: F[]): void

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
  version(els: readonly E[]): number
  bounds(els: readonly E[]): Bounds
  /** Bring these elements into view, covering `zoomFactor` of the viewport. */
  fit(els: readonly E[], opts: { zoomFactor: number; animate: boolean }): void
  /** Re-measure the container (after it was hidden). */
  refresh(): void
  onScroll(cb: () => void): () => void
  /** Is the person in the middle of something: drawing, dragging, typing, another tool? */
  isBusy(): boolean
  setActiveTool(tool: ActiveToolSpec): void
  exportPng(els: readonly E[], files: Record<string, F>, opts: ExportPngOptions): Promise<Blob>
}
