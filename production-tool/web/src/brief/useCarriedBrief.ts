// The brief a project was born with (features/production-spinoff.clan): Continue in › Production from Brief Maker
// writes the project with the brief carried whole under data.upstream.<brief id>, and the project opens on the
// blank canvas with that brief's Brief node alone, in view, nothing selected; no Script, nothing asked (owner
// 2026-11-18). Once: a project that has the Brief node already is left as it is. No UI of its own.

import { useEffect, useRef } from 'react'
import type { ClanStoreApi } from '../../../clan-store/src'
import type { NodeEnv } from '../canvas/nodes/nodes'
import { fitClear } from '../canvas/boards/boards'
import { bringCarriedBrief } from './start'
import { bringCarriedRoutes } from './routeNode'

export function useCarriedBrief(env: NodeEnv | null, clan: Pick<ClanStoreApi, 'spunOffFrom'> | null): void {
  // Once per project's store, whatever number of times the canvas environment is rebuilt.
  const taken = useRef<unknown>(null)
  useEffect(() => {
    if (!env || !clan || taken.current === clan) return
    taken.current = clan
    clan.spunOffFrom()
      .then(async (from) => ({ made: await bringCarriedBrief(env, from), routes: await bringCarriedRoutes(env, from) }))
      .then(({ made, routes }) => {
        if (routes) return // the routes were fitted into view as they came in
        if (!made) return
        // In view clear of the tool rail, at most 100% (re-test 2b: at 1116 px the Brief landed half under the rail).
        env.canvas.select([])
        fitClear(env.canvas, [made.el], { zoomFactor: 0.8 })
      })
      .catch((e) => console.warn('what this project carries could not be brought in', e))
  }, [env, clan])
}
