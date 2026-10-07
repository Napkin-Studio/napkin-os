// "Update what follows (N)": an inline confirm that lists the work and its cost,
// then the run's progress with Stop. The run itself is jobs/follow.ts.

import { useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { cancelFollow, followState, planFollow, planSize, planSummary, startFollow } from '../jobs/follow'
import { InlineConfirm } from './Undo'

/** `progress`: show the run's progress and Stop here (the top bar does; the buttons on items do not). */
export function UpdateFollows({ size = 'sm', progress = true }: { size?: 'xs' | 'sm'; progress?: boolean }) {
  const services = useServices()
  const { doc: docStore, ui: uiStore, runner, relay } = services
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  useJobsTick()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const run = ui.following
  const state = followState(doc, (id) => ui.jobCtx[id], run)

  if (run && state) {
    if (!progress) return null
    return (
      <span className="follow row" role="status" onClick={(e) => e.stopPropagation()}>
        <span className="faint" style={{ fontSize: 12 }}>
          {run.cancel ? 'Stopping after this one…' : state.failed ? 'Updating what follows: a step failed. Retry it, or stop.' : `Updating what follows… step ${Math.max(1, state.done)}`}
        </span>
        {!run.cancel && <button className={`btn ${size} ghost`} onClick={() => void cancelFollow(deps)}>Stop</button>}
      </span>
    )
  }

  const plan = planFollow(doc)
  const n = planSize(plan)
  if (!n) return null
  if (asking) {
    return (
      <span className="follow" onClick={(e) => e.stopPropagation()}>
        <InlineConfirm text={`Update what follows? ${planSummary(plan, config)}`} yes="Update" no="Not now" tone="primary"
          onNo={() => setAsking(false)}
          onYes={async () => {
            setAsking(false)
            setError(null)
            try {
              await startFollow(deps)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'That did not work.')
            }
          }}>
          <div className="faint" style={{ fontSize: 11.5 }}>In order: frames one by one, then their clips, then the ad. Earlier versions are kept.</div>
        </InlineConfirm>
      </span>
    )
  }
  return (
    <span className="follow row" onClick={(e) => e.stopPropagation()}>
      <button className={`btn ${size}`} title="Make the out-of-date frames, clips and ad again from what is there now" onClick={() => setAsking(true)}>
        Update what follows ({n})
      </button>
      {error && <span role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 12 }}>{error}</span>}
    </span>
  )
}
