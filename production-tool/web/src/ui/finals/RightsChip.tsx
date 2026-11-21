// "Rights?" on an uploaded picture (features/prod-assets-route.clan): asked once, never in the way. A small
// chip at the picture's top-left; its menu says whether a client may be shown it. Not sure hides the chip in
// this browser and leaves the rights unknown (the Deck Maker then asks for them before a client sees it).

import { useRef, useState } from 'react'
import { useDoc, useServices } from '../../app/context'
import type { AssetRights } from '../../contracts/types'
import { asksRights } from '../../doc/finals'
import { updateDoc } from '../../doc/store'
import type { Pt } from '../../canvas/core/canvasAdapter'
import { chipLook } from './chipLook'
import { Float } from '../Float'
import './finals.css'

const KEY = 'napkin.production.rightsNotSure'
const CHOICES: { rights: AssetRights; label: string; hint: string }[] = [
  { rights: 'own', label: 'Ours', hint: 'we made it or own it' },
  { rights: 'licensed', label: 'Licensed', hint: 'stock or bought for this' },
  { rights: 'generated', label: 'Made with AI', hint: 'generated for us' },
]

function notSure(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function keepNotSure(sha: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...notSure(), sha].slice(-500)))
  } catch {
    // private window: the chip comes back next time, nothing else changes
  }
}

export function RightsChip({ sha, at, zoom = 1 }: { sha: string; at: Pt; zoom?: number }) {
  const doc = useDoc()
  const { doc: store } = useServices()
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(() => notSure().has(sha))
  const btn = useRef<HTMLButtonElement>(null)
  if (hidden || !asksRights(doc.assets[sha])) return null
  const look = chipLook(zoom)
  const choose = (rights: AssetRights) => {
    setOpen(false)
    void updateDoc(store, (d) => { const a = d.assets[sha]; if (a) a.rights = rights }, `rights ${rights} ${sha}`)
  }
  return (
    <>
      <button ref={btn} type="button" className={`rights-chip${look.dot ? ' dot' : ''}`} aria-label="Rights?"
        style={{ left: at.x, top: at.y, ...(look.dot ? {} : { transform: `translate(6px, 6px) scale(${look.scale})` }) }} aria-haspopup="menu" aria-expanded={open}
        title="May a client see this picture? Say once: the Deck Maker reads it." onClick={() => setOpen((o) => !o)}>{look.dot ? '' : 'Rights?'}</button>
      <Float anchor={btn} open={open} onClose={() => setOpen(false)} label="Rights of this picture" className="rights-menu">
        {CHOICES.map((c) => (
          <button key={c.rights} type="button" role="menuitem" className="pt-menurow" onClick={() => choose(c.rights)}>
            {c.label}<span className="hint">{c.hint}</span>
          </button>
        ))}
        <button type="button" role="menuitem" className="pt-menurow" onClick={() => { setOpen(false); keepNotSure(sha); setHidden(true) }}>
          Not sure<span className="hint">ask me later</span>
        </button>
      </Float>
    </>
  )
}
