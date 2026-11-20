// A failed job's words as the person reads them. The relay says "The director failed (DirectorError)."
// when its director refuses a plan (relay/service.py, code 'internal'); that reached the person as is.
// Here it becomes what happened, in plain words, and what to do; every other error stays as it came.

import type { ContractError, Op } from '../contracts/types'

const DIRECTOR = /^The director failed \((\w+)\)\.?$/

const RUNWAY = /^Runway answered (\d{3})(?::\s*(.*))?$/s
const ASPECT = /aspect ratio\. width \/ height ratio must be at (least|most) (\d+(?:\.\d+)?)\. Got (\d+(?:\.\d+)?)/i

/** Runway's refusal of what was sent, in words (UAT 2026-11-21, F5: "Runway answered 400: Validation of body failed:
 *  references.1.uri Invalid asset aspect ratio…" reached the person as it came). */
function runwayWords(status: number, detail: string): string {
  const a = ASPECT.exec(detail)
  if (a) {
    const narrow = a[1] === 'least'
    return `One of the pictures is too ${narrow ? 'narrow' : 'wide'} for this model (${a[3]} wide for each 1 tall; it takes ${narrow ? 'at least' : 'at most'} ${a[2]}). Crop it ${narrow ? 'wider' : 'taller'}, leave it out, or pick another model.`
  }
  if (status === 400 || status === 422) return 'Runway could not take what was sent for this model. Try another model, or change the pictures or words, then make it again.'
  return `Runway refused this (${status}). Try again in a moment.`
}

/** The error with plain words in place of the relay's internal ones, where it has some. */
export function plainJobError(error: ContractError, op: Op | undefined): ContractError {
  const r = RUNWAY.exec(error.message ?? '')
  if (r) return { ...error, message: runwayWords(Number(r[1]), r[2] ?? '') }
  const m = DIRECTOR.exec(error.message ?? '')
  if (!m) return error
  const message = m[1] === 'DirectorError'
    ? op === 'shot_list'
      ? 'The Director agent could not plan these shots: the plan named a picture that was not sent. Check that each @name in the script has a picture (a bare @name needs its front), then plan again.'
      : 'The Director agent could not direct this: a name or a setting did not match the pictures sent. Check the @names, then try again.'
    : 'The Director agent could not work this out. Try again.'
  return { ...error, message }
}
