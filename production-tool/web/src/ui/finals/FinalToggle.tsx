// The Final toggle (features/prod-assets-route.clan, features/pt-final-and-fit.clan): marks the picture shown as
// finished work, which the Deck Maker reads from the project (finals). Marking asks for its rights in a small menu
// (generated for a picture made here, unknown for an upload; one more click); un-marking is one click. Each is one
// undo step. A size or a picture keeps one final.

import { useRef, useState } from 'react'
import { useDoc, useServices, useUi } from '../../app/context'
import type { AssetRights, Final, Sha256 } from '../../contracts/types'
import { defaultRights, finalsOf, isFinal, markFinalWithRights, RIGHTS_CHOICES, setFinal, type FinalOf } from '../../doc/finals'
import { updateDoc } from '../../doc/store'
import { Float } from '../Float'
import './finals.css'

export function FinalToggle({ of, asset, extra, also, className = 'btn sm' }: {
  of: FinalOf
  /** The exact picture shown (a size: its delivery-size file when one was made, doc/finals sizeFinalAsset). */
  asset: Sha256 | undefined
  /** What the Deck reads beside it: a frame's version, a size's set, format and lane. */
  extra?: Pick<Final, 'version' | 'set_id' | 'format' | 'channel'>
  /** Other names for the same picture (a canvas picture's node, its frames): a final under any counts, and Unmark removes them all. */
  also?: FinalOf[]
  className?: string
}) {
  const doc = useDoc()
  const { doc: store } = useServices()
  const ui = useUi()
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<AssetRights>('unknown')
  if (!asset) return null
  const on = isFinal(doc, of, asset, also)
  const earlier = !on && of.kind !== 'frame' && finalsOf(doc, of).length > 0
  const by = ui.me ? `human:${ui.me.participantId}` : 'human:p_local'
  const a = doc.assets[asset]
  const upload = a?.origin === 'uploaded'
  const title = on ? 'Final: the Deck Maker takes this picture. Click to un-mark it.'
    : earlier ? 'An earlier picture of this is final. Click to make this one final instead.'
    : 'Mark this picture final: the Deck Maker takes final pictures.'
  const start = () => {
    if (on) {
      void updateDoc(store, (d) => setFinal(d, of, asset, false, by, extra, undefined, also), `unmark final ${of.kind} ${of.id}`)
      return
    }
    setChoice(defaultRights(a))
    setOpen((o) => !o)
  }
  const confirm = () => {
    setOpen(false)
    void updateDoc(store, (d) => markFinalWithRights(d, of, asset, choice, by, extra, also), `mark final ${of.kind} ${of.id}`)
  }
  return (
    <>
      <button ref={btn} type="button" className={`${className} final-toggle ${on ? 'on' : ''}`} aria-pressed={on} aria-haspopup={on ? undefined : 'dialog'} aria-expanded={on ? undefined : open} title={title} onClick={start}>
        {on ? 'Final ✓' : 'Final'}
      </button>
      <Float anchor={btn} open={open} onClose={() => setOpen(false)} role="dialog" label="Rights for this final" className="final-rights">
        <h3>{upload ? 'Mark this upload Final' : 'Mark this picture Final'}</h3>
        <p>
          {upload && (!a?.rights || a.rights === 'unknown') ? 'No one has said where this came from yet.' : 'The Deck uses the rights you state.'}
          {choice === 'generated' && !upload ? ' Generated is set because it was made here.' : ''}
        </p>
        {RIGHTS_CHOICES.map((c) => (
          <button key={c.rights} type="button" role="radio" aria-checked={choice === c.rights} className={`opt${choice === c.rights ? ' sel' : ''}`} onClick={() => setChoice(c.rights)}>
            <i aria-hidden="true" />
            <span><b>{c.label}</b><span>{c.hint}{c.rights === 'generated' && choice === 'generated' && !upload ? ' Shown to the client.' : ''}</span></span>
          </button>
        ))}
        <div className="row">
          <button type="button" className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="btn sm primary" onClick={confirm}>Mark Final</button>
        </div>
      </Float>
    </>
  )
}
