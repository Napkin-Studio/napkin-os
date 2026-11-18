// The shell bar on every Production screen (features/production-new-ui.clan; the mock is the spec:
// ~/Documents/napkin-design-mocks/production-new-ui-v2, core.js S.bar). The same bar Brief Maker and
// Research wear (app/src/components/Toolbar.tsx, app/src/shell/nui/shell.css): the Deep O medallion and the
// agency pill, the client chip, the document slot (name, saved line, ▾ menu), the crumb, Continue in and
// Share; then the job chip, the editor's one primary, the people here, light or dark, you, and Decisions
// with its count. Each editor's own controls sit in the band row under it (Band).

import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useConfig, useDoc, useRoute, useRouter, useServices, useShell } from '../../app/context'
import { Float, MenuItem } from '../Float'
import { saveTime, useSave } from '../useSave'
import { setThemeChoice } from '../../theme'
import { Account } from '../chrome/Bar'
import { clientDisc, pillMark } from './agency'
import { DeepO } from './look'
import { useLook, useTheme } from './lookContext'
import { ICON, studioHref, useNeedsCount } from './bar'
import { usePanels } from '../chrome/panels'
import './shell.css'

export interface Crumb { label: string; onClick?: () => void }

const Ic = ({ d, cls }: { d: string; cls?: string }) => (
  <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
)
export const Icon = Ic

function Medallion({ state, progress }: { state: 'awake' | 'working' | 'needs'; progress?: number }) {
  const shell = useShell()
  const go = () => {
    const href = studioHref()
    if (href) location.assign(href)
    else void shell.goHome()
  }
  return (
    <button type="button" className="m1-medallion" onClick={go} title={studioHref() ? 'Back to the studio' : 'Home: your films'} aria-label={studioHref() ? 'Back to the studio' : 'Home: your films'}>
      <DeepO size={54} state={state} progress={progress} />
    </button>
  )
}

export function AgencyPill() {
  const look = useLook()
  const mark = pillMark(look)
  if (look.solo) return <span className="ag-pill solo"><b>Napkin Studio</b></span>
  return (
    <span className="ag-pill">
      {mark ? <img src={mark} alt={look.name} className="ag-mark" /> : <b>{look.name}</b>}
      <small>Napkin Studio</small>
    </span>
  )
}

/** The client this film is for, when it has one; else the tool's own chip. Either goes to Production's home. */
function ClientChip() {
  const shell = useShell()
  const doc = useDoc()
  const clientId = doc.project.client_id
  if (clientId) {
    const name = clientId.replace(/^client[_:-]?/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    const disc = clientDisc({ id: clientId, name })
    return (
      <button type="button" className="tb-client" onClick={() => void shell.goHome()} title={`${name}: all films`}>
        <span className="cdisc" style={{ background: disc.bg, color: disc.ink }}>{disc.initials}</span><span className="cn">{name}</span>
      </button>
    )
  }
  return (
    <button type="button" className="tb-client tool" onClick={() => void shell.goHome()} title="Production: all films">
      <span className="cdisc tool"><Ic d={ICON.film} /></span><span className="cn">Production</span>
    </button>
  )
}

function savedLine(s: ReturnType<typeof useSave>): string {
  if (!s.can) return 'kept in this browser'
  const st = s.state
  return st.kind === 'saving' ? 'saving…' : st.kind === 'saved' ? `saved ${saveTime(st.at)}` : st.kind === 'failed' ? 'not saved · retry' : 'not saved yet'
}

/** The document slot: the film's name and its saved line; ▾ opens the document menu. */
function DocSlot({ menu }: { menu?: (close: () => void) => ReactNode }) {
  const shell = useShell()
  const { project } = useServices()
  const save = useSave()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const name = shell.index.get(project.id)?.name ?? 'Untitled film'
  return (
    <>
      <button ref={ref} type="button" className="tba-name" aria-haspopup="menu" aria-expanded={open} title={name} onClick={() => setOpen(!open)}>
        <Ic d={ICON.film} cls="ticon" />
        <span className="tba-n2"><b>{name}</b><span className={`tba-saved ${save.state.kind === 'failed' ? 'failed' : ''}`}>{savedLine(save)}</span></span>
        <span className="tba-caret" aria-hidden="true">▾</span>
      </button>
      <Float anchor={ref} open={open} onClose={() => setOpen(false)} role="menu" label={name} className="pt-menu nui-pop">
        <div className="fhead">{name}</div>
        {menu?.(() => setOpen(false))}
      </Float>
    </>
  )
}

function Crumbs({ crumb }: { crumb: Crumb[] }) {
  return (
    <nav className="tba-crumb" aria-label="Where you are">
      {crumb.map((c, i) => (
        <span key={i} className="tba-cstep">
          <span aria-hidden="true">›</span>
          {i === crumb.length - 1 || !c.onClick ? <span className="here" aria-current={i === crumb.length - 1 ? 'page' : undefined}>{c.label}</span>
            : <button type="button" onClick={c.onClick} title={`Back to ${c.label} (Ctrl+[)`}>{c.label}</button>}
        </span>
      ))}
    </nav>
  )
}

/** Continue in ▾: where this film goes next. Link a brief… opens Assets › From Napkin on the canvas, where the
 *  agency's Brief Maker briefs are (features/brief-node.clan; live test 2026-11-18). */
function ContinueIn() {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { ui } = useServices()
  const { config } = useConfig()
  const route = useRoute()
  const router = useRouter()
  const panels = usePanels()
  const soon = 'Not in this version yet'
  const linkBrief = () => {
    setOpen(false)
    // The Brief node goes on the canvas: an editor or a room goes back to it first.
    if (route.kind === 'script') router.leave()
    ui.update((u) => { u.stage = 'character' }, 'stage')
    panels.openAssets('napkin')
  }
  return (
    <>
      <button ref={ref} type="button" className="tba-btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Continue in ▾</button>
      <Float anchor={ref} open={open} onClose={() => setOpen(false)} role="menu" label="Continue in" className="pt-menu nui-pop">
        <div className="fhead">Continue in</div>
        <MenuItem icon="+" disabled hint={soon} onSelect={() => {}}>New deck from this film</MenuItem>
        {config.flags.briefNode
          ? <MenuItem icon="↔" hint="From Brief Maker, in Assets › From Napkin" onSelect={linkBrief}>Link a brief…</MenuItem>
          : <MenuItem icon="↔" disabled hint={soon} onSelect={() => {}}>Link a brief…</MenuItem>}
      </Float>
    </>
  )
}

/** Share: copy the link (it opens only for people at your agency who can see the film). */
function Share() {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.href); setSaid('Link copied') } catch { setSaid('Copy the address bar') }
    setTimeout(() => setSaid(null), 2400)
  }
  return (
    <>
      <button ref={ref} type="button" className="tba-btn ghost pt-share" aria-haspopup="menu" aria-expanded={open} aria-live="polite" onClick={() => setOpen(!open)}>{said ?? 'Share'}</button>
      <Float anchor={ref} open={open} onClose={() => setOpen(false)} role="menu" label="Share" className="pt-menu nui-pop">
        <div className="fhead">Share</div>
        <MenuItem icon={<Ic d={ICON.link} cls="fmi-svg" />} hint="Opens for people at your agency who can see the film" onSelect={() => { setOpen(false); void copy() }}>Copy link</MenuItem>
      </Float>
    </>
  )
}

