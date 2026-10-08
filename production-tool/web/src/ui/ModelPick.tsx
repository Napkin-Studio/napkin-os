// The regenerate menu (features/model-choice.clan): which model makes the next version.
// It appears only where a version is made again; a first draw runs the routed default.
// The relay checks every pick, and falls back to config.fallbackOnly when the picked
// provider cannot take the job.

import { useConfig } from '../app/context'
import { modelChoicesFor } from '../capabilities'
import type { ModelChoice, Op } from '../contracts/types'
import { price } from './modelChoice'

const keyOf = (c: ModelChoice) => `${c.provider}:${c.model}`

export function ModelPick({ op, value, onChange }: { op: Op; value?: ModelChoice; onChange: (c: ModelChoice) => void }) {
  const { config } = useConfig()
  const options = modelChoicesFor(op, config)
  if (options.length < 2) return null
  const chosen = options.find((o) => value && keyOf(o) === keyOf(value)) ?? options[0]
  return (
    <label className="modelpick" title={chosen.note} onClick={(e) => e.stopPropagation()}>
      <span className="faint">Model</span>
      <select className="select" aria-label="Model for the next version" value={keyOf(chosen)}
        onChange={(e) => {
          const o = options.find((x) => keyOf(x) === e.target.value)
          if (o) onChange({ provider: o.provider, model: o.model })
        }}>
        {options.map((o) => <option key={keyOf(o)} value={keyOf(o)}>{o.label} · {o.provider} · {price(o.estimateUsd)}</option>)}
      </select>
      {chosen.note && <span className="faint modelnote">{chosen.note}</span>}
    </label>
  )
}
