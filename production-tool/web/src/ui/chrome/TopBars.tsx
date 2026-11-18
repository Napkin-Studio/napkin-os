// The canvas's bar and every editor's bar (features/production-new-ui.clan; the mock is the spec): the
// shell bar of the new UI (ui/shell/ShellBar) with the document's ▾ menu holding what More held (Export,
// Save now, Copy link, the editor's own rows), and, under an editor's bar, the band row with its own
// controls (the view switch, Format, meta, Undo/Redo). History is the Decisions drawer, opened from the
// bar's Decisions button. No spend, cost or limit in any bar (principle 4); costs show only in Decisions.

import { useState, type ReactNode } from 'react'
import { DataSharing } from '../DataSharing'
import { usePanels } from './panels'
import { useDoc, useServices, useShell, useShowMock, useUi } from '../../app/context'
import { Band, Icon, ShellBar, type Crumb } from '../shell/ShellBar'
import { ICON } from '../shell/bar'
import { exportBundle, download } from '../../export'
import { downloadAllMedia } from '../../media/download'
import { viewsOnCanvas } from '../../media/names'
import { idbGet } from '../../lib/idb'
import type { CanvasSnapshot } from '../../canvas/controller'
import { BetaTag } from '../../dogfood/Dogfood'
import { MenuItem } from '../Float'
import { JobTray } from '../JobTray'
import { UndoButtons, UndoMenuItems } from '../UndoButtons'
import { saveTime, useSave } from '../useSave'
import { NodeIcon, Presence, type NodeKind } from './Bar'
import { undoInMore, useFitLevel } from './fit'
import { LinkIcon } from './MoreMenu'
import { useProjectName } from '../useDownload'


/** Whose History a bar opens: the app's panel, or the Script editor's own. */
export interface HistoryToggle { on: boolean; toggle: () => void }

/** Assets and characters: the library, opened on purpose (it opens in the Booth beside the canvas). */
export function AssetsButton() {
  const { assets, toggle } = usePanels()
  return (
    <button type="button" className={`tba-btn pt-assets ${assets ? 'on' : ''}`} aria-pressed={assets}
      title="Assets and characters: your references, the team library and uploads" onClick={() => toggle('assets')}>
      <Icon d={ICON.image} /><span className="lt">Assets</span>
    </button>
  )
}

/** The canvas's More (ui-behaviour 3.18, 2.4): Export's rows (the media, the project, and what is not
 *  built yet, shown as not yet), Save now, and Copy link when Share has left the bar (tight). */
