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

export function Root({ shell }: { shell: Shell }) {
  const state = useSyncExternalStore(shell.subscribe, shell.get)
  const app = useSyncExternalStore(shell.deps.app.subscribe, shell.deps.app.get)
  const { relay } = shell.deps
  let body
  if (relay.kind === 'http' && !app.me) body = <SignedOut />
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

/** GET /me said no one (401): the tool has no sign-in of its own; Napkin Studio's signs you in
 *  (features/drop-hackathon-extras.clan; wired in by features/os-sign-in). */
function SignedOut() {
  return (
    <div style={{ display: 'flex', flex: 1, background: 'var(--soft)' }}>
      <div className="card signin stack" role="status">
        <div className="row" style={{ gap: 10 }}><StudioMark size={28} /><b style={{ fontSize: 18, letterSpacing: '-0.02em' }}>Napkin Production Tool</b></div>
        <p style={{ margin: 0 }}>Sign in through Napkin Studio to use the Production Tool.</p>
      </div>
    </div>
  )
}
