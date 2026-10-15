// A double-click on a picture (features/edit-canvas-pictures.clan; owner 2026-10-15): it opens the
// picture in the Image editor once the picture is the one thing selected. A picture on its own is
// selected by the double-click's first click, so it opens at once. In a group (a key's views, stacked or
// spread, or a person's group) a click selects the whole group, so the first double-click picks the
// picture out (SelectTool.pickOne) and the next one, on the picture now selected alone, opens it.
// Drawings are not opened: their picture is drawn from their strokes.

import type { CanvasElement, Pt } from '../core/canvasAdapter'
import { imageOf } from '../sceneRead'

/** A picture the Image editor can open: a dropped picture or a result, once it has its picture. */
export function editablePicture(el: CanvasElement | undefined): string | null {
  const img = imageOf(el)
  return img && img.kind !== 'drawn' && img.asset ? img.id : null
}

const inside = (e: CanvasElement, p: Pt) => p.x >= e.x && p.y >= e.y && p.x <= e.x + e.width && p.y <= e.y + e.height

/** What a double-click at `p` does to a picture: open it (its node id), or null (the canvas's own: pick it out of its group). */
export function pictureToOpen(els: readonly CanvasElement[], selectedIds: readonly string[], p: Pt): string | null {
  if (selectedIds.length !== 1) return null
  const el = els.find((e) => e.id === selectedIds[0] && !e.isDeleted)
  return el && inside(el, p) ? editablePicture(el) : null
}
