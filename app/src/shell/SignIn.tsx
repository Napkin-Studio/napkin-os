// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Signing in to the studio (napkin-web's /api/auth/*, crates/napkin-web/src/auth.rs).
//
// A server with accounts answers /api/session with 401 {signin: true} until a
// person signs in with one name, `name@agency` (owner, 2026-10-05). The 401 says
// whether the server asks for a password too (`password`): a roster server
// (NAPKIN_AUTH=roster) does not, and the name and agency are enough. Where
// there are passwords, the first sign-in with the temporary password an admin
// gave asks for the person's own, then the studio opens. The gate renders the studio unchanged when the server has no
// accounts (anonymous mode), when the page is the public viewer, on the
// device and on the desktop.
//
// The screen is the approved mock's (design/new-ui/napkin-app-v1.html,
// .p33-signin): one paper card on the desk, the medallion, the heading, then
// the fields. It always opens in Napkin's own look, after a sign-out too
// (owner, 2026-11-11), and takes an agency's look ("template") as the person
// types: the part after the @ (or an email's domain before its TLD) picks the
// agency from the admin registry (agency/palette.ts AGENCY_COLOURS), and the
// medallion, the line under the heading, the desk and the Sign in button take
// its name and colours. Only the registry is read, never the roster or the
// server, so the look says nothing about who has an account.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { LogoSpinnerFill } from '../brand/LogoSpinner'
import { DeepOMark } from '../brand/DeepOMark'
import { accountName, isAccountName } from './accountName'
import { agencyOfSignInName, applyAgency } from './agency/palette'
import { LOOK_DELAY_MS, signInLookOf, type SignInLook } from './agency/signInLook'
import { justSignedOut, markSignedOut, rememberAgency } from './agency/lastAgency'
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

/** The look for the typed name, a moment after typing rests, and on the page (desk, paper, action colour). */
function useSignInLook(typed: string): SignInLook {
  const want = agencyOfSignInName(typed)
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    if (want === id) return
    const t = setTimeout(() => setId(want), LOOK_DELAY_MS)
    return () => clearTimeout(t)
  }, [want, id])
  // Napkin's layer when nobody is named (it replaces the last agency's the boot screen painted).
  useEffect(() => { applyAgency(id ? `_@${id}` : null) }, [id])
  return signInLookOf(id ? `_@${id}` : '')
}

/** The agency's wordmark on the card, the copy for each theme's paper (CSS shows the one that reads); nothing without one. */
function AgencyWordmark({ look }: { look: SignInLook }) {
  const { light, dark } = look.wordmark
  if (!look.name || (!light && !dark)) return null
  return (
    <span className="si-agency" key={look.id ?? 'none'} data-testid="signin-wordmark">
      {light && <img className="on-light" src={light} alt={look.name} />}
      {dark && <img className="on-dark" src={dark} alt={look.name} />}
    </span>
  )
}

export function SignIn({ asksPassword, onDone }: { asksPassword: boolean; onDone: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [fresh, setFresh] = useState('')
  const [again, setAgain] = useState('')
  const [challenge, setChallenge] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [signedOut] = useState(justSignedOut)
  const agency = useSignInLook(name)
  const done = () => { markSignedOut(false); rememberAgency(accountName(name)); onDone() }

  const signIn = async (e: FormEvent) => {
    e.preventDefault()
    if (!isAccountName(name)) { setError('Enter your sign-in name as name@agency.'); return }
    if (asksPassword && !password) { setError('Enter your password.'); return }
    setBusy(true); setError(null)
    try {
      const body = asksPassword
        ? { username: accountName(name), password }
        : { username: accountName(name) }
      const { status, data } = await post('/api/auth/sign-in', body)
      if (data.ok) { done(); return }
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
      const { status, data } = await post('/api/auth/new-password', { username: accountName(name), session: challenge, password: fresh })
      if (data.ok) { done(); return }
      setError(typeof data.error === 'string' ? data.error : `That did not work (${status}).`)
      if (typeof data.error === 'string' && /sign in again/i.test(data.error)) { setChallenge(null); setFresh(''); setAgain('') }
    } catch {
      setError('The studio could not be reached. Try again.')
    } finally { setBusy(false) }
  }

  const heading = signedOut ? 'Signed out.' : 'Sign in.'
  return (
    <main className="nui p33-signin" data-agency={agency.id ?? 'none'}>
      {challenge === null ? (
        <form className="si-card" onSubmit={signIn} noValidate>
          <span className="si-mark" key={agency.id ?? 'none'}><DeepOMark size={54} palette={agency.mark} shared state="awake" progress={0} testId="medallion-mark" /></span>
          <AgencyWordmark look={agency} />
          <h2>{heading}</h2>
          <p data-testid="signin-lede">{agency.lede}</p>
          <label>
            Sign-in name
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
              placeholder="name@agency" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </label>
          {asksPassword && (
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)} />
            </label>
          )}
          {error && <p className="si-err" role="alert">{error}</p>}
          <button className="btn-rect primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {asksPassword ? (
            forgot
              ? <p className="si-note" role="status">Your sign-in name and first password come from your studio admin. Ask them to reset it.</p>
              : <button type="button" className="side-link" onClick={() => setForgot(true)}>Forgot your password?</button>
          ) : <p className="si-note">Your studio admin adds your name to the studio.</p>}
        </form>
      ) : (
        <form className="si-card" onSubmit={choose} noValidate>
          <span className="si-mark" key={agency.id ?? 'none'}><DeepOMark size={54} palette={agency.mark} shared state="awake" progress={0} testId="medallion-mark" /></span>
          <h2>Choose your password.</h2>
          <p>This is your first sign-in as <b>{accountName(name)}</b>. Pick a password only you know: at least 10 characters, with a letter and a number.</p>
          <label>
            New password
            <input type="password" autoComplete="new-password" value={fresh} onChange={e => setFresh(e.target.value)} autoFocus />
          </label>
          <label>
            The same again
            <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} />
          </label>
          {error && <p className="si-err" role="alert">{error}</p>}
          <button className="btn-rect primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and open the studio'}</button>
        </form>
      )}
    </main>
  )
}
