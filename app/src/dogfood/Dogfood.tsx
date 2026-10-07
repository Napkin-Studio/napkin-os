// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What a person sees of the dogfood build (features/dogfood-telemetry.clan):
// - once per account, a notice that everything here is recorded, which they
//   acknowledge before anything is;
// - a "Beta" badge in the OS bar that shows the notice again;
// - thumbs up or down, with an optional note, for the screen (beside the
//   badge) and for each of an agent's results (in the decision history).
// Nothing renders when the build does not record.

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CONTACT, acknowledge, currentScreen, dogfoodState, feedback, feedbackNote, loadDogfood, subscribe } from './recorder'
import './Dogfood.css'

function useDogfood() {
  return useSyncExternalStore(subscribe, dogfoodState, dogfoodState)
}

/** The notice: to acknowledge (`onAgree`), or to read again (`onClose`). */
export function DogfoodNotice({ onAgree, onClose }: { onAgree?: () => void; onClose?: () => void }) {
  return (
    <div className="df-veil" role="dialog" aria-modal="true" aria-labelledby="df-h">
      <div className="df-card">
        <span className="df-badge df-badge-static">Beta</span>
        <h2 id="df-h">This build records everything you do</h2>
        <p>You are using a beta of Napkin Studio, made so we can learn from how it is used.</p>
        <p>Questions, or want your data removed? Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        <div className="df-actions">
          {onAgree && <button className="ch-btn ch-btn-primary" onClick={onAgree} autoFocus>I understand</button>}
          {onClose && <button className="ch-btn" onClick={onClose} autoFocus>Close</button>}
        </div>
      </div>
    </div>
  )
}

/**
 * Around the studio: asks the server whether this build records and, if this
 * person has not acknowledged it yet, shows the notice first.
 */
export function DogfoodGate({ children }: { children: ReactNode }) {
  const state = useDogfood()
  const [busy, setBusy] = useState(false)
  useEffect(() => { loadDogfood() }, [])
  const agree = async () => {
    setBusy(true)
    await acknowledge()
    setBusy(false)
  }
  return (
    <>
      {children}
      {state.on && !state.consented && <DogfoodNotice onAgree={busy ? undefined : agree} />}
    </>
  )
}

/** Thumbs up or down, recorded when chosen; then an optional note, sent as feedback on `on`. */
export function Thumbs({ on, extra, compact = false }: { on: string; extra?: Record<string, unknown>; compact?: boolean }) {
  const [thumb, setThumb] = useState<'up' | 'down' | null>(null)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  if (sent) return <span className="df-thanks">Thanks</span>
  const choose = (t: 'up' | 'down') => { if (t !== thumb) { setThumb(t); feedback(on, t, extra) } }
  const send = () => { if (thumb) { feedbackNote(on, thumb, note, extra); setSent(true) } }
  return (
    <span className={compact ? 'df-thumbs df-thumbs-compact' : 'df-thumbs'}>
      <button className="df-thumb" data-dogfood="thumb up" aria-pressed={thumb === 'up'} title="This works for me" onClick={() => choose('up')}>👍</button>
      <button className="df-thumb" data-dogfood="thumb down" aria-pressed={thumb === 'down'} title="This does not work for me" onClick={() => choose('down')}>👎</button>
      {thumb && (
        <span className="df-note">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Anything to add? (optional)"
            onKeyDown={e => { if (e.key === 'Enter') send() }} autoFocus aria-label="Note" />
          <button className="ch-btn" data-dogfood="send feedback note" onClick={send}>Send</button>
        </span>
      )}
    </span>
  )
}

/** In the OS bar: the Beta badge, and thumbs for this screen. Nothing when not recording. */
export function DogfoodBadge() {
  const state = useDogfood()
  const [open, setOpen] = useState(false)
  if (!state.on) return null
  const where = currentScreen()
  return (
    <span className="df-bar">
      <button className="df-badge" data-dogfood="beta notice" onClick={() => setOpen(true)} title="This build records what you do. Click to read more.">Beta</button>
      {state.consented && <Thumbs key={`${where.screen}:${where.doc ?? ''}`} on="screen" extra={{ ...where }} compact />}
      {open && <DogfoodNotice onClose={() => setOpen(false)} />}
    </span>
  )
}

/** Under an agent's result: thumbs for that result. Nothing when not recording. */
export function ResultThumbs({ extra }: { extra: Record<string, unknown> }) {
  const state = useDogfood()
  if (!state.on || !state.consented) return null
  return <Thumbs on="agent result" extra={extra} compact />
}
