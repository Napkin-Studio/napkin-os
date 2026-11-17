// The agency's look as React sees it: Root works it out once from who is signed in (ui/shell/agency.ts),
// puts its layer on the page and provides it; the medallion, the pill and every Deep O read it here.

import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { staticMarkSvg } from '@napkin/app/brand/deepOSvg'
import { DEEP_O_CSS } from '@napkin/app/brand/deepOSvg'
import type { MarkState } from '@napkin/app/brand/deepO'
import type { Me } from '../../contracts/types'
import { agencyIdFor, applyLook, lookOf } from './agency'
import { LookContext, useLook } from './lookContext'

// Read once at load, before the router rewrites the address (dev builds only; agencyIdFor ignores it otherwise).
const FIRST_SEARCH = typeof location === 'undefined' ? '' : location.search

export function LookProvider({ me, children }: { me: Me | undefined; children: ReactNode }) {
  const look = useMemo(() => lookOf(agencyIdFor(me, FIRST_SEARCH, import.meta.env.DEV)), [me])
  useLayoutEffect(() => { applyLook(look) }, [look])
  return <LookContext.Provider value={look}>{children}</LookContext.Provider>
}


let cssIn = false
function ensureCss() {
  if (cssIn || typeof document === 'undefined') return
  cssIn = true
  const s = document.createElement('style')
  s.id = 'pt-deep-o'
  s.textContent = DEEP_O_CSS
  document.head.appendChild(s)
}

let uid = 0
/** The Deep O mark (app/src/brand/deepOSvg.ts staticMarkSvg) in the agency's colours: the medallion, the
 *  job chip, the busy pointer's badge and every "working" sign of this tool. `progress` is steps done / steps;
 *  leave it out while working for the turning arc. */
export function DeepO({ size, state = 'awake', progress, label, className }: { size: number; state?: MarkState; progress?: number; label?: string; className?: string }) {
  const look = useLook()
  const id = useMemo(() => `pto${++uid}`, [])
  ensureCss()
  const svg = useMemo(() => staticMarkSvg({ size, state, progress, label, uid: id, palette: { base: look.colours.base, accent: look.colours.accent } }),
    [size, state, progress, label, id, look])
  return <span className={`pt-deepo ${className ?? ''}`} data-state={state} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}
