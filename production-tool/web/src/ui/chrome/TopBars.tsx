// The canvas's bar and every editor's bar (features/production-new-ui.clan; the slim bar, owner 2026-11-19): the
// shell bar of the new UI (ui/shell/ShellBar) with the film's ▾ menu (FilmMenu: New, Open a file, All projects,
// Export, Continue in, Share, Rename, Duplicate, Data sharing, Light/Dark, Delete, after the editor's own rows),
// and, under an editor's bar, the band row: ← back to the canvas, its own controls (the view switch, Format,
// meta), its page actions (Plan shots, Make film, Apply…) and Undo/Redo. Escape goes back too, when nothing else
// takes it. History is the Decisions drawer, from the bar's Decisions button. No spend, cost or limit in any bar
// (principle 4); costs show only in Decisions.

import { useContext, useEffect, useState, type ReactNode } from 'react'
import { DataSharing } from '../DataSharing'
import { usePanels } from './panels'
import { RouterContext, useDoc, useServices, useShell, useUi } from '../../app/context'
import { Band, ShellBar, type Crumb } from '../shell/ShellBar'
import { exportBundle, download } from '../../export'
import { downloadAllMedia } from '../../media/download'
import { viewsOnCanvas } from '../../media/names'
import { idbGet } from '../../lib/idb'
import type { CanvasSnapshot } from '../../canvas/controller'
import { MenuItem } from '../Float'
import { JobTray } from '../JobTray'
import { UndoButtons, UndoMenuItems } from '../UndoButtons'
import { saveTime, useSave } from '../useSave'
import { NodeIcon, type NodeKind } from './Bar'
import { undoInMore, useFitLevel } from './fit'
import { LinkIcon } from './MoreMenu'
import { useProjectName } from '../useDownload'
import { setThemeChoice } from '../../theme'
import { useTheme } from '../shell/lookContext'


/** Whose History a bar opens: the app's panel, or the Script editor's own. */
export interface HistoryToggle { on: boolean; toggle: () => void }

/** Pick a file from the computer (the input lives on the page, so it outlives the menu that asked). */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove() }, { once: true })
    input.addEventListener('cancel', () => { resolve(null); input.remove() }, { once: true })
    document.body.appendChild(input)
    input.click()
  })
}

/** The film's ▾ menu, on every screen (owner 2026-11-19): New · Open a file · All projects · Export; Continue in ·
 *  Share · Rename · Duplicate; Data sharing · Light/Dark · Delete. Two-line rows where the mock has them. */
