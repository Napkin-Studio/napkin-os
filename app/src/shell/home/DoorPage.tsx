// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One door of a home, opened. Every tool opens inside a job file (v2 section 4),
// so a door whose tool exists (Brief, Research, Presentations) asks which client's
// and opens that client's tool page. A door whose tool comes in a later phase
// opens that tool's Empty state: one line on what goes here, a finished example
// and its starting verb, never an error and never a blank box (v2 section 8).

import { useEffect, useRef } from 'react'
import type { ClientRecord, JobRights, LibraryItem } from '../../host/types'
import { Empty } from '../../components/states/ScreenStates'
import { doorById } from '../../components/states/doors'
import { clientLook, clientName, monogramOf } from '../nui/deskData'
import { toolById } from '../landing/tools'
import type { Route } from '../route'
import { doorTarget } from './doorTargets'
import { doorIsLive, doorTool } from './model'
import { Dashboard } from './Dashboard'
import { ApprovalsPage } from '../approvals/ApprovalsPage'
import { LiveJobs } from '../job/LiveJobs'
import './home.css'

interface Props {
  door: string
  /** The door's words as the home gave them (`Brief (read and sign)`), else the Empty content's name. */
  name: string | null
  clients: readonly ClientRecord[]
  items: readonly LibraryItem[]
  apps: readonly string[]
  /** What this person may do with jobs (the home view's): who gets the Open a job button. */
  rights?: JobRights | null
  go: (r: Route) => void
}

export function DoorPage({ door, name, clients, items, apps, rights = null, go }: Props) {
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [door])
  const content = doorById(door)
  const title = name ?? content?.name ?? door.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
  const toolId = doorTool(door)
  const tool = toolId ? toolById(toolId) : undefined
  const live = doorIsLive(door, apps)
  const target = doorTarget(door)
  const page = live && target && 'page' in target ? target.page : null

  let body
  if (page === 'agency-dashboard') {
    // The dashboard reads the job index, behind the server's role check (a door of Management's home).
    body = <Dashboard go={go} />
  } else if (page === 'approvals') {
    // Who approves each stage and by when, who holds each job and for how long: read from the job index.
    body = <ApprovalsPage go={go} />
  } else if (page === 'live-jobs') {
    // Every live job, soonest deadline first, each row its page (features/job-page.clan).
    body = <LiveJobs clients={clients} rights={rights} go={go} />
  } else if (page === 'clients') {
    // The client desk is the Clients door: the desk page itself, not a second list of clients.
    body = <Empty line="The desk lists your clients." verb="Open the desk" example={{ title: 'Example · Client A, an Irish whiskey', lines: ['Client A, an Irish whiskey. One live job, J001.'] }} onStart={() => go({ level: 'clients' })} />
  } else if (tool && live && clients.length > 0) {
    body = (
      <section className="cl-row-wrap" aria-label={`Clients for ${title}`}>
        <div className="cl-row" role="group" aria-label="Pick a client" data-testid="door-clients">
          {clients.map(c => {
            const n = items.filter(i => i.client?.id === c.id && i.app_id === tool.appId).length
            const look = clientLook(c.id, c.name)
            return (
              <button key={c.id} type="button" className="cl-circle" data-testid="door-client" onClick={() => go({ level: 'tool', client: c.id, tool: tool.id })}
                aria-label={`${clientName(c)}: ${n === 0 ? `no ${tool.noun[1]} yet` : `${n} ${n === 1 ? tool.noun[0] : tool.noun[1]}`}. Opens ${title}`}>
                <span className="cl-disc" style={{ ['--cl' as string]: look.cl, ['--cl-ink' as string]: look.ink }}><b>{monogramOf(c)}</b></span>
                <span className="cl-name">{clientName(c)}</span>
                <span className="cl-line">{n === 0 ? `No ${tool.noun[1]} yet` : `${n} ${n === 1 ? tool.noun[0] : tool.noun[1]}`}</span>
              </button>
            )
          })}
        </div>
      </section>
    )
  } else if (tool && live) {
    body = <Empty line={content?.line ?? `${title} goes here.`} verb="Add a client" example={content?.example} onStart={() => go({ level: 'clients' })} />
  } else {
    body = (
      <Empty
        line={content?.line ?? `${title} goes here.`}
        example={content?.example ?? { title: 'Example · Client A, an Irish whiskey', lines: [`${title} will list the J001 work here.`] }}
        verb={content?.verb ?? 'Open the J001 job'}
        reason="This tool comes in a later phase. Its place here is kept."
      />
    )
  }

  return (
    <div className={`nui nui-page${door === 'approvals' ? ' ap-page' : door === 'live-jobs' ? ' jp-page' : ''}`} ref={top} data-testid="door-page" data-door={door}>
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">DOOR</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="door-title">{title}<span className="period-dot" aria-hidden /></h1>
          </div>
          <div className="hm-tools"><button type="button" className="side-link" data-testid="to-home" onClick={() => go({ level: 'agency' })}>Back to your home</button></div>
        </section>
        <main className="hm-main">{body}</main>
      </div>
    </div>
  )
}
