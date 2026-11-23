// All projects (features/project-home.clan; owner 2026-11-18, features/production-new-ui.clan): the films in this
// browser and on the server, in the new design language (the mock's Production home: the paper film cards with
// their slate, the role spheres). Never shown on entry: entry is the blank canvas. It is reached from the film's
// ▾ menu (All projects) and the medallion. Open a file, sort, search, open, rename, duplicate, export, delete.
// Everything here reads the project index (projects/projectIndex.ts); no project is open while it shows.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useShell } from '../app/context'
import { download } from '../export'
import { errorShown, setScreen } from '../dogfood/recorder'
import type { SavedProject } from '../contracts/types'
import { deleteWords } from '../projects/deleteWords'
import { homeItems, itemId } from '../projects/homeList'
import type { ProjectEntry } from '../projects/projectIndex'
import type { ProjectSummary } from '../projects/summary'
import { clock, edited, refusalNotice, stageChip } from './homeWords'
import { AgentFigure } from './agents/AgentFigure'
import { DataSharing } from './DataSharing'
import { CAST, CREW_ORDER } from './agents/cast'
import { useBlobUrl } from './hooks'
import { Account } from './chrome/Bar'
import { PlaceBar } from './shell/ShellBar'
import { useLook } from './shell/lookContext'
import './home.css'

