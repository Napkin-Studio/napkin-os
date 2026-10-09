// What shows: sign in, Home, or the open project (features/project-home.clan).
// Each project gets its own services (document, UI, runner), and the App is
// keyed by the project, so nothing on screen carries over from another one.

import { useState, useSyncExternalStore } from 'react'
import { App } from './App'
import { OwnKeysContext, ServicesContext, ShellContext } from './app/context'
import { relayId } from './relay'
import type { Shell } from './projects/shell'
import { Home } from './ui/Home'
import { StudioMark } from './ui/Mark'

export function Root({ shell }: { shell: Shell }) {
  const state = useSyncExternalStore(shell.subscribe, shell.get)
  const app = useSyncExternalStore(shell.deps.app.subscribe, shell.deps.app.get)
  const { relay } = shell.deps
  let body
  if (relay.kind === 'http' && !app.session) body = <SignIn shell={shell} />
  else if (state.view === 'project' && state.session) {
    body = (
      <ServicesContext.Provider value={state.session.services} key={state.session.id}>
        <App initialCanvas={state.session.initialCanvas} />
      </ServicesContext.Provider>
    )
  } else body = <Home />
  return (
    <ShellContext.Provider value={shell}>
      <OwnKeysContext.Provider value={shell.deps.ownKeys}>{body}</OwnKeysContext.Provider>
    </ShellContext.Provider>
  )
}

function SignIn({ shell }: { shell: Shell }) {
  const { relay, app } = shell.deps
  const [code, setCode] = useState('')
  const [handle, setHandle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ display: 'flex', flex: 1, background: 'var(--soft)' }}>
      <form className="card signin stack" onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          const s = await relay.session({ eventCode: code.trim(), handle: handle.trim() })
          relay.useToken(s.token)
          app.update((u) => { u.session = s; u.sessionFor = relayId() })
          // Signing in opens on Home. The project you open next becomes yours (projects/session.ts).
          await shell.goHome()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not sign in.')
        } finally {
          setBusy(false)
        }
      }}>
        <div className="row" style={{ gap: 10 }}><StudioMark size={28} /><b style={{ fontSize: 18, letterSpacing: '-0.02em' }}>Napkin Production Tool</b></div>
        <p className="muted" style={{ margin: 0 }}>Make your characters on a free canvas, storyboard them, and turn it into an ad.</p>
        <label className="stack" style={{ gap: 4 }}><span className="eyebrow">Event code</span><input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></label>
        <label className="stack" style={{ gap: 4 }}><span className="eyebrow">Your name</span><input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} pattern="[A-Za-z0-9_.\-]{2,24}" title="2-24 letters, numbers, . _ or -" /></label>
        {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div>}
        <button className="btn primary" disabled={busy || code.trim().length < 4 || handle.trim().length < 2}>{busy ? 'Signing in…' : 'Start'}</button>
      </form>
    </div>
  )
}
