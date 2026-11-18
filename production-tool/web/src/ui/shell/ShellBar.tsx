// The slim shell bar on every Production screen (Shrey, 2026-11-18/19; features/production-new-ui.clan, the
// pinned "slim shell bar" decision):
//   [◐ Napkin Studio]  <Film name> ▾  › Canvas › Script            •  Decisions 0  (SH)
// Left: the brand pill (the way home), the film's name with its saved line and its ▾ menu, and the crumb of
// where you are (the steps before the current one are links). Right: only the agent status dot (ui/JobTray),
// Decisions and you. Every page's own actions sit in its band (Band) under the bar, never in it.

import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useShell } from '../../app/context'
import { Float } from '../Float'
import { saveTime, useSave } from '../useSave'
import { Account } from '../chrome/Bar'
import { StudioMark } from '../Mark'
import { pillMark } from './agency'
import { useLook } from './lookContext'
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

/** The brand pill: the Napkin mark and the agency (or Napkin Studio alone); the way back to the studio, or Home. */
export function BrandPill() {
  const shell = useShell()
  const look = useLook()
  const mark = pillMark(look)
  const studio = studioHref()
  const go = () => {
    if (studio) location.assign(studio)
    else void shell.goHome()
  }
  const where = studio ? 'Back to the studio' : 'Home: your films'
  return (
    <button type="button" className={`tb-brand ag-pill ${look.solo ? 'solo' : ''}`} onClick={go} title={where} aria-label={`${look.name}: ${where}`}>
      <span className="tb-brand-mark" aria-hidden="true"><StudioMark size={18} /></span>
      {look.solo ? <b>Napkin Studio</b> : <span className="tb-brand-t">{mark ? <img src={mark} alt="" className="ag-mark" /> : <b>{look.name}</b>}<small>Napkin Studio</small></span>}
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
      <span className="lbl-t">Decisions</span><span className="cnt">{needs}</span>
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
        <BrandPill />
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

/** The same slim bar where no film is open (the projects page): the brand pill, the place, and you. */
export function PlaceBar({ place, children, account }: { place: string; children?: ReactNode; account?: ReactNode }) {
  return (
    <div className="topbar-outer slim" data-float-avoid="" data-bar="home">
      <header className="tb" aria-label="Napkin Studio Top Bar">
        <BrandPill />
        <div className="tb-app">
          <span className="tba-place"><Ic d={ICON.film} cls="ticon" /><b>{place}</b></span>
          {children}
        </div>
        <span className="tb-spacer" />
        <span className="tb-right"><span className="tb-me"><Account>{account}</Account></span></span>
      </header>
    </div>
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
