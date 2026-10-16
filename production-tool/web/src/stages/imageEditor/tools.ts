// The Image editor's tools and their keys (ui-behaviour 3.12): Select V, Brush mask B, Lasso L,
// Text T, Crop C, Hand H (or hold Space). [ and ] change the brush size. Pure, for the tests.
// No click-select: it ran a model in the browser that never finished on Firefox, so the region is
// painted or lassoed. No Eraser: Subtract (or Alt held) on the Brush and the Lasso takes paint away
// (owner, 2026-10-16; features/image-editor-masks-layers.clan).

export type ToolId = 'select' | 'brush' | 'lasso' | 'text' | 'crop' | 'hand'

export interface Tool { id: ToolId; label: string; key: string }

export const TOOLS: readonly Tool[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'brush', label: 'Brush mask', key: 'B' },
  { id: 'lasso', label: 'Lasso', key: 'L' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'crop', label: 'Crop', key: 'C' },
  { id: 'hand', label: 'Hand, pan the frame', key: 'H' },
]

/** The tool a key chooses, or undefined. Keys with a modifier, and keys typed into a field, choose none. */
export function toolForKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): ToolId | undefined {
  if (e.metaKey || e.ctrlKey || e.altKey) return undefined
  return TOOLS.find((t) => t.key === e.key.toUpperCase())?.id
}

/** The tools that paint a mask, and so show the brush strip. */
export const MASK_TOOLS: readonly ToolId[] = ['brush', 'lasso']

export const BRUSH_MIN = 4
export const BRUSH_MAX = 200

/** [ makes the brush smaller and ] larger, in steps that suit its size. */
export function brushStep(size: number, key: '[' | ']'): number {
  const step = size < 20 ? 2 : size < 60 ? 6 : 12
  return Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, size + (key === ']' ? step : -step)))
}

/** The crop from a drag, 0-1 of the picture. The frame's ratio is kept (3.12, review item 10): in
 *  0-1 units of the same picture, that is a square, so the larger of the drag's sides wins and the
 *  rectangle stays on the picture. */
export function cropRect(a: { x: number; y: number }, b: { x: number; y: number }, min = 0.1): { x: number; y: number; w: number; h: number } {
  let s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), min)
  const sx = b.x >= a.x ? 1 : -1, sy = b.y >= a.y ? 1 : -1
  const roomX = sx > 0 ? 1 - a.x : a.x
  const roomY = sy > 0 ? 1 - a.y : a.y
  s = Math.min(s, roomX, roomY, 1)
  const x = sx > 0 ? a.x : a.x - s
  const y = sy > 0 ? a.y : a.y - s
  return { x, y, w: s, h: s }
}

/** Zoom steps (−, +) and Fit. */
export const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const
export function zoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOMS.find((v) => v > z + 1e-6) ?? ZOOMS[ZOOMS.length - 1]
  return [...ZOOMS].reverse().find((v) => v < z - 1e-6) ?? ZOOMS[0]
}
