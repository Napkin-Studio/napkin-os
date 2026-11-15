// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The three first-day pointers (features/first-day.clan): one at a time, each beside the real thing on the desk. No veil,
// no focus trap, no right-hand panel: a small card on the page that the page keeps working under. Next moves on, Got it
// and Esc end them; the end is the server's mark, per person, so they never come back on any device.

import { useCallback, useEffect, useRef, useState } from 'react'
import { placement, pointerKey, stepsFrom, type Box, type Step } from './anchors'
import { BUTTONS } from './words'
import { useFirstDay } from './useFirstDay'
import './firstday.css'

interface CardProps {
  step: Step
  at: number
  count: number
  still: boolean
  /** Where it stands; null until the page has said where its anchor is (hidden, not shown in the wrong place). */
  spot: { top: number; left: number } | null
  cardRef?: React.Ref<HTMLDivElement>
  onNext: () => void
  onGotIt: () => void
}

/** One pointer: named for feedback by pointing, a dialog that does not claim the page. */
export function PointerCard({ step, at, count, still, spot, cardRef, onNext, onGotIt }: CardProps) {
  const last = at >= count - 1
  return (
    <div className="fd-pointer nui" role="dialog" aria-labelledby={`fd-words-${step.id}`} data-testid="pointer" data-anchor={step.id}
      ref={cardRef} data-still={String(still)} data-feedback-label={`First day pointer: ${step.name}`}
      style={spot ? { top: spot.top, left: spot.left } : { top: 0, left: 0, visibility: 'hidden' }}>
      <p className="fd-words" id={`fd-words-${step.id}`}>{step.words}</p>
      <div className="fd-foot">
        <small className="fd-count">{at + 1} of {count}</small>
        <span className="fd-btns">
          {!last && <button type="button" className="btn-rect fd-btn" data-dogfood="first day pointer next" onClick={onNext}>{BUTTONS.next}</button>}
          <button type="button" className={`btn-rect fd-btn${last ? ' primary' : ''}`} data-dogfood="first day pointer got it" onClick={onGotIt}>{BUTTONS.gotIt}</button>
        </span>
      </div>
    </div>
  )
}

const box = (r: DOMRect): Box => ({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right })

/** The consent question, wherever it stands: no pointer is placed over it. */
const CLEAR = '[data-testid="timesheet-ask"]'

function reduced(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** Mounted beside the desk: shows the pointers to an invited person who has not seen them, and to no one else. */
export function Pointers({ enabled }: { enabled: boolean }) {
  const { show, end } = useFirstDay(enabled)
  const [steps, setSteps] = useState<Step[]>([])
  const [at, setAt] = useState(0)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const still = reduced()

  // The anchors that are on the page now; the desk loads in pieces, so look again as it changes.
  useEffect(() => {
    if (!show) return
    const look = () => setSteps(prev => {
      const next = stepsFrom(sel => !!document.querySelector(sel))
      return prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.anchor === next[i].anchor) ? prev : next
    })
    look()
    const obs = new MutationObserver(look)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [show])

  const step = steps[Math.min(at, Math.max(0, steps.length - 1))]
  const place = useCallback(() => {
    if (!step) { setSpot(null); return }
    const el = document.querySelector(step.anchor)
    const c = card.current
    if (!el) { setSpot(null); return }
    el.scrollIntoView?.({ block: 'nearest' })
    const avoid = Array.from(document.querySelectorAll(CLEAR)).map(n => box(n.getBoundingClientRect()))
    setSpot(placement(box(el.getBoundingClientRect()), { width: c?.offsetWidth ?? 300, height: c?.offsetHeight ?? 120 },
      { width: window.innerWidth, height: window.innerHeight }, avoid))
  }, [step])
  useEffect(() => {
    // placed a frame after it renders, so the card's own size is known; and again when the page moves
    const frame = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [place, steps.length, show])

  // Esc ends them all; nothing else is taken, and focus is never held.
  useEffect(() => {
    if (!show) return
    const onKey = (e: KeyboardEvent) => { if (pointerKey(e.key) === 'end') end() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, end])

  if (!show || !step) return null
  return (
    <PointerCard step={step} at={Math.min(at, steps.length - 1)} count={steps.length} still={still} spot={spot} cardRef={card}
      onNext={() => setAt(i => Math.min(i + 1, steps.length - 1))} onGotIt={end} />
  )
}
