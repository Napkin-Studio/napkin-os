// What to say before stopping a job that is still being made. Some providers
// cannot stop a job once it has started (their sheet's results.cancel is
// false, e.g. HeyGen): the job may still be charged, and the confirm says so.

import { routedProvider, type Sheets } from '../capabilities'
import { SHEETS } from '../contracts/load'
import type { Config, DocJob, Provider } from '../contracts/types'

const NAME: Partial<Record<Provider, string>> = { heygen: 'HeyGen', runway: 'Runway', fal: 'fal', mock: 'The mock' }

/** The provider that has (or will get) the job: the one it reports, else the one routed for its op. */
export function jobProvider(job: Pick<DocJob, 'op' | 'provider'> | undefined, config: Config, sheets: Sheets = SHEETS): Provider | null {
  if (!job) return null
  return job.provider ?? routedProvider(job.op, config, sheets)
}

/** "HeyGen cannot stop … may still be charged", or null when the provider can cancel. */
export function mayStillCharge(job: Pick<DocJob, 'op' | 'provider'> | undefined, config: Config, sheets: Sheets = SHEETS): string | null {
  const p = jobProvider(job, config, sheets)
  if (!p) return null
  if (sheets[p]?.results.cancel !== false) return null
  return `${NAME[p] ?? p} cannot stop a job once it has started, so this may still be charged.`
}

/** The whole confirm sentence for stopping (and, on the canvas, removing) a job. */
export function cancelText(job: Pick<DocJob, 'op' | 'provider'> | undefined, config: Config, remove = false, sheets: Sheets = SHEETS): string {
  const head = remove ? 'Stop making this and remove it?' : 'Stop making this?'
  const warn = mayStillCharge(job, config, sheets)
  return warn ? `${head} ${warn}` : head
}
