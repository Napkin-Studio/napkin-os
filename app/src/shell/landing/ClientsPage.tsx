// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The clients page: one circle per client, most urgent first, and the way to
// add one. Given everything; it fetches nothing.

import { useState, type FormEvent } from 'react'
import { Circle } from './Circle'
import { ACTIVITY_WORD, boxFor, circleName, initialsOf, pageOf, plural, type ClientSummary } from './model'

interface Props {
  agency: string
  /** Every live client, urgent first (`ordered`). */
  clients: ClientSummary[]
  query: string
  showAll: boolean
  /** Whether the add form is open. */
  adding: boolean
  onQuery: (q: string) => void
  onShowAll: () => void
  onAdding: (open: boolean) => void
  onOpenClient: (id: string) => void
  /** Make a client; resolves with the host's words when it was refused. */
  onAdd: (name: string) => Promise<string | null>
}

function Status({ s }: { s: ClientSummary }) {
  const mark = s.activity === 'idle' ? 'lc-dot lc-dot-hollow' : s.activity === 'error' ? 'lc-dot lc-dot-ink' : 'lc-dot'
  // The quieter verbs are said too: the dot is never the only word.
  const verb = s.activity === 'think' || s.activity === 'read' || s.activity === 'check' ? ` · ${ACTIVITY_WORD[s.activity]}` : ''
  return <><i className={mark} data-activity={s.activity} aria-hidden />{s.status}{verb}</>
}

function AddForm({ onAdd, onCancel }: { onAdd: (name: string) => Promise<string | null>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    const refused = await onAdd(name)
    setBusy(false)
    if (refused) setError(refused)
    else setName('')
  }
  return (
    <form className="lc-add" onSubmit={e => { void submit(e) }} aria-label="Add a client" data-testid="add-form">
      <label htmlFor="lc-client-name">Client name</label>
      <div className="lc-add-row">
        <input
          id="lc-client-name"
          name="client-name"
          autoFocus
          autoComplete="off"
          maxLength={60}
          value={name}
          onChange={e => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'lc-client-err' : undefined}
          onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
        />
        <button className="ch-btn ch-btn-primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add client'}
        </button>
        <button className="ch-btn ch-btn-quiet" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p id="lc-client-err" className="lc-error" role="alert">{error}</p>}
    </form>
  )
}

export function ClientsPage({ agency, clients, query, showAll, adding, onQuery, onShowAll, onAdding, onOpenClient, onAdd }: Props) {
  const page = pageOf(clients, query, showAll)
  const n = clients.length
  const ring = page.shown.length + 1 <= 7
  return (
    <div className="lc-page" data-testid="clients">
      <header className="lc-phead">
        <div className="lc-phl">
          <p className="eyebrow">{agency}</p>
          <h1 className="lc-h1 lc-h1-left" tabIndex={-1}>Clients</h1>
          <p className="lc-lede">
            {n === 0 ? 'No clients yet. Add one to start.' : `${plural(n, 'client')}, most urgent first. Pick one to open its tools.`}
          </p>
        </div>
        <div className="lc-phr">
          {page.paged && (
            <label className="lc-search">
              <span className="lc-sr">Search clients</span>
              <input type="search" placeholder="Search clients" value={query} onChange={e => onQuery(e.target.value)} />
            </label>
          )}
          {n > 0 && !adding && (
            <button className="ch-btn" onClick={() => onAdding(true)}>Add client</button>
          )}
        </div>
      </header>

      {adding && <AddForm onAdd={onAdd} onCancel={() => onAdding(false)} />}

      <div className="lc-stagewrap">
        {n === 0 && !adding ? (
          <div className="lc-empty" data-testid="empty">
            <button className="lc-addc lc-addc-big" onClick={() => onAdding(true)} aria-label="Add your first client">
              <span aria-hidden>+</span>
            </button>
            <p>Every piece of work in the studio belongs to a client. Add the first one.</p>
          </div>
        ) : (
          <div className={`lc-row${ring ? ' lc-ring' : ''}`} role="group" aria-label="Clients" style={{ '--n': page.shown.length + 1 } as React.CSSProperties}>
            {ring && <span className="lc-hub" aria-hidden><Circle size={64} material="onyx" initials={initialsOf(agency)} slot="agency-hub" orb /></span>}
            {page.shown.map((s, i) => {
              // Standing round the agency they are all one size; in rows the first three lead.
              const box = ring ? 110 : boxFor(i, page.shown.length)
              return (
                <button
                  key={s.client.id}
                  className="lc-client"
                  data-testid="client-circle"
                  data-client={s.client.id}
                  style={{ '--box': `${box}px`, '--i': i } as React.CSSProperties}
                  aria-label={circleName(s)}
                  onClick={() => onOpenClient(s.client.id)}
                >
                  <span className="lc-orb"><Circle size={box} material={s.client.material} initials={s.client.initials || initialsOf(s.client.name)} activity={s.activity} slot={`client:${s.client.id}`} orb /></span>
                  <span className="lc-lbl">
                    <span className="lc-nm">{s.client.name}</span>
                    <span className="lc-st"><Status s={s} /></span>
                  </span>
                </button>
              )
            })}
            {!adding && (
              <button className="lc-client lc-add-client" style={{ '--box': ring ? '110px' : '89px', '--i': page.shown.length } as React.CSSProperties} onClick={() => onAdding(true)} aria-label="Add client">
                <span className="lc-orb"><span className="lc-addc" aria-hidden>+</span></span>
                <span className="lc-lbl"><span className="lc-nm">Add client</span></span>
              </button>
            )}
            {page.shown.length === 0 && query.trim() && <p className="lc-nothing">No client called “{query.trim()}”.</p>}
          </div>
        )}
        {page.hidden > 0 && (
          <div className="lc-more">
            <button className="ch-btn" onClick={onShowAll}>Show all {n}</button>
          </div>
        )}
      </div>
      {n > 0 && (
        <p className="lc-legend">
          <span><i className="lc-dot" data-activity="human" aria-hidden /> Needs you</span>
          <span><i className="lc-dot lc-dot-ink" aria-hidden /> Failed</span>
          <span><i className="lc-dot" data-activity="work" aria-hidden /> Working, thinking, reading or checking</span>
          <span><i className="lc-dot lc-dot-hollow" aria-hidden /> Idle</span>
          <span className="lc-mut">Every state is also said in words.</span>
        </p>
      )}
    </div>
  )
}