function FilmMenu({ close }: { close: () => void }) {
  const { doc: docStore, project, ui: uiStore } = useServices()
  const shell = useShell()
  const doc = useDoc()
  const saving = useSave()
  const panels = usePanels()
  const router = useContext(RouterContext)
  const theme = useTheme()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const name = useProjectName()
  const files = Object.keys(doc.assets).length
  const run = async (what: string, fn: () => Promise<string | null>) => {
    setBusy(what)
    setNote(null)
    try {
      const said = await fn()
      if (said) setNote(said)
      else close()
    } catch (e) {
      setNote(e instanceof Error && e.message ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(null)
    }
  }
  const soon = 'Not in this version yet'
  const ui = useUi()
  const allow = ui.me?.allow
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sharing, setSharing] = useState(false)
  // Continue in › Link a brief…: the Brief node goes on the canvas, from Assets › From Napkin (features/brief-node.clan).
  const linkBrief = () => {
    close()
    if (router?.get().kind === 'script') router.leave()
    uiStore.update((u) => { u.stage = 'character' }, 'stage')
    panels.openAssets('napkin')
  }
  return (
    <>
      <MenuItem icon="+" hint="A blank canvas" disabled={!!busy} onSelect={() => { close(); void shell.newProject() }}>New film</MenuItem>
      <MenuItem icon="⇪" hint="A Napkin file (.clan) or an export .zip" disabled={!!busy} onSelect={() => void run('open', async () => {
        const f = await pickFile('.zip,.clan,application/zip,application/vnd.clan+zip')
        if (f) await shell.openFile(f, f.name)
        return null
      })}>{busy === 'open' ? 'Opening…' : 'Open a file…'}</MenuItem>
      <MenuItem icon="▤" hint="Every film in this browser and on the server" onSelect={() => { close(); void shell.goHome() }}>All projects</MenuItem>
      <div className="pt-menusep" />
      <div className="fhead">Export</div>
      <MenuItem icon={<ExportIcon kind="zip" />} disabled={!!busy} hint={`${files} files`} onSelect={() => void run('media', async () => {
        const canvas = await idbGet<CanvasSnapshot>('kv', project.canvasKey).catch(() => undefined)
        const r = await downloadAllMedia(docStore.get(), name, viewsOnCanvas(docStore.get(), canvas?.elements ?? []))
        if (!r.packed) return 'Nothing to save in this browser'
        return r.missing ? `Saved ${r.packed} · ${r.missing} not in this browser` : null
      })}>{busy === 'media' ? 'Packing…' : 'Download all media (zip)'}</MenuItem>
      <MenuItem icon={<ExportIcon kind="clan" />} disabled={!!busy} hint="A Napkin file anyone with Napkin can open" onSelect={() => void run('clan', async () => {
        const { blob, name: file } = await exportBundle(docStore, project.canvasKey, name)
        download(blob, file)
        return null
      })}>{busy === 'clan' ? 'Packing…' : 'Project as .clan + assets'}</MenuItem>
      <MenuItem icon={<NodeIcon kind="script" size={16} />} disabled hint={soon} onSelect={() => {}}>Script as PDF</MenuItem>
      <MenuItem icon={<NodeIcon kind="script" size={16} />} disabled hint={soon} onSelect={() => {}}>Script as Fountain</MenuItem>
      <MenuItem icon={<NodeIcon kind="storyboard" size={16} />} disabled hint={soon} onSelect={() => {}}>Storyboard as PDF</MenuItem>
      <MenuItem icon={<ExportIcon kind="publish" />} disabled hint="Publish a reference from Assets" onSelect={() => {}}>Publish selected to team library</MenuItem>
      {saving.can && (
        <MenuItem icon="⤒" hint={saving.state.kind === 'failed' ? 'Ctrl+S · the last save failed' : saving.state.kind === 'saved' ? `Ctrl+S · saved ${saveTime(saving.state.at)}` : 'Ctrl+S'}
          disabled={saving.state.kind === 'saving'} onSelect={() => { close(); void saving.save() }}>
          {saving.state.kind === 'saving' ? 'Saving…' : 'Save now'}
        </MenuItem>
      )}
      {note && <div className="pt-menuhead" role="status">{note}</div>}
      <div className="pt-menusep" />
      <div className="fhead">Continue in</div>
      <MenuItem icon="+" disabled hint={soon} onSelect={() => {}}>New deck from this film</MenuItem>
      <MenuItem icon="↔" hint="From Brief Maker, in Assets › From Napkin" onSelect={linkBrief}>Link a brief…</MenuItem>
      <MenuItem icon={<LinkIcon />} hint="Copies the link: it opens for people at your agency who can see the film" onSelect={() => void run('share', async () => copyLink(location.href))}>Share…</MenuItem>
      {renaming !== null ? (
        <form className="pt-menuform" onSubmit={(e) => { e.preventDefault(); const n = renaming.trim(); if (n) void shell.rename(project.id, n).then(close, () => setNote('Could not rename it. Try again.')); else setRenaming(null) }}>
          <input className="input" autoFocus onFocus={(e) => e.currentTarget.select()} aria-label="The project's name" value={renaming} maxLength={120} onChange={(e) => setRenaming(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) } }} />
          <button type="submit" className="btn sm">Rename</button>
        </form>
      ) : <MenuItem icon="✎" onSelect={() => setRenaming(name ?? '')}>Rename</MenuItem>}
      <MenuItem icon="⧉" disabled={!!busy} hint="Opens the copy" onSelect={() => void run('dup', async () => {
        // The copy is made from the saved project (shell.duplicate closes this one first), then opened.
        const copy = await shell.duplicate(project.id)
        await shell.open(copy.id)
        return null
      })}>{busy === 'dup' ? 'Duplicating…' : 'Duplicate'}</MenuItem>
      <div className="pt-menusep" />
      {allow && <MenuItem icon="⇄" hint="Who receives what your agency puts in" onSelect={() => setSharing(true)}>Data sharing</MenuItem>}
      <MenuItem icon={theme === 'dark' ? '☼' : '☾'} hint={theme === 'dark' ? 'Switch to the light look' : 'Switch to the dark look'}
        onSelect={() => setThemeChoice(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'}</MenuItem>
      {deleting ? (
        <div className="pt-menuhead" role="alertdialog" aria-label="Delete this project">
          Delete “{name ?? 'this project'}” from this browser? The server's copy is kept.
          <span className="pt-menuacts">
            <button type="button" className="btn sm danger" autoFocus onClick={() => { close(); void shell.remove(project.id).catch(() => undefined) }}>Delete</button>
            <button type="button" className="btn sm ghost" onClick={() => setDeleting(false)}>Cancel</button>
          </span>
        </div>
      ) : <MenuItem icon="×" danger hint="From this browser; the server’s copy is kept" onSelect={() => setDeleting(true)}>Delete…</MenuItem>}
      {sharing && allow && <DataSharing allow={allow} onClose={() => { setSharing(false); close() }} />}
    </>
  )
}

