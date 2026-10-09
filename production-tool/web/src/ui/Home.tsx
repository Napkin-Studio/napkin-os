// Home (features/project-home.clan): where the app opens after sign-in, and
// where the Napkin mark in the bar comes back to. Make a new ad, open a file,
// or pick up a saved project from its card. Everything here reads the project
// index (projects/projectIndex.ts); no project is open while Home shows.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useShell } from '../app/context'
import { effectiveConfig } from '../capabilities'
import { download } from '../export'
import { BetaTag } from '../dogfood/Dogfood'
import { errorShown, setScreen } from '../dogfood/recorder'
import { OwnKeysButton } from '../keys/OwnKeysPanel'
import { ordered, type ProjectEntry } from '../projects/projectIndex'
import type { ProjectSummary } from '../projects/summary'
import { clock, displayName, edited, greeting, stageChip } from './homeWords'
import { AgentFigure } from './agents/AgentFigure'
import { sayer, type CastKey } from './agents/cast'
import { useBlobUrl } from './hooks'
import { StudioMark } from './Mark'
import './home.css'

const CREW: CastKey[] = ['dex', 'ellis', 'jude']

export function Home() {
  const shell = useShell()
  const { app, index, relay, remoteConfig } = shell.deps
  const state = useSyncExternalStore(shell.subscribe, shell.get)
  const ui = useSyncExternalStore(app.subscribe, app.get)
  const projects = useSyncExternalStore(index.subscribe, index.all)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const config = useMemo(() => effectiveConfig(ui.configChoice, ui.providerChoice, undefined, remoteConfig), [ui.configChoice, ui.providerChoice, remoteConfig])
  const shown = ordered(projects, ui.homeSort, query)
  const who = displayName(ui.session?.handle)
  const first = projects.length === 0

  const act = (what: string, p: Promise<unknown>) => {
    setError(null)
    p.catch((e) => setError(`${what}: ${e instanceof Error ? e.message : String(e)}`))
  }
  useEffect(() => { setScreen({ stage: 'home' }) }, [])
  useEffect(() => { if (error) errorShown('home', error) }, [error])
  const newProject = () => act('Could not start a new project', shell.newProject())
  const chooseFile = () => fileRef.current?.click()

  return (
    <div className="home-view" data-dogfood-area="home">
      <HomeBar ownKeys={!!config.flags.ownKeys} />
      <main className="hm-scroll">
        <div className="hm-wrap">
          <div className="hm-head">
            <div>
              <div className="eyebrow">Home</div>
              <h1>{first ? `Welcome, ${who}` : `${greeting()}, ${who}`}</h1>
              <p>{first ? 'Your ads will live here.' : 'Start an ad from a picture or a script, or pick up where you left off.'}</p>
            </div>
            <span className="spacer" />
            {!first && (
              <label className="hm-search">
                <span aria-hidden>⌕</span>
                <input type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
              </label>
            )}
          </div>

          {error && <div className="hm-error" role="alert">{error} <button className="btn xs ghost" onClick={() => setError(null)}>OK</button></div>}
          {state.busy && <div className="hm-busy" role="status">{state.busy}</div>}

          <input ref={fileRef} type="file" accept=".zip,.clan,application/zip,application/vnd.clan+zip" hidden onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) act('Could not open that file', shell.openFile(f, f.name))
          }} />

          {first ? (
            <div className="hm-empty">
              <div className="hm-crew">{CREW.map((k) => <AgentFigure key={k} agent={k} size={46} />)}</div>
              <span className="hm-sayer">{sayer('dex')}</span>
              <b>Let's make your first ad</b>
              <p>Draw or drop your characters and write a few lines of script. I plan the shots, draw the frames and make the clips; Ellis reads your notes back and Jude checks each result.</p>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn primary" onClick={newProject} disabled={!!state.busy}>＋ New project</button>
                <button className="btn" onClick={chooseFile} disabled={!!state.busy}>Open a file…</button>
              </div>
            </div>
          ) : (
            <>
              <div className="hm-starts">
                <div className="hm-new" role="button" tabIndex={0} onClick={newProject} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), newProject())}>
                  <span className="eyebrow">New project</span>
                  <h2>Make a new ad</h2>
                  <p>Draw or drop your characters on the canvas, write the script, and the crew plans the shots, draws the frames and makes the clips.</p>
                  <button className="hm-go" tabIndex={-1} disabled={!!state.busy}>＋ New project</button>
                  <div className="hm-say"><b>{sayer('dex')}</b>Bring a picture or a line of script. I'll take it from there.</div>
                  <div className="hm-crewline" aria-hidden>{CREW.map((k) => <AgentFigure key={k} agent={k} size={48} decorative />)}</div>
                </div>
                <div className="hm-open" role="button" tabIndex={0} onClick={chooseFile} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), chooseFile())}>
                  <span className="hm-ico" aria-hidden>⇪</span>
                  <b>Open a file</b>
                  <p>An Export zip or a .clan from this or another computer. It comes back as a project, with its pictures and canvas.</p>
                  <button className="btn sm" tabIndex={-1} style={{ alignSelf: 'flex-start', marginTop: 4 }}>Choose a file…</button>
                </div>
              </div>

              <div className="hm-sechead">
                <h3>Your projects</h3><span className="faint">{projects.length}</span>
                <span className="spacer" />
                <div className="hm-tabs" role="tablist" aria-label="Order">
                  {(['recent', 'name'] as const).map((s) => (
                    <button key={s} role="tab" aria-selected={ui.homeSort === s} className={ui.homeSort === s ? 'on' : ''} onClick={() => app.update((a) => { a.homeSort = s })}>{s === 'recent' ? 'Recent' : 'Name'}</button>
                  ))}
                </div>
              </div>
              {shown.length === 0 && <p className="faint">No project is called that.</p>}
              <div className="hm-grid">
                {shown.map((p) => (
                  <ProjectCard key={p.id} p={p} menu={menuFor === p.id} onMenu={(open) => setMenuFor(open ? p.id : null)} onError={setError} />
                ))}
              </div>
            </>
          )}

          <div className="hm-foot">
            {ui.savedAt && relay.kind === 'http' && <span className="hm-cloud">☁ Saved to the server · {clock(ui.savedAt)}</span>}
            <span>Projects live in this browser{relay.kind === 'http' ? ' and save to the server as you work' : ''}. Opening them on another computer comes with the server work.</span>
          </div>
        </div>
      </main>
    </div>
  )
}

