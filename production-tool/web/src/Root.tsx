// What shows: sign in, Home, or the open project (features/project-home.clan).
// Each project gets its own services (document, UI, runner), and the App is
// keyed by the project, so nothing on screen carries over from another one.

import { useState, useSyncExternalStore } from 'react'
import { App } from './App'
import { DogfoodGate } from './dogfood/Dogfood'
import { OwnKeysContext, ServicesContext, ShellContext } from './app/context'
import { relayId } from './relay'
import { welcomeBack } from './projects/homeList'
import { deviceId, elsewhereWords, nameProblem, teamProblem, whoWithTeam } from './projects/signIn'
import type { Shell } from './projects/shell'
import { Home } from './ui/Home'
import { displayName } from './ui/homeWords'
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
      {/* The beta's notice, once after sign-in (features/production-tool-dogfood.clan). */}
      <DogfoodGate shell={shell} />
    </ShellContext.Provider>
  )
}

function SignIn({ shell }: { shell: Shell }) {
  const { relay, app } = shell.deps
  const [code, setCode] = useState('')
  const [team, setTeam] = useState('')
  const [handle, setHandle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The same team and name signed in from another browser recently: ask before going on.
  const [elsewhere, setElsewhere] = useState<{ words: string; go: () => Promise<void> } | null>(null)
  const teamWhy = team.trim() ? teamProblem(team) : null
  const nameWhy = handle.trim() ? nameProblem(handle) : null

  if (elsewhere) {
    return (
      <div style={{ display: 'flex', flex: 1, background: 'var(--soft)' }}>
        <div className="card signin stack" role="alertdialog" aria-labelledby="elsewhere-head">
          <div className="row" style={{ gap: 10 }}><StudioMark size={28} /><b id="elsewhere-head" style={{ fontSize: 18, letterSpacing: '-0.02em' }}>Is this you?</b></div>
          <p style={{ margin: 0 }}>{elsewhere.words}</p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => {
              // Not them: the session was never kept, so nothing to undo; they pick another name.
              setElsewhere(null)
              setHandle('')
            }}>Use another name</button>
            <button className="btn primary" autoFocus onClick={() => void elsewhere.go()}>That's me</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flex: 1, background: 'var(--soft)' }}>
      <form className="card signin stack" onSubmit={async (e) => {
        e.preventDefault()
        if (teamProblem(team) || nameProblem(handle)) return
        setBusy(true)
        setError(null)
        try {
          const s = await relay.session({ eventCode: code.trim(), team: team.trim().split(/\s+/).join(' '), handle: handle.trim(), device: deviceId() })
          // Kept only once the person goes on: storing it swaps this screen for Home, so a question
          // about the same name in the same team has to be answered first.
          const go = async () => {
            setElsewhere(null)
            relay.useToken(s.token)
            app.update((u) => { u.session = s; u.sessionFor = relayId() })
            // Signing in opens on Home. The project you open next becomes yours (projects/session.ts).
            await shell.goHome()
            // A name that already has saved work says so, so a second person who picks it notices.
            shell.say(welcomeBack(whoWithTeam(displayName(s.handle), s.team), s.projects ?? 0))
          }
          if (s.elsewhere) setElsewhere({ words: elsewhereWords(displayName(s.handle), s.team ?? team.trim(), s.elsewhere.at), go })
          else await go()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not sign in.')
        } finally {
          setBusy(false)
        }
      }}>
        <div className="row" style={{ gap: 10 }}><StudioMark size={28} /><b style={{ fontSize: 18, letterSpacing: '-0.02em' }}>Napkin Production Tool</b></div>
        <p className="muted" style={{ margin: 0 }}>Make your characters on a free canvas, storyboard them, and turn it into an ad.</p>
        <label className="stack" style={{ gap: 4 }}><span className="eyebrow">Event code</span><input className="input" value={code} onChange={(e) => { setCode(e.target.value); setError(null) }} autoFocus /></label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Team name</span>
          <input className="input" value={team} maxLength={80} onChange={(e) => { setTeam(e.target.value); setError(null) }} aria-describedby="team-hint" aria-invalid={!!teamWhy} />
          <small id="team-hint" className={teamWhy ? 'field-error' : 'faint'}>{teamWhy ?? 'Any name for your team. With your name, it keeps your work apart from anyone else with your name.'}</small>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Your name</span>
          <input className="input" value={handle} onChange={(e) => { setHandle(e.target.value); setError(null) }} aria-describedby="name-hint" aria-invalid={!!nameWhy} />
          <small id="name-hint" className={nameWhy ? 'field-error' : 'faint'}>{nameWhy ?? '2 to 24 letters, numbers, . _ or -'}</small>
        </label>
        {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div>}
        <button className="btn primary" disabled={busy || code.trim().length < 4 || !team.trim() || !handle.trim() || !!teamWhy || !!nameWhy}>{busy ? 'Signing in…' : 'Start'}</button>
      </form>
    </div>
  )
}
