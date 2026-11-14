// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useSyncExternalStore } from 'react'
import type { MarkPalette } from './deepOSvg'
import { appliedAgencyMark, markOf, NEUTRAL_MARK, onAppliedAgency } from '../shell/agency/palette'
import { lastAgency, lastAgencyLook } from '../shell/agency/lastAgency'

/**
 * The mark's colours when it is not told: the agency on the page, else the one
 * this browser last signed in to (a basic agency's look as last applied, else
 * the registry's), else neutral (as the boot screen, brand/bootLook.ts).
 */
export function useAgencyMark(): MarkPalette {
  const applied = useSyncExternalStore(onAppliedAgency, appliedAgencyMark, () => null)
  if (applied) return applied
  const last = lastAgency()
  if (!last) return NEUTRAL_MARK
  const kept = lastAgencyLook()
  return kept ? { base: kept.base, accent: kept.accent } : markOf(`_@${last}`)
}
