// The slim shell bar on every Production screen (features/production-new-ui.clan; owner 2026-11-19): the brand
// pill (the Deep O medallion and the agency pill), the film's name with its ▾ menu and saved line, and the crumb
// of where you are (Canvas › Script); on the right only the agents' status dot (Brief Maker's .tb-status),
// Decisions with its count, and you. Everything else a bar held lives in the film's ▾ menu (New, Open, All
// projects, Export, Continue in, Share, Rename, Duplicate, Data sharing, Light/Dark, Delete) or in the page's
// own band row under it (Band), with its page actions.

import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useShell } from '../../app/context'
import { Float } from '../Float'
import { saveTime, useSave } from '../useSave'
import { Account } from '../chrome/Bar'
import { pillMark } from './agency'
import { DeepO } from './look'
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
          <span aria-hidden="true">›</span>
          {/* Every step before this one is a link back (owner 2026-11-19: "How do I get out of this page back to canvas?"). */}
          {i === crumb.length - 1 || !c.onClick ? <span className="here" aria-current={i === crumb.length - 1 ? 'page' : undefined}>{c.label}</span>
            : <button type="button" className="crumb-link" onClick={c.onClick} title={`Back to ${c.label} (Esc)`}>{c.label}</button>}
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

/** The bar. `crumb` names where you are past the film (Canvas › Storyboard); `menu` fills the film's ▾. */
export function ShellBar({ crumb, menu, job, mark = 'awake', markProgress, className = '', bar, history }: {
  crumb?: Crumb[]
  /** An editor's own Decisions (the Script editor's, narrowed for "Why?"); else the app's drawer. */
  history?: { on: boolean; toggle: () => void }
  menu?: (close: () => void) => ReactNode
  /** The agents' status dot (ui/JobTray). */
  job?: ReactNode
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
      <header className="tb slim" aria-label="Napkin Studio Top Bar">
        <span className="tb-lead"><Medallion state={mark} progress={markProgress} /><AgencyPill /></span>
        <div className="tb-app">
          <DocSlot menu={menu} />
          {crumb && crumb.length > 0 && <Crumbs crumb={crumb} />}
        </div>
        <span className="tb-spacer" />
        {job && <span className="tb-tools">{job}</span>}
        <DecisionsButton needs={needs} own={history} />
        <span className="tb-me"><Account /></span>
      </header>
    </div>
  )
}

/** The bar where no film is open (All projects, and the sign-in and access screens): the medallion and agency
 *  pill, the place's name, and you once signed in. A film's slots (its name, Continue in, Share, Decisions)
 *  are not here (mock production-new-ui-v2 core.js S.bar({ place: 'Production' })). */
export function PlaceBar({ place = 'Production', account }: {
  place?: string
  /** The account button and its menu; none when signed out. */
  account?: ReactNode
}) {
  return (
    <div className="topbar-outer" data-float-avoid="" data-bar="place">
      <header className="tb slim" aria-label="Napkin Studio Top Bar">
        <span className="tb-lead"><Medallion state="awake" /><AgencyPill /></span>
        <div className="tb-app">
          <span className="tba-name static"><Ic d={ICON.film} cls="ticon" /><span className="tba-n2"><b>{place}</b></span></span>
        </div>
        <span className="tb-spacer" />
        {account && <span className="tb-me">{account}</span>}
      </header>
    </div>
  )
}

/** The band row under an editor's bar: the editor's own controls (view switch, Format, length, Undo). */
export function Band({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return <div className={`band ${className}`} role="toolbar" aria-label={label ?? 'Editor controls'}>{children}</div>
}
