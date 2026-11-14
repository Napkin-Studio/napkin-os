// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The page a client opens from the agency's link (features/client-confirm-link.clan; v2 section 4):
// on a phone, with no account, one locked version of the brief, and two answers, Confirm and Ask
// for changes. Nothing here is the shell: no sign-in, no host, no session. The link in the URL is
// the whole of the client's authority, and the page asks the server for that one version only.
// The clean copy is shown in a frame that cannot run script; the answer goes back to the same link.

import { useEffect, useState } from 'react'
import ReviewLink, { CodeScreen, type Review } from './ReviewLink'
import './clientLink.css'

interface Open {
  title: string
  client: { name: string }
  agency: { name: string | null; logo?: string | null }
  expires: string
  summary: { label: string; text: string }[]
  signed_by: string[]
  html: string
}

type Seen =
  | { kind: 'loading' }
  | { kind: 'open'; page: Open }
  | { kind: 'review'; page: Review }
  | { kind: 'code'; agency: { name: string | null; logo?: string | null } }
  | { kind: 'gone'; state: string; agency?: string }
  | { kind: 'unknown' }
  | { kind: 'trouble' }

type Done = null | { answer: 'confirm' | 'changes' }

const date = (iso: string) => new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'long' })

const GONE_WORDS: Record<string, (who: string) => string> = {
  answered: () => 'You have already answered this brief. There is nothing more to do.',
  withdrawn: who => `${who} has withdrawn this link. Ask them for a new one.`,
  expired: who => `This link has run out. Ask ${who} for a new one.`,
  locked: who => `That link's code was tried wrong too many times, so it no longer opens. Ask ${who} for a new link.`,
  superseded: who => `The brief has changed since this link was made. Ask ${who} for the new version.`,
}

