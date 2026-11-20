// The slim shell bar on every Production screen (Shrey, 2026-11-18/19; features/production-new-ui.clan, the
// pinned "slim shell bar" decision):
//   (O)[Napkin Studio]  <Film name> ▾  › Canvas › Script            •  Decisions 0  (SH)
// Left: the Deep O medallion and the agency pill (the way home), as Brief Maker and the shell wear them, the film's name with its saved line and its ▾ menu, and the crumb of
// where you are (the steps before the current one are links). Right: only the agent status dot (ui/JobTray),
// Decisions and you. Every page's own actions sit in its band (Band) under the bar, never in it.

import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useShell } from '../../app/context'
import { Float } from '../Float'
import { saveTime, useSave } from '../useSave'
import { Account } from '../chrome/Bar'
import { DeepO } from './look'
import { pillMark } from './agency'
import { useLook, useTheme } from './lookContext'
import { setThemeChoice } from '../../theme'
import { ICON, studioHref, useNeedsCount } from './bar'
import { usePanels } from '../chrome/panels'
import './shell.css'
import { useProjectName } from '../useDownload'
import { nameParts } from './nameParts'

export interface Crumb { label: string; onClick?: () => void }

const Ic = ({ d, cls }: { d: string; cls?: string }) => (
  <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
)
export const Icon = Ic

/** The brand: the Deep O medallion and the agency pill, as Brief Maker and the OS shell wear them (app/src/components/
 *  Toolbar.tsx; the mark is the shared app/src/brand/deepOSvg, ./look DeepO, in the agency's colours). The medallion
 *  is the way back to the studio, or Home. It is the brand, held still: the agents' activity is the status dot. */
