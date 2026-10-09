// Shot-list arithmetic: the seconds of the shots must add up to the target.

import type { Shot } from '../contracts/types'

export const TARGETS = [10, 15, 20] as const
export const MIN_SHOTS = 2
export const MAX_SHOTS = 8

export function totalSeconds(shots: Pick<Shot, 'duration_s'>[]): number {
  return Math.round(shots.reduce((s, x) => s + (Number.isFinite(x.duration_s) ? x.duration_s : 0), 0) * 100) / 100
}

export type DurationCheck =
  | { ok: true; total: number }
  | { ok: false; total: number; reason: string }

export function checkDurations(shots: Pick<Shot, 'duration_s'>[], targetS: number): DurationCheck {
  const total = totalSeconds(shots)
  if (shots.length < MIN_SHOTS) return { ok: false, total, reason: `Add at least ${MIN_SHOTS} shots.` }
  if (shots.length > MAX_SHOTS) return { ok: false, total, reason: `Use ${MAX_SHOTS} shots or fewer.` }
  const bad = shots.find((s) => !(s.duration_s >= 1 && s.duration_s <= 10))
  if (bad) return { ok: false, total, reason: 'Each shot lasts 1 to 10 seconds.' }
  if (total !== targetS) {
    const diff = Math.round((targetS - total) * 100) / 100
    return { ok: false, total, reason: diff > 0 ? `Add ${diff} s to reach ${targetS} s.` : `Cut ${-diff} s to reach ${targetS} s.` }
  }
  return { ok: true, total }
}

/** Split a target into even shots (used by the mock director and as a starting point). */
export function splitTarget(targetS: number): number[] {
  if (targetS <= 10) return [5, 5]
  if (targetS <= 15) return [5, 5, 5]
  return [5, 5, 5, 5]
}
