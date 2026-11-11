// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Territories, for one client, behind the Brief gate (features/brief-gate.clan; build prompt v2
// section 6: no creative work starts on a brief the client has not confirmed). Closed, it says
// what stands in the way, step by step, and takes the person to the brief. Open, it takes a territory
// (typed by hand until the Territory tool lands, features/territory-tool.clan) and spins the brief off into
// a visual brief (features/visual-brief.clan); the visual briefs already made for the client are listed.

import { useState, type FormEvent } from 'react'
import type { ClientRecord, LibraryItem } from '../../host'
import { clientName } from '../nui/deskData'
import { territoriesOf, VISUAL_BRIEF } from '../gate/words'
import '../gate/gate.css'

interface Props {
  client: ClientRecord
  /** This client's documents, newest first. */
  items: LibraryItem[]
  onOpenBrief: (path: string) => void
  onNewBrief: () => void
  onBack: () => void
  /** Spin the brief off into a visual brief for this territory and open it. Rejects with the host's words. */
  onChooseTerritory?: (brief: LibraryItem, territory: string, line: string) => Promise<void>
}

/** The form that takes a territory by hand and makes the visual brief from the brief. */
function ChooseTerritory({ brief, onChoose }: { brief: LibraryItem; onChoose: (brief: LibraryItem, territory: string, line: string) => Promise<void> }) {
  const [territory, setTerritory] = useState('')
  const [line, setLine] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!territory.trim() || busy) return
    setBusy(true); setError(null)
    onChoose(brief, territory.trim(), line.trim())
      .catch(err => setError(String(err instanceof Error ? err.message : err)))
      .finally(() => setBusy(false))
  }
  return (
    <form className="tg-form" onSubmit={submit} data-testid="choose-territory">
      <h2 className="sec-title">Choose a territory</h2>
      <p>Write the territory the team is taking forward. The visual brief starts from the brief, with its proposition and tone.</p>
      <label className="bg-field"><span>Territory</span>
        <input value={territory} onChange={e => setTerritory(e.target.value)} placeholder="Permission to stop" autoComplete="off" /></label>
      <label className="bg-field"><span>In one line</span>
        <input value={line} onChange={e => setLine(e.target.value)} placeholder="The evening does not start until something says the day is over." autoComplete="off" /></label>
      <button type="submit" className="ch-btn ch-btn-primary" disabled={busy || !territory.trim()} aria-disabled={busy || !territory.trim()}>
        {busy ? 'Making the visual brief' : 'Make the visual brief'}
      </button>
      {error && <p className="bg-err" role="alert">{error}</p>}
    </form>
  )
}

export function TerritoriesGate({ client, items, onOpenBrief, onNewBrief, onBack, onChooseTerritory }: Props) {
  const name = clientName(client)
  const t = territoriesOf(items, name)
  const visual = items.filter(i => i.app_id === VISUAL_BRIEF)
  return (
    <div className="nui nui-page" data-testid="tool-page" data-client={client.id} data-tool="territories">
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow" id="hero-eyebrow">{name} · Territories</div>
            <h1 className="hero-title" id="hero-title" tabIndex={-1}>Territories<span className="period-dot" aria-hidden /></h1>
            <p className="hero-sub" id="hero-sub">
              {t.open
                ? `The brief passed the gate, the agency signed it and ${name} confirmed it.`
                : `Creative work starts on a brief ${name} has confirmed. Territories open when the brief passes the gate, the agency signs it and ${name} confirms it.`}
            </p>
          </div>
        </section>
        <section className="section-block" aria-label={`Territories for ${name}`}>
          {t.open ? (
            <div className="tg-card tg-open" data-testid="territories-open">
              <h2 className="sec-title">Territories are open</h2>
              <p>The brief is ready for creative work.</p>
              {t.brief && onChooseTerritory && <ChooseTerritory brief={t.brief} onChoose={onChooseTerritory} />}
              {t.brief && <button type="button" className="ch-btn" onClick={() => onOpenBrief(t.brief!.path)}>Open the brief</button>}
            </div>
          ) : (
            <div className="tg-card" data-testid="territories-closed">
              <h2 className="sec-title">Territories are closed</h2>
              <ol className="tg-steps" aria-label="What opens Territories">
                {t.steps.map(s => (
                  <li key={s.text} data-done={s.done}>
                    <i aria-hidden />
                    <span>{s.text}</span>
                    <b>{s.done ? 'Done' : 'Waiting'}</b>
                  </li>
                ))}
              </ol>
              {t.brief
                ? <button type="button" className="ch-btn ch-btn-primary" onClick={() => onOpenBrief(t.brief!.path)}>Open the brief</button>
                : <button type="button" className="ch-btn ch-btn-primary" onClick={onNewBrief}>Start a brief</button>}
            </div>
          )}
          {visual.length > 0 && (
            <div className="tg-card tg-visual-list" data-testid="visual-briefs-card">
              <h2 className="sec-title">Visual briefs</h2>
              <ul className="tg-visuals" aria-label="Visual briefs" data-testid="visual-briefs">
                {visual.map(v => (
                  <li key={v.path}>
                    <button type="button" className="ch-link" onClick={() => onOpenBrief(v.path)}>{v.title}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="nui-more"><button type="button" className="side-link" onClick={onBack}>Back to {name}</button></p>
        </section>
      </div>
    </div>
  )
}
