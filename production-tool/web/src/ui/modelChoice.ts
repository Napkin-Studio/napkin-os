// The regenerate menu's helpers (features/model-choice.clan): which
// model made a frame or take (its tooltip, and where the menu starts). Read from the job's
// record; a job picked for one provider that ran on another (the relay's fallback) says so.

import { modelLabel, type ModelOption } from '../capabilities'
import type { DocJob, ModelChoice, Provider, ProductionDocument } from '../contracts/types'
import type { UiState } from '../doc/ui'

export const PROVIDER_NAMES: Record<Provider, string> = { runway: 'Runway', mock: 'Mock' }

/** A provider's name. A document's madeBy can name one no longer routed
 *  (features/drop-hackathon-extras.clan): as recorded, then. */
export function providerName(p: string): string {
  return PROVIDER_NAMES[p as Provider] ?? p
}

/** "Made on Runway: Mock could not", when the relay made a job on another provider than the
 *  one it was meant for (Job.fallbackFrom; features/runway-fallback.clan). */
export function fellBack(from: ModelChoice | undefined, made: string | undefined): string | undefined {
  if (!from || !made || from.provider === made) return undefined
  return `Made on ${providerName(made)}: ${providerName(from.provider)} could not`
}

/** The notice when the relay made a job on Runway, the floor, because the provider it was meant for
 *  could not: "Mock couldn't make frame 3, so we made it on Runway. Napkin's got you." */
export function fallbackNotice(from: ModelChoice | undefined, made: string | undefined, what: string): string | undefined {
  if (!from || !made || from.provider === made) return undefined
  return `${providerName(from.provider)} couldn't make ${what}, so we made it on ${providerName(made)}. Napkin's got you.`
}

export interface MadeWith {
  /** The provider (as the document recorded it: madeBy) and model the job ran on, when the record has them. */
  made?: { provider: string; model: string }
  /** "Veo 3.1 Fast (runway)", or "Gen-4 Image (runway) · Made on Runway: Mock could not". */
  label?: string
  /** "Made on Runway: Mock could not", when it fell back. */
  fallback?: string
}

export function madeWith(doc: ProductionDocument, ui: Pick<UiState, 'jobs'>, jobId: string | undefined): MadeWith {
  const job = jobId ? doc.jobs[jobId] : undefined
  if (!job?.provider || !job.model) return {}
  const made = { provider: job.provider, model: job.model }
  const local = jobId ? ui.jobs[jobId] : undefined
  // The relay's record of it, else the pick it was sent with (jobs from before fallbackFrom was kept).
  const fallback = fellBack(local?.fallbackFrom ?? local?.request?.modelChoice, made.provider)
  const label = `${modelLabel(made.provider, made.model)} (${made.provider})${fallback ? ` · ${fallback}` : ''}`
  return fallback ? { made, label, fallback } : { made, label }
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
