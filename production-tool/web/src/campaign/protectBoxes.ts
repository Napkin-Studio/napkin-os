// "What must stay in every size": the boxes a person marks on the master. Pure geometry for the editor
// (ProtectEditor.tsx): which box a point hits, moving and resizing one inside the picture, the box a
// tap makes, and the words a box wears. All in the master's pixels.

import type { ProtectBox } from '../contracts/types'

export const MAX_BOXES = 8
/** The smallest side a box may be shrunk to, as a share of the picture's shorter side. */
export const MIN_SIDE = 0.03

export type Role = ProtectBox['role']
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const ROLE_WORD: Record<Role, string> = { subject: 'Subject', product: 'Product', other: 'Something else' }

/** The label a box wears until the person names it. */
export function defaultLabel(role: Role): string {
  return role === 'other' ? 'keep' : role
}

/** What to show for a box: its own label, else the role's. */
export function labelOf(b: ProtectBox): string {
  return b.label?.trim() || defaultLabel(b.role)
}

export interface Pic { w: number; h: number }

const inside = (b: ProtectBox, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h

/** The index of the box under a point: the smallest one, so a box inside another stays reachable (-1 for none). */
export function hitBox(boxes: readonly ProtectBox[], x: number, y: number): number {
  let best = -1
  for (let i = 0; i < boxes.length; i++) {
    if (!inside(boxes[i], x, y)) continue
    if (best < 0 || boxes[i].w * boxes[i].h <= boxes[best].w * boxes[best].h) best = i
  }
  return best
}

/** The box a tap makes: a fifth of the picture across and three tenths down, centred on the point, inside the picture. */
export function tapBox(pic: Pic, x: number, y: number, role: Role): ProtectBox {
  const w = Math.round(pic.w * 0.2)
  const h = Math.round(pic.h * 0.3)
  return {
    role, label: defaultLabel(role),
    x: Math.round(Math.max(0, Math.min(x - w / 2, pic.w - w))),
    y: Math.round(Math.max(0, Math.min(y - h / 2, pic.h - h))),
    w, h,
  }
}

/** The box a drag from one corner to another makes, kept inside the picture. */
export function dragBox(pic: Pic, x0: number, y0: number, x1: number, y1: number, role: Role): ProtectBox {
  const lo = (v: number, max: number) => Math.max(0, Math.min(v, max))
  const ax = lo(Math.min(x0, x1), pic.w)
  const bx = lo(Math.max(x0, x1), pic.w)
  const ay = lo(Math.min(y0, y1), pic.h)
  const by = lo(Math.max(y0, y1), pic.h)
  return { role, label: defaultLabel(role), x: Math.round(ax), y: Math.round(ay), w: Math.round(bx - ax), h: Math.round(by - ay) }
}

/** The box moved by a drag, never leaving the picture. */
export function moveBox(b: ProtectBox, dx: number, dy: number, pic: Pic): ProtectBox {
  return {
    ...b,
    x: Math.round(Math.max(0, Math.min(b.x + dx, pic.w - b.w))),
    y: Math.round(Math.max(0, Math.min(b.y + dy, pic.h - b.h))),
  }
}

/** The box with one handle dragged by (dx, dy): the opposite edges stay, nothing leaves the picture or goes under the minimum. */
export function resizeBox(b: ProtectBox, handle: Handle, dx: number, dy: number, pic: Pic): ProtectBox {
  const min = Math.max(4, Math.round(Math.min(pic.w, pic.h) * MIN_SIDE))
  let l = b.x
  let t = b.y
  let r = b.x + b.w
  let bt = b.y + b.h
  if (handle.includes('w')) l = Math.max(0, Math.min(l + dx, r - min))
  if (handle.includes('e')) r = Math.min(pic.w, Math.max(r + dx, l + min))
  if (handle.includes('n')) t = Math.max(0, Math.min(t + dy, bt - min))
  if (handle.includes('s')) bt = Math.min(pic.h, Math.max(bt + dy, t + min))
  return { ...b, x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(bt - t) }
}

/** Whether a drawn or tapped box is worth keeping: a drag under the minimum side is a tap. */
export function isTap(pic: Pic, x0: number, y0: number, x1: number, y1: number, scale: number): boolean {
  void pic
  return Math.abs(x1 - x0) < 8 / scale && Math.abs(y1 - y0) < 8 / scale
}

/** The words for where a box sits in the picture ("upper left", "centre"), for a model told what to keep. */
export function whereWords(b: ProtectBox, pic: Pic): string {
  const cx = (b.x + b.w / 2) / pic.w
  const cy = (b.y + b.h / 2) / pic.h
  const h = cx < 0.36 ? 'left' : cx > 0.64 ? 'right' : 'centre'
  const v = cy < 0.36 ? 'upper' : cy > 0.64 ? 'lower' : 'middle'
  if (h === 'centre' && v === 'middle') return 'centre'
  if (h === 'centre') return `${v} centre`
  if (v === 'middle') return h
  return `${v} ${h}`
}
