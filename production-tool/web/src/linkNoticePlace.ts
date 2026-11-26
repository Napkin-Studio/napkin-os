// Where the link notice (LinkNotice.tsx) sits on the canvas, by the selection bar.

type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width'>

/** Where the notice goes on the canvas, in its host's coordinates: by the selection bar, on the side away from the node
 *  (above a bar that sits above the node, else under it), lined up with the bar's left edge. With no room above (a node
 *  near the top, as at fit-all) it goes beside the bar, or under it when the right is full too: never under the top bar
 *  (UAT acceptance A42: "The Brief is not linked…" sat clipped under the header). */
export function noticePlace(bar: Box, host: Box, nodeTop: number, size: { width: number; height: number }): { left: number; top: number } {
  const above = bar.top < nodeTop
  const left = Math.round(bar.left - host.left)
  if (!above) return { left, top: Math.round(bar.bottom - host.top + 8) }
  const top = Math.round(bar.top - host.top - size.height - 8)
  if (top >= 8) return { left, top }
  const beside = Math.round(bar.right - host.left + 8)
  if (beside + size.width <= host.width - 8) return { left: beside, top: Math.max(8, Math.round(bar.top - host.top)) }
  return { left, top: Math.round(bar.bottom - host.top + 8) }
}
