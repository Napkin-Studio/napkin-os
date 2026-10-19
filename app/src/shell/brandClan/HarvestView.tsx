// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The harvest panel's body, drawn from what it is given (`HarvestPanel` holds
// the state and talks to the host), so each state can be rendered in a test.

import type { HarvestOffer } from '../../host'
import { anyTicked, statusWords, tickable, valueText } from './harvest'
import type { Ticks } from './harvest'
import { fieldWords } from './words'
import './BrandClan.css'

/** The panel's body, drawn from what it is given; `HarvestPanel` holds the state. */
export default function HarvestView({ offer, ticks, summary, busy, error, labels, onTick, onSummary, onApply, onClose }: {
  offer: HarvestOffer
  ticks: Ticks
  summary: string
  busy: boolean
  error: string | null
  labels?: Readonly<Record<string, string>>
  onTick: (key: 'work' | string, on: boolean) => void
  onSummary: (s: string) => void
  onApply: () => void
  onClose: () => void
}) {
  const brand = offer.brand.title
  const ready = anyTicked(ticks) && !busy
  const workWords = offer.work.item.title ? `${offer.work.item.title} · approved exemplar` : 'This document · approved exemplar'
  return (
    <section className="bc-harvest" aria-label={`Add to ${brand}’s Brand Clan`}>
      <div className="bc-harvest-head">
        <h3>Add to {brand}’s Brand Clan</h3>
        <button type="button" className="ch-btn ch-btn-quiet" onClick={onClose}>Close</button>
      </div>
      <p className="bc-note">Tick what to take. Nothing is added until you press the button.</p>

      <ul className="bc-rows">
        <li className="bc-row-item" data-status={offer.work.status}>
          <label>
            <input type="checkbox" checked={ticks.work} disabled={!tickable(offer.work.status) || busy}
              onChange={e => onTick('work', e.target.checked)} />
            <span className="bc-row-name">{workWords}</span>
          </label>
          <span className="bc-tag" data-tag={offer.work.status}>{statusWords(offer.work.status)}</span>
        </li>
        {offer.fields.map(f => (
          <li key={f.from} className="bc-row-item" data-status={f.status} data-flagged={f.flagged || undefined}>
            <label>
              <input type="checkbox" checked={!!ticks.fields[f.from]} disabled={!tickable(f.status) || busy}
                onChange={e => onTick(f.from, e.target.checked)} />
              <span className="bc-row-name">{fieldWords(f.from, labels)}</span>
            </label>
            <span className="bc-tag" data-tag={f.status}>{statusWords(f.status)}</span>
            {f.flagged && <p className="bc-flag">{f.reason || 'the client asked for a change here'}</p>}
            <div className="bc-sides">
              <div><small>This document</small><p>{valueText(f.value)}</p></div>
              <div><small>The Brand Clan</small><p>{valueText(f.kit_value) || '—'}</p></div>
            </div>
          </li>
        ))}
      </ul>

      <label className="bc-label" htmlFor="bc-summary">What this adds, in a line (optional)</label>
      <input id="bc-summary" className="ch-input" type="text" value={summary} disabled={busy}
        onChange={e => onSummary(e.target.value)} />

      {error && <p className="bc-err" role="alert">{error}</p>}
      <div className="bc-row">
        <button type="button" className="ch-btn ch-btn-primary" disabled={!ready} onClick={onApply}>
          {busy ? 'Adding…' : 'Add to the Brand Clan'}
        </button>
      </div>
    </section>
  )
}

