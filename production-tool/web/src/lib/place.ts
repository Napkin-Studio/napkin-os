// Where a floating toolbar or popover goes: centred above its anchor, flipped
// below when there is no room above, and always fully inside the box.

export interface Anchor {
  /** Horizontal centre of the selection. */
  x: number
  /** Top of the selection (and its label row). */
  top: number
  /** Bottom of the selection. */
  bottom: number
}

export function placeFloating(anchor: Anchor, size: { w: number; h: number }, box: { w: number; h: number }, gap = 14, margin = 8): { left: number; top: number; below: boolean } {
  const maxLeft = box.w - size.w - margin
  const left = maxLeft < margin ? margin : Math.min(Math.max(anchor.x - size.w / 2, margin), maxLeft)
  let top = anchor.top - gap - size.h
  let below = false
  if (top < margin) {
    top = anchor.bottom + gap
    below = true
  }
  const maxTop = box.h - size.h - margin
  top = maxTop < margin ? margin : Math.min(Math.max(top, margin), maxTop)
  return { left, top, below }
}
