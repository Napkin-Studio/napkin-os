// What the Data sharing sheet says (DataSharing.tsx, features/tenant-limits.clan): who receives the
// agency's material, from the notice (contracts/subprocessors.json) and the agency's allowlist (GET /me
// allow). No prices, costs or limits (owner, 2026-10-13).

import { SPEND_POLICY, SUBPROCESSORS, type Subprocessor } from '../contracts/load'
import type { Allow } from '../contracts/types'

export interface SharingRow {
  id: string
  name: string
  does: string
  receives: string
  /** "Through Runway", when another entry carries the material to it. */
  through?: string
  where: string
  on: boolean
  /** Why it is on or off, in words. */
  state: string
}

export const ASK_NAPKIN = 'To change what your agency shares, ask Napkin. Turning a company off also turns off the steps only its models can make.'

/** One row per company, marked on or off for this agency. */
export function sharingRows(allow: Allow, entries: Subprocessor[] = SUBPROCESSORS): SharingRow[] {
  const names = new Map(entries.map((e) => [e.id, e.name]))
  return entries.map((e) => {
    let on: boolean
    let state: string
    if (e.control === 'always') {
      on = true
      state = 'Always on: the tool runs on it'
    } else if (e.control === 'claude') {
      on = allow.claude
      state = on ? 'On' : 'Off for your agency: Dex plans no shots, and directs without it'
    } else {
      on = allow.makers.includes(e.id) || SPEND_POLICY.alwaysAllowed.includes(e.id)
      state = on ? 'On' : 'Off for your agency'
    }
    return {
      id: e.id, name: e.name, does: e.does, receives: e.receives,
      ...(e.via ? { through: `Through ${names.get(e.via) ?? e.via}` } : {}),
      where: e.region ? e.region.where : 'Where it is processed is not yet confirmed',
      on, state,
    }
  })
}
