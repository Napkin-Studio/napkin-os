// The Booth (features/booth.clan, to its letter; features/script-freeform.clan): the agents' place on the
// right of every room of this tool. Skye in the Script editor, Dex in the Storyboard, Fin and Edie in the
// Make and Edit rooms. Their drafts, asks and notes wait here as cards; no chat.
//
// Its own column: hiding closes the column and slides the panel out to the right while the work recentres;
// opening flies it in. A 38px edge tab on the window's right edge brings it back, with a count dot in brand
// orange when something waits for the person. Nothing ever floats over the work: in the Storyboard and the
// rooms the hidden tab keeps a 44px gutter. Below 1100px the Script and Storyboard Booth stays a column.
// Reduced motion (the OS setting, or the account menu's) gets a short fade. Hidden or shown is remembered
// per person in this tool (AppUi.booth).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { useUi } from '../../app/context'
import { BOOTH_OPEN_EVENT } from '../askPlaces'
import { boothGutter, boothWidth, edgeLabel } from './state'
import type { BoothState } from './useBooth'
import './booth.css'

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const subscribe = useCallback((fn: () => void) => {
    if (typeof matchMedia !== 'function') return () => {}
    const m = matchMedia(query)
    m.addEventListener?.('change', fn)
    return () => m.removeEventListener?.('change', fn)
  }, [])
  return useSyncExternalStore(subscribe, () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false), () => false)
}

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'left' ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6l-3.5 3.5'} />
  </svg>
)

export type { BoothState } from './useBooth'

export function Booth({ state, scoped = false, count = 0, asks = 0, children, footer }: {
  state: BoothState
  /** A part or a selection is open (the Script editor): the wider Booth. */
  scoped?: boolean
  /** Things waiting for the person: the edge tab's count dot. */
  count?: number
  /** Questions waiting: a new one while hidden pings the dot, then brings the Booth in after about 1 s. */
  asks?: number
  children?: ReactNode
  /** Kept at the foot of the Booth's body. */
  footer?: ReactNode
}) {
  const ui = useUi()
  const { place, shown, canHide, windowWidth, setOpen, bringIn } = state
  const hidden = !shown
  const width = boothWidth(place, scoped, windowWidth)
  const still = useReducedMotion() || ui.motion === 'still'
  const colRef = useRef<HTMLDivElement>(null)
  const [instant, setInstant] = useState(true)
  const [ping, setPing] = useState(0)
  const [edgeTop, setEdgeTop] = useState(96)

  // No animation on the first paint or a resize: only the person's hide and show move.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)))
    return () => cancelAnimationFrame(id)
  }, [])

  // The tab sits ~96 px from the window's top, and never over a bar above the Booth's column.
  useLayoutEffect(() => {
    const at = () => {
      const top = colRef.current?.getBoundingClientRect().top ?? 0
      setEdgeTop(Math.max(96, Math.round(top)))
    }
    at()
    window.addEventListener('resize', at)
    return () => window.removeEventListener('resize', at)
  }, [hidden, windowWidth])

  // An agent asks while it is hidden: the dot pings, then the Booth comes in on the question (booth.clan).
  const lastAsks = useRef(asks)
  useEffect(() => {
    const before = lastAsks.current
    lastAsks.current = asks
    if (!hidden || asks <= before) return
    setPing((p) => p + 1)
    const t = setTimeout(bringIn, 1000)
    return () => clearTimeout(t)
  }, [asks, hidden, bringIn])

  // ] toggles, as in Brief Maker (no badge shows it); never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ']' || e.metaKey || e.ctrlKey || e.altKey || !canHide) return
      const t = e.target as Element | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return
      e.preventDefault()
      setOpen(hidden)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canHide, hidden, setOpen])

  // The tray's Show found its ask in a hidden Booth (ui/askPlaces focusAsk): come in.
  useEffect(() => {
    const on = () => { if (hidden) bringIn() }
    window.addEventListener(BOOTH_OPEN_EVENT, on)
    return () => window.removeEventListener(BOOTH_OPEN_EVENT, on)
  }, [hidden, bringIn])

  const style = { '--bw': `${width}px`, '--bgut': `${boothGutter(place)}px` } as CSSProperties
  const cls = ['booth-col', `booth-${place}`, place === 'room' ? 'flush' : '', hidden ? 'booth-off' : '', still ? 'booth-still' : '', instant ? 'booth-instant' : ''].filter(Boolean).join(' ')
  return (
    <div ref={colRef} className={cls} style={style} data-booth={place} data-booth-open={shown ? 'true' : 'false'}>
      <aside className="booth" aria-label="Booth" inert={hidden || undefined} aria-hidden={hidden || undefined}>
        <div className="booth-hd">
          <span className="booth-nm">Booth</span>
          <span className="booth-sp" />
          {canHide && (
            <button type="button" className="booth-hide" aria-label="Hide the Booth" aria-expanded={shown} onClick={() => setOpen(false)}>
              Hide<Chevron dir="right" />
            </button>
          )}
        </div>
        <div className="booth-body">
          {children}
          {footer}
        </div>
      </aside>
      {canHide && (
        <button type="button" className={`booth-edge ${hidden ? 'on' : ''} ${count ? 'has' : ''} ${ping ? `ping${ping % 2}` : ''}`}
          style={{ top: edgeTop }} aria-label={edgeLabel(count)} aria-expanded={shown} tabIndex={hidden ? 0 : -1} aria-hidden={!hidden || undefined}
          onClick={() => setOpen(true)}>
          <Chevron dir="left" />
          <span className="booth-lb">Booth</span>
          <span className="booth-ct" aria-hidden="true">{count || ''}</span>
        </button>
      )}
    </div>
  )
}
