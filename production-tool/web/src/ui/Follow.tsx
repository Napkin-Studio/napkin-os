// Updates (features/one-to-one-updates.clan): the remake bar floats on the stage while anything
// is out of date ("2 out of date · 2 frames  [Update 2 | ▾]", ▾ "Update 2 and carry forward (6)")
// or not made yet ("3 clips not made yet · Make them"), and starts a steered run (jobs/follow.ts):
// the plan first, then each item in the update box (ui/UpdateBox.tsx). The cards start the same
// runs for one item, or for it and those after (useUpdate, ui/useUpdate.ts). While a run is on, the top bar shows
// its state and Stop.

import { useState } from 'react'
import { useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { cancelFollow, followState, planSize, planWords, type FollowScope } from '../jobs/follow'
import { behindCount, notMadeCount } from './behind'
import { SplitButton } from './SplitButton'
import { useUpdate } from './useUpdate'

/** The run's state and Stop, in the top bar; nothing when no run is on. */
export function UpdateFollows() {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const run = ui.following
  const state = followState(doc, (id) => ui.jobCtx[id], run)
  if (!run || !state) return null
  const label = run.cancel ? 'Stopping…' : run.reviewing ? 'Update · check the plan' : state.failed ? 'Update paused' : run.awaiting && !state.running ? 'Update · your turn' : `Updating · ${Math.min(state.done + 1, run.total ?? state.done + 1)} of ${run.total ?? '…'}`
  return (
    <span className="follow row" role="status" onClick={(e) => e.stopPropagation()}>
      <span className={`followchip ${state.failed ? 'failed' : ''}`}
        title={run.cancel ? 'Stopping after the step running now' : state.failed ? 'A step failed: make it again in the update box, on another model if you like, or stop.' : 'Updating: frames, then clips, then the ad'}>
        {label}
      </span>
      {!run.cancel && <button className="btn sm ghost" onClick={() => void cancelFollow(deps)}>Stop</button>}
    </span>
  )
}

/** The one place to start an update of the whole project: a bar floating on the stage while anything is
 *  out of date or not made yet. `dock`: top on the Video stage, where the bottom is the player's controls. */
export function RemakeBar({ dock = 'bottom' }: { dock?: 'top' | 'bottom' } = {}) {
  const update = useUpdate()
  useJobsTick()
  const [error, setError] = useState<string | null>(null)
  if (update.running) return null
  const direct = update.plan({ kind: 'direct' })
  const n = planSize(direct)
  const carry = update.size({ kind: 'carry' })
  const missing = update.plan({ kind: 'missing' })
  const m = planSize(missing)
  if (!n && !m) return null
  const go = async (scope: FollowScope) => {
    setError(null)
    try {
      await update.start(scope)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  return (
    <div className={`remakebar ${dock === 'top' ? 'top' : ''}`} role="region" aria-label="Update" onClick={(e) => e.stopPropagation()}>
      {n > 0 && (
        <>
          <span className="dot" aria-hidden="true" />
          <b>{behindCount(n)}</b>
          <span className="remake-what">{planWords(direct)}</span>
          <SplitButton kind="dark" menuLabel="More ways to update" onClick={() => void go({ kind: 'direct' })}
            title={`Make ${planWords(direct)} again, only what is out of date: your words and model for each`}
            items={carry > n ? [{
              label: `Update ${n} and carry forward (${carry})`, hint: update.cost({ kind: 'carry' }), icon: '⇥',
              onSelect: () => void go({ kind: 'carry' }),
            }] : []}>
            Update {n}
          </SplitButton>
        </>
      )}
      {n > 0 && m > 0 && <span className="remake-sep" aria-hidden="true" />}
      {m > 0 && (
        <>
          <span className="remake-what notmade">{notMadeCount(missing.frames.length, missing.clips.length)}</span>
          <button className="btn sm" title={`Make ${planWords(missing)}, one at a time: your words and model for each`} onClick={() => void go({ kind: 'missing' })}>
            {m === 1 ? 'Make it' : 'Make them'}
          </button>
        </>
      )}
      {error && <span role="alert" className="remake-error">{error}</span>}
    </div>
  )
}
