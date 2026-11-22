// The rights of a picture on the canvas (features/prod-assets-route.clan, features/pt-final-and-fit.clan): a small chip at
// the picture's bottom-left that says them ("Generated", "Own", "Licensed"), or "Rights?" while they are not known (an
// upload nobody has spoken for: the Deck then marks it "Rights to supply"). Its menu changes them. Nothing is shown for a
// picture that has no rights (a mock, an edit): readers infer from origin.

import { useRef, useState } from 'react'
import { useDoc, useServices } from '../../app/context'
import type { AssetRights } from '../../contracts/types'
import { RIGHTS_CHOICES, rightsWord } from '../../doc/finals'
import { updateDoc } from '../../doc/store'
import type { Pt } from '../../canvas/core/canvasAdapter'
import { chipLook } from './chipLook'
import { Float } from '../Float'
import './finals.css'

/** `at`: the picture's bottom-left corner on screen. */
export function RightsChip({ sha, at, zoom = 1 }: { sha: string; at: Pt; zoom?: number }) {
  const doc = useDoc()
  const { doc: store } = useServices()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const rights = doc.assets[sha]?.rights
  const word = rightsWord(rights)
  if (!rights || !word) return null
  const look = chipLook(zoom)
  const choose = (next: AssetRights) => {
    setOpen(false)
    if (next !== rights) void updateDoc(store, (d) => { const a = d.assets[sha]; if (a) a.rights = next }, `rights ${next} ${sha}`)
  }
  return (
    <>
      <button ref={btn} type="button" className={`rights-chip ${rights}${look.dot ? ' dot' : ''}`} aria-label={word}
        style={{ left: at.x, top: at.y, ...(look.dot ? {} : { transform: `translate(6px, calc(-100% - 6px)) scale(${look.scale})` }) }} aria-haspopup="menu" aria-expanded={open}
        title="May a client see this picture? The Deck Maker reads it." onClick={() => setOpen((o) => !o)}>{look.dot ? '' : word}</button>
      <Float anchor={btn} open={open} onClose={() => setOpen(false)} label="Rights of this picture" className="rights-menu">
        {RIGHTS_CHOICES.map((c) => (
          <button key={c.rights} type="button" role="menuitem" className="pt-menurow" onClick={() => choose(c.rights)}>
            {c.label}<span className="hint">{c.hint}</span>
          </button>
        ))}
      </Float>
    </>
  )
}
