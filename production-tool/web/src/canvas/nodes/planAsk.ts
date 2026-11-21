// The question a storyboard's plan waits on (UAT round 3 R3-5): the card says so and NodeLayer shows its ask beside it.

import type { Ask, ProductionDocument } from '../../contracts/types'
import { askOf } from '../../jobs/runner'

/** The question a plan on this storyboard waits on, if one does (its ask card goes beside the node: NodeLayer). */
export function planAskOn(doc: ProductionDocument, storyboardId: string | undefined): Ask | undefined {
  if (!storyboardId) return undefined
  const job = Object.values(doc.jobs ?? {}).find((j) => j.op === 'shot_list' && j.node?.kind === 'storyboard' && j.node.id === storyboardId && j.state === 'needs_input')
  const ask = job ? askOf(doc, job.id) : undefined
  return ask && ask.state !== 'answered' ? ask : undefined
}
