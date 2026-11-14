// Quality beside the Model menu (features/clip-quality.clan): Draft, Standard or Final for the next clip
// or clip edit. Each says the size it makes on the picked model; a level the model cannot make is greyed
// with why (a model that keeps the clip's size greys all three). Never a price (features/runway-sheet-sync.clan).

import { useConfig } from '../app/context'
import { QUALITY_NAMES, qualityOptions } from '../capabilities'
import type { ClipQuality, ModelChoice, Op } from '../contracts/types'

export function QualityPick({ op, choice, value, onChange }: {
  op: Extract<Op, 'clip' | 'clip_edit'>
  /** The model picked beside it (absent: the routed first model). */
  choice?: ModelChoice
  value: ClipQuality
  onChange: (q: ClipQuality) => void
}) {
  const { config } = useConfig()
  const options = qualityOptions(op, choice, config)
  // What will run: the asked level when the model makes it, else the nearest it has.
  const on = options.filter((o) => o.on)
  const shown = on.find((o) => o.level === value) ?? nearest(on, value)
  return (
    <span className="pt-seg qualitypick" role="radiogroup" aria-label="Quality" onClick={(e) => e.stopPropagation()}>
      {options.map((o) => (
        <button key={o.level} type="button" role="radio" aria-checked={shown?.level === o.level} aria-pressed={shown?.level === o.level}
          disabled={!o.on} title={o.on ? `${QUALITY_NAMES[o.level]}: ${o.size}` : o.why}
          onClick={() => onChange(o.level)}>
          {QUALITY_NAMES[o.level]}
        </button>
      ))}
    </span>
  )
}

const ORDER: ClipQuality[] = ['draft', 'standard', 'final']

function nearest<T extends { level: ClipQuality }>(on: T[], want: ClipQuality): T | undefined {
  const i = ORDER.indexOf(want)
  return [...on].sort((a, b) => Math.abs(ORDER.indexOf(a.level) - i) - Math.abs(ORDER.indexOf(b.level) - i) || ORDER.indexOf(a.level) - ORDER.indexOf(b.level))[0]
}
