// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Invite, on a person's row of the People page (features/first-day.clan): the admin may pick a first document of a live
// job and gets a link to copy. The link carries the sign-in name and nothing else; it makes no person and grants no role
// (the person is already on the page, with the roles the store holds). The same inline sheet the roles editor is.

import { useState } from 'react'
import { INVITE } from './words'

import { makeInvite, type InviteApi, type InviteDoc } from './invite'
export type { InviteDoc } from './invite'

interface FormProps {
  docs: readonly InviteDoc[]
  first: string
  email: string
  busy: boolean
  link: string | null
  error: string | null
  copied: boolean
  onFirst: (path: string) => void
  onEmail: (email: string) => void
  onMake: () => void
  onCopy: () => void
  onClose: () => void
}

export function InviteForm({ docs, first, email, busy, link, error, copied, onFirst, onEmail, onMake, onCopy, onClose }: FormProps) {
  return (
    <>
      {link === null ? (
        <>
          {docs.length > 0 && (
            <label className="pa-fld">
              {INVITE.first}
              <select value={first} onChange={e => onFirst(e.target.value)}>
                <option value="">{INVITE.none}</option>
                {docs.map(d => <option key={d.path} value={d.path}>{`${d.job}, ${d.title}`}</option>)}
              </select>
            </label>
          )}
          <label className="pa-fld">
            {INVITE.email}
            <input type="email" value={email} autoComplete="off" placeholder="name@place" onChange={e => onEmail(e.target.value)} />
          </label>
          {error && <p className="pa-hint" role="alert">{error}</p>}
          <div className="pa-acts pa-end">
            <button type="button" className="pa-btn" onClick={onClose}>{INVITE.close}</button>
            <button type="button" className="pa-btn pa-primary" data-testid="invite-make" disabled={busy} onClick={onMake}>{INVITE.make}</button>
          </div>
        </>
      ) : (
        <>
          <input className="fd-invite-link" data-testid="invite-link" readOnly value={link} aria-label="The link" onFocus={e => e.currentTarget.select()} />
          <p className="pa-hint fd-invite-note">The link fills in their sign-in name. They press Sign in; nothing else is in it.</p>
          <div className="pa-acts pa-end">
            {copied && <small data-testid="invite-copied" role="status">{INVITE.copied}</small>}
            <button type="button" className="pa-btn" onClick={onClose}>{INVITE.close}</button>
            <button type="button" className="pa-btn pa-primary" onClick={onCopy}>{INVITE.copy}</button>
          </div>
        </>
      )}
    </>
  )
}

/** The sheet for one person. */
export function InviteRow({ person, name, docs, api, onClose }: { person: string; name: string; docs: readonly InviteDoc[]; api: InviteApi; onClose: () => void }) {
  const [first, setFirst] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const make = async () => {
    setBusy(true); setError(null)
    const r = await makeInvite(api, person, { first, email })
    setBusy(false)
    if (r.ok) setLink(r.link); else setError(r.error)
  }
  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link) } catch { /* the field above is selectable */ }
    setCopied(true)
  }
  return (
    <section className="pa-sheet" aria-label={`Invite ${name}`} data-testid="people-invite">
      <h2>Invite {name}</h2>
      <InviteForm docs={docs} first={first} email={email} busy={busy} link={link} error={error} copied={copied}
        onFirst={setFirst} onEmail={setEmail} onMake={() => void make()} onCopy={() => void copy()} onClose={onClose} />
    </section>
  )
}
