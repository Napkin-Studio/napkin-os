// The canvas's first-run Start card ("Start with the script"): only on a blank canvas.

import { cardOf } from '../canvas/nodes/nodes'
import { imageOf, isText, isUserDrawing, type El } from '../canvas/scene'

/**
 * Whether the Start card shows: not dismissed, no marks, no named pictures, and no node on the
 * canvas. A node's own empty start (its card's PromptStart) takes over, so the card never covers one.
 */
export function showStartCard(els: readonly El[], o: { dismissed: boolean; refs: number }): boolean {
  if (o.dismissed || o.refs > 0) return false
  return !els.some((e) => isUserDrawing(e) || isText(e) || !!imageOf(e) || !!cardOf(e))
}
