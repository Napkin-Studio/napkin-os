// The brief → Production spin-off on arrival (features/brief-node.clan): a page opened as
// /production/…?brief=<doc id>, on our own engine, brings that brief in once: its Brief node (how: spinoff)
// alone, in view, nothing selected; no Script, nothing asked (owner 2026-11-18). The parameter leaves the URL
// so a reload does not bring it again. No UI of its own.

import { useEffect } from 'react'
import type { NodeEnv } from '../canvas/nodes/nodes'
import { pageBriefSource, type BriefSource } from './os'
import { briefSpinoffOf, bringBriefId, withoutBriefSpinoff } from './start'
import { fitClear } from '../canvas/boards/boards'

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
    bringBriefId(env, src, id).then(({ el }) => {
      // In view clear of the tool rail, at most 100% (re-test 2b: at 1116 px the Brief landed half under the rail).
      env.canvas.select([])
      fitClear(env.canvas, [el], { zoomFactor: 0.8 })
    }).catch((e) => console.warn('the brief could not be brought in', e))
  }, [env, src])
}
