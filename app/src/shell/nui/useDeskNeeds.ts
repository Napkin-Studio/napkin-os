// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the signed-in person's documents hold for them (`GET /needs`: per document), kept current without a refresh
// (home/useLiveRead.ts) and read again when a mark is set aside or brought back. The only reader of the route besides
// the set-aside store.

import { useEffect, useRef } from 'react'
import { jobNeeds } from '../../host/http'
import type { NeedsAnswer } from '../../host/types'
import { asideVersion, useAsideVersion } from '../decisions/asideStore'
import { useLiveRead } from '../home/useLiveRead'

const NONE: NeedsAnswer = { documents: [], aside: {}, next_deadline: null, timesheet: null }

export function useDeskNeeds(enabled: boolean): { answer: NeedsAnswer; ready: boolean; reload: () => void } {
  const { value, ready, reload } = useLiveRead(jobNeeds, enabled, NONE)
  // a set-aside moved: the server has the mark (or is about to), so ask again a moment later too
  useAsideVersion()
  const seen = useRef(asideVersion())
  useEffect(() => {
    if (!enabled || seen.current === asideVersion()) return
    seen.current = asideVersion()
    const t = setTimeout(reload, 300)
    return () => clearTimeout(t)
  })
  return { answer: value, ready, reload }
}
