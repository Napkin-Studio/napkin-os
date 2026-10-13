// What shows: signed out, Home, or the open project (features/project-home.clan).
// Each project gets its own services (document, UI, runner), and the App is
// keyed by the project, so nothing on screen carries over from another one.

import { useSyncExternalStore } from 'react'
import { App } from './App'
import { DogfoodGate } from './dogfood/Dogfood'
import { ServicesContext, ShellContext } from './app/context'
import type { Shell } from './projects/shell'
import { Home } from './ui/Home'
import { StudioMark } from './ui/Mark'
import { NO_ACCESS, signInHref, type Access, type AccessStore } from './relay/access'
import './ui/home.css'

export function Root({ shell, access }: { shell: Shell; access: AccessStore }) {
  const state = useSyncExternalStore(shell.subscribe, shell.get)
  const app = useSyncExternalStore(shell.deps.app.subscribe, shell.deps.app.get)
  const why = useSyncExternalStore(access.subscribe, access.get)
  const { relay } = shell.deps
  let body
  if (relay.kind === 'http' && (why !== 'ok' || !app.me)) body = <NoAccess why={why === 'ok' ? 'signed_out' : why} />
  else if (state.view === 'project' && state.session) {
    body = (
      <ServicesContext.Provider value={state.session.services} key={state.session.id}>
        <App initialCanvas={state.session.initialCanvas} />
      </ServicesContext.Provider>
    )
  } else body = <Home />
  return (
    <ShellContext.Provider value={shell}>
      {body}
      {/* The beta's notice, once signed in (features/production-tool-dogfood.clan). */}
      <DogfoodGate shell={shell} />
    </ShellContext.Provider>
  )
}

/** Why this person cannot use the tool now (relay/access.ts; UI spec 3.15). The tool has no sign-in
 *  of its own: Napkin Studio's signs you in and comes back to this same page (features/os-sign-in.clan). */
function NoAccess({ why }: { why: Exclude<Access, 'ok'> }) {
  const words = NO_ACCESS[why]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: 'var(--soft)' }}>
      <header className="hm-bar">
        <span className="hm-brand">
          <StudioMark size={22} />
          <span className="hm-studio">Napkin Studio</span>
          <span className="hm-tool">Production</span>
        </span>
      </header>
      <div className="card signin stack" role="status">
        <b style={{ fontSize: 18, letterSpacing: '-0.02em' }}>{words.title}</b>
        {words.body && <p style={{ margin: 0 }}>{words.body}</p>}
        {why === 'signed_out' && (
          <div className="row"><a className="btn primary" href={signInHref(location)}>Sign in</a></div>
        )}
      </div>
    </div>
  )
}
