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

/**
 * The bend for an arrow from a source to a target: it bows away from the line between their
 * centres, on the side the source sits (a source above the target arcs over, one below arcs
 * under), so arrows from sources stacked on one side run beside each other instead of crossing.
 * `dy` is the source centre's y minus the target centre's; `dx` is the arrow's x run.
 */
export function bendAway(dx: number, dy: number, index: number): number {
  const side = Math.abs(dy) > 20 ? Math.sign(dy) : index % 2 ? -1 : 1
  // A positive bend moves the middle point toward +y when the arrow runs rightward.
  return side * (dx >= 0 ? 1 : -1) * 0.15 * (1 + Math.floor(index / 2))
}
