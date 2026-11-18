// What shows: signed out, Home, or the open project (features/project-home.clan).
// Each project gets its own services (document, UI, runner), and the App is
// keyed by the project, so nothing on screen carries over from another one.

import { useEffect, useSyncExternalStore } from 'react'
import { App } from './App'
import { DogfoodGate } from './dogfood/Dogfood'
import { RouterContext, ServicesContext, ShellContext } from './app/context'
import { routeProject, type Router } from './app/route'
import type { Shell } from './projects/shell'
import { Home } from './ui/Home'
import { LookProvider } from './ui/shell/look'
import { PlaceBar } from './ui/shell/ShellBar'
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
  // A project's route belongs to it being open: on Home, or in another project, it goes (the open project's
  // App writes its own; app/useProjectRoute).
  const open = state.view === 'project' ? state.session?.id : undefined
  useEffect(() => {
    const of = routeProject(route)
    if (of && of !== open && !state.busy) router.replace({ kind: 'none' })
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
        {/* The agency's look, from who is signed in (features/production-new-ui.clan). */}
        <LookProvider me={app.me}>
          {body}
          {/* The beta's notice, once signed in (features/production-tool-dogfood.clan). */}
          <DogfoodGate shell={shell} />
        </LookProvider>
      </RouterContext.Provider>
    </ShellContext.Provider>
  )
}

/** Why this person cannot use the tool now (relay/access.ts; UI spec 3.15), under the shell bar of the new UI.
 *  The tool has no sign-in of its own: Napkin Studio's signs you in and comes back to this same page
 *  (features/os-sign-in.clan). */
function NoAccess({ why }: { why: Exclude<Access, 'ok'> }) {
  const words = NO_ACCESS[why]
  return (
    <div className="access-view" data-access={why}>
      <PlaceBar />
      <main className="access-main">
        <section className="access-card" role="status">
          <span className="lbl">Production</span>
          <h1>{words.title}</h1>
          {words.body && <p>{words.body}</p>}
          {why === 'signed_out' && <a className="btn-rect primary" href={signInHref(location)}>Sign in</a>}
        </section>
      </main>
    </div>
  )
}