function ExportIcon({ kind }: { kind: 'zip' | 'clan' | 'publish' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
      {kind === 'zip' && <><rect x="2.5" y="2" width="11" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 5v5M5.8 8 L8 10.2 L10.2 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>}
      {kind === 'clan' && <path d="M8 1.8 L13.5 5 V11 L8 14.2 L2.5 11 V5 Z M2.5 5 L8 8.2 L13.5 5 M8 8.2 V14.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />}
      {kind === 'publish' && <><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 11V5.5M5.8 7.6 L8 5.4 L10.2 7.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>}
    </svg>
  )
}

/** Share copies the canvas link (ui-behaviour 2.4); the link opens only for people who can see the project. */
async function copyLink(url: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(url)
    return 'Link copied'
  } catch {
    return 'Copy the address bar'
  }
}

/** The canvas's bar: the slim shell bar with Canvas as where you are and the agents' status dot; the ▾ menu is
 *  the film's. Assets is in the canvas's + menu. */
export function CanvasBar({ phone = false }: { /** The phone's cut: watch only, so its job button has no ask dock and no Show. */ phone?: boolean }) {
  return (
    <ShellBar bar="canvas" className="ptbar" crumb={[{ label: 'Canvas' }]}
      menu={(close) => <FilmMenu close={close} />}
      job={phone ? <JobTray phone /> : <JobTray />} />
  )
}

/** Escape goes back from an editor (owner 2026-11-19) when nothing else takes it: not while typing, not while a
 *  menu, popover or dialog is open, not when something is selected that Escape would clear first. What was
 *  open is read before anything handles the key (capture), so a menu Escape closes never also leaves. */
function useEscapeBack(onBack: () => void): void {
  useEffect(() => {
    let free = false
    const OPEN = '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], .pt-menu, .traypop, .nui-pop, [aria-selected="true"], [data-selected="true"], .is-selected'
    const before = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      const sel = window.getSelection()
      free = !typing && !document.querySelector(OPEN) && !(sel && !sel.isCollapsed)
    }
    const after = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !free || e.defaultPrevented) return
      free = false
      onBack()
    }
    window.addEventListener('keydown', before, true)
    window.addEventListener('keydown', after)
    return () => {
      window.removeEventListener('keydown', before, true)
      window.removeEventListener('keydown', after)
    }
  }, [onBack])
}

