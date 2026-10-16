// A double-click on a picture (features/edit-canvas-pictures.clan; owner 2026-10-15) opens it in the
// Image editor, selected alone, unless it is in a group the double-click has not picked it out of yet.
// A picture on its own (no group) opens at once, whatever else was selected with it. In a group (a key's
// views, stacked or spread, or a person's group) a click selects the whole group, so the first
// double-click picks the picture out (SelectTool.pickOne) and the next, on the picture now selected
// alone, opens it. Drawings are not opened: their picture is drawn from their strokes.

import type { CanvasElement, Pt } from '../core/canvasAdapter'
import { imageOf } from '../sceneRead'

/** A picture the Image editor can open: a dropped picture or a result, once it has its picture. */
export function editablePicture(el: CanvasElement | undefined): string | null {
  const img = imageOf(el)
  return img && img.kind !== 'drawn' && img.asset ? img.id : null
}

const inside = (e: CanvasElement, p: Pt) => p.x >= e.x && p.y >= e.y && p.x <= e.x + e.width && p.y <= e.y + e.height

/** What a double-click at `p` opens: the picture there (its element and node id), or null (the canvas's
 *  own: a group's picture is picked out first). `els` in drawing order, topmost last. */
export function pictureToOpen(els: readonly CanvasElement[], selectedIds: readonly string[], p: Pt): { el: string; node: string } | null {
  // Boards and frames hold pictures and sit under them; arrows and links pass over them.
  const hit = els.filter((e) => !e.isDeleted && e.type !== 'arrow' && e.type !== 'frame' && inside(e, p)).at(-1)
  const node = editablePicture(hit)
  if (!hit || !node) return null
  const grouped = (hit.groupIds ?? []).length > 0
  return !grouped || (selectedIds.length === 1 && selectedIds[0] === hit.id) ? { el: hit.id, node } : null
}
