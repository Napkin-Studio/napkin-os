// Save moments besides the minute tick (session.ts). A Final is what a deck made from this project reads: marking one
// and leaving at once (to the deck, in the OS) left the library copy without it, so the deck never offered
// "Update from Production" (UAT 5-tool run, track A, 2026-11-26).
import type { ProductionDocument } from '../contracts/types'

/** A marked, unmarked or changed Final is posted this long after it changes. */
export const FINAL_SAVE_MS = 1_500

/** The project's Finals as one string, the same whatever order their keys came in. */
export function finalsKey(d: Pick<ProductionDocument, 'finals'>): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
    }
    return v
  }
  const f = d.finals ?? {}
  return JSON.stringify(Object.keys(f).length ? sorted(f) : {})
}

/** One pending save, run at the earliest moment any caller asked for: a later, longer ask never pushes it back. */
export function soonTimer(save: () => void): ((ms: number) => void) & { cancel: () => boolean } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let due = 0
  const soon = (ms: number) => {
    const at = Date.now() + ms
    if (timer && due <= at) return
    if (timer) clearTimeout(timer)
    due = at
    timer = setTimeout(() => { timer = null; save() }, ms)
  }
  return Object.assign(soon, {
    cancel: () => {
      if (!timer) return false
      clearTimeout(timer)
      timer = null
      return true
    },
  })
}
