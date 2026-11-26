// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What one entry of the brand flow shows (mocks a1 and a2): the question, the naming step, the 120-page ask, the progress card, done and failed.
// Drawn from the entry alone, so it renders without a host; BrandAsk.tsx holds the strip that mounts it.

import { useState, type ReactNode } from 'react'
import { words, type BrandFlow, type Entry } from './brandFlow'
import './BrandAsk.css'

/** What one entry shows. Pure of the flow: given the entry and the verbs, it draws (and is drawn in the tests). */
export function BrandCard({ entry, client, flow }: { entry: Entry; client: string; flow: Pick<BrandFlow, 'answer' | 'make' | 'confirmBig' | 'retry' | 'dismiss' | 'offerBuild'> }) {
  const p = entry.phase
  const id = entry.id
  if (p.kind === 'detecting') return null
  if (p.kind === 'offer') {
    return (
      <div className="bq bq-offer" data-testid="brand-offer">
        <button type="button" className="bq-link" onClick={() => void flow.offerBuild(id)}>{words.offer(entry.label)}</button>
        <button type="button" className="bq-link bq-x" aria-label="Dismiss" onClick={() => flow.dismiss(id)}>Dismiss</button>
      </div>
    )
  }
  if (p.kind === 'ask') {
    const q = p.question
    const top = q.update ? words.update(q.update.name) : null
    return (
      <Card tone="ask" testid="brand-ask" title={words.title(entry.label)} sub={q.mode === 'new' ? words.askNew(client) : words.askChoose(client)}>
        {q.mode === 'new'
          ? <button type="button" className="bq-btn bq-primary" data-testid="brand-build" onClick={() => void flow.answer(id, 'build')}>{words.build}</button>
          : <>
              {top && <button type="button" className="bq-btn bq-primary" data-testid="brand-update" onClick={() => void flow.answer(id, 'update')}>{top}</button>}
              <button type="button" className={`bq-btn${top ? '' : ' bq-primary'}`} data-testid="brand-new" onClick={() => void flow.answer(id, 'new')}>{words.makeNew}</button>
            </>}
        <button type="button" className="bq-btn" data-testid="brand-not" onClick={() => void flow.answer(id, 'not_bible')}>{words.notBible}</button>
      </Card>
    )
  }
  if (p.kind === 'naming') return <Naming entry={entry} client={client} flow={flow} />
  if (p.kind === 'big') {
    return (
      <Card tone="ask" testid="brand-big" title={words.big(entry.label, p.pages)} sub={words.bigSub(120)}>
        <button type="button" className="bq-btn bq-primary" data-testid="brand-big-yes" onClick={() => void flow.confirmBig(id, true)}>{words.bigYes(p.pages)}</button>
        <button type="button" className="bq-btn" data-testid="brand-big-no" onClick={() => void flow.confirmBig(id, false)}>{words.bigNo}</button>
      </Card>
    )
  }
  if (p.kind === 'working') {
    return (
      <div className="bq bq-working" role="status" data-testid="brand-working">
        <span className="bq-spin" aria-hidden />
        <span><b>{words.working(p.answer)}</b> <span className="bq-sub">{words.workingSub(p.answer)}</span></span>
      </div>
    )
  }
  if (p.kind === 'done') {
    const n = p.result.gaps.length
    return (
      <div className="bq bq-done" role="status" data-testid="brand-done">
        <span><b>{words.done(p.result)}</b> <span className="bq-sub">{words.doneSub(p.result, client)}{n ? ` ${words.gaps(n)}` : ''}</span></span>
        <button type="button" className="bq-link" onClick={() => flow.dismiss(id)}>Dismiss</button>
      </div>
    )
  }
  return (
    <div className="bq bq-failed" role="alert" data-testid="brand-failed">
      <span><b>{words.failed}</b> <span className="bq-sub">{p.reason} {words.untouched}</span></span>
      <button type="button" className="bq-btn bq-primary" data-testid="brand-retry" onClick={() => void flow.retry(id)}>Retry</button>
      <button type="button" className="bq-link" onClick={() => flow.dismiss(id)}>Dismiss</button>
    </div>
  )
}

function Card({ tone, testid, title, sub, children }: { tone: string; testid: string; title: string; sub: string; children: ReactNode }) {
  return (
    <div className={`bq bq-${tone}`} role="group" aria-label={title} data-testid={testid}>
      <div className="bq-title">{title}</div>
      <div className="bq-sub">{sub}</div>
      <div className="bq-row">{children}</div>
    </div>
  )
}

function Naming({ entry, client, flow }: { entry: Entry; client: string; flow: Pick<BrandFlow, 'make' | 'dismiss'> }) {
  const [name, setName] = useState('')
  const ok = name.trim().length > 0 && name.trim().length <= 60
  return (
    <Card tone="ask" testid="brand-naming" title={words.naming} sub={`For ${client}, from ${entry.label}. A new look beside the ones it has.`}>
      <input className="bq-input" data-testid="brand-name" aria-label={words.naming} maxLength={60} value={name} autoFocus
             onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ok) void flow.make(entry.id, name) }} />
      <button type="button" className="bq-btn bq-primary" data-testid="brand-make" disabled={!ok} onClick={() => void flow.make(entry.id, name)}>Make it</button>
      <button type="button" className="bq-btn" onClick={() => flow.dismiss(entry.id)}>Cancel</button>
    </Card>
  )
}

