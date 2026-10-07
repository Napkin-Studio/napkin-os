// The shape of a provenance arrow: a gentle curve, so arrows into one node fan
// out instead of lying on top of each other. Pure maths, no Excalidraw import.

/** The three points of a curved arrow, relative to its start: the middle one is pushed off the
 * straight line by `bend` (a share of the length, signed), so arrows into one node fan out. */
export function curvePoints(start: { x: number; y: number }, end: { x: number; y: number }, bend: number): [number, number][] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const off = bend * len
  return [[0, 0], [dx / 2 - (dy / len) * off, dy / 2 + (dx / len) * off], [dx, dy]]
}

/** How far an arrow bends, by its place among the arrows into the same node: never straight,
 * alternating sides and wider each pair (0.15, -0.15, 0.3, -0.3…), so none lie on top of each other. */
export function bendFor(index: number): number {
  return (index % 2 ? -1 : 1) * 0.15 * (1 + Math.floor(index / 2))
}
