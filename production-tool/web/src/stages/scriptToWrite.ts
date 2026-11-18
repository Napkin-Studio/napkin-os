// The script a board rail's Script row opens (stages/Character.tsx open('script')).

import { cardOf, createNode, type NodeEnv } from '../canvas/nodes/nodes'
import type { ProductionDocument } from '../contracts/types'
import { mainScript } from '../model/selectors'

/**
 * The project's own script, or, on a blank project (no script yet), a new Script node made the way
 * + Node → Script makes it (createNode: its entity, then the node in view, selected). Undefined when there
 * is none and no canvas that can make nodes (`env` null: Excalidraw).
 */
export async function scriptToWrite(doc: ProductionDocument, env: NodeEnv | null): Promise<string | undefined> {
  const sc = mainScript(doc)?.id
  if (sc) return sc
  if (!env) return undefined
  return cardOf(await createNode(env, 'script'))?.id
}
