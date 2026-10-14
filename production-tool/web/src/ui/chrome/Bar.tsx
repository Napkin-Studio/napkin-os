// The pieces every top bar of the approved UI is made of (docs/production-tool/ui-mocks,
// Main.dc.html; ui-behaviour 3.1): the Home mark, the brand, the back button, an editor's
// title with its node mark, the people here and the account button with its menu.

import { useRef, useState, type ReactNode } from 'react'
import { useServices, useShell, useUi } from '../../app/context'
import type { Me } from '../../contracts/types'
import { Float } from '../Float'
import { initials } from './panels'
import { CrewSheet } from '../agents/CrewSheet'
import './chrome.css'

/** "Home: your projects": a dark tile with the Home triangle (the mocks' mark). */
export function HomeMark({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="pt-home" aria-label="Home: your projects" title="Home: your projects" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 11 L7 3 L12 11 Z" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round" /></svg>
    </button>
  )
}

/** The same tile where it goes nowhere (Home itself, the signed-out page). */
export function MarkTile() {
  return (
    <span className="pt-home" aria-hidden="true" style={{ cursor: 'default' }}>
      <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 11 L7 3 L12 11 Z" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round" /></svg>
    </span>
  )
}

/** "Napkin Studio", "Production" in tool blue, and the project's name in grey. */
export function Brand({ project }: { project?: string }) {
  return (
    <>
      <span className="pt-studio">Napkin Studio</span>
      <span className="pt-tool">Production</span>
      {project && <span className="pt-project pt-shrink" title={project}>{project}</span>}
    </>
  )
}

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="pt-back" onClick={onClick} title={`Back to ${label} (Ctrl+[)`}><span aria-hidden="true">←</span>{label}</button>
}

export const BarSep = () => <span aria-hidden="true" className="pt-sep" />

export type NodeKind = 'script' | 'storyboard' | 'video' | 'frame' | 'sound'

/** The node marks of the mocks: a coral page (script), four blue frames (storyboard), a play box (video), a picture (frame). */
export function NodeIcon({ kind, size = 20 }: { kind: NodeKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" style={{ flexShrink: 0 }}>
      {kind === 'script' && <><rect x="4" y="2" width="12" height="16" rx="2" fill="#FF6A55" /><path d="M7 7h6M7 10h6M7 13h4" stroke="#16181D" strokeWidth="1.4" strokeLinecap="round" /></>}
      {kind === 'storyboard' && <>
        <rect x="2" y="4" width="7" height="5" rx="1" fill="#2F64F5" /><rect x="11" y="4" width="7" height="5" rx="1" fill="#2F64F5" />
        <rect x="2" y="11" width="7" height="5" rx="1" fill="#2F64F5" /><rect x="11" y="11" width="7" height="5" rx="1" fill="#2F64F5" opacity="0.45" />
      </>}
      {kind === 'video' && <><rect x="2" y="4" width="16" height="12" rx="2" fill="var(--ink)" /><path d="M8 7.5 L13 10 L8 12.5 Z" fill="var(--paper)" /></>}
      {kind === 'frame' && <><rect x="2" y="4" width="16" height="12" rx="2" fill="#2F64F5" /><path d="M3 15 L8 9.5 L11.5 13 L14 11 L17 14" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinejoin="round" /></>}
      {kind === 'sound' && <><rect x="2" y="4" width="16" height="12" rx="2" fill="#7D52F4" /><path d="M5 10h1M8 7v6M11 8.5v3M14 6v8" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" /></>}
    </svg>
  )
}

/** The people in this project besides you. Live presence comes with live-sync; until then there is
 *  no one else to show, and the bar shows nothing rather than a pretend "here". */
export function Presence({ line }: { line?: string }) {
  if (!line) return null
  return <div className="pt-presence">{line}</div>
}

/** The account button: your initials; its menu has who you are, Reduce motion, and the projects. */
export function Account({ children }: { children?: ReactNode }) {
  const ui = useUi()
  const { ui: uiStore } = useServices()
  const shell = useShell()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [crew, setCrew] = useState(false)
  const me: Me | undefined = ui.me
  const still = ui.motion === 'still'
  return (
    <>
      <button ref={ref} type="button" className="pt-account" aria-label="Your account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {initials(me?.name ?? me?.handle)}
      </button>
      <Float anchor={ref} open={open} onClose={() => setOpen(false)} align="end" role="dialog" label="Your account" className="pt-menu">
        <div className="pt-menuhead">
          <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13 }}>{me?.name ?? me?.handle ?? 'You'}</div>
          <div className="pt-mono">@{me?.handle ?? 'guest'}{me?.team ? ` · ${me.team}` : ''}</div>
        </div>
        <div className="pt-menusep" />
        <label className="pt-menurow" style={{ cursor: 'default' }}>
          <span>Reduce motion</span>
          <span style={{ flex: 1 }} />
          <button type="button" role="switch" aria-checked={still} aria-label="Reduce motion" className="pt-switch"
            onClick={() => uiStore.update((u) => { u.motion = still ? undefined : 'still' })} />
        </label>
        {children}
        <button type="button" className="pt-menurow" onClick={() => { setOpen(false); setCrew(true) }}>The crew<span className="hint">who works on your ad</span></button>
        <div className="pt-menusep" />
        <button type="button" className="pt-menurow" onClick={() => { setOpen(false); void shell.newProject() }}>New project</button>
        <button type="button" className="pt-menurow" onClick={() => { setOpen(false); void shell.goHome() }}>All projects</button>
      </Float>
      {crew && <CrewSheet onClose={() => setCrew(false)} />}
    </>
  )
}
