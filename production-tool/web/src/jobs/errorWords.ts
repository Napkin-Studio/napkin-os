// A failed job's words as the person reads them. The relay says "The director failed (DirectorError)."
// when its director refuses a plan (relay/service.py, code 'internal'); that reached the person as is.
// Here it becomes what happened, in plain words, and what to do; every other error stays as it came.

import type { ContractError, Op } from '../contracts/types'

const DIRECTOR = /^The director failed \((\w+)\)\.?$/

/** The error with plain words in place of the relay's internal ones, where it has some. */
export function plainJobError(error: ContractError, op: Op | undefined): ContractError {
  const m = DIRECTOR.exec(error.message ?? '')
  if (!m) return error
  const message = m[1] === 'DirectorError'
    ? op === 'shot_list'
      ? 'Dex could not plan these shots: the plan named a picture that was not sent. Check that each @name in the script has a picture (a bare @name needs its front), then plan again.'
      : 'Dex could not direct this: a name or a setting did not match the pictures sent. Check the @names, then try again.'
    : 'Dex could not work this out. Try again.'
  return { ...error, message }
}
