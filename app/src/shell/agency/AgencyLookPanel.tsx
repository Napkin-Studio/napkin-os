// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency's logo upload (features/agency-look.clan): pick an SVG or a PNG,
// the browser reads its pixels, takes the strongest colour that is not black,
// white or grey, sets its lightness for each mode, saves it, and the shell
// repaints at once. A logo with no colour of its own saves with no accent.

import { useEffect, useState } from 'react'
import { MODES } from '../../theme'
import { contrast } from './palette'
import { MODE_SURFACES, MIN_CONTRAST } from './accent'
import { applyAgencyLook, getAgencyLook, lookFromFile, saveAgencyLook, type AgencyLook } from './look'
import '../../components/chrome.css'
import './look.css'

const NAME = { white: 'White', grey: 'Grey', black: 'Black' } as const

interface Props {
  onClose: () => void
  /** Told when a new look is saved, so the shell can keep it. */
  onSaved?: (look: AgencyLook) => void
}

export default function AgencyLookPanel({ onClose, onSaved }: Props) {
  const [look, setLook] = useState<AgencyLook | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  useEffect(() => { void getAgencyLook().then(setLook) }, [])
  // Escape closes it, and only it: the page's own Escape (up one level) waits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function save(next: AgencyLook, said: string) {
    setBusy(true)
    try {
      const saved = await saveAgencyLook(next)
      setLook(saved)
      applyAgencyLook(saved)
      onSaved?.(saved)
      setNote({ text: said })
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : 'Could not save the look.', bad: true })
    } finally {
      setBusy(false)
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return
    setNote(null)
    setBusy(true)
    let next: AgencyLook
    try {
      next = await lookFromFile(file)
    } catch (e) {
      setBusy(false)
      setNote({ text: e instanceof Error ? e.message : 'Could not read that file.', bad: true })
      return
    }
    await save(next, next.accent ? 'Saved. The accent is set from your logo.' : 'Saved. Your logo has no colour of its own, so there is no accent.')
  }

  return (
    <div className="ch-scrim" style={{ zIndex: 100 }} onClick={onClose}>
      <div className="ch-dialog al-dialog" role="dialog" aria-modal="true" aria-labelledby="al-title" data-testid="agency-look" onClick={e => e.stopPropagation()}>
        <div>
          <div className="eyebrow">Your agency</div>
          <h2 id="al-title" style={{ marginTop: 4 }}>Agency look</h2>
        </div>
        <p>
          Upload your logo as an SVG or a PNG. Napkin takes its strongest colour, leaving out black, white and grey, and
          uses it for focus, the selected item, where you are, and counts.
        </p>
        <div className="al-logo">
          {look?.logo
            ? <img src={look.logo} alt="Your agency logo" data-testid="look-logo" />
            : <span data-testid="look-logo-none">{look ? 'No logo yet.' : 'Reading the saved look.'}</span>}
        </div>
        <label className="ch-btn al-file">
          {look?.logo ? 'Replace logo' : 'Upload a logo'}
          <input type="file" accept=".svg,.png,image/svg+xml,image/png" data-testid="look-file" disabled={busy}
            onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {look?.logo && (
          look.accent ? (
            <ul className="al-modes" data-testid="look-accents">
              {MODES.map(m => {
                const c = look.accent![m]
                const worst = Math.min(...MODE_SURFACES[m].map(s => contrast(c, s)))
                return (
                  <li key={m} data-testid={`look-accent-${m}`} data-accent={c}>
                    <i className="al-chip" style={{ background: c }} aria-hidden />
                    <b>{NAME[m]}</b>
                    <span>{c.toUpperCase()}</span>
                    <small>{worst.toFixed(1)} to 1{worst >= MIN_CONTRAST ? '' : ', too low'}</small>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p data-testid="look-no-accent">No accent: the logo has only black, white and grey.</p>
          )
        )}
        <div role="status" aria-live="polite" className={note?.bad ? 'al-note al-bad' : 'al-note'} data-testid="look-note">{note?.text ?? ''}</div>
        <div className="ch-actions">
          {look?.logo && <button className="ch-btn ch-btn-quiet" disabled={busy} onClick={() => void save({}, 'Logo removed.')}>Remove logo</button>}
          <button className="ch-btn ch-btn-quiet" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
