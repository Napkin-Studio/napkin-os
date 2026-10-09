// The regenerate menu's helpers (features/model-choice.clan): prices as shown, and which
// model made a frame or take (its tooltip, and where the menu starts). Read from the job's
// record; a job picked for one provider that ran on another (the relay's fallback) says so.

import { modelLabel, type ModelOption } from '../capabilities'
import type { DocJob, ModelChoice, ProductionDocument } from '../contracts/types'
import type { UiState } from '../doc/ui'

export interface MadeWith {
  /** The provider and model the job ran on, when the record has them. */
  made?: ModelChoice
  /** "Veo 3.1 Fast (fal)", or "Veo 3.1 Fast (runway), because fal could not take Veo 3.1". */
  label?: string
}

export function madeWith(doc: ProductionDocument, ui: UiState, jobId: string | undefined): MadeWith {
  const job = jobId ? doc.jobs.find((j) => j.id === jobId) : undefined
  if (!job?.provider || !job.model) return {}
  const made = { provider: job.provider, model: job.model }
  let label = `${modelLabel(made.provider, made.model)} (${made.provider})`
  const picked = jobId ? ui.jobCtx[jobId]?.request.modelChoice : undefined
  if (picked && picked.provider !== made.provider) {
    label += `, because ${picked.provider} could not take ${modelLabel(picked.provider, picked.model)}`
  }
  return { made, label }
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
