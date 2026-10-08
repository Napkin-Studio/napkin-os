// "Update what follows (N)": starts a steered run (jobs/follow.ts), whose items wait in
// the update box (ui/UpdateBox.tsx); while one is on, the run's state and Stop.

import { useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { shotsBeingFixed } from '../jobs/fix'
import { cancelFollow, followState, planFollow, planSize, planWords, startFollow } from '../jobs/follow'

/** `progress`: show the run's state and Stop here (the top bar does; the buttons on items do not). */
export function UpdateFollows({ size = 'sm', progress = true }: { size?: 'xs' | 'sm'; progress?: boolean }) {
  const services = useServices()
  const { doc: docStore, ui: uiStore, runner, relay } = services
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  useJobsTick()
  const [error, setError] = useState<string | null>(null)
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const run = ui.following
  const state = followState(doc, (id) => ui.jobCtx[id], run)

  if (run && state) {
    if (!progress) return null
    const label = run.cancel ? 'Stopping…' : state.failed ? 'Update paused' : run.awaiting && !state.running ? 'Update · your turn' : `Updating · ${Math.min(state.done + 1, run.total ?? state.done + 1)} of ${run.total ?? '…'}`
    return (
      <span className="follow row" role="status" onClick={(e) => e.stopPropagation()}>
        <span className={`followchip ${state.failed ? 'failed' : ''}`}
          title={run.cancel ? 'Stopping after the step running now' : state.failed ? 'A step failed: make it again in the update box, on another model if you like, or stop.' : 'Updating what follows: frames, then clips, then the ad'}>
          {label}
        </span>
        {!run.cancel && <button className={`btn ${size} ghost`} onClick={() => void cancelFollow(deps)}>Stop</button>}
      </span>
    )
  }

  const plan = planFollow(doc, shotsBeingFixed(doc, (id) => ui.jobCtx[id]))
  const n = planSize(plan)
  if (!n) return null
  return (
    <span className="follow row" onClick={(e) => e.stopPropagation()}>
      <button className={`btn ${size}`} title={`Make ${planWords(plan)} again, one at a time: your words and model for each`} onClick={async () => {
        setError(null)
        try {
          await startFollow(deps, config, { steer: true })
        } catch (e) {
          setError(e instanceof Error ? e.message : 'That did not work.')
        }
      }}>
        Update what follows ({n})
      </button>
      {error && <span role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12 }}>{error}</span>}
    </span>
  )
}
