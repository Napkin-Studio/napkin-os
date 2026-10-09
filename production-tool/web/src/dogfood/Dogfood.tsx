// What a participant sees of the beta's record (features/production-tool-dogfood.clan), after
// Napkin OS's dogfood build (app/src/dogfood/Dogfood.tsx):
// - once, after sign-in, a notice that this beta logs what they do, acknowledged before anything is;
// - a "Beta" tag after "Production" in the top bar (and on Home) that shows the notice again;
// - 👍 / 👎 with an optional note on the screen and on everything the tool makes, and on errors.
// Nothing renders when the build does not record.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Relay } from '../relay'
import type { Shell } from '../projects/shell'
import { CONTACT, configureDogfood, dogfoodState, feedback, feedbackNote, subscribe, type Target } from './recorder'
import './Dogfood.css'

function useDogfood() {
  return useSyncExternalStore(subscribe, dogfoodState, dogfoodState)
}

/** The notice: to acknowledge (`onAgree`), or to read again (`onClose`). */
export function DogfoodNotice({ onAgree, onClose, busy = false }: { onAgree?: () => void; onClose?: () => void; busy?: boolean }) {
  return (
    <div className="df-veil" role="dialog" aria-modal="true" aria-labelledby="df-h">
      <div className="df-card">
        <span className="df-badge df-badge-static">Beta</span>
        <h2 id="df-h">This beta logs what you do</h2>
        <p>We record what you click, what you ask for and what comes back, so we can make the tool better. Use 👍 and 👎 on anything it makes to tell us if it's right.</p>
        <p>Questions, or want your data removed? Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        <div className="df-actions">
          {onAgree && <button className="btn sm primary" data-dogfood="beta notice: I understand" onClick={onAgree} disabled={busy} autoFocus>I understand</button>}
          {onClose && <button className="btn sm" data-dogfood="beta notice: close" onClick={onClose} autoFocus>Close</button>}
        </div>
      </div>
    </div>
  )
}

/**
 * Beside the signed-in app: tells the recorder whether this build records (config flags.dogfood,
 * on the real relay) and whether this participant has agreed (the session says), and shows the
 * notice until they have.
 */
export function DogfoodGate({ shell }: { shell: Shell }) {
  const { relay, app } = shell.deps
  const ui = useSyncExternalStore(app.subscribe, app.get)
  const session = ui.session
  const on = isOn(relay, shell.deps.remoteConfig?.flags?.dogfood) && !!session
  const consented = !!session?.dogfood?.consented
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    configureDogfood({ on, consented }, (events, leaving) => relay.dogfoodEvents?.(events, leaving))
  }, [on, consented, relay])
  if (!on || consented) return null
  const agree = async () => {
    setBusy(true)
    try {
      await relay.dogfoodConsent?.()
      app.update((u) => { if (u.session) u.session.dogfood = { consented: true } })
    } catch { /* the notice stays; nothing is recorded */ } finally {
      setBusy(false)
    }
  }
  return <DogfoodNotice onAgree={agree} busy={busy} />
}

function isOn(relay: Relay, flag: boolean | undefined): boolean {
  return relay.kind === 'http' && flag === true && typeof relay.dogfoodEvents === 'function'
}

/** 👍 / 👎, recorded when chosen; then an optional note, sent on Send. */
export function Thumbs({ target, compact = false, labels }: { target: Target; compact?: boolean; labels?: { up: string; down: string } }) {
  const state = useDogfood()
  const [thumb, setThumb] = useState<'up' | 'down' | null>(null)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  if (!state.on || !state.consented) return null
  if (sent) return <span className="df-thanks">Thanks</span>
  const choose = (t: 'up' | 'down') => { if (t !== thumb) { setThumb(t); feedback(target, t) } }
  const send = () => { if (thumb) { feedbackNote(target, thumb, note); setSent(true) } }
  const up = labels?.up ?? 'This is right'
  const down = labels?.down ?? 'This is wrong'
  return (
    <span className={compact ? 'df-thumbs df-thumbs-compact' : 'df-thumbs'} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="df-thumb" data-dogfood={`thumb up: ${target.kind}`} aria-pressed={thumb === 'up'} title={up} aria-label={up} onClick={() => choose('up')}>👍</button>
      <button type="button" className="df-thumb" data-dogfood={`thumb down: ${target.kind}`} aria-pressed={thumb === 'down'} title={down} aria-label={down} onClick={() => choose('down')}>👎</button>
      {thumb && (
        <span className="df-note">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={thumb === 'up' ? 'What is right? (optional)' : 'What is wrong? (optional)'}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') send() }} autoFocus aria-label="Note" data-dogfood="feedback note" />
          <button type="button" className="btn xs" data-dogfood="send feedback note" onClick={send}>Send</button>
        </span>
      )}
    </span>
  )
}

/** In the top bar and on Home: the Beta tag, and thumbs for this screen. */
export function BetaTag({ screen }: { screen: { stage: string; project?: string | null } }) {
  const state = useDogfood()
  const [open, setOpen] = useState(false)
  if (!state.on) return null
  return (
    <span className="df-bar">
      <button type="button" className="df-badge" data-dogfood="beta tag" onClick={() => setOpen(true)} title="This beta logs what you do. Click to read more.">Beta</button>
      {state.consented && <Thumbs key={`${screen.stage}:${screen.project ?? ''}`} target={{ kind: 'screen', id: screen.stage, project: screen.project ?? null }} compact />}
      {/* On the page itself: the bar's backdrop-filter would hold a fixed veil inside the bar. */}
      {open && createPortal(<DogfoodNotice onClose={() => setOpen(false)} />, document.body)}
    </span>
  )
}
