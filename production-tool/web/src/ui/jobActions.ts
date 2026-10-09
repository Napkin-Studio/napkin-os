// What a failed job's card offers (features/video-stage-findings.clan). Another model or a
// report cannot help with the day's quota, the event's budget, a step switched off or a
// signed-out session: those cards offered "Try another model" and "Report" anyway (2026-10-09).
// invalid_input keeps both: a provider's 4xx arrives as invalid_input too, and another model
// may take what this one refused.

import type { ContractError } from '../contracts/types'

/** The event's limits and the session: nothing a model or the organisers' log can change. */
const NOT_THE_MODEL = new Set(['quota_exhausted', 'spend_stop', 'flag_off', 'unauthorised', 'blocked'])

export interface FailedActions {
  otherModel: boolean
  report: boolean
  /** A line under the message: what happens next, when the message alone does not say. */
  note?: string
}

export function failedActions(err: Pick<ContractError, 'code'> | undefined): FailedActions {
  const code = err?.code
  if (code && NOT_THE_MODEL.has(code)) {
    // The relay counts the day in UTC (service.py _day).
    const note = code === 'quota_exhausted' ? 'Your daily allowance starts again at midnight UTC. Ask an organiser if you need more today.' : undefined
    return { otherModel: false, report: false, ...(note ? { note } : {}) }
  }
  return { otherModel: true, report: true }
}
