// The box around some elements, engine-free (features/engine-adapter.clan): a
// line, arrow or stroke by its points, anything else by its box, each turned by
// its angle about its centre. The pure helpers in canvas/scene.ts use it, and
// so does the own adapter; Excalidraw's adapter keeps its own getCommonBounds.

import type { Bounds, CanvasElement } from './canvasAdapter'

export function elementBounds(els: readonly CanvasElement[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const e of els) {
    const local = e.points?.length
      ? e.points.map(([px, py]) => [e.x + px, e.y + py] as const)
      : [[e.x, e.y], [e.x + e.width, e.y], [e.x + e.width, e.y + e.height], [e.x, e.y + e.height]] as const
    const a = e.angle ?? 0
    const cx = e.x + e.width / 2
    const cy = e.y + e.height / 2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    for (const [x0, y0] of local) {
      const x = a ? cx + (x0 - cx) * cos - (y0 - cy) * sin : x0
      const y = a ? cy + (x0 - cx) * sin + (y0 - cy) * cos : y0
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}
