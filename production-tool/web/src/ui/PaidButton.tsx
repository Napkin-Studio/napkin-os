// A button that starts paid jobs asks first, with how many and what they cost (features/pt-canvas-r2.clan; UAT round 2
// R2-6: "Make the other views" spent $0.60 on one click, while every other paid action confirms).

import { useState } from 'react'
import type { JobInput, ModelChoice, Op } from '../contracts/types'
import { InlineConfirm } from './Undo'
import { usePrice } from './usePrice'

export function PaidButton({ label, busyLabel = 'Starting…', busy, disabled, className, what, yes, op, input, count, modelChoice, onYes }: {
  label: string
  busyLabel?: string
  busy: boolean
  disabled?: boolean
  className: string
  /** What it will make, in words: "3 views of @marco: three-quarter, side, back". */
  what: string
  yes: string
  op: Op
  /** Only the fields the price turns on. */
  input: JobInput
  count: number
  modelChoice?: ModelChoice
  onYes: () => void
}) {
  const [asking, setAsking] = useState(false)
  const price = usePrice(asking ? op : null, input, count, modelChoice)
  if (asking) {
    return (
      <InlineConfirm tone="primary" yes={yes} no="Not now" text={<>{what}{price ? <> · <b className="paid-price">{price}</b></> : null}</>}
        onNo={() => setAsking(false)} onYes={() => { setAsking(false); onYes() }} />
    )
  }
  return <button type="button" className={className} disabled={busy || disabled} onClick={() => setAsking(true)}>{busy ? busyLabel : label}</button>
}
