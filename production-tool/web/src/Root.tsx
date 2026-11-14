// What shows: signed out, Home, or the open project (features/project-home.clan).
// Each project gets its own services (document, UI, runner), and the App is
// keyed by the project, so nothing on screen carries over from another one.

import { useEffect, useSyncExternalStore } from 'react'
import { App } from './App'
import { DogfoodGate } from './dogfood/Dogfood'
import { RouterContext, ServicesContext, ShellContext } from './app/context'
import type { Router } from './app/route'
import type { Shell } from './projects/shell'
import { Home } from './ui/Home'
import { MarkTile } from './ui/chrome/Bar'
import { NO_ACCESS, signInHref, type Access, type AccessStore } from './relay/access'
import './ui/home.css'

export function Root({ shell, access, router }: { shell: Shell; access: AccessStore; router: Router }) {
  const state = useSyncExternalStore(shell.subscribe, shell.get)
  const app = useSyncExternalStore(shell.deps.app.subscribe, shell.deps.app.get)
  const why = useSyncExternalStore(access.subscribe, access.get)
  const { relay } = shell.deps
  const route = useSyncExternalStore(router.subscribe, router.get)
  // Reduce motion (ui-behaviour 6.6): the account menu's switch stills every loader and animation.
  useEffect(() => {
    if (app.motion === 'still') document.documentElement.dataset.motion = 'still'
    else delete document.documentElement.dataset.motion
  }, [app.motion])
  // An editor's route belongs to its open project: on Home, or in another project, it goes.
  const open = state.view === 'project' ? state.session?.id : undefined
  useEffect(() => {
    if (route.kind === 'script' && route.projectId !== open && !state.busy) router.replace({ kind: 'none' })
  }, [route, open, state.busy, router])
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
      <RouterContext.Provider value={router}>
        {body}
        {/* The beta's notice, once signed in (features/production-tool-dogfood.clan). */}
        <DogfoodGate shell={shell} />
      </RouterContext.Provider>
    </ShellContext.Provider>
  )
}

/** Why this person cannot use the tool now (relay/access.ts; UI spec 3.15). The tool has no sign-in
 *  of its own: Napkin Studio's signs you in and comes back to this same page (features/os-sign-in.clan). */
function NoAccess({ why }: { why: Exclude<Access, 'ok'> }) {
  const words = NO_ACCESS[why]
  return (
    <div className="pt-grid" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <header className="hm-bar">
        <span className="hm-brand">
          <MarkTile />
          <span className="hm-studio">Napkin Studio</span>
          <span className="hm-tool">Production</span>
        </span>
      </header>
      <div className="card signin stack" role="status">
        <b className="signin-title">{words.title}</b>
        {words.body && <p style={{ margin: 0 }}>{words.body}</p>}
        {why === 'signed_out' && (
          <div className="row" style={{ justifyContent: 'center' }}><a className="btn primary" href={signInHref(location)}>Sign in</a></div>
        )}
      </div>
    </div>
  )
}
