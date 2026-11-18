// The pieces every top bar of the approved UI is made of (docs/production-tool/ui-mocks,
// Main.dc.html; ui-behaviour 3.1): the brand, the back button, an editor's
// title with its node mark, the people here and the account button with its menu.

import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useShell } from '../../app/context'
import { onThemeChoice, setThemeChoice, themeChoice, type ThemeChoice } from '../../theme'
import type { Me } from '../../contracts/types'
import { Float } from '../Float'
import { initials } from './panels'
import { useLook } from '../shell/lookContext'
import { behindNapkinOs, signOut } from '../../relay/access'
import './chrome.css'

/** "Napkin Studio", "Production" in tool blue, and the project's name in grey (it shrinks first).
 *  `wordmark` false (a tight bar): "Napkin Studio" hides; the Home mark is the logo already. */
export function Brand({ project, wordmark = true }: { project?: string; wordmark?: boolean }) {
  return (
    <>
      {wordmark && <span className="pt-studio">Napkin Studio</span>}
      <span className="pt-tool">Production</span>
      {project && <span className="pt-project pt-shrink" title={project}>{project}</span>}
    </>
  )
}

/** ← and where it goes; `short` (a tight bar): the arrow alone, its words in the label and tooltip. */
export function BackButton({ label, onClick, short = false }: { label: string; onClick: () => void; short?: boolean }) {
  return (
    <button type="button" className={`pt-back ${short ? 'short' : ''}`} onClick={onClick} aria-label={short ? `Back to ${label}` : undefined}
      title={`Back to ${label} (Ctrl+[)`}><span aria-hidden="true">←</span>{!short && label}</button>
  )
}

export const BarSep = () => <span aria-hidden="true" className="pt-sep" />

export type NodeKind = 'script' | 'storyboard' | 'video' | 'frame' | 'sound'

/** The node marks of the mocks: a coral page (script), four blue frames (storyboard), a play box (video), a picture (frame). */
export function NodeIcon({ kind, size = 20 }: { kind: NodeKind; size?: number }) {
  // The new UI's slate identity (Shrey, 2026-11-17; mock production-new-ui-v2 core.js icons): one ink line icon
  // per kind, no tool colours.
  const p: Record<NodeKind, ReactNode> = {
    script: <><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /></>,
    storyboard: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
    video: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 5l2 4M12 5l2 4M17 5l2 4" /></>,
    frame: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></>,
    sound: <><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {p[kind]}
    </svg>
  )
}

/** The people in this project besides you. Live presence comes with live-sync; until then there is
 *  no one else to show, and the bar shows nothing rather than a pretend "here". */
export function Presence({ line }: { line?: string }) {
  if (!line) return null
  return <div className="pt-presence">{line}</div>
}

const THEMES: { id: ThemeChoice; label: string }[] = [{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }, { id: 'system', label: 'System' }]

/** Light / Dark / System, as the shell's switch keeps it (napkin.theme): applies at once, no reload. */
export function ThemeChoices() {
  const choice = useSyncExternalStore(onThemeChoice, () => themeChoice(), () => 'system' as ThemeChoice)
  return (
    <div className="pt-menurow" style={{ cursor: 'default' }}>
      <span id="pt-theme-label">Theme</span>
      <span style={{ flex: 1 }} />
      <div className="pt-seg pt-theme" role="radiogroup" aria-labelledby="pt-theme-label">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={choice === t.id} aria-pressed={choice === t.id}
            onClick={() => setThemeChoice(t.id)}>{t.label}</button>
        ))}
      </div>
    </div>
  )
}

/** The account button: your initials; its menu has who you are (name, agency), the theme, Reduce motion and Sign out. */
export function Account({ children }: { children?: ReactNode }) {
  // The app's part of the UI (who you are, Reduce motion): the same on Home and in a project.
  const shell = useShell()
  const app = shell.deps.app
  const ui = useSyncExternalStore(app.subscribe, app.get)
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const look = useLook()
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
          {/* The agency this person is signed in under (ui/shell/agency.ts). */}
          <div className="pt-mono">{look.name}</div>
        </div>
        <div className="pt-menusep" />
        <ThemeChoices />
        <label className="pt-menurow" style={{ cursor: 'default' }}>
          <span>Reduce motion</span>
          <span style={{ flex: 1 }} />
          <button type="button" role="switch" aria-checked={still} aria-label="Reduce motion" className="pt-switch"
            onClick={() => app.update((u) => { u.motion = still ? undefined : 'still' })} />
        </label>
        {children}
        {/* Napkin OS's sign-out, only when napkin-web serves the tool (features/os-sign-in.clan). New film and All
            projects are the film's ▾ menu's, not here (Shrey 2026-11-19: the two menus never repeat each other). */}
        {behindNapkinOs(import.meta.env.VITE_RELAY_URL as string | undefined) && (
          <>
            <div className="pt-menusep" />
            <button type="button" className="pt-menurow" onClick={() => { setOpen(false); void signOut() }}>Sign out</button>
          </>
        )}
      </Float>
    </>
  )
}
