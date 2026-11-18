// The canvas's first-run Start card ("Start with the script"): only on a blank canvas.

import { cardOf, createNode, type NodeEnv } from '../canvas/nodes/nodes'
import type { ProductionDocument } from '../contracts/types'
import { mainScript } from '../model/selectors'
import { isEmptyDocument } from '../projects/summary'
import { imageOf, isText, isUserDrawing, type El } from '../canvas/scene'

/**
 * Whether the Start card shows: not dismissed, no marks, no named pictures, and no node on the
 * canvas. A node's own empty start (its card's PromptStart) takes over, so the card never covers one.
 */
export function showStartCard(els: readonly El[], o: { dismissed: boolean; refs: number }): boolean {
  if (o.dismissed || o.refs > 0) return false
  return !els.some((e) => isUserDrawing(e) || isText(e) || !!imageOf(e) || !!cardOf(e))
}

/** Whether the document holds work a node shows: script lines, shots, pictures, jobs, a brief, a Format set or a
 *  text (an empty Script, Storyboard and Film of a blank project are not). The start card never shows on one,
 *  whatever the canvas has drawn so far (re-test N-E: a cold open flashed "What should this film be?" over a
 *  project with nodes). */
export function hasWork(d: ProductionDocument): boolean {
  return !isEmptyDocument(d) || [d.briefs, d.format_sets, d.texts].some((m) => !!m && Object.keys(m).length > 0)
}

/**
 * The script "Write the script" opens: the project's own, or, on a blank project (no script yet), a new
 * Script node made the way + Node → Script makes it (createNode: its entity, then the node in view,
 * selected). Undefined when there is none and no canvas that can make nodes (`env` null: Excalidraw).
 */
export async function scriptToWrite(doc: ProductionDocument, env: NodeEnv | null): Promise<string | undefined> {
  const sc = mainScript(doc)?.id
  if (sc) return sc
  if (!env) return undefined
  return cardOf(await createNode(env, 'script'))?.id
}
