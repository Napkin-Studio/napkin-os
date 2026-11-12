// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A read the server answers from the job index, kept current without a refresh: read once, again
// the moment the server says a document's data changed (the event stream, the same one the shell
// already holds; the job index is the server's, so this reads the web host's), and on a slow poll as the safety net for a dropped stream. A stage change
// reaches the screen well inside ten seconds (pilot test 5).

import { useCallback, useEffect, useRef, useState } from 'react'
import { httpHost } from '../../host/http'

/** The safety-net poll. The event stream is the fast path. */
export const LIVE_POLL_MS = 4000

export function useLiveRead<T>(read: () => Promise<T>, enabled: boolean, initial: T): { value: T; ready: boolean; reload: () => void } {
  const [state, setState] = useState<{ value: T; ready: boolean }>({ value: initial, ready: false })
  const loader = useRef<() => void>(() => {})
  // A save asks for the answer now rather than at the next poll.
  const reload = useCallback(() => loader.current(), [])
  useEffect(() => {
    if (!enabled) return
    let fresh = true
    let busy = false
    let again = false
    const load = async () => {
      // One read at a time; a change that lands mid-read asks for one more, so the last word is never lost.
      if (busy) { again = true; return }
      busy = true
      try {
        const value = await read()
        if (fresh) setState({ value, ready: true })
      } finally {
        busy = false
        if (again && fresh) { again = false; void load() }
      }
    }
    loader.current = () => { void load() }
    void load()
    const timer = setInterval(() => { void load() }, LIVE_POLL_MS)
    let unlisten: (() => void) | undefined
    void httpHost.on('clan-data-changed', () => { void load() }).then(u => { if (fresh) unlisten = u; else u() }).catch(() => {})
    return () => { fresh = false; clearInterval(timer); unlisten?.() }
  // `read` is a module function; the effect restarts only when the enabling changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
  return { ...state, reload }
}
