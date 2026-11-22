// The Final toggle (features/prod-assets-route.clan): marks the picture shown as finished work, which the
// Deck Maker reads from the project (finals). One click, one undo step; a size or a picture keeps one final.

import { useDoc, useServices, useUi } from '../../app/context'
import type { Final, Sha256 } from '../../contracts/types'
import { finalsOf, isFinal, setFinal, type FinalOf } from '../../doc/finals'
import { updateDoc } from '../../doc/store'
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
  if (!asset) return null
  const on = isFinal(doc, of, asset, also)
  const earlier = !on && of.kind !== 'frame' && finalsOf(doc, of).length > 0
  const by = ui.me ? `human:${ui.me.participantId}` : 'human:p_local'
  const title = on ? 'Final: the Deck Maker takes this picture. Click to unmark it.'
    : earlier ? 'An earlier picture of this is final. Click to make this one final instead.'
    : 'Mark this picture final: the Deck Maker takes final pictures.'
  return (
    <button type="button" className={`${className} final-toggle ${on ? 'on' : ''}`} aria-pressed={on} title={title}
      onClick={() => void updateDoc(store, (d) => setFinal(d, of, asset, !on, by, extra, undefined, also), `${on ? 'unmark' : 'mark'} final ${of.kind} ${of.id}`)}>
      {on ? 'Final ✓' : 'Final'}
    </button>
  )
}
