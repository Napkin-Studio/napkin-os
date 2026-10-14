// What the canvas chrome (the tool bar, the zoom pill, the board rail) needs from a canvas engine,
// beyond CanvasAdapter: the active tool, zoom and fit. Engine-neutral: each adapter implements it in
// one small file (adapter/excalidraw/chrome.ts; later adapter/own), and nothing under canvas/chrome
// imports an engine (features/production-ui.clan).

/** The tools the bar offers (ui-behaviour 7: V H P T S, plus a picture and the eraser). */
export type ChromeTool = 'select' | 'hand' | 'pen' | 'text' | 'sketch' | 'image' | 'eraser'

export interface CanvasChrome {
  /** The tool in use, or null for one the bar does not show (a shape picked by its key). */
  tool(): ChromeTool | null
  setTool(t: ChromeTool): void
  /** Zoom, 1 = 100%. */
  zoom(): number
  /** One step in or out, round the middle of the view. */
  zoomBy(step: 1 | -1): void
  /** Fit everything on the canvas (⌥0). */
  fitAll(): void
  /** Called when the tool or the zoom changes. */
  onChange(cb: () => void): () => void
}

/** The zoom steps of the pill: 10% to 300%, as the house canvases. */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.62, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3]

export function nextZoom(z: number, step: 1 | -1): number {
  if (step > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_STEPS[0]
}

/** Keep the middle of the view still while zooming: the new scroll for one axis. */
export function scrollForZoom(scroll: number, size: number, from: number, to: number): number {
  return scroll + size / 2 / to - size / 2 / from
}