/** An editor's bar: the shell bar with the crumb (← where back goes › this editor's title), the job chip and
 *  the one primary; the ▾ menu holds the editor's own rows (and, on a tight window, the view switch and
 *  Undo/Redo). Under it, the band row: the meta pills, the view switch, the editor's own controls, Undo/Redo. */
export function EditorBar({ className = '', back, onBack, icon, title, meta, view, afterView, right, undo = false, history, moreHead, more, primary }: {
  className?: string
  back: string
  onBack: () => void
  icon: NodeKind
  title: string
  meta?: ReactNode
  /** The one view switch (Screenplay | Video · Audio, Picture | Sound): the band's, or the menu's at tight. */
  view?: { label: string; options: { id: string; label: string }[]; value: string; onPick: (id: string) => void }
  /** Beside the view switch (the Script editor's Format menu); hidden at tight, as the switch is. */
  afterView?: ReactNode
  right?: ReactNode
  undo?: boolean
  /** The editor's own Decisions (the Script editor narrows it to one item for "Why?"). */
  history?: HistoryToggle
  /** Always at the head of the ▾ menu (Script's Shots from). */
  moreHead?: ReactNode
  /** The editor's own rows of the ▾ menu (every editor has Copy link to this). */
  more?: (close: () => void) => ReactNode
  moreTip?: string
  primary?: ReactNode
}) {
  const { level, coarse } = useFitLevel()
  const tight = level === 'tight'
  const undoMore = undo && undoInMore(level, coarse)
  const crumb: Crumb[] = [{ label: back, onClick: onBack }, { label: title }]
  useEscapeBack(onBack)
  return (
    <div className={`ptbar nui-bars ${className}`} data-bar={icon} data-fit={level}>
      <ShellBar bar={icon} crumb={crumb} history={history} job={<JobTray />}
        menu={(close) => (
          <>
            {moreHead && <><div className="pt-morehead">{moreHead}</div><div className="pt-menusep" /></>}
            {view && tight && <ViewItems view={view} close={close} />}
            {more?.(close)}
            {undoMore && <><div className="pt-menusep" /><UndoMenuItems close={close} /></>}
            {/* The film's rows, the same on every screen (live test 2026-11-18: the rooms had only a dead row). */}
            {(more || undoMore || (view && tight) || moreHead) && <div className="pt-menusep" />}
            <FilmMenu close={close} />
          </>
        )} />
      <Band label={`${title}: controls`}>
        {/* The way back, as the Booth's crumbs say it (mock .sp-crumb "← Canvas"). */}
        <button type="button" className="band-back" onClick={onBack} title={`Back to ${back} (Esc)`}><span aria-hidden="true">←</span> {back}</button>
        <h1 className="pt-title sr-title" title={title}>{title}</h1>
        {meta}
        {view && !tight && <ViewSwitch view={view} />}
        {!tight && afterView}
        <span className="band-grow" />
        {right}
        {/* The page's own actions (Plan shots, Make film, Apply…) are the band's, never the bar's (owner 2026-11-19). */}
        {primary && <span className="band-primary">{primary}</span>}
        {undo && !undoMore && <UndoButtons />}
      </Band>
    </div>
  )
}

function ViewSwitch({ view }: { view: NonNullable<Parameters<typeof EditorBar>[0]['view']> }) {
  return (
    <span className="pt-seg" role="group" aria-label={view.label}>
      {view.options.map((o) => <button key={o.id} type="button" aria-pressed={view.value === o.id} onClick={() => view.onPick(o.id)}>{o.label}</button>)}
    </span>
  )
}

function ViewItems({ view, close }: { view: NonNullable<Parameters<typeof EditorBar>[0]['view']>; close: () => void }) {
  return (
    <>
      <div className="fhead">{view.label}</div>
      {view.options.map((o) => (
        <MenuItem key={o.id} icon={view.value === o.id ? '✓' : undefined} onSelect={() => { close(); view.onPick(o.id) }}>{o.label}</MenuItem>
      ))}
      <div className="pt-menusep" />
    </>
  )
}
