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

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Where a menu or panel opened from a button goes (ui/Float.tsx): below the button
 * (or above, when asked), lined up with its start, end or centre; on the other side
 * when there is no room; always fully inside the viewport.
 */
export function placeMenu(anchor: Rect, size: { w: number; h: number }, view: { w: number; h: number },
  align: 'start' | 'end' | 'center' = 'start', side: 'below' | 'above' = 'below', gap = 6, margin = 8): { left: number; top: number; above: boolean } {
  const want = align === 'end' ? anchor.right - size.w : align === 'center' ? (anchor.left + anchor.right) / 2 - size.w / 2 : anchor.left
  const maxLeft = view.w - size.w - margin
  const left = maxLeft < margin ? margin : Math.min(Math.max(want, margin), maxLeft)
  const below = anchor.bottom + gap
  const above = anchor.top - gap - size.h
  const fitsBelow = below + size.h <= view.h - margin
  const fitsAbove = above >= margin
  const goAbove = side === 'above' ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove
  const maxTop = view.h - size.h - margin
  const top = maxTop < margin ? margin : Math.min(Math.max(goAbove ? above : below, margin), maxTop)
  return { left, top, above: goAbove }
}