function Medallion() {
  const shell = useShell()
  const go = () => {
    const href = studioHref()
    if (href) location.assign(href)
    else void shell.goHome()
  }
  return (
    <button type="button" className="m1-medallion" onClick={go} title={studioHref() ? 'Back to the studio' : 'Home: your films'} aria-label={studioHref() ? 'Back to the studio' : 'Home: your films'}>
      <DeepO size={54} state="awake" />
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

/** The bar's lead: the medallion over the agency pill. */
export function BrandLead() {
  return <span className="tb-lead"><Medallion /><AgencyPill /></span>
}

function savedLine(s: ReturnType<typeof useSave>): string {
  if (!s.can) return 'kept in this browser'
  const st = s.state
  return st.kind === 'saving' ? 'saving…' : st.kind === 'saved' ? `saved ${saveTime(st.at)}` : st.kind === 'failed' ? 'not saved · retry' : 'not saved yet'
}

/** The document slot: the film's name and its saved line; ▾ opens the document menu. */
function DocSlot({ menu }: { menu?: (close: () => void) => ReactNode }) {
  const save = useSave()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const name = useProjectName() ?? 'Untitled film'
  return (
    <>
      <button ref={ref} type="button" className="tba-name" aria-haspopup="menu" aria-expanded={open} title={name} onClick={() => setOpen(!open)}>
        <Ic d={ICON.film} cls="ticon" />
        <span className="tba-n2"><NameText name={name} /><span className={`tba-saved ${save.state.kind === 'failed' ? 'failed' : ''}`}>{savedLine(save)}</span></span>
        <span className="tba-caret" aria-hidden="true">▾</span>
      </button>
      <Float anchor={ref} open={open} onClose={() => setOpen(false)} role="menu" label={name} className="pt-menu nui-pop">
        <div className="fhead">{name}</div>
        {menu?.(() => setOpen(false))}
      </Float>
    </>
  )
}

function NameText({ name }: { name: string }) {
  const [head, tail] = nameParts(name)
  return <b className="tba-title"><span className="tba-head">{head}</span>{tail && <span className="tba-tail">{tail}</span>}</b>
}

function Crumbs({ crumb }: { crumb: Crumb[] }) {
  return (
    <nav className="tba-crumb" aria-label="Where you are">
      {crumb.map((c, i) => (
        <span key={i} className="tba-cstep">
          <span aria-hidden="true" className="tba-csep">›</span>
          {i === crumb.length - 1 || !c.onClick ? <span className="here" aria-current={i === crumb.length - 1 ? 'page' : undefined}>{c.label}</span>
            : <button type="button" className="tba-clink" onClick={c.onClick} title={`Back to ${c.label} (Esc)`}>{c.label}</button>}
        </span>
      ))}
    </nav>
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
      {/* The count is what needs you, shown only when something does (UAT 2026-11-21: "0" read as "no decisions"
          beside a drawer of 91). */}
      <span className="lbl-t">Decisions</span>{needs > 0 && <span className="cnt" title={`${needs} need${needs === 1 ? 's' : ''} you`}>{needs}</span>}
    </button>
  )
}

/** The bar. `crumb` names where you are past the film (Canvas › Storyboard); `menu` fills the film's ▾;
 *  `job` is the agent status dot (ui/JobTray). */
export function ShellBar({ crumb, menu, job, className = '', bar, history }: {
  crumb?: Crumb[]
  /** An editor's own Decisions (the Script editor's, narrowed for "Why?"); else the app's drawer. */
  history?: { on: boolean; toggle: () => void }
  menu?: (close: () => void) => ReactNode
  /** The agent status dot (ui/JobTray). */
  job?: ReactNode
  className?: string
  /** data-bar, for tests and styles: canvas, script, storyboard, video, frame, sound. */
  bar?: string
}) {
  const needs = useNeedsCount()
  const shell = useShell()
  // The app store is read so the account's initials follow a sign-in.
  useSyncExternalStore(shell.deps.app.subscribe, shell.deps.app.get)
  return (
    <div className={`topbar-outer slim ${className}`} data-float-avoid="" data-bar={bar}>
      <header className="tb" aria-label="Napkin Studio Top Bar">
        <BrandLead />
        <span className="tb-sep" aria-hidden="true" />
        <div className="tb-app">
          <DocSlot menu={menu} />
          {crumb && crumb.length > 0 && <Crumbs crumb={crumb} />}
        </div>
        <span className="tb-spacer" />
        <span className="tb-right">
          {job}
          <DecisionsButton needs={needs} own={history} />
          <span className="tb-me"><Account /></span>
        </span>
      </header>
    </div>
  )
}

/** The slim bar where no film is open (All projects, and the sign-in and access screens): the medallion and pill, the
 *  place's name, and you once signed in. Light or dark is in your account menu; signed out, a theme button stands
 *  in for it. A film's slots (its name and menu, the status dot, Decisions) are not here. */
export function PlaceBar({ place = 'Production', account }: {
  place?: string
  /** The account button and its menu; none when signed out. */
  account?: ReactNode
}) {
  return (
    <div className="topbar-outer slim" data-float-avoid="" data-bar="place">
      <header className="tb" aria-label="Napkin Studio Top Bar">
        <BrandLead />
        <span className="tb-sep" aria-hidden="true" />
        <div className="tb-app">
          <span className="tba-place"><Ic d={ICON.film} cls="ticon" /><b>{place}</b></span>
        </div>
        <span className="tb-spacer" />
        <span className="tb-right">{account ? <span className="tb-me">{account}</span> : <ThemeButton />}</span>
      </header>
    </div>
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

/** "← Canvas" at the left of an editor's band: the Booth crumb's look (mock production-new-ui-v2 .sp-crumb). */
export function BandBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="band-back" onClick={onClick} title={`Back to ${label} (Esc)`}>
      <span aria-hidden="true">←</span> {label}
    </button>
  )
}

/** The band row under an editor's bar: the editor's own controls (view switch, Format, length, Undo). */
export function Band({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return <div className={`band ${className}`} role="toolbar" aria-label={label ?? 'Editor controls'}>{children}</div>
}
