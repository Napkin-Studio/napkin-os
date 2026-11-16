// What the canvas chrome (the tool bar, the zoom pill, the board rail) needs from a canvas engine,
// beyond CanvasAdapter: the active tool, zoom and fit. Engine-neutral: each adapter implements it in
// one small file (adapter/excalidraw/chrome.ts; later adapter/own), and nothing under canvas/chrome
// imports an engine (features/production-ui.clan).

import type { PenChoice } from './penStyle'

/** The tools the bar offers (ui-behaviour 7: V H P T S, plus a picture and the eraser). */
export type ChromeTool = 'select' | 'hand' | 'pen' | 'text' | 'sketch' | 'image' | 'eraser'

export interface CanvasChrome {
  /** The tool in use, or null for one the bar does not show (a shape picked by its key). */
  tool(): ChromeTool | null
  setTool(t: ChromeTool): void
  /** The next sketch area's shape (ui-behaviour 3.7's picker); absent where the engine takes it elsewhere. */
  setSketchRatio?(ratio: string): void
  /** The one sketch area selected (its ratio), else null; absent where the engine has no own areas. */
  selectedSketch?(): { id: string; ratio: string | null } | null
  /** "Make a 9:16 copy" of the selected area (the picker's, with an area selected): false when it cannot. */
  copySketch?(ratio: string): boolean
  /** Does this engine have the tool yet? Absent: every tool. The bar disables the others, with why. */
  supports?(t: ChromeTool): boolean
  /** Zoom, 1 = 100%. */
  zoom(): number
  /** One step in or out, round the middle of the view. */
  zoomBy(step: 1 | -1): void
  /** Fit everything on the canvas (⌥0). */
  fitAll(): void
  /** Fit a scene box (the boards drawn over the canvas, which are not the engine's elements). */
  fitRect(r: { x: number; y: number; w: number; h: number }): void
  /** The pen's options (pen or highlighter, ink name, width): what the pen draws with from now on. */
  setPen(p: PenChoice): void
  /** The next text's look (the Text tool's options: font size in scene pixels, an ink name or #rrggbb); absent where the engine has its own text. */
  setText?(look: { size: number; color: string }): void
  /** The look of the text being typed or the selected text, else null (the Text options then show it). */
  selectedText?(): { size: number; color: string } | null
  /** Restyle the text being typed, or the selected texts (one undo step). */
  styleText?(change: { size?: number; color?: string }): void
  /** Called when the tool, the zoom, the selected sketch area or the selected text changes. */
  onChange(cb: () => void): () => void
}

/** The zoom steps of the pill: 10% to 300%, as the house canvases. */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.62, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3]

export function nextZoom(z: number, step: 1 | -1): number {
  if (step > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_STEPS[0]
}

/** The zoom and scroll that show box `r` in a `vw` x `vh` view with a margin, at most 100%. */
export function fitView(r: { x: number; y: number; w: number; h: number }, vw: number, vh: number, margin = 48): { zoom: number; scrollX: number; scrollY: number } {
  const zoom = Math.min(1, (vw - margin * 2) / Math.max(1, r.w), (vh - margin * 2) / Math.max(1, r.h))
  return { zoom, scrollX: (vw / zoom - r.w) / 2 - r.x, scrollY: (vh / zoom - r.h) / 2 - r.y }
}

/** Keep the middle of the view still while zooming: the new scroll for one axis. */
export function scrollForZoom(scroll: number, size: number, from: number, to: number): number {
  return scroll + size / 2 / to - size / 2 / from
}
