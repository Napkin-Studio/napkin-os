import type { View } from '../contracts/types'

export interface GenLike { id: string; state: string; asset?: string; view?: View; pickedAs?: View; op: string }

/** The pictures a view slot offers: those made for that view first, then every other finished picture,
 *  so any image can fill any slot. */
export function viewCandidates<G extends GenLike>(gens: G[], v: View): { madeFor: G[]; others: G[] } {
  const done = gens.filter((g) => g.state === 'completed' && g.asset)
  const madeFor = done.filter((g) => g.view === v || g.pickedAs === v || (v === 'front' && (g.op === 'generate' || g.op === 'combine')))
  const first = new Set(madeFor.map((g) => g.id))
  return { madeFor, others: done.filter((g) => !first.has(g.id)) }
}
