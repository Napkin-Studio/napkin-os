// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Looking after the client registry from the screen: adopt the free-text names
// the tools have always kept, rename a client, archive it and bring it back.
// Each piece is given its callbacks and fetches nothing; the host's own words
// are shown when it refuses (a name in use, a registry that cannot be written).

import { useState, type FormEvent } from 'react'
import type { ClientRecord, LegacyName } from '../../host'
import { plural } from './model'

/** The names the documents carry that no client has, each ticked, to turn into clients. */
export function AdoptPanel({ offer, onAdopt, onClose }: {
  offer: LegacyName[]
  onAdopt: (names: string[]) => Promise<{ words: string } | { error: string }>
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(offer.map(o => o.name)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const toggle = (name: string) => setChosen(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await onAdopt(offer.map(o => o.name).filter(n => chosen.has(n)))
    setBusy(false)
    if ('error' in r) setError(r.error)
    else setSaid(r.words)
  }
  if (said) {
    return (
      <div className="lc-add lc-adopt" data-testid="adopt-done">
        <p role="status">{said}</p>
        <div className="lc-add-row"><button className="ch-btn" onClick={onClose}>Done</button></div>
      </div>
    )
  }
  return (
    <form
      className="lc-add lc-adopt"
      aria-label="Adopt clients"
      data-testid="adopt-panel"
      onSubmit={e => { void submit(e) }}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
    >
      <fieldset className="lc-fields">
        <legend>Names the work already carries</legend>
        <p className="lc-hint">
          Brief, Research and Advertising documents name a client as plain text. Tick the ones that are clients of the
          studio: each becomes a client, and the documents that name it are linked to it. Nothing is changed for a name you leave unticked.
        </p>
        <ul className="lc-checks">
          {offer.map((o, i) => (
            <li key={o.name}>
              <label>
                {/* focus lands in the panel, so Escape closes it and a screen reader is told where it is */}
                <input autoFocus={i === 0} type="checkbox" checked={chosen.has(o.name)} onChange={() => toggle(o.name)} />
                <span className="lc-ck-name">{o.name}</span>
                <span className="lc-ck-n">{plural(o.documents, 'document')}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="lc-add-row">
        <button className="ch-btn ch-btn-primary" type="submit" disabled={busy || chosen.size === 0}>
          {busy ? 'Adopting…' : `Adopt ${plural(chosen.size, 'name')}`}
        </button>
        <button className="ch-btn ch-btn-quiet" type="button" onClick={onClose}>Cancel</button>
      </div>
      {error && <p className="lc-error" role="alert">{error}</p>}
    </form>
  )
}

/** Archived clients, each with Restore. Their work was kept, and comes back with them. */
export function ArchivedList({ archived, onRestore }: {
  archived: ClientRecord[]
  onRestore: (id: string) => Promise<string | null>
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  if (archived.length === 0) return null
  const restore = async (id: string) => {
    setBusy(id)
    setError(null)
    const refused = await onRestore(id)
    setBusy(null)
    if (refused) setError(refused)
  }
  return (
    <details className="lc-archived" data-testid="archived">
      <summary>Archived clients ({archived.length})</summary>
      <p className="lc-hint">Archived clients are hidden from the circles. Their work is kept and comes back with them.</p>
      <ul className="lc-cards">
        {archived.map(c => (
          <li key={c.id} className="lc-arch-row">
            <span className="lc-card-t">{c.name}</span>
            <button className="ch-btn" disabled={busy === c.id} aria-label={`Restore ${c.name}`} onClick={() => { void restore(c.id) }}>
              {busy === c.id ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="lc-error" role="alert">{error}</p>}
    </details>
  )
}
