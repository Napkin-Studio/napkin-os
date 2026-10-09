// The model menu (features/model-choice.clan, look: features/production-tool-look.clan):
// which model makes the next version. A chip that opens a floating list: each model
// with its provider, note and price. It appears only where a version is made again;
// a first draw runs the routed default. The relay checks every pick, and falls back
// to config.fallbackOnly when the picked provider cannot take the job.

import { useCallback, useRef, useState } from 'react'
import { useConfig } from '../app/context'
import { modelChoicesFor, type ModelOption } from '../capabilities'
import type { ModelChoice, Op } from '../contracts/types'
import { Float } from './Float'
import { price } from './modelChoice'

const keyOf = (c: ModelChoice) => `${c.provider}:${c.model}`

/** A provider's small square mark: the first letter on its colour. */
export function ProviderMark({ provider }: { provider: string }) {
  return <span className={`pmark pmark-${provider}`} aria-hidden="true">{provider.slice(0, 1).toUpperCase()}</span>
}

/** The models as menu items: name and mark, provider and note, price. */
export function ModelItems({ options, current, tagOther, onPick }: {
  options: ModelOption[]
  current?: ModelChoice
  /** Marks the models from another provider than this one (a failed job's). */
  tagOther?: string
  onPick: (o: ModelOption) => void
}) {
  return options.map((o) => {
    const on = !!current && keyOf(o) === keyOf(current)
    return (
      <button key={keyOf(o)} type="button" role="menuitem" className={`fmi mmi ${on ? 'on' : ''}`} aria-current={on || undefined} onClick={() => onPick(o)}>
        <ProviderMark provider={o.provider} />
        <span className="fmi-text">
          <b>{o.label}{tagOther && o.provider !== tagOther && <span className="mmi-tag">another provider</span>}</b>
          <small>{o.provider}{o.note ? ` · ${o.note}` : ''}</small>
        </span>
        <span className="fmi-hint">{on ? '✓ ' : ''}{price(o.estimateUsd)}</span>
      </button>
    )
  })
}

export function ModelPick({ op, value, onChange }: { op: Op; value?: ModelChoice; onChange: (c: ModelChoice) => void }) {
  const { config } = useConfig()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const options = modelChoicesFor(op, config)
  if (options.length < 2) return null
  const chosen = options.find((o) => value && keyOf(o) === keyOf(value)) ?? options[0]
  return (
    <span className="modelpick" onClick={(e) => e.stopPropagation()}>
      <button ref={ref} type="button" className={`modelchip ${open ? 'open' : ''}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Model for the next version: ${chosen.label} (${chosen.provider})`} title={chosen.note} onClick={() => setOpen(!open)}>
        <ProviderMark provider={chosen.provider} />
        {chosen.label}
        <span className="caret" aria-hidden="true">▾</span>
      </button>
      <span className="faint modelprice">{price(chosen.estimateUsd)}</span>
      <Float anchor={ref} open={open} onClose={close} label="Model for the next version" className="modelmenu">
        <div className="fhead">Make the next version with</div>
        <ModelItems options={options} current={chosen} onPick={(o) => { onChange({ provider: o.provider, model: o.model }); close() }} />
      </Float>
    </span>
  )
}
