// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One Trash: the deleted documents of any tool, for a client or (with none) the whole agency, each with its
// tool, its title, who deleted it and for how long it can still come back. There is no permanent delete here.

import type { ClientRecord, TrashItem } from '../../host/types'
import { docTitle } from '../docTitle'
import { clientLook, clientName, monogramOf } from './deskData'
import { ToolIcon } from './icons'
import { TrashToastView } from './TrashToast'
import type { TrashDesk, TrashState } from './trashDesk'
import { trashIcon, trashLine } from './trashDesk'
import './trash.css'

export function TrashPage({ client, agency, desk, state, onBack, now }: {
  client: ClientRecord | null
  agency: string
  desk: TrashDesk
  state: TrashState
  onBack: () => void
  now?: number
}) {
  const name = client ? clientName(client) : agency
  const look = client ? clientLook(client.id, client.name) : null
  return (
    <div className="nui nui-page" data-testid="trash-page" data-client={client?.id ?? ''}>
      <div className="studio-shell">
        <main id="view-client">
          <header className="cp-head">
            {client && look && <span className="cl-disc cp-disc" style={{ ['--cl' as string]: look.cl, ['--cl-ink' as string]: look.ink }}><b>{monogramOf(client)}</b></span>}
            <div>
              <div className="eyebrow">{name.toUpperCase()}</div>
              <h1 className="hero-title" tabIndex={-1}>Trash<span className="period-dot" aria-hidden /></h1>
              <p className="hero-sub">Restorable for 30 days, then gone for good.</p>
            </div>
          </header>
          <section className="cp-sec cp-trashlist" aria-label={`Trash for ${name}`} data-testid="trash-list">
            <div className="cp-box">
              {state.loaded && state.rows.length === 0 && <p className="cp-trashnote" data-testid="trash-empty">Trash is empty. A document you move here waits for 30 days.</p>}
              {state.rows.map((r: TrashItem) => {
                // A new document still carries its tool's name as its title ("Brief Maker"): say what it is instead (UAT4 F14).
                const title = docTitle(r.title, r.app_id).text
                return (
                  <div key={`${r.path}@${r.trashed_at}`} className="cp-row" data-testid="trash-item">
                    <span className={`cp-ico k-${trashIcon(r.app_id)}`}><ToolIcon tool={trashIcon(r.app_id)} /></span>
                    <span className="cp-t"><b>{title}</b><small>{trashLine(r, now)}</small></span>
                    <button type="button" className="btn-rect" data-testid="restore" aria-label={`Restore ${title}`} onClick={() => { void desk.restore(r.path) }}>Restore</button>
                  </div>
                )
              })}
            </div>
            {state.error && <p className="cp-trashnote" role="alert" data-testid="trash-error">{state.error}</p>}
          </section>
          <p className="cp-record"><button type="button" className="side-link" data-testid="trash-back" onClick={onBack}>← Back to {name}</button></p>
        </main>
      </div>
      <TrashToastView state={state} desk={desk} />
    </div>
  )
}
