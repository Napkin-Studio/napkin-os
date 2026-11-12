// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The audit view (features/agency-setup.clan; v2 section 9): every approval, export, client link, permission
// change and sign-in, for an admin to read. It is a record, so there is nothing here to edit, and nothing that
// counts, scores or ranks a person: who did what, to which document and version, and when. The server keeps the
// log in a chain that shows if a line is ever changed, and the page can check it.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Empty, FailedSave, Loading, MissingAccess } from '../../components/states/ScreenStates'
import type { Route } from '../route'
import { readAudit, verifyAudit, type AuditEntry, type Verified } from './api'
import { AUDIT_FILTERS, auditShown, versionWords, whenWords, type AuditFilter } from './model'
import '../home/home.css'
import './setup.css'

interface BodyProps {
  lines: AuditEntry[]
  filter: AuditFilter
  verified: Verified | null
  checking: boolean
  onFilter: (f: AuditFilter) => void
  onCheck: () => void
}

/** The list and what narrows it, drawn from props. */
export function AuditBody({ lines, filter, verified, checking, onFilter, onCheck }: BodyProps) {
  const shown = auditShown(lines, filter)
  return (
    <>
      <div className="au-bar">
        <div className="au-filters" role="group" aria-label="Show">
          {AUDIT_FILTERS.map(f => (
            <button key={f.id} type="button" className="au-chip" data-testid="audit-filter" data-filter={f.id} aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="au-check">
          <button type="button" className="side-link" data-testid="audit-check" disabled={checking} onClick={onCheck}>{checking ? 'Checking' : 'Check that nothing was changed'}</button>
          {verified && (
            <span className={verified.ok ? 'su-ok' : 'su-warn'} role="status" data-testid="audit-verified" data-ok={verified.ok}>
              {verified.ok ? `Nothing was changed. ${verified.lines} saved ${verified.lines === 1 ? 'line' : 'lines'} checked.` : `A saved line was changed${verified.line ? ` (line ${verified.line})` : ''}. ${verified.problem ?? ''}`}
            </span>
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="nui-empty" data-testid="audit-none">Nothing of this kind has happened yet.</p>
      ) : (
        <ul className="au-list" data-testid="audit-list">
          {shown.map((l, i) => (
            <li key={`${l.at}-${i}`} className="au-row" data-testid="audit-line" data-kind={l.kind}>
              <span className="au-when">{whenWords(l.at)}</span>
              <span className="au-what">
                <b>{l.what}</b>
                <small>
                  {l.who}
                  {versionWords(l.version) ? ` · version ${versionWords(l.version)}` : ''}
                  {l.ip ? ` · from ${l.ip}` : ''}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

type Load = 'loading' | 'ready' | 'refused' | 'failed'

export function AuditPage({ go }: { go: (r: Route) => void }) {
  const [load, setLoad] = useState<Load>('loading')
  const [lines, setLines] = useState<AuditEntry[]>([])
  const [filter, setFilter] = useState<AuditFilter>('all')
  const [verified, setVerified] = useState<Verified | null>(null)
  const [checking, setChecking] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const top = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    void readAudit().then(r => {
      if (!live) return
      if (r.ok) { setLines(r.data.lines); setLoad('ready') } else setLoad(r.status === 403 ? 'refused' : 'failed')
    })
    return () => { live = false }
  }, [attempt])
  useEffect(() => { top.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) }, [])

  const check = async () => {
    setChecking(true)
    const r = await verifyAudit()
    setChecking(false)
    if (r.ok) setVerified(r.data)
    else setLoad(r.status === 403 ? 'refused' : 'failed')
  }

  let body: ReactNode
  if (load === 'loading') body = <Loading what="the audit view" rows={4} />
  else if (load === 'refused') body = <MissingAccess what="the audit view" who="an admin of this agency" />
  else if (load === 'failed') body = <FailedSave onRetry={() => { setLoad('loading'); setAttempt(a => a + 1) }} primary={false} />
  else if (lines.length === 0) {
    body = <Empty line="Nothing has been signed, exported or changed yet. Each approval, export and change to who can open what is listed here." example={{ title: 'Example · Client A, an Irish whiskey', lines: ['12 Nov, 09:41. Dara signed the brief for J001.'] }} verb="Back to your home" onStart={() => go({ level: 'agency' })} />
  } else body = <AuditBody lines={lines} filter={filter} verified={verified} checking={checking} onFilter={setFilter} onCheck={() => void check()} />

  return (
    <div className="nui nui-page" ref={top} data-testid="audit-page">
      <div className="studio-shell">
        <section className="app-head">
          <div className="app-head-text">
            <div className="eyebrow">AUDIT</div>
            <h1 className="hero-title" tabIndex={-1} data-testid="audit-title">What happened<span className="period-dot" aria-hidden /></h1>
            <p className="hero-sub">Every approval, export and change to who can open what. It is a record: nobody edits it.</p>
          </div>
          <div className="hm-tools"><button type="button" className="side-link" data-testid="to-home" onClick={() => go({ level: 'agency' })}>Back to your home</button></div>
        </section>
        <main className="hm-main">{body}</main>
      </div>
    </div>
  )
}
