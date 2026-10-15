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

/**
 * `avoid`: the canvas chrome a floating bar or card must not cover (the boards rail, the top bar, the
 * tool bar), in the box's coordinates (ui-behaviour 3.9). Above the selection first, then below; at
 * each, centred, else moved clear beside whatever it would cover; covering chrome only when nothing fits.
 */
export function placeFloating(anchor: Anchor, size: { w: number; h: number }, box: { w: number; h: number }, gap = 14, margin = 8,
  avoid: readonly Rect[] = []): { left: number; top: number; below: boolean } {
  const clampLeft = (x: number) => {
    const maxLeft = box.w - size.w - margin
    return maxLeft < margin ? margin : Math.min(Math.max(x, margin), maxLeft)
  }
  const clampTop = (y: number) => {
    const maxTop = box.h - size.h - margin
    return maxTop < margin ? margin : Math.min(Math.max(y, margin), maxTop)
  }
  const left = clampLeft(anchor.x - size.w / 2)
  const aboveTop = anchor.top - gap - size.h
  const rows: { top: number; below: boolean }[] = []
  if (aboveTop >= margin) rows.push({ top: clampTop(aboveTop), below: false })
  rows.push({ top: clampTop(anchor.bottom + gap), below: true })
  const covers = (l: number, t: number) => avoid.find((r) => l < r.right && l + size.w > r.left && t < r.bottom && t + size.h > r.top)
  for (const row of rows) {
    if (!covers(left, row.top)) return { left, ...row }
    // Beside what it would cover: to its right or its left, the nearer to the centred place first.
    const beside = avoid.flatMap((r) => [clampLeft(r.right + margin), clampLeft(r.left - margin - size.w)])
      .sort((a, b) => Math.abs(a - left) - Math.abs(b - left))
    const clear = beside.find((l) => !covers(l, row.top))
    if (clear !== undefined) return { left: clear, ...row }
  }
  return { left, ...rows[0] }
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
