// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Signing in to the studio (napkin-web's /api/auth/*, crates/napkin-web/src/auth.rs).
//
// A server with accounts answers /api/session with 401 {signin: true} until a
// person signs in with their user name and their agency's name. The 401 says
// whether the server asks for a password too (`password`): a roster server
// (NAPKIN_AUTH=roster) does not, and the name and agency are enough. Where
// there are passwords, the first sign-in with the temporary password an admin
// gave asks for the person's own, then the studio opens. The gate renders the studio unchanged when the server has no
// accounts (anonymous mode), when the page is the public viewer, on the
// device and on the desktop.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { StudioLogo } from '../brand/StudioMark'
import { LogoSpinnerFill } from '../brand/LogoSpinner'
import { PoweredByClan } from '../brand/PoweredByClan'
import { accountName } from './accountName'
import './SignIn.css'

type Gate = 'checking' | 'open' | 'signin'

export function SignInGate({ children, check }: { children: ReactNode; check: boolean }) {
  const [gate, setGate] = useState<Gate>(check ? 'checking' : 'open')
  // a server from before the roster says nothing: it asks for a password
  const [asksPassword, setAsksPassword] = useState(true)
  useEffect(() => {
    if (!check) return
    let live = true
    fetch('/api/session', { credentials: 'same-origin' })
      .then(async r => {
        if (!live) return
        if (r.status === 401) {
          const b = await r.json().catch(() => ({}))
          if (b && b.password === false) setAsksPassword(false)
          setGate(b && b.signin ? 'signin' : 'open')
        } else setGate('open')
      })
      // offline or no server: the studio says so itself
      .catch(() => { if (live) setGate('open') })
    return () => { live = false }
  }, [check])
  if (gate === 'checking') return <LogoSpinnerFill label="Opening the studio…" />
  if (gate === 'signin') return <SignIn asksPassword={asksPassword} onDone={() => location.reload()} />
  return <>{children}</>
}

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

export function SignIn({ asksPassword, onDone }: { asksPassword: boolean; onDone: () => void }) {
  const [user, setUser] = useState('')
  const [agency, setAgency] = useState('')
  const [password, setPassword] = useState('')
  const [fresh, setFresh] = useState('')
  const [again, setAgain] = useState('')
  const [challenge, setChallenge] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signIn = async (e: FormEvent) => {
    e.preventDefault()
    if (!user.trim() || !agency.trim()) { setError('Enter your user name and your agency.'); return }
    if (asksPassword && !password) { setError('Enter your password.'); return }
    setBusy(true); setError(null)
    try {
      const body = asksPassword
        ? { user: user.trim(), agency: agency.trim(), password }
        : { user: user.trim(), agency: agency.trim() }
      const { status, data } = await post('/api/auth/sign-in', body)
      if (data.ok) { onDone(); return }
      if (data.step === 'new_password' && typeof data.session === 'string') { setChallenge(data.session); setPassword(''); return }
      setError(typeof data.error === 'string' ? data.error : `Sign-in failed (${status}).`)
    } catch {
      setError('The studio could not be reached. Try again.')
    } finally { setBusy(false) }
  }

  const choose = async (e: FormEvent) => {
    e.preventDefault()
    if (fresh !== again) { setError('The two passwords are not the same.'); return }
    setBusy(true); setError(null)
    try {
      const { status, data } = await post('/api/auth/new-password', { username: accountName(user, agency), session: challenge, password: fresh })
      if (data.ok) { onDone(); return }
      setError(typeof data.error === 'string' ? data.error : `That did not work (${status}).`)
      if (typeof data.error === 'string' && /sign in again/i.test(data.error)) { setChallenge(null); setFresh(''); setAgain('') }
    } catch {
      setError('The studio could not be reached. Try again.')
    } finally { setBusy(false) }
  }

  return (
    <main className="si">
      <div className="si-card">
        <div className="si-mark"><StudioLogo size={20} /></div>
        {challenge === null ? (
          <form onSubmit={signIn} noValidate>
            <h1 className="si-h">Sign in to the studio</h1>
            <label className="si-f">
              <span>User name</span>
              <input name="user" autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={user} onChange={e => setUser(e.target.value)} autoFocus />
            </label>
            <label className="si-f">
              <span>Agency</span>
              <input name="agency" autoComplete="organization" autoCapitalize="none" spellCheck={false}
                value={agency} onChange={e => setAgency(e.target.value)} />
            </label>
            {asksPassword && (
              <label className="si-f">
                <span>Password</span>
                <input name="password" type="password" autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)} />
              </label>
            )}
            {error && <p className="si-err" role="alert">{error}</p>}
            <button className="si-go" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <p className="si-note">{asksPassword
              ? 'Your user name and first password come from your studio admin.'
              : 'Your studio admin adds your name to the studio.'}</p>
          </form>
        ) : (
          <form onSubmit={choose} noValidate>
            <h1 className="si-h">Choose your password</h1>
            <p className="si-lede">This is your first sign-in as <b>{accountName(user, agency)}</b>. Pick a password only you know: at least 10 characters, with a letter and a number.</p>
            <label className="si-f">
              <span>New password</span>
              <input type="password" autoComplete="new-password" value={fresh} onChange={e => setFresh(e.target.value)} autoFocus />
            </label>
            <label className="si-f">
              <span>The same again</span>
              <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} />
            </label>
            {error && <p className="si-err" role="alert">{error}</p>}
            <button className="si-go" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and open the studio'}</button>
          </form>
        )}
      </div>
      <footer className="si-foot"><PoweredByClan /></footer>
    </main>
  )
}
