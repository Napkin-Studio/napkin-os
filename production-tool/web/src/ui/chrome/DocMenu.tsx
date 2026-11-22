// The film's ▾ menu in the slim bar (Shrey, 2026-11-18/19; features/production-new-ui.clan, pinned decision):
//   New · Open… · All projects · Import/Export ›
//   Continue in › · Share… · Rename · Duplicate · Save now
//   (the page's own rows, when it has any)
//   Data sharing · Light / Dark · Delete…
// Two-line rows as the mock's .pop .mi. Import/Export, Continue in and Share open in place (a ‹ back row on
// top), so the menu never stacks a second popover.

import { useContext, useRef, useState, type ReactNode } from 'react'
import { RouterContext, useDoc, useServices, useShell, useUi } from '../../app/context'
import { DataSharing } from '../DataSharing'
import { MenuItem } from '../Float'
import { saveTime, useSave } from '../useSave'
import { useProjectName } from '../useDownload'
import { exportBundle, download } from '../../export'
import { downloadAllMedia } from '../../media/download'
import { mediaItems, viewsOnCanvas } from '../../media/names'
import { idbGet } from '../../lib/idb'
import type { CanvasSnapshot } from '../../canvas/controller'
import { setThemeChoice } from '../../theme'
import { useTheme } from '../shell/lookContext'
import { usePanels } from './panels'
import { NodeIcon } from './Bar'
import { LinkIcon } from './MoreMenu'

type View = 'main' | 'export' | 'continue' | 'share'

const SOON = 'Not in this version yet'

/** The menu's rows. `page` is the open page's own rows (Script's Copy link to this, Shots from…), with its title. */
export function DocMenu({ close, page }: { close: () => void; page?: { title: string; head?: ReactNode; rows?: ReactNode } }) {
  const { project } = useServices()
  const shell = useShell()
  const saving = useSave()
  const ui = useUi()
  const name = useProjectName()
  const allow = ui.me?.allow
  const [view, setView] = useState<View>('main')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
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
  const openPicker = () => fileRef.current?.click()
  const picker = (
    <input ref={fileRef} type="file" hidden accept=".zip,.clan,application/zip,application/vnd.clan+zip" aria-label="Open a .clan file"
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) void run('open', async () => { await shell.openFile(f, f.name); return null })
      }} />
  )
  const status = note && <div className="pt-menuhead" role="status">{note}</div>

  if (view !== 'main') {
    const title = view === 'export' ? 'Import/Export' : view === 'continue' ? 'Continue in' : 'Share'
    return (
      <div className="dm-sub" data-view={view}>
        <button type="button" role="menuitem" className="fmi dm-back" onClick={() => { setNote(null); setView('main') }}>
          <span className="fmi-ico" aria-hidden="true">‹</span><span className="fmi-text">{title}</span>
        </button>
        <div className="pt-menusep" />
        {view === 'export' && <ExportRows busy={busy} run={run} onOpen={openPicker} />}
        {view === 'continue' && <ContinueRows close={close} />}
        {view === 'share' && <ShareRows run={run} />}
        {status}
        {picker}
      </div>
    )
  }

  return (
    <>
      <MenuItem icon="+" hint="A blank canvas" onSelect={() => { close(); void shell.newProject() }}>New</MenuItem>
      <MenuItem icon="↥" disabled={!!busy} hint="A .clan or an Export zip from your computer" onSelect={openPicker}>{busy === 'open' ? 'Opening…' : 'Open…'}</MenuItem>
      <MenuItem icon="▤" hint="Every project you can open" onSelect={() => { close(); void shell.goHome() }}>All projects</MenuItem>
      <SubItem icon="⇅" hint="Media, the project as .clan, the script" onSelect={() => setView('export')}>Import/Export</SubItem>
      <div className="pt-menusep" />
      <SubItem icon="→" hint="A deck from this film, or link a brief" onSelect={() => setView('continue')}>Continue in</SubItem>
      <MenuItem icon={<LinkIcon />} hint="Copy the link for people at your agency" onSelect={() => setView('share')}>Share…</MenuItem>
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
      {saving.can && (
        <MenuItem icon="⤒" hint={saving.state.kind === 'saved' ? `Ctrl+S · saved ${saveTime(saving.state.at)}` : saving.state.kind === 'failed' ? 'Ctrl+S · the last save failed' : 'Ctrl+S'}
          disabled={saving.state.kind === 'saving'} onSelect={() => { close(); void saving.save() }}>
          {saving.state.kind === 'saving' ? 'Saving…' : 'Save now'}
        </MenuItem>
      )}
      {page && (page.head || page.rows) && (
        <>
          <div className="pt-menusep" />
          <div className="fhead">{page.title}</div>
          {page.head && <div className="pt-morehead">{page.head}</div>}
          {page.rows}
        </>
      )}
      <div className="pt-menusep" />
      {allow && <MenuItem icon="⇄" hint="Who receives what your agency puts in" onSelect={() => setSharing(true)}>Data sharing</MenuItem>}
      <ThemeRow />
      {deleting ? (
        <div className="pt-menuhead" role="alertdialog" aria-label="Delete this project">
          Delete “{name ?? 'this project'}” from this browser? The server's copy is kept.
          <span className="pt-menuacts">
            <button type="button" className="btn sm danger" autoFocus onClick={() => { close(); void shell.remove(project.id).catch(() => undefined) }}>Delete</button>
            <button type="button" className="btn sm ghost" onClick={() => setDeleting(false)}>Cancel</button>
          </span>
        </div>
      ) : <MenuItem icon="×" danger hint="From this browser; the server’s copy is kept" onSelect={() => setDeleting(true)}>Delete…</MenuItem>}
      {status}
      {picker}
      {sharing && allow && <DataSharing allow={allow} onClose={() => { setSharing(false); close() }} />}
    </>
  )
}

