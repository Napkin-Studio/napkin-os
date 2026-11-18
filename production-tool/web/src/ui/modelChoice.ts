// The regenerate menu's helpers (features/model-choice.clan): a provider's name, what a failed job may be
// sent again on, and the words when the relay made a job on another provider (its fallback).

import { sameOption, type ModelOption } from '../capabilities'
import type { DocJob, ModelChoice, Provider } from '../contracts/types'

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

/** What a failed job may be sent again on: every other model, those from another provider
 *  first (what made it fail, an account out of credit or a model that cannot take the step,
 *  may not hold there), the failed one left out. */
export function otherModels(options: ModelOption[], failed: Pick<DocJob, 'provider' | 'model'>): ModelOption[] {
  const rest = options.filter((o) => !(failed.model && sameOption(o, { provider: failed.provider, model: failed.model })))
  return [...rest.filter((o) => o.provider !== failed.provider), ...rest.filter((o) => o.provider === failed.provider)]
}