export function Home() {
  const shell = useShell()
  const { app, index, relay } = shell.deps
  const state = useSyncExternalStore(shell.subscribe, shell.get)
  const ui = useSyncExternalStore(app.subscribe, app.get)
  const projects = useSyncExternalStore(index.subscribe, index.all)
  const look = useLook()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // The projects this person saved on the relay, from any browser (features/personal-workspaces.clan).
  const [saved, setSaved] = useState<SavedProject[]>([])
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const signedIn = ui.me?.participantId
  useEffect(() => {
    let live = true
    shell.serverProjects().then((rows) => {
      if (!live) return
      setSaved(rows)
      setSavedNote(null)
    }, () => {
      if (live) setSavedNote('Could not list the projects you saved on the server. Those in this browser are below.')
    })
    return () => { live = false }
  }, [shell, signedIn])
  // A blank film that never got anything is not a project (owner 2026-11-18): drafts are not listed.
  const own = projects.filter((p) => !p.draft)
  const all = homeItems(own, saved)
  const shown = homeItems(own, saved, ui.homeSort, query)

  const act = (what: string, p: Promise<unknown>) => {
    setError(null)
    p.catch((e) => setError(`${what}: ${e instanceof Error ? e.message : String(e)}`))
  }
  useEffect(() => { setScreen({ stage: 'home' }) }, [])
  useEffect(() => { if (error) errorShown('home', error) }, [error])
  const newProject = () => act('Could not start a new film', shell.newProject())
  const chooseFile = () => fileRef.current?.click()
  const agency = look.solo ? 'Napkin Studio' : look.name

  return (
    <div className="home-view pp" data-dogfood-area="home">
      <HomeBar />
      <main className="hm-scroll">
        <div className="pp-page">
          <div className="pp-head">
            <div>
              <div className="pp-eyebrow">{agency} · Production</div>
              <h1 className="pp-title">All projects<span className="dot" /></h1>
              <p className="pp-sub">Scripts, storyboards and films, made together on one canvas.</p>
            </div>
          </div>

          {state.notice && (
            <div className="pp-notice" role="status">
              <span>{refusalNotice(state.notice)} <span className="faint">It was left as it was.</span></span>
              <button type="button" className="btn-rect" onClick={() => shell.say(null)}>OK</button>
            </div>
          )}
          {error && <div className="pp-error" role="alert">{error} <button type="button" className="btn-rect" onClick={() => setError(null)}>OK</button></div>}
          {savedNote && <div className="pp-notice" role="status"><span>{savedNote}</span></div>}
          {state.busy && <div className="hm-busy" role="status">{state.busy}</div>}

          <input ref={fileRef} type="file" accept=".zip,.clan,application/zip,application/vnd.clan+zip" hidden onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) act('Could not open that file', shell.openFile(f, f.name))
          }} />

          <div className="pp-grid">
            <div>
              <div className="pp-sechead">
                <h2>{all.length ? 'Pick one to open, or start a new film' : 'No films yet'}</h2>
                <span className="pp-grow" />
                {all.length > 0 && (
                  <label className="pp-search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
                    <input type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
                  </label>
                )}
                {all.length > 0 && (
                  <div className="seg-row sm" role="tablist" aria-label="Order">
                    {(['recent', 'name'] as const).map((s) => (
                      <button key={s} type="button" role="tab" aria-selected={ui.homeSort === s} aria-pressed={ui.homeSort === s} onClick={() => app.update((a) => { a.homeSort = s })}>{s === 'recent' ? 'Recent' : 'Name'}</button>
                    ))}
                  </div>
                )}
              </div>
              {all.length > 0 && shown.length === 0 && <p className="faint">No project is called that.</p>}
              <div className="film-cards">
                {shown.map((i) => i.kind === 'local' ? (
                  <ProjectCard key={i.p.id} p={i.p} server={i.server} newerThere={i.newerThere} menu={menuFor === i.p.id}
                    onMenu={(open) => setMenuFor(open ? i.p.id : null)} onError={setError} />
                ) : (
                  <ServerCard key={itemId(i)} row={i.row} name={i.name} onError={setError} />
                ))}
                <div className="film-card new">
                  <span className="lbl">New</span>
                  <button type="button" className="side-link big" onClick={newProject} disabled={!!state.busy}>+ New film</button>
                  <small className="muted">Opens a blank canvas</small>
                  <span className="pp-grow" />
                  <button type="button" className="side-link" onClick={chooseFile} disabled={!!state.busy}>Open a file…</button>
                  <small className="faint">A Napkin file (.clan) or an export .zip</small>
                </div>
              </div>
              <p className="pp-foot">
                {ui.savedAt && relay.kind === 'http' && <>Saved to the server · {clock(ui.savedAt)} · </>}
                {all.length} {all.length === 1 ? 'film' : 'films'} · {relay.kind === 'http'
                  ? 'Films save to the server as you work. Sign in to Napkin Studio on any computer to open them there.'
                  : 'Films live in this browser.'}
              </p>
            </div>
            <aside>
              <h3 className="lbl pp-asidehead">The agents in Production</h3>
              <div className="crewlist">
                {CREW_ORDER.map((k) => (
                  <div key={k} className="r"><AgentFigure agent={k} size={28} decorative /><span><b>{CAST[k].given}</b><small>{CAST[k].role}</small></span></div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  )
}

/** The bar where no film is open (ui/shell/ShellBar.tsx PlaceBar): no Beta tag, no thumbs (owner 2026-11-19). */
function HomeBar() {
  const shell = useShell()
  const { app } = shell.deps
  const ui = useSyncExternalStore(app.subscribe, app.get)
  const [sharing, setSharing] = useState(false)
  const allow = ui.me?.allow
  return (
    <>
      <PlaceBar place="All projects"
        account={(
          // The account menu every bar has: who you are, the theme, Reduce motion, Sign out.
          <Account>
            {/* Who receives the agency's material (features/tenant-limits.clan). */}
            {allow && <button type="button" className="pt-menurow" onClick={() => setSharing(true)}>Data sharing</button>}
          </Account>
        )} />
      {sharing && allow && <DataSharing allow={allow} onClose={() => setSharing(false)} />}
    </>
  )
}

/** A project saved on the server from another browser: opening it brings it, and every picture it uses, here. */
function ServerCard({ row, name, onError }: { row: SavedProject; name: string; onError: (m: string) => void }) {
  const shell = useShell()
  const open = () => {
    shell.openFromServer(row).catch((e) => onError(`Could not open “${name}”: ${e instanceof Error ? e.message : String(e)}`))
  }
  return (
    <div className="film-card" role="button" tabIndex={0} aria-label={`Open ${name} from the server`} onClick={open}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && open()}>
      <span className="slate">On the server</span>
      <div className="strip empty" aria-hidden><span>☁</span></div>
      <div className="t"><b title={name}>{name}</b><div className="st">On the server · not in this browser yet</div></div>
      <div className="kv"><span>Saved</span><span>{edited(row.savedAt).replace(/^edited /, '')}</span></div>
    </div>
  )
}