function ThemeButton() {
  const theme = useTheme()
  return (
    <button type="button" className="tb-theme" title="Light or dark" aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      onClick={() => setThemeChoice(theme === 'dark' ? 'light' : 'dark')}>
      <Ic d={ICON.moon} cls="i-moon" /><Ic d={ICON.sun} cls="i-sun" />
    </button>
  )
}

/** Decisions: the project's decision tree and its costs, with how many things need you. */
export function DecisionsButton({ needs, own }: { needs: number; own?: { on: boolean; toggle: () => void } }) {
  const panels = usePanels()
  const on = own ? own.on : panels.history
  const toggle = own ? own.toggle : () => panels.toggle('history')
  return (
    <button type="button" className={`tb-decisions-btn ${needs ? 'has-needs' : ''}`} aria-pressed={on} aria-label={`Decisions${needs ? `, ${needs} need you` : ''}`}
      title="Decisions: every decision, who made it and why, and what each job cost" onClick={toggle}>
      <span className="lbl-t">Decisions</span><span className="cnt">{needs}</span>
    </button>
  )
}

/** The bar. `crumb` names where you are past the document (Canvas › Storyboard); `menu` fills the ▾. */
export function ShellBar({ crumb, menu, job, tools, primary, presence, mark = 'awake', markProgress, className = '', bar, history }: {
  crumb?: Crumb[]
  /** An editor's own Decisions (the Script editor's, narrowed for "Why?"); else the app's drawer. */
  history?: { on: boolean; toggle: () => void }
  menu?: (close: () => void) => ReactNode
  /** The job chip (ui/JobTray). */
  job?: ReactNode
  /** Quiet tools beside the job chip (Assets). */
  tools?: ReactNode
  /** The screen's one primary action. */
  primary?: ReactNode
  presence?: ReactNode
  mark?: 'awake' | 'working' | 'needs'
  markProgress?: number
  className?: string
  /** data-bar, for tests and styles: canvas, script, storyboard, video, frame, sound. */
  bar?: string
}) {
  const needs = useNeedsCount()
  const shell = useShell()
  // The app store is read so the account's initials follow a sign-in.
  useSyncExternalStore(shell.deps.app.subscribe, shell.deps.app.get)
  return (
    <div className={`topbar-outer ${className}`} data-float-avoid="" data-bar={bar}>
      <header className="tb" aria-label="Napkin Studio Top Bar">
        <span className="tb-lead"><Medallion state={mark} progress={markProgress} /><AgencyPill /></span>
        <span className="tb-sep" aria-hidden="true" />
        <ClientChip />
        <span className="tb-sep" aria-hidden="true" />
        <div className="tb-app">
          <DocSlot menu={menu} />
          {crumb && crumb.length > 0 && <Crumbs crumb={crumb} />}
          <span className="tba-acts"><ContinueIn /><Share /></span>
        </div>
        <span className="tb-spacer" />
        <span className="tb-tools">{job}{tools}{primary}</span>
        {presence}
        <ThemeButton />
        <span className="tb-me"><Account /></span>
        <DecisionsButton needs={needs} own={history} />
      </header>
    </div>
  )
}

/** The band row under an editor's bar: the editor's own controls (view switch, Format, length, Undo). */
export function Band({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return <div className={`band ${className}`} role="toolbar" aria-label={label ?? 'Editor controls'}>{children}</div>
}
