// The regenerate menu's helpers (features/model-choice.clan): prices as shown, and which
// model made a frame or take (its tooltip, and where the menu starts). Read from the job's
// record; a job picked for one provider that ran on another (the relay's fallback) says so.

import { modelLabel, type ModelOption } from '../capabilities'
import type { DocJob, ModelChoice, Provider, ProductionDocument } from '../contracts/types'
import type { UiState } from '../doc/ui'

export const PROVIDER_NAMES: Record<Provider, string> = { fal: 'fal', runway: 'Runway', heygen: 'HeyGen', mock: 'Mock' }

/** "Made on Runway: HeyGen could not", when the relay made a job on another provider than the
 *  one it was meant for (Job.fallbackFrom; features/runway-fallback.clan). */
export function fellBack(from: ModelChoice | undefined, made: Provider | undefined): string | undefined {
  if (!from || !made || from.provider === made) return undefined
  return `Made on ${PROVIDER_NAMES[made]}: ${PROVIDER_NAMES[from.provider]} could not`
}

export interface MadeWith {
  /** The provider and model the job ran on, when the record has them. */
  made?: ModelChoice
  /** "Veo 3.1 Fast (fal)", or "Veo 3 (runway) · Made on Runway: HeyGen could not". */
  label?: string
  /** "Made on Runway: HeyGen could not", when it fell back. */
  fallback?: string
}

export function madeWith(doc: ProductionDocument, ui: UiState, jobId: string | undefined): MadeWith {
  const job = jobId ? doc.jobs.find((j) => j.id === jobId) : undefined
  if (!job?.provider || !job.model) return {}
  const made = { provider: job.provider, model: job.model }
  const ctx = jobId ? ui.jobCtx[jobId] : undefined
  // The relay's record of it, else the pick it was sent with (jobs from before fallbackFrom was kept).
  const fallback = fellBack(ctx?.fallbackFrom ?? ctx?.request.modelChoice, made.provider)
  const label = `${modelLabel(made.provider, made.model)} (${made.provider})${fallback ? ` · ${fallback}` : ''}`
  return fallback ? { made, label, fallback } : { made, label }
}

/** An estimate as the menu shows it. */
export function price(usd: number | null): string {
  if (usd == null) return 'price not published'
  return `~$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`
}

/** Where the menu starts: the model that made the version being replaced, when it is offered. */
export function startingChoice(options: ModelOption[], made?: Pick<DocJob, 'provider' | 'model'>): ModelChoice | undefined {
  const hit = made?.provider && made.model ? options.find((o) => o.provider === made.provider && o.model === made.model) : undefined
  const o = hit ?? options[0]
  return o && { provider: o.provider, model: o.model }
}

/** What a failed job may be sent again on: every other model, those from another provider
 *  first (what made it fail, an account out of credit or a model that cannot take the step,
 *  may not hold there), the failed one left out. */
export function otherModels(options: ModelOption[], failed: Pick<DocJob, 'provider' | 'model'>): ModelOption[] {
  const rest = options.filter((o) => !(o.provider === failed.provider && o.model === failed.model))
  return [...rest.filter((o) => o.provider !== failed.provider), ...rest.filter((o) => o.provider === failed.provider)]
}
