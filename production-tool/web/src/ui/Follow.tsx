// "Update what follows": the remake bar floats at the bottom of the stage while anything
// is behind ("3 behind your changes · Remake them") and starts a steered run
// (jobs/follow.ts), whose items wait in the update box (ui/UpdateBox.tsx); while one
// is on, the top bar shows the run's state and Stop.

import { useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { shotsBeingFixed } from '../jobs/fix'
import { cancelFollow, followState, planFollow, planSize, planWords, startFollow } from '../jobs/follow'
import { behindCount } from './behind'

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
  const label = run.cancel ? 'Stopping…' : state.failed ? 'Update paused' : run.awaiting && !state.running ? 'Update · your turn' : `Updating · ${Math.min(state.done + 1, run.total ?? state.done + 1)} of ${run.total ?? '…'}`
  return (
    <span className="follow row" role="status" onClick={(e) => e.stopPropagation()}>
      <span className={`followchip ${state.failed ? 'failed' : ''}`}
        title={run.cancel ? 'Stopping after the step running now' : state.failed ? 'A step failed: make it again in the update box, on another model if you like, or stop.' : 'Updating what follows: frames, then clips, then the ad'}>
        {label}
      </span>
      {!run.cancel && <button className="btn sm ghost" onClick={() => void cancelFollow(deps)}>Stop</button>}
    </span>
  )
}

/** The one place to start an update: a bar floating at the bottom of the stage while anything is behind. */
export function RemakeBar() {
  const services = useServices()
  const { doc: docStore, ui: uiStore, runner, relay } = services
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  useJobsTick()
  const [error, setError] = useState<string | null>(null)
  if (ui.following) return null
  const plan = planFollow(doc, shotsBeingFixed(doc, (id) => ui.jobCtx[id]))
  const n = planSize(plan)
  if (!n) return null
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  return (
    <div className="remakebar" role="region" aria-label="Update what follows" onClick={(e) => e.stopPropagation()}>
      <span className="dot" aria-hidden="true" />
      <b>{behindCount(n)}</b>
      <span className="remake-what">{planWords(plan)}</span>
      <button className="btn sm dark" title={`Make ${planWords(plan)} again, one at a time: your words and model for each`} onClick={async () => {
        setError(null)
        try {
          await startFollow(deps, config, { steer: true })
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That did not work.')
        }
      }}>Remake them</button>
      {error && <span role="alert" className="remake-error">{error}</span>}
    </div>
  )
}
