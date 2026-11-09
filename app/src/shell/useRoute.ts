// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's route in React. The state is the owner; the URL hash is written
// from it, and a hashchange (back, forward, a pasted link) only reads it. No
// router: four shapes, parsed in route.ts.

import { useCallback, useEffect, useState } from 'react'
import { formatRoute, parseRoute, sameRoute, type Route } from './route'

const here = (): Route => parseRoute(window.location.hash)

export function useRoute(): [Route, (r: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(here)

  useEffect(() => {
    // A bare or unknown hash is #agency from the first paint, so a reload and a share agree.
    const want = formatRoute(here())
    if (window.location.hash !== want) window.history.replaceState(null, '', want)
    const read = () => setRoute(here())
    window.addEventListener('hashchange', read)
    window.addEventListener('popstate', read)
    return () => {
      window.removeEventListener('hashchange', read)
      window.removeEventListener('popstate', read)
    }
  }, [])

  const go = useCallback((next: Route, replace = false) => {
    setRoute(prev => (sameRoute(prev, next) ? prev : next))
    const want = formatRoute(next)
    if (window.location.hash !== want) {
      if (replace) window.history.replaceState(null, '', want)
      else window.history.pushState(null, '', want)
    }
  }, [])

  return [route, go]
}