function HomeBar({ ownKeys }: { ownKeys: boolean }) {
  const shell = useShell()
  const { relay, app } = shell.deps
  const ui = useSyncExternalStore(app.subscribe, app.get)
  const [menu, setMenu] = useState(false)
  return (
    <header className="hm-bar">
      <span className="hm-brand">
        <StudioMark size={22} />
        <span className="hm-studio">Napkin Studio</span>
        <span className="hm-tool">Production</span>
        <BetaTag screen={{ stage: 'home' }} />
        {relay.kind === 'mock' && <span className="mockbadge" title="No relay set: every result is a mock">MOCK</span>}
      </span>
      <span />
      <span className="hm-right">
        {ownKeys && <OwnKeysButton />}
        <span className="topmenu">
          <button className={`btn sm icon ${menu ? 'on' : ''}`} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
          {menu && (
            <span className="menu" role="menu">
              <span className="handle menu-head">@{ui.session?.handle ?? 'guest'}</span>
              {relay.kind === 'http' && ui.session && (
                <button className="btn sm ghost" role="menuitem" onClick={() => {
                  setMenu(false)
                  relay.useToken(null)
                  app.update((u) => { u.session = undefined; u.sessionFor = undefined })
                }}>Sign out</button>
              )}
            </span>
          )}
        </span>
      </span>
    </header>
  )
}

