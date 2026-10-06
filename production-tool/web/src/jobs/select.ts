// Finding the job that belongs at a spot in the UI (pending or failed).

import type { JobInput, ProductionDocument, Ratio, View } from '../contracts/types'
import type { JobCtx, UiState } from '../doc/ui'
import type { Relay } from '../relay'
import { assetRef } from './assets'
import { isActive } from './runner'

/** The newest job matching `match` that is still running, or failed and not cleared. */
export function jobAt(doc: ProductionDocument, ui: UiState, match: (ctx: JobCtx) => boolean): string | undefined {
  for (let i = doc.jobs.length - 1; i >= 0; i--) {
    const j = doc.jobs[i]
    const ctx = ui.jobCtx[j.id]
    if (!ctx || ctx.dismissed || !match(ctx)) continue
    if (isActive(j.state) || j.state === 'failed' || j.state === 'cancelled') return j.id
  }
  return undefined
}

export function isRunning(doc: ProductionDocument, jobId: string | undefined): boolean {
  if (!jobId) return false
  const j = doc.jobs.find((x) => x.id === jobId)
  return !!j && isActive(j.state)
}

/** The locked character views as AssetRefs (front is required). */
export async function characterInput(relay: Relay, doc: ProductionDocument): Promise<NonNullable<JobInput['character']>> {
  const v = doc.character.views
  if (!v.front) throw new Error('Pick a Front view on the Character stage first.')
  const out: NonNullable<JobInput['character']> = { front: await assetRef(relay, v.front.asset) }
  for (const k of ['three_quarter', 'side', 'back', 'side_2'] as Exclude<View, 'front'>[]) {
    const p = v[k]
    if (p) out[k] = await assetRef(relay, p.asset)
  }
  return out
}

export function ratioAspect(r: Ratio): number {
  const [a, b] = r.split(':').map(Number)
  return a / b
}
