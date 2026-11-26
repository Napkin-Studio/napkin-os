// The Booth's open state (features/booth.clan, features/script-freeform.clan): the person's remembered one
// (AppUi.booth, keyed by who is signed in) and the window's width.

import { useCallback, useState, useSyncExternalStore } from 'react'
import { useServices, useUi } from '../../app/context'
import { boothCanHide, boothKey, rememberedOpen, shownOpen, startsOpen, type BoothPlace } from './state'

function subscribeResize(fn: () => void) {
  window.addEventListener('resize', fn)
  return () => window.removeEventListener('resize', fn)
}
/** The window's width, kept current. */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1600)
}


export interface BoothState {
  place: BoothPlace
  /** What it is set to (the person's, or a room's start). */
  open: boolean
  /** What shows: open, or it may not hide here. */
  shown: boolean
  canHide: boolean
  windowWidth: number
  /** Hide or show, as the person did it: remembered. */
  setOpen: (open: boolean) => void
  /** Bring it in for a moment's reason (an agent's question, a click on the page): not remembered. */
  bringIn: () => void
}

/** The Booth's open state here: the person's remembered one. */
export function useBooth(place: BoothPlace): BoothState {
  const { ui: uiStore } = useServices()
  const ui = useUi()
  const windowWidth = useWindowWidth()
  const key = boothKey(ui.me?.participantId)
  const remembered = rememberedOpen(ui.booth, key)
  const [start] = useState(() => startsOpen(place, typeof window === 'undefined' ? 1600 : window.innerWidth, remembered))
  const [local, setLocal] = useState<boolean | null>(start === remembered ? null : start)
  const open = local ?? remembered
  const canHide = boothCanHide(place, windowWidth)
  const setOpen = useCallback((v: boolean) => {
    setLocal(null)
    uiStore.update((u) => { u.booth = { ...u.booth, [key]: v ? 'shown' : 'hidden' } })
  }, [uiStore, key])
  const bringIn = useCallback(() => setLocal(true), [])
  return { place, open, shown: shownOpen(place, windowWidth, open), canHide, windowWidth, setOpen, bringIn }
}

