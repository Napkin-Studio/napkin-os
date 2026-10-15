// The ask dock (owner 2026-10-15; ui-behaviour 3.17): no job that waits on a person is ever invisible. Under
// the top bar of every screen (it rides with the job tray, which every bar has), it shows each waiting
// question that belongs on this screen and that no card shows in its place (the item a draft was for is
// gone, the card is not on screen, the screen has no place for it), and the one the tray's Show asked for
// when it is nowhere else. Answering here is answering anywhere: the same ask card.

import { useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { RouterContext, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import type { Route } from '../app/route'
import { ctxReader } from '../jobs/runner'
import { AskCard } from './AskCard'
import { claimDock, dockAsks, hereOf, isPlaced, isTopDock, summonAsk, summonedAsk, useAskPlaces, waitingAsks } from './askPlaces'

const NO_ROUTE: Route = { kind: 'none' }
const noop = () => () => {}

/** How long an ask must have no card before the dock shows it: a card mounting in its place comes first. */
const GRACE_MS = 250

export function AskDock() {
  const { runner } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const router = useContext(RouterContext)
  const route = useSyncExternalStore(router?.subscribe ?? noop, router?.get ?? (() => NO_ROUTE))
  useJobsTick()
  useAskPlaces()
  const [me] = useState(() => Symbol('dock'))
  useEffect(() => claimDock(me), [me])
  const here = hereOf(route, ui.stage)
  const called = summonedAsk()
  const list = dockAsks(waitingAsks(doc, (id) => runner.liveInfo(id)?.state), here, ctxReader(doc, ui), isPlaced, called)
  const ids = list.map((x) => x.ask.id).join(' ')
  const [ready, setReady] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setReady(ids), GRACE_MS)
    return () => clearTimeout(t)
  }, [ids])
  // A summoned ask that has been answered, or is shown in its place again, is let go.
  useEffect(() => {
    if (called && !waitingAsks(doc).some((x) => x.ask.id === called)) summonAsk(null)
  }, [called, doc])
  const shown = list.filter((x) => x.ask.id === called || ready.split(' ').includes(x.ask.id))
  if (!shown.length || !isTopDock(me) || typeof document === 'undefined') return null
  return createPortal(
    <div className="askdock" role="region" aria-label="Waiting for you">
      {shown.map(({ ask }) => <AskCard key={ask.id} ask={ask} docked />)}
    </div>,
    document.body,
  )
}