function CanvasMoreItems({ close, share }: { close: () => void; share: boolean }) {
  const { doc: docStore, project } = useServices()
  const shell = useShell()
  const doc = useDoc()
  const saving = useSave()
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
    } catch {
      setNote('That did not work. Try again.')
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
  return (
    <>
      {/* The document itself (mock menu): Rename, Duplicate, then Export; Data sharing and Delete last. */}
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
      <div className="fhead">Export</div>
      <MenuItem icon={<ExportIcon kind="zip" />} disabled={!!busy} hint={`${files} files`} onSelect={() => void run('media', async () => {
        const canvas = await idbGet<CanvasSnapshot>('kv', project.canvasKey).catch(() => undefined)
        const r = await downloadAllMedia(docStore.get(), name, viewsOnCanvas(docStore.get(), canvas?.elements ?? []))
        if (!r.packed) return 'Nothing to save in this browser'
        return r.missing ? `Saved ${r.packed} · ${r.missing} not in this browser` : null
      })}>{busy === 'media' ? 'Packing…' : 'Download all media (zip)'}</MenuItem>
      <MenuItem icon={<ExportIcon kind="clan" />} disabled={!!busy} onSelect={() => void run('clan', async () => {
        const { blob, name: file } = await exportBundle(docStore, project.canvasKey, name)
        download(blob, file)
        return null
      })}>{busy === 'clan' ? 'Packing…' : 'Project as .clan + assets'}</MenuItem>
      <MenuItem icon={<NodeIcon kind="script" size={16} />} disabled hint={soon} onSelect={() => {}}>Script as PDF</MenuItem>
      <MenuItem icon={<NodeIcon kind="script" size={16} />} disabled hint={soon} onSelect={() => {}}>Script as Fountain</MenuItem>
      <MenuItem icon={<NodeIcon kind="storyboard" size={16} />} disabled hint={soon} onSelect={() => {}}>Storyboard as PDF</MenuItem>
      <MenuItem icon={<ExportIcon kind="publish" />} disabled hint="Publish a reference from Assets" onSelect={() => {}}>Publish selected to team library</MenuItem>
      {note && <div className="pt-menuhead" role="status">{note}</div>}
      {(saving.can || share) && <div className="pt-menusep" />}
      {saving.can && (
        <MenuItem icon="⤒" hint="Ctrl+S" disabled={saving.state.kind === 'saving'} onSelect={() => { close(); void saving.save() }}>
          {saving.state.kind === 'saving' ? 'Saving…' : saving.state.kind === 'failed' ? 'Save now · the last save failed' : saving.state.kind === 'saved' ? `Save now · saved ${saveTime(saving.state.at)}` : 'Save now'}
        </MenuItem>
      )}
      {share && <MenuItem icon={<LinkIcon />} onSelect={() => { close(); void copyLink(location.href) }}>Copy link</MenuItem>}
      <div className="pt-menusep" />
      {allow && <MenuItem icon="⇄" hint="Who receives what your agency puts in" onSelect={() => setSharing(true)}>Data sharing</MenuItem>}
      {deleting ? (
        <div className="pt-menuhead" role="alertdialog" aria-label="Delete this project">
          Delete “{name ?? 'this project'}” from this browser? The server's copy is kept.
          <span className="pt-menuacts">
            <button type="button" className="btn sm danger" autoFocus onClick={() => { close(); void shell.remove(project.id).catch(() => undefined) }}>Delete</button>
            <button type="button" className="btn sm ghost" onClick={() => setDeleting(false)}>Cancel</button>
          </span>
        </div>
      ) : <MenuItem icon="×" danger hint="From this browser" onSelect={() => setDeleting(true)}>Delete…</MenuItem>}
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

/** The canvas's bar: the shell bar, with Canvas as where you are, the job chip and Assets; the ▾ menu
 *  holds Export's rows and Save now. The questions waiting are the Decisions count (and an amber tag on
 *  the node that asks). */
export function CanvasBar({ presence, phone = false }: { presence?: string; /** The phone's cut: watch only, so its job button has no ask dock and no Show. */ phone?: boolean }) {
  const { project, relay } = useServices()
  const mock = useShowMock()
  return (
    <ShellBar bar="canvas" className="ptbar" crumb={[{ label: 'Canvas' }]}
      menu={(close) => <CanvasMoreItems close={close} share />}
      job={phone ? <JobTray phone /> : <JobTray />}
      tools={<>
        {mock && relay.kind === 'mock' && <span className="mockbadge" title="No relay set: every result is a mock">MOCK</span>}
        <BetaTag screen={{ stage: 'canvas', project: project.id }} />
        <AssetsButton />
      </>}
      presence={<Presence line={presence} />} />
  )
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
  return (
    <div className={`ptbar nui-bars ${className}`} data-bar={icon} data-fit={level}>
      <ShellBar bar={icon} crumb={crumb} history={history} job={<JobTray />} primary={primary} presence={<Presence />}
        menu={(close) => (
          <>
            {moreHead && <><div className="pt-morehead">{moreHead}</div><div className="pt-menusep" /></>}
            {view && tight && <ViewItems view={view} close={close} />}
            {more?.(close)}
            {undoMore && <><div className="pt-menusep" /><UndoMenuItems close={close} /></>}
            {/* The same document rows as on the canvas (live test 2026-11-18: the rooms had only a dead row);
                Copy link is the bar's Share. */}
            {(more || undoMore || (view && tight) || moreHead) && <div className="pt-menusep" />}
            <CanvasMoreItems close={close} share={false} />
          </>
        )} />
      <Band label={`${title}: controls`}>
        <h1 className="pt-title sr-title" title={title}>{title}</h1>
        {meta}
        {view && !tight && <ViewSwitch view={view} />}
        {!tight && afterView}
        <span className="band-grow" />
        {right}
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
