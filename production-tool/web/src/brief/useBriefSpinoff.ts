// The brief → Production spin-off on arrival (features/brief-node.clan): a page opened as
// /production/…?brief=<doc id>, on our own engine, starts from that brief once:
// the Brief node (how: spinoff), a new Script beside it, the link. The parameter leaves the URL so a
// reload does not start again. No UI of its own: the Start card's "Start from a brief" is the card's.

import { useEffect } from 'react'
import type { NodeEnv } from '../canvas/nodes/nodes'
import { pageBriefSource, type BriefSource } from './os'
import { briefSpinoffOf, startFromBriefId, withoutBriefSpinoff } from './start'
import { fitClear } from '../canvas/boards/boards'
import { cardOf } from '../canvas/nodes/nodes'
import { briefOfElement } from './canvas'

let taken = false
/** The brief the page arrived with, held at boot (main.tsx) before the router rewrites the URL to a project's
 *  (live test 2026-11-18: ?brief= was gone by the time the canvas mounted, and the last project opened). */
let held: string | null = null
export function holdBriefSpinoff(id: string | null): void {
  held = id
}

export function useBriefSpinoff(env: NodeEnv | null, src: BriefSource = pageBriefSource()): void {
  useEffect(() => {
    if (taken || !env || typeof window === 'undefined') return
    const id = held ?? briefSpinoffOf(window.location.search)
    if (!id) return
    taken = true
    held = null
    if (briefSpinoffOf(window.location.search)) window.history.replaceState(window.history.state, '', window.location.pathname + withoutBriefSpinoff(window.location.search) + window.location.hash)
    startFromBriefId(env, src, id, 'spinoff').then((out) => {
      // In view clear of the tool rail, nothing selected, as the start card lays a film out (re-test 2b: at
      // 1116 px the Brief landed half under the rail).
      const ids = new Set([out.briefId, out.scriptId])
      const els = env.canvas.elements().filter((e) => !e.isDeleted && ids.has(cardOf(e)?.id ?? briefOfElement(e) ?? ''))
      env.canvas.select([])
      if (els.length) fitClear(env.canvas, els, { zoomFactor: 0.8 })
    }).catch((e) => console.warn('the brief could not be brought in', e))
  }, [env, src])
}
