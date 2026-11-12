// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The client's own link, made from the signed brief (features/client-confirm-link.clan). Account
// service types who it is for, copies the link, and sends it themselves (Phase 1 does not send
// the email). The links already made are listed with what each is worth now, and an open one can
// be withdrawn. The host decides every state; this draws it.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { host } from '../../host'
import type { ClientLinkRow } from '../../host'
import { makeRound, readRound, roundOptions } from '../../host/http'
import type { ClientRoundMade, ClientRoundView } from '../../host/types'
import { RoundView } from '../clientReview/RoundView'

const STATE_WORDS: Record<string, string> = {
  open: 'Waiting for the client',
  answered: 'Answered',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
  superseded: 'Replaced: the brief changed',
}

const ANSWER_WORDS: Record<string, string> = { accepted: 'confirmed', accepted_with_changes: 'asked for changes' }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'long' })

interface Props {
  client: string
  /** The version signed, so the person sees which one the link is to. */
  onChanged?: () => void
}

export default function ClientLinkPanel({ client, onChanged }: Props) {
  const [rows, setRows] = useState<ClientLinkRow[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    host.listClientLinks().then(setRows, () => setRows([]))
  }, [])
  useEffect(() => {
    load()
    const offs = [host.on('clan-data-changed', load)]
    return () => { for (const off of offs) off.then(f => f()).catch(() => {}) }
  }, [load])

  const make = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null); setCopied(false)
    host.makeClientLink(name.trim(), email.trim()).then(
      made => { setUrl(`${window.location.origin}${made.path}`); load(); onChanged?.() },
      err => setError(String(err instanceof Error ? err.message : err)),
    ).finally(() => setBusy(false))
  }

  const copy = () => {
    if (!url) return
    navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false))
  }

  const withdraw = (id: string) => {
    setBusy(true); setError(null)
    host.withdrawClientLink(id).then(load, err => setError(String(err instanceof Error ? err.message : err))).finally(() => setBusy(false))
  }

  return (
    <section className="bg-block" data-testid="client-link-panel">
      <h3 className="bg-h3">Link for {client}</h3>
      <p className="bg-mid">{client} opens it on a phone with no account and confirms this signed version. It works once and ends in 30 days.</p>
      <form className="bg-form" onSubmit={make}>
        <label className="bg-field"><span>Who it is for</span>
          <input value={name} onChange={e => setName(e.target.value)} autoComplete="off" data-testid="client-link-name" /></label>
        <label className="bg-field"><span>Their email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" data-testid="client-link-email" /></label>
        <button type="submit" className="ch-btn" disabled={busy || !name.trim() || !email.trim()}>Make the link</button>
      </form>
      {url && (
        <div className="cl-made" data-testid="client-link-made">
          <input readOnly value={url} aria-label="The client link" onFocus={e => e.currentTarget.select()} />
          <button type="button" className="ch-btn ch-btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy the link'}</button>
          <p className="bg-reason">Shown once. Send it yourself.</p>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="bg-list cl-rows" aria-label="Links made">
          {rows.map(r => (
            <li key={r.id} data-state={r.state}>
              <span>{r.client.name}: {r.answer ? ANSWER_WORDS[r.answer] ?? r.answer : STATE_WORDS[r.state] ?? r.state}
                {r.state === 'open' ? `, until ${day(r.expires)}` : ''}</span>
              {r.state === 'open' && <button type="button" className="ch-btn ch-btn-quiet" disabled={busy} onClick={() => withdraw(r.id)}>Withdraw</button>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="bg-err" role="alert">{error}</p>}
      <RoundPanel client={client} onChanged={() => { load(); onChanged?.() }} />
    </section>
  )
}

interface Person { name: string; email: string }

/** Send the signed version to several people at the client, one of them the approver, and read the round back. */
function RoundPanel({ client, onChanged }: { client: string; onChanged: () => void }) {
  const [people, setPeople] = useState<Person[]>([{ name: '', email: '' }, { name: '', email: '' }])
  const [lead, setLead] = useState(0)
  const [code, setCode] = useState(false)
  const [canCode, setCanCode] = useState(false)
  const [made, setMade] = useState<ClientRoundMade | null>(null)
  const [round, setRound] = useState<ClientRoundView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(() => { void readRound().then(setRound) }, [])
  useEffect(() => {
    load()
    void roundOptions().then(o => setCanCode(o.code))
    const offs = [host.on('clan-data-changed', load)]
    return () => { for (const off of offs) off.then(f => f()).catch(() => {}) }
  }, [load])

  const set = (i: number, k: keyof Person) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPeople(ps => ps.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)))
  const filled = people.map((p, i) => ({ ...p, i })).filter(p => p.name.trim() && p.email.trim())
  const ready = filled.length > 0 && filled.some(p => p.i === lead)

  const send = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null); setCopied(null)
    makeRound(filled.map(p => ({ name: p.name.trim(), email: p.email.trim(), approver: p.i === lead })), code && canCode).then(
      m => { setMade(m); load(); onChanged() },
      err => setError(String(err instanceof Error ? err.message : err)),
    ).finally(() => setBusy(false))
  }

  const copy = (id: string, path: string) =>
    navigator.clipboard?.writeText(`${window.location.origin}${path}`).then(() => setCopied(id), () => setCopied(null))

  return (
    <div className="cr-people-block" data-testid="client-round-panel">
      <h3 className="bg-h3">Send to several people at {client}</h3>
      <p className="bg-mid">Each person gets their own link to this signed version, and sees nothing of the others. One of them is the approver: only their answer counts as the client&apos;s decision.</p>
      <form className="bg-form cr-people" onSubmit={send}>
        {people.map((p, i) => (
          <div className="cr-person" key={i}>
            <label className="bg-field"><span>Name {i + 1}</span><input value={p.name} onChange={set(i, 'name')} autoComplete="off" data-testid={`round-name-${i}`} /></label>
            <label className="bg-field"><span>Email {i + 1}</span><input type="email" value={p.email} onChange={set(i, 'email')} autoComplete="off" data-testid={`round-email-${i}`} /></label>
            <label className="cr-lead"><input type="radio" name="approver" checked={lead === i} onChange={() => setLead(i)} /> The approver</label>
          </div>
        ))}
        {canCode && <label className="cr-lead"><input type="checkbox" checked={code} onChange={e => setCode(e.target.checked)} data-testid="round-code" /> Ask each person for a code we email them first</label>}
        <div className="cr-people-act">
          {people.length < 12 && <button type="button" className="ch-btn ch-btn-quiet" onClick={() => setPeople(ps => [...ps, { name: '', email: '' }])}>Add a person</button>}
          <button type="submit" className="ch-btn" disabled={busy || !ready} data-testid="round-send">Send for review</button>
        </div>
      </form>
      {made && (
        <ul className="bg-list cl-rows" aria-label="Links made" data-testid="round-links">
          {made.links.map(l => (
            <li key={l.id}>
              <span>{l.name}{l.role === 'approver' ? ' (approver)' : ''}</span>
              <button type="button" className="ch-btn ch-btn-primary" onClick={() => copy(l.id, l.path)}>{copied === l.id ? 'Copied' : 'Copy the link'}</button>
            </li>
          ))}
          <li><span className="bg-reason">Shown once. Send each link yourself.</span></li>
        </ul>
      )}
      {error && <p className="bg-err" role="alert">{error}</p>}
      {round && <RoundView round={round} />}
    </div>
  )
}