function ProjectCard({ p, menu, onMenu, onError }: { p: ProjectEntry; menu: boolean; onMenu: (open: boolean) => void; onError: (m: string) => void }) {
  const shell = useShell()
  const thumb = useBlobUrl(p.summary.thumb)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [draft, setDraft] = useState(p.name)
  const box = useRef<HTMLDivElement>(null)
  const making = p.summary.active > 0

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!menu) return
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onMenu(false)
    }
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [menu, onMenu])

  const fail = (what: string) => (e: unknown) => onError(`${what}: ${e instanceof Error ? e.message : String(e)}`)
  const open = () => {
    if (renaming || deleting) return
    shell.open(p.id).catch(fail('Could not open the project'))
  }
  const item = (label: string, fn: () => void, cls = '') => (
    <button role="menuitem" className={cls} onClick={(e) => { e.stopPropagation(); onMenu(false); fn() }}>{label}</button>
  )

  return (
    <div ref={box} className={`hm-card ${menu ? 'menu-open' : ''}`} role="button" tabIndex={0} aria-label={`Open ${p.name}`} onClick={open}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && open()}>
      <div className="hm-th">
        {thumb ? <img src={thumb} alt="" draggable={false} /> : <Placeholder stage={p.summary.stage} />}
        {making && <span className="hm-badge live">Making</span>}
        {p.summary.shots > 0 && <div className="hm-strip" aria-hidden>{Array.from({ length: Math.min(p.summary.shots, 6) }, (_, i) => <i key={i} />)}</div>}
        <button className="hm-more" aria-label={`More for ${p.name}`} aria-haspopup="menu" aria-expanded={menu}
          onClick={(e) => { e.stopPropagation(); onMenu(!menu) }}>⋯</button>
      </div>
      {menu && (
        <div className="hm-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          {item('Open', open)}
          {item('Rename', () => { setDraft(p.name); setRenaming(true) })}
          {item('Duplicate', () => void shell.duplicate(p.id).catch(fail('Could not duplicate it')))}
          {item('Export', () => void shell.exportProject(p.id).then(({ blob, name }) => download(blob, name)).catch(fail('Could not export it')))}
          <hr />
          {item('Delete…', () => setDeleting(true), 'del')}
        </div>
      )}
      <div className="hm-m">
        {renaming ? (
          <form className="hm-rename" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
            e.preventDefault()
            setRenaming(false)
            void shell.rename(p.id, draft)
          }}>
            <input className="input" value={draft} autoFocus aria-label="Project name" maxLength={80}
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)} onBlur={() => setRenaming(false)} />
          </form>
        ) : <b title={p.name}>{p.name}</b>}
        <div className="row"><StageChip s={p.summary} /><span>· {edited(p.updated)}</span></div>
        {making && p.summary.making && <span className="hm-work"><AgentFigure agent="dex" state="working" size={19} decorative />{p.summary.making}</span>}
        {deleting && (
          <div className="hm-confirm" role="alertdialog" aria-label={`Delete ${p.name}?`} onClick={(e) => e.stopPropagation()}>
            <span>Delete “{p.name}” from this browser? Its pictures and the server's copy are kept.</span>
            <div className="row">
              <span className="spacer" />
              <button className="btn xs ghost" onClick={() => setDeleting(false)}>Keep</button>
              <button className="btn xs danger" autoFocus onClick={() => { setDeleting(false); shell.remove(p.id).catch(fail('Could not delete it')) }}>Delete</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StageChip({ s }: { s: ProjectSummary }) {
  const { tone, text } = stageChip(s)
  return <span className={`hm-stage ${tone}`}><span className="dot" />{text}</span>
}

function Placeholder({ stage }: { stage: ProjectSummary['stage'] }) {
  return (
    <div className={`hm-ph ${stage}`} aria-hidden>
      <StudioMark size={28} />
    </div>
  )
}
