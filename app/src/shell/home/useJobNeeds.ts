// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Needs you for the signed-in person: their lines on the jobs they are on, by deadline, from the job
// index, and the next deadline on those jobs for the empty list. `reload` asks again at once (Done and Undo).

import { jobNeeds } from '../../host/http'
import type { JobNeed, NextDeadline } from '../../host/types'
import { useLiveRead } from './useLiveRead'

const NONE = { items: [] as JobNeed[], next_deadline: undefined as NextDeadline | null | undefined }

export function useJobNeeds(enabled: boolean): { items: JobNeed[]; next: NextDeadline | null | undefined; reload: () => void } {
  const { value, reload } = useLiveRead(jobNeeds, enabled, NONE)
  return { items: value.items, next: value.next_deadline, reload }
}
