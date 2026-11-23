// A button that starts paid jobs asks first, with how many and what they make (features/pt-canvas-r2.clan; UAT round 2
// R2-6: "Make the other views" started three jobs on one click, while every other paid action confirms). No price: costs
// are shown only in Decisions (owner, 2026-10-13).

import { useState } from 'react'
import { InlineConfirm } from './Undo'

export function PaidButton({ label, busyLabel = 'Starting…', busy, disabled, className, what, yes, onYes }: {
  label: string
  busyLabel?: string
  busy: boolean
  disabled?: boolean
  className: string
  /** What it will make, in words: "3 views of @marco: 3/4, side, back". */
  what: string
  yes: string
  onYes: () => void
}) {
  const [asking, setAsking] = useState(false)
  if (asking) {
    return <InlineConfirm tone="primary" yes={yes} no="Not now" text={what} onNo={() => setAsking(false)} onYes={() => { setAsking(false); onYes() }} />
  }
  return <button type="button" className={className} disabled={busy || disabled} onClick={() => setAsking(true)}>{busy ? busyLabel : label}</button>
}
