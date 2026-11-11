// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Needs you for the signed-in person: their lines on live jobs, by deadline, from the job index.

import { jobNeeds } from '../../host/http'
import type { JobNeed } from '../../host/types'
import { useLiveRead } from './useLiveRead'

const NONE: JobNeed[] = []

export function useJobNeeds(enabled: boolean): JobNeed[] {
  return useLiveRead(jobNeeds, enabled, NONE).value
}
