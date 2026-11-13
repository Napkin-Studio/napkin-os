// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the person's role adds to the desk, in React: read once for the roles in the session, and again
// when an admin's View as asks for another role's. A server with no accounts,
// the desktop and the serverless build have none, and keep the desk.

import { useEffect, useState } from 'react'
import { homeView, type HomeView } from '../../host/http'

export interface HomeState {
  /** `loading` until the first answer; then `ready`, with the view or null where there is none. */
  state: 'loading' | 'ready'
  view: HomeView | null
}

export function useHomeView(enabled: boolean, as: string | null): HomeState {
  const [got, setGot] = useState<{ as: string | null; view: HomeView | null } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let fresh = true
    void homeView(as).then(view => { if (fresh) setGot({ as, view }) })
    return () => { fresh = false }
  }, [enabled, as])
  if (!enabled) return { state: 'ready', view: null }
  // A switch in flight keeps the home on screen until the new one lands.
  return got ? { state: 'ready', view: got.view } : { state: 'loading', view: null }
}
