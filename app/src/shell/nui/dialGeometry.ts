// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The dial's drawing in numbers: the ring's radii, a point on it, and the path and box of a quadrant.

export const R = { o0: 100, o1: 300, rim: 308 }
export const pol = (r: number, a: number): [number, number] => [320 + r * Math.cos(a), 320 + r * Math.sin(a)]
export const f1 = (n: number) => n.toFixed(1)
/** A box in the 640-unit picture, and the sector's drawing inside it. */
export interface Box { x: number; y: number; w: number; h: number }
/** The box that just holds a sector: the ends of its two arcs, and any point where an arc passes a compass point. */
export function sectorBox(r0: number, r1: number, a0: number, a1: number): Box {
  const pts: [number, number][] = [pol(r0, a0), pol(r0, a1), pol(r1, a0), pol(r1, a1)]
  for (let k = Math.ceil(a0 / (Math.PI / 2)); k * (Math.PI / 2) <= a1; k++) pts.push(pol(r1, k * (Math.PI / 2)))
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
/** With a `box`, the path is drawn in that box's own unit square (what a button's clip-path wants); without, in the picture. */
export function sector(r0: number, r1: number, a0: number, a1: number, box?: Box): string {
  const L = a1 - a0 > Math.PI ? 1 : 0
  const kx = box ? 1 / box.w : 1, ky = box ? 1 / box.h : 1, fx = box ? (n: number) => n.toFixed(4) : f1
  const P = ([x, y]: [number, number]) => `${fx((x - (box?.x ?? 0)) * kx)} ${fx((y - (box?.y ?? 0)) * ky)}`
  const A = (r: number) => `${fx(r * kx)} ${fx(r * ky)}`
  return `M${P(pol(r1, a0))}A${A(r1)} 0 ${L} 1 ${P(pol(r1, a1))}L${P(pol(r0, a1))}A${A(r0)} 0 ${L} 0 ${P(pol(r0, a0))}Z`
}
export function arcD(r: number, a0: number, a1: number): string {
  const [x0, y0] = pol(r, a0), [x1, y1] = pol(r, a1)
  return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`
}

/** Where each quadrant's button sits, in the 640-unit picture (five quadrants, the first centred at the top). */
export const dialBoxes = (): Box[] => {
  const span = (2 * Math.PI) / 5, start = -Math.PI / 2 - span / 2
  return [0, 1, 2, 3, 4].map(i => sectorBox(R.o0, R.o1, start + i * span, start + (i + 1) * span))
}