function ProjectCard({ p, server, newerThere, menu, onMenu, onError }: {
  p: ProjectEntry; server?: SavedProject; newerThere: boolean; menu: boolean; onMenu: (open: boolean) => void; onError: (m: string) => void
}) {
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
    <button type="button" role="menuitem" className={`pt-menurow ${cls}`} onClick={(e) => { e.stopPropagation(); onMenu(false); fn() }}>{label}</button>
  )

  const chip = stageChip(p.summary)
  return (
    <div ref={box} className={`film-card ${menu ? 'menu-open' : ''}`} role="button" tabIndex={0} aria-label={`Open ${p.name}`} onClick={open}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && open()}>
      <span className="slate">{p.summary.shots > 0 ? `${p.summary.shots} ${p.summary.shots === 1 ? 'shot' : 'shots'}` : 'Film'}{p.summary.adSeconds !== null ? ` · ${p.summary.adSeconds} s` : ''}</span>
      <button type="button" className="pp-more" aria-label={`More for ${p.name}`} aria-haspopup="menu" aria-expanded={menu}
        onClick={(e) => { e.stopPropagation(); onMenu(!menu) }}>⋯</button>
      <div className={`strip ${thumb ? '' : 'empty'}`} aria-hidden>{thumb ? <img src={thumb} alt="" draggable={false} /> : <Placeholder stage={p.summary.stage} />}</div>
      {menu && (
        <div className="pt-menu nui-pop pp-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          {item('Open', open)}
          {item('Rename', () => { setDraft(p.name); setRenaming(true) })}
          {item('Duplicate', () => void shell.duplicate(p.id).catch(fail('Could not duplicate it')))}
          {item('Export', () => void shell.exportProject(p.id).then(({ blob, name }) => download(blob, name)).catch(fail('Could not export it')))}
          <div className="pt-menusep" />
          {item('Delete…', () => setDeleting(true), 'del')}
        </div>
      )}
      <div className="t">
        {renaming ? (
          <form className="pp-rename" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
            e.preventDefault()
            setRenaming(false)
            void shell.rename(p.id, draft)
          }}>
            <input className="field" value={draft} autoFocus aria-label="Project name" maxLength={80}
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)} onBlur={() => setRenaming(false)} />
          </form>
        ) : <b title={p.name}>{p.name}</b>}
        <div className={`st ${making ? 'working' : chip.tone === 'warn' ? 'call' : ''}`}>{making ? (p.summary.making ?? 'Agents working') : chip.text}</div>
      </div>
      <div className="kv">
        <span>Updated</span><span>{edited(p.updated)}</span>
        {server && <><span>Server</span><span title={`Saved to the server ${new Date(server.savedAt).toLocaleString()}`}>saved {edited(server.savedAt).replace(/^edited /, '')}{newerThere ? ' · a newer save from elsewhere' : ''}</span></>}
        {!server && <><span>Kept</span><span>in this browser</span></>}
      </div>
      {deleting && (
        <div className="pp-confirm" role="alertdialog" aria-label={`Delete ${p.name}?`} onClick={(e) => e.stopPropagation()}>
          <span>{deleteWords(p.name)}</span>
          <div className="pp-acts">
            <button type="button" className="btn-rect" onClick={() => setDeleting(false)}>Keep</button>
            <button type="button" className="btn-rect danger" autoFocus onClick={() => { setDeleting(false); shell.remove(p.id).catch(fail('Could not delete it')) }}>Delete</button>
          </div>
        </div>
      )}
    </div>
  )
}

// The stage rides as data, never as a class: `.character` is the canvas page's own (position: absolute; inset: 0), and as a
// class on this span it covered the whole card, Delete included (Tidewell UAT).
export function Placeholder({ stage }: { stage: ProjectSummary['stage'] }) {
  return <span className="pp-ph" data-stage={stage}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 5l2 4M12 5l2 4M17 5l2 4" /></svg></span>
}
