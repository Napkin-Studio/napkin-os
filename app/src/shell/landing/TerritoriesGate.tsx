// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Territories, for one client, behind the Brief gate (features/brief-gate.clan; build prompt v2
// section 6: no creative work starts on a brief the client has not confirmed). Closed, it says
// what stands in the way, step by step, and takes the person to the brief. Open, it says so:
// the Territory tool itself is its own record (features/territory-tool.clan).

import type { ClientRecord, LibraryItem } from '../../host'
import { clientName } from '../nui/deskData'
import { territoriesOf } from '../gate/words'
import '../gate/gate.css'

interface Props {
  client: ClientRecord
  /** This client's documents, newest first. */
  items: LibraryItem[]
  onOpenBrief: (path: string) => void
  onNewBrief: () => void
  onBack: () => void
}

export function TerritoriesGate({ client, items, onOpenBrief, onNewBrief, onBack }: Props) {
  const name = clientName(client)
  const t = territoriesOf(items, name)
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
              <p>The brief is ready for creative work. The territory tool starts from it.</p>
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
          <p className="nui-more"><button type="button" className="side-link" onClick={onBack}>Back to {name}</button></p>
        </section>
      </div>
    </div>
  )
}
