// The method rows of a size's Change method menu (CampaignLayer's tile, SizesOverview's float). A method that cannot run
// from this master at this shape is not offered: it is greyed with the reason under it (features/pt-final-and-fit.clan,
// owner-approved mock), and when none can hold the protected product the menu says so plainly under the rows.

import type { FormatSet, Size, SizeMethod } from '../contracts/types'
import { fitOfSize, methodOffered, methodWhy } from './fit'
import { METHOD_WORD, PAID, STILL_METHODS, type MethodModel } from './rules'

export function MethodMenu({ set, size, models, onPick }: { set: FormatSet; size: Size; models: Partial<Record<SizeMethod, MethodModel>>; onPick: (m: SizeMethod) => void }) {
  const fit = fitOfSize(set, size, new Set<SizeMethod>(['crop', 'layout', ...(Object.keys(models) as SizeMethod[])]))
  return (
    <>
      {STILL_METHODS.map((m) => {
        const noModel = PAID.has(m) && !models[m]
        const why = fit ? methodWhy(fit, m) : undefined
        const unfit = !!fit && !methodOffered(fit, m)
        const off = size.media !== 'image' || noModel || unfit
        return (
          <button key={m} type="button" role="menuitemradio" aria-checked={size.method === m} className={`pt-menurow${unfit ? ' unfit' : ''}`} disabled={off || size.method === m}
            title={noModel ? 'Off for your agency' : why} onClick={() => onPick(m)}>
            <span className="cb-mrow"><b>{METHOD_WORD[m]}</b><span className="hint">{PAID.has(m) ? models[m]?.label ?? 'off' : 'in seconds'}</span>{size.method === m && ' ✓'}</span>
            {unfit && why && <small className="cb-why">{why}</small>}
          </button>
        )
      })}
      {fit?.product === 'wont' && fit.say && (
        <div className="cb-wont" role="note">
          <b>{fit.say.split('. ')[0]}</b>
          <p>{fit.say.slice(fit.say.indexOf('. ') + 2)}</p>
        </div>
      )}
    </>
  )
}
