// Where a floating toolbar or popover goes: centred above its anchor, flipped
// below when there is no room above, and always fully inside the box.

export interface Anchor {
  /** Horizontal centre of the selection. */
  x: number
  /** Top of the selection (and its label row). */
  top: number
  /** Bottom of the selection. */
  bottom: number
  /** Line the bar's left edge up with this (a node's left edge, mock production-new-ui-v2) instead of centring it. */
  left?: number
}

/**
 * `avoid`: the canvas chrome a floating bar or card must not cover (the boards rail, the top bar, the
 * tool bar), in the box's coordinates (ui-behaviour 3.9). Above the selection first, then below; at
 * each, centred, else moved clear beside whatever it would cover; covering chrome only when nothing fits.
 */
export function placeFloating(anchor: Anchor, size: { w: number; h: number }, box: { w: number; h: number }, gap = 14, margin = 8,
  avoid: readonly Rect[] = [], centredFirst = false): { left: number; top: number; below: boolean } {
  const clampLeft = (x: number) => {
    const maxLeft = box.w - size.w - margin
    return maxLeft < margin ? margin : Math.min(Math.max(x, margin), maxLeft)
  }
  const clampTop = (y: number) => {
    const maxTop = box.h - size.h - margin
    return maxTop < margin ? margin : Math.min(Math.max(y, margin), maxTop)
  }
  const left = clampLeft(anchor.left ?? anchor.x - size.w / 2)
  const aboveTop = anchor.top - gap - size.h
  const rows: { top: number; below: boolean }[] = []
  if (aboveTop >= margin) rows.push({ top: clampTop(aboveTop), below: false })
  rows.push({ top: clampTop(anchor.bottom + gap), below: true })
  const covers = (l: number, t: number) => avoid.find((r) => l < r.right && l + size.w > r.left && t < r.bottom && t + size.h > r.top)
  // `centredFirst`: centred on the anchor, above or else below, before anything moves it sideways (QA
  // 2026-11-17: a size tile's Adjust crop bar slid far left over the Boards panel under the board's header).
  if (centredFirst) for (const row of rows) if (!covers(left, row.top)) return { left, ...row }
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
  align: 'start' | 'end' | 'center' = 'start', side: 'below' | 'above' | 'right' = 'below', gap = 6, margin = 8): { left: number; top: number; above: boolean } {
  // Beside a rail's button (the canvas's tool rail, features/production-new-ui.clan): to its right, top lined up, inside the view.
  if (side === 'right') {
    const maxTop = view.h - size.h - margin
    const maxL = view.w - size.w - margin
    return { left: Math.max(margin, Math.min(anchor.right + gap + 4, maxL)), top: maxTop < margin ? margin : Math.min(Math.max(anchor.top, margin), maxTop), above: false }
  }
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

/**
 * Where a panel opened for one picture goes: beside it, at the picture's edge (right first, then left),
 * top lined up with the picture, always inside the view. When neither side has room it goes below
 * (the Campaign send tray, features/art-director.clan slice 0: it used to sit in the board's corner).
 */
export function placeBeside(anchor: Rect, size: { w: number; h: number }, view: { w: number; h: number }, gap = 12, margin = 8): { left: number; top: number; side: 'right' | 'left' | 'below' } {
  const clampTop = (y: number) => { const m = view.h - size.h - margin; return m < margin ? margin : Math.min(Math.max(y, margin), m) }
  if (anchor.right + gap + size.w <= view.w - margin) return { left: anchor.right + gap, top: clampTop(anchor.top), side: 'right' }
  if (anchor.left - gap - size.w >= margin) return { left: anchor.left - gap - size.w, top: clampTop(anchor.top), side: 'left' }
  const m = placeMenu(anchor, size, view, 'start', 'below', gap, margin)
  return { left: m.left, top: m.top, side: 'below' }
}