export default function ClientLink({ token }: { token: string }) {
  const [seen, setSeen] = useState<Seen>({ kind: 'loading' })
  const [full, setFull] = useState(false)
  const [asking, setAsking] = useState(false)
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<Done>(null)

  useEffect(() => {
    // The link is in this page's address: keep it from going anywhere else as a referrer.
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.appendChild(robots)
    return () => { meta.remove(); robots.remove() }
  }, [])

  // a review link may be on the emailed code: bump this to read the page again once it is in
  const [again, setAgain] = useState(0)

  useEffect(() => {
    let live = true
    fetch(`/c/${token}/view`, { credentials: 'same-origin', cache: 'no-store' }).then(async r => {
      const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
      if (!live) return
      if (r.ok && body.mode === 'review') {
        const page = body as unknown as Review
        document.title = `Please review: ${page.title}`
        setSeen({ kind: 'review', page })
      } else if (r.status === 401 && body.state === 'code') {
        const ag = (body.agency ?? {}) as { name?: string | null; logo?: string | null }
        setSeen({ kind: 'code', agency: { name: ag.name ?? null, logo: ag.logo } })
      } else if (r.ok) {
        const page = body as unknown as Open
        document.title = `Please confirm: ${page.title}`
        setSeen({ kind: 'open', page })
      } else if (r.status === 410) setSeen({ kind: 'gone', state: String(body.state ?? 'gone') })
      else if (r.status === 404) setSeen({ kind: 'unknown' })
      else setSeen({ kind: 'trouble' })
    }, () => { if (live) setSeen({ kind: 'trouble' }) })
    return () => { live = false }
  }, [token, again])

  const send = (answer: 'confirm' | 'changes') => {
    setBusy(true); setProblem(null)
    fetch(`/c/${token}/answer`, {
      method: 'POST', credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(answer === 'changes' ? { answer, said } : { answer }),
    }).then(async r => {
      if (r.ok) { setDone({ answer }); return }
      const body = (await r.json().catch(() => ({}))) as { state?: string; error?: string }
      if (r.status === 410) setSeen({ kind: 'gone', state: body.state ?? 'gone' })
      else setProblem(body.error ?? 'That did not go through. Try again.')
    }, () => setProblem('That did not go through. Check your connection and try again.'))
      .finally(() => setBusy(false))
  }

  if (seen.kind === 'loading') {
    return <main className="cl-page" aria-busy="true"><div className="cl-wrap"><p className="cl-sub">Opening the brief</p></div></main>
  }

  if (seen.kind === 'code') {
    return <CodeScreen token={token} agency={seen.agency} onIn={() => setAgain(n => n + 1)} onGone={state => setSeen({ kind: 'gone', state })} />
  }

  if (seen.kind === 'review') {
    if (done) {
      return (
        <main className="cl-page" data-testid="client-link-done">
          <div className="cl-wrap">
            <h1 className="cl-title">{done.answer === 'confirm' ? 'Thank you, it is approved' : 'Thank you, we have your changes'}</h1>
            <p className="cl-sub">{done.answer === 'confirm' ? 'The agency has your answer.' : 'The agency will come back to you with a new version.'} You can close this page.</p>
          </div>
        </main>
      )
    }
    return <ReviewLink token={token} page={seen.page} onGone={state => setSeen({ kind: 'gone', state })} onDone={answer => setDone({ answer })} />
  }

  if (seen.kind !== 'open') {
    const who = 'the agency'
    const text = seen.kind === 'gone'
      ? (GONE_WORDS[seen.state] ?? (() => `This link no longer works. Ask ${who} for a new one.`))(who)
      : seen.kind === 'unknown'
        ? 'This link is not right. Check that you copied all of it, or ask the agency to send it again.'
        : 'The brief could not be opened just now. Try again in a minute.'
    return (
      <main className="cl-page" data-testid="client-link-gone" data-state={seen.kind === 'gone' ? seen.state : seen.kind}>
        <div className="cl-wrap">
          <p className="eyebrow">Brief link</p>
          <h1 className="cl-title">{seen.kind === 'gone' && seen.state === 'answered' ? 'Already answered' : 'This link does not open'}</h1>
          <p className="cl-sub">{text}</p>
        </div>
      </main>
    )
  }

  const { page } = seen
  const agency = page.agency.name ? page.agency.name.toUpperCase() : 'YOUR AGENCY'

  if (done) {
    return (
      <main className="cl-page" data-testid="client-link-done">
        <div className="cl-wrap">
          <Mark agency={agency} logo={page.agency.logo} />
          <h1 className="cl-title">{done.answer === 'confirm' ? 'Thank you, it is confirmed' : 'Thank you, we have your changes'}</h1>
          <p className="cl-sub">
            {done.answer === 'confirm'
              ? `${agency.toLowerCase() === 'your agency' ? 'The agency' : agency} now has your confirmation of this brief. You can close this page.`
              : 'The agency will come back to you with a new version. You can close this page.'}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="cl-page" data-testid="client-link-page">
      <div className="cl-wrap">
        <header className="cl-head">
          <Mark agency={agency} logo={page.agency.logo} />
          <p className="eyebrow">For {page.client.name} · {page.title}</p>
          <h1 className="cl-title">Please confirm this brief</h1>
          <p className="cl-sub">You do not need an account. This link is yours, and it ends on {date(page.expires)}.</p>
        </header>

        <section className="cl-sections" aria-label="The brief in short">
          {page.summary.map(s => (
            <div key={s.label} className="cl-sec">
              <h2 className="eyebrow">{s.label}</h2>
              <p className="cl-text">{s.text}</p>
            </div>
          ))}
        </section>

        <div className="cl-more">
          <button type="button" className="ch-btn cl-btn" aria-expanded={full} onClick={() => setFull(f => !f)}>
            {full ? 'Hide the full brief' : 'Read the full brief'}
          </button>
          {page.signed_by.length > 0 && <p className="cl-note">Signed by {page.signed_by.join(' and ')}.</p>}
        </div>
        {full && (
          <iframe className="cl-frame" title="The full brief" sandbox="" srcDoc={page.html} data-testid="client-link-full" />
        )}

        {asking && (
          <form className="cl-ask" onSubmit={e => { e.preventDefault(); if (said.trim()) send('changes') }}>
            <label htmlFor="cl-said" className="eyebrow">What should change?</label>
            <textarea id="cl-said" value={said} onChange={e => setSaid(e.target.value)} rows={5} autoFocus
              placeholder="Say it in your own words. The agency reads it as you wrote it." maxLength={5000} />
          </form>
        )}
        {problem && <p className="cl-problem" role="alert">{problem}</p>}
      </div>

      <div className="cl-bar">
        <div className="cl-bar-in">
          {!asking ? (
            <>
              <button type="button" className="ch-btn ch-btn-primary cl-btn" disabled={busy} onClick={() => send('confirm')}>Confirm this brief</button>
              <button type="button" className="ch-btn cl-btn" disabled={busy} onClick={() => setAsking(true)}>Ask for changes</button>
            </>
          ) : (
            <>
              <button type="button" className="ch-btn ch-btn-primary cl-btn" disabled={busy || !said.trim()} onClick={() => send('changes')}>Send my changes</button>
              <button type="button" className="ch-btn cl-btn" disabled={busy} onClick={() => { setAsking(false); setProblem(null) }}>Back</button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function Mark({ agency, logo }: { agency: string; logo?: string | null }) {
  return (
    <p className="cl-mark" aria-label={agency}>
      {logo ? <img src={logo} alt="" /> : <i aria-hidden />}
      {!logo && <span>{agency}</span>}
    </p>
  )
}
