// The price on a paid confirm (features/pt-canvas-r2.clan; UAT round 2 R2-6, R2-10): the relay's POST /estimate for one
// job like the one to be sent, times how many. The relay prices it as it will price the job (contracts/pricing.py over
// the sheet); the words come from ui/historyItems.ts priceWords. No answer (an older relay, offline): no price, and the
// confirm works as before.

import { useEffect, useState } from 'react'
import { useServices } from '../app/context'
import type { Estimate, EstimateRequest, JobInput, ModelChoice, Op } from '../contracts/types'
import { priceWords } from './historyItems'

const asked = new Map<string, Promise<number | undefined>>()

/** One job's price in USD, asked once per kind of request this session (a failed ask is asked again next time). */
export function estimateOnce(estimate: ((req: EstimateRequest) => Promise<Estimate>) | undefined, req: EstimateRequest): Promise<number | undefined> {
  if (!estimate) return Promise.resolve(undefined)
  const key = JSON.stringify(req)
  const known = asked.get(key)
  if (known) return known
  const p = estimate(req).then((e) => (e.unknown ? undefined : e.usd), () => undefined)
  asked.set(key, p)
  void p.then((usd) => { if (usd === undefined) asked.delete(key) })
  return p
}

/** One job's price in USD for `op` with this input (only the fields the price turns on); undefined until known, or
 *  when `op` is null (nothing to price). */
export function useEstimate(op: Op | null, input: JobInput, modelChoice?: ModelChoice): number | undefined {
  const { relay } = useServices()
  const [usd, setUsd] = useState<number | undefined>(undefined)
  const key = op ? JSON.stringify([op, input, modelChoice ?? null]) : ''
  useEffect(() => {
    if (!op) return
    let live = true
    const req: EstimateRequest = { contractVersion: '3', op, input, ...(modelChoice ? { modelChoice } : {}) }
    void estimateOnce(relay.estimate?.bind(relay), req).then((v) => { if (live) setUsd(v) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, relay])
  return op ? usd : undefined
}

// The words ("about" and the total) for `count` jobs of `op` with this input, or undefined.
export function usePrice(op: Op | null, input: JobInput, count = 1, modelChoice?: ModelChoice): string | undefined {
  return priceWords(useEstimate(op, input, modelChoice), count)
}
