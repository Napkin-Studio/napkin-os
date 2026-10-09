// Plans for update scopes as things stand now, and a way to start one (features/one-to-one-updates.clan):
// the remake bar, a card's Redraw / Remake and their "this and those after", the shot row's
// "Redraw frame 3" and "Carry the look forward" all start steered runs (jobs/follow.ts), the plan
// first in the update box when it has more than one item.

import { useConfig, useDoc, useServices, useUi } from '../app/context'
import { planCostShort, planFor, planSize, shotsInTheMaking, startFollow, type FollowScope } from '../jobs/follow'

export function useUpdate() {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  const busy = shotsInTheMaking(doc, (id) => ui.jobCtx[id])
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const plan = (scope: FollowScope) => planFor(doc, scope, busy.clips, busy.frames)
  return {
    plan,
    size: (scope: FollowScope) => planSize(plan(scope)),
    cost: (scope: FollowScope) => planCostShort(plan(scope), config),
    /** A run is on: nothing else can start until it ends. */
    running: !!ui.following,
    start: (scope: FollowScope) => startFollow(deps, config, { steer: true, scope }),
  }
}
