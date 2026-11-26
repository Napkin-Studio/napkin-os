// Where links and arrows attach to an element until ports land (engine-nodes):
// the midpoints of its box's four edges. Pure; both adapters use it.

import type { Anchor, Bounds } from './canvasAdapter'

export function edgeAnchors(b: Bounds): Anchor[] {
  const cx = b.minX + b.w / 2
  const cy = b.minY + b.h / 2
  return [
    { side: 'n', x: cx, y: b.minY },
    { side: 'e', x: b.maxX, y: cy },
    { side: 's', x: cx, y: b.maxY },
    { side: 'w', x: b.minX, y: cy },
  ]
}