/** A row that opens its part of the menu in place (›). */
function SubItem({ icon, hint, children, onSelect }: { icon: ReactNode; hint: string; children: ReactNode; onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" aria-haspopup="menu" className="fmi dm-subitem" onClick={onSelect}>
      <span className="fmi-ico" aria-hidden="true">{icon}</span>
      <span className="fmi-text">{children}<span className="dm-chev" aria-hidden="true">›</span></span>
      <span className="fmi-hint">{hint}</span>
    </button>
  )
}

/** Light / Dark: the bar's old theme button, as one row (applies at once; the account menu keeps System). */
function ThemeRow() {
  const theme = useTheme()
  return (
    <div className="pt-menurow dm-theme" role="group" aria-label="Light or dark">
      <span className="fmi-ico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg></span>
      <span className="dm-theme-l">Light / Dark</span>
      <span style={{ flex: 1 }} />
      <span className="pt-seg pt-theme">
        {(['light', 'dark'] as const).map((t) => (
          <button key={t} type="button" role="menuitemradio" aria-checked={theme === t} aria-pressed={theme === t} onClick={() => setThemeChoice(t)}>{t === 'light' ? 'Light' : 'Dark'}</button>
        ))}
      </span>
    </div>
  )
}

function ExportRows({ busy, run, onOpen }: { busy: string | null; run: (what: string, fn: () => Promise<string | null>) => Promise<void>; onOpen: () => void }) {
  const { doc: docStore, project } = useServices()
  const doc = useDoc()
  const name = useProjectName()
  // What the zip holds (media/names.ts), not every asset: masks and drawings are not media (UAT round 1: "34 files", 29 in the zip).
  const files = mediaItems(doc, name).length
  return (
    <>
      <div className="fhead">Import</div>
      <MenuItem icon="↥" disabled={!!busy} hint="A .clan or an Export zip becomes a new project" onSelect={onOpen}>{busy === 'open' ? 'Opening…' : 'Open a .clan file…'}</MenuItem>
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
      <MenuItem icon={<NodeIcon kind="script" size={16} />} disabled hint={`${SOON} · the Script editor exports PDF and Fountain`} onSelect={() => {}}>Script as PDF</MenuItem>
      <MenuItem icon={<NodeIcon kind="script" size={16} />} disabled hint={SOON} onSelect={() => {}}>Script as Fountain</MenuItem>
      <MenuItem icon={<NodeIcon kind="storyboard" size={16} />} disabled hint={SOON} onSelect={() => {}}>Storyboard as PDF</MenuItem>
      <MenuItem icon={<ExportIcon kind="publish" />} disabled hint="Publish a reference from Assets" onSelect={() => {}}>Publish selected to team library</MenuItem>
    </>
  )
}

/** Continue in: where this film goes next. Link a brief… opens Assets › From Napkin on the canvas, where the
 *  agency's Brief Maker briefs are (features/brief-node.clan; live test 2026-11-18). */
function ContinueRows({ close }: { close: () => void }) {
  const { ui } = useServices()
  // Read at the click only: the bar also shows where no router is (the editors' own tests).
  const router = useContext(RouterContext)
  const panels = usePanels()
  const linkBrief = () => {
    close()
    // The Brief node goes on the canvas: an editor or a room goes back to it first.
    if (router?.get().kind === 'script') router.leave()
    ui.update((u) => { u.stage = 'character' }, 'stage')
    panels.openAssets('napkin')
  }
  return (
    <>
      <MenuItem icon="+" disabled hint={SOON} onSelect={() => {}}>New deck from this film</MenuItem>
      <MenuItem icon="↔" hint="From Brief Maker, in Assets › From Napkin" onSelect={linkBrief}>Link a brief…</MenuItem>
    </>
  )
}

/** Share: copy the link (it opens only for people at your agency who can see the film). */
function ShareRows({ run }: { run: (what: string, fn: () => Promise<string | null>) => Promise<void> }) {
  return (
    <MenuItem icon={<LinkIcon />} hint="Opens for people at your agency who can see the film" onSelect={() => void run('link', () => copyLink(location.href))}>Copy link</MenuItem>
  )
}

async function copyLink(url: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(url)
    return 'Link copied'
  } catch {
    return 'Copy the address bar'
  }
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
