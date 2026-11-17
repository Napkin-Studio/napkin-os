// The brief → Production spin-off on arrival (features/brief-node.clan): a page opened as
// /production/…?brief=<doc id> with flags.briefNode on, on our own engine, starts from that brief once:
// the Brief node (how: spinoff), a new Script beside it, the link. The parameter leaves the URL so a
// reload does not start again. No UI of its own: the Start card's "Start from a brief" is the card's.

import { useEffect } from 'react'
import type { Flags } from '../contracts/types'
import type { NodeEnv } from '../canvas/nodes/nodes'
import { osBriefSource, type BriefSource } from './os'
import { briefSpinoffOf, startFromBriefId, withoutBriefSpinoff } from './start'

let taken = false
const OS = osBriefSource()

export function useBriefSpinoff(env: NodeEnv | null, flags: Pick<Flags, 'briefNode'> | undefined, src: BriefSource = OS): void {
  useEffect(() => {
    if (taken || !env || !flags?.briefNode || typeof window === 'undefined') return
    const id = briefSpinoffOf(window.location.search)
    if (!id) return
    taken = true
    window.history.replaceState(window.history.state, '', window.location.pathname + withoutBriefSpinoff(window.location.search) + window.location.hash)
    startFromBriefId(env, src, id, 'spinoff').catch((e) => console.warn('the brief could not be brought in', e))
  }, [env, flags?.briefNode, src])
}
