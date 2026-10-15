// The canvas top bar and every editor's top bar (ui-behaviour 3.1, 2.3; mocks Main, Assets,
// Storyboard, ScriptScreenplay; features/topbar-declutter.clan). Each bar keeps a small fixed set:
// the way back, the title, at most one view switch, the job button, History, More, one primary and
// the account. Everything else is in More. Three fit levels (fit.ts) decide what goes icon-only or
// into More as the window narrows. No spend, cost or limit anywhere (principle 4).

import { useState, type ReactNode } from 'react'
import { usePanels } from './panels'
import { useDoc, useServices, useShell, useShowMock } from '../../app/context'
import { exportBundle, download } from '../../export'
import { downloadAllMedia } from '../../media/download'
import { viewsOnCanvas } from '../../media/names'
import { idbGet } from '../../lib/idb'
import type { CanvasSnapshot } from '../../canvas/controller'
import { openAsks } from '../../model/selectors'
import { BetaTag } from '../../dogfood/Dogfood'
import { MenuItem } from '../Float'
import { JobTray } from '../JobTray'
import { SaveStatus } from '../SaveButton'
import { UndoButtons, UndoMenuItems } from '../UndoButtons'
import { saveTime, useSave } from '../useSave'
import { Account, BackButton, BarSep, Brand, HomeMark, NodeIcon, Presence, type NodeKind } from './Bar'
import { undoInMore, useFitLevel } from './fit'
import { LinkIcon, MoreMenu } from './MoreMenu'


const HISTORY_TIP = 'History: every decision, who made it and why'
const HistoryIcon = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M7 4v3.2l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>

/** Whose History a bar opens: the app's panel, or the Script editor's own. */
export interface HistoryToggle { on: boolean; toggle: () => void }

function useHistoryToggle(own?: HistoryToggle): HistoryToggle {
  const { history, toggle } = usePanels()
  return own ?? { on: history, toggle: () => toggle('history') }
}

/** History: words at full, the clock alone at compact (its name in the tooltip and label). */
function HistoryButton({ iconOnly, own }: { iconOnly: boolean; own?: HistoryToggle }) {
  const h = useHistoryToggle(own)
  return (
    <button type="button" className={`btn pt-hist ${iconOnly ? 'icon' : ''} ${h.on ? 'on' : ''}`} aria-pressed={h.on} aria-label={iconOnly ? 'History' : undefined}
      data-tip={HISTORY_TIP} onClick={h.toggle}>
      <HistoryIcon />{!iconOnly && 'History'}
    </button>
  )
}

/** History as a row of More, where the bar has no room for it (tight). */
function HistoryItem({ close, own }: { close: () => void; own?: HistoryToggle }) {
  const h = useHistoryToggle(own)
  return <MenuItem icon={<HistoryIcon />} hint={h.on ? 'open' : undefined} onSelect={() => { close(); h.toggle() }}>History</MenuItem>
}

function AssetsButton({ iconOnly }: { iconOnly: boolean }) {
  const { assets, toggle } = usePanels()
  return (
    <button type="button" className={`btn pt-assets ${iconOnly ? 'icon' : ''} ${assets ? 'on' : ''}`} aria-pressed={assets} aria-label={iconOnly ? 'Assets' : undefined}
      data-tip="Assets: your references, the team library and uploads" onClick={() => toggle('assets')}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5 2v10" stroke="currentColor" strokeWidth="1.3" /></svg>
      {!iconOnly && 'Assets'}
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
  const name = shell.index.get(project.id)?.name
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
  return (
    <>
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

function ShareButton() {
  const [said, setSaid] = useState<string | null>(null)
  const share = async () => {
    setSaid(await copyLink(location.href))
    setTimeout(() => setSaid(null), 2400)
  }
  return <button type="button" className="btn pt-share" onClick={() => void share()} aria-live="polite">{said ?? 'Share'}</button>
}

/** "2 questions waiting", only while asks are open, with ‹ › (ui-behaviour 3.17); its position is in its
 *  label. Compact and tight: the count alone. */
function AsksPill({ short }: { short: boolean }) {
  const doc = useDoc()
  const asks = openAsks(doc)
  const [at, setAt] = useState(0)
  if (!asks.length) return null
  const i = Math.min(at, asks.length - 1)
  const words = `${asks.length} ${asks.length === 1 ? 'question' : 'questions'} waiting`
  return (
    <div className="pt-asks" role="group" aria-label={`${words}, ${i + 1} of ${asks.length}`} data-tip={`${words} · ${i + 1} of ${asks.length}`}>
      <span className="dot" aria-hidden="true" />
      <b>{short ? asks.length : words}</b>
      <button type="button" aria-label="Previous question" onClick={() => setAt((i - 1 + asks.length) % asks.length)}>‹</button>
      <button type="button" aria-label="Next question" onClick={() => setAt((i + 1) % asks.length)}>›</button>
    </div>
  )
}

/** The canvas's bar: Home, the brand and project, the questions, the people here, the job button, the
 *  save state, History, Assets, Share, More (Export, Save now), you. */
export function CanvasBar({ presence }: { presence?: string }) {
  const shell = useShell()
  const { project, relay } = useServices()
  const mock = useShowMock()
  const { level } = useFitLevel()
  const name = shell.index.get(project.id)?.name
  const tight = level === 'tight'
  return (
    <header className="ptbar" data-fit={level} data-bar="canvas">
      <HomeMark onClick={() => void shell.goHome()} />
      <Brand project={name} wordmark={!tight} />
      <BetaTag screen={{ stage: 'canvas', project: project.id }} />
      {mock && relay.kind === 'mock' && <span className="mockbadge" title="No relay set: every result is a mock">MOCK</span>}
      <AsksPill short={level !== 'full'} />
      <span className="pt-grow" />
      <Presence line={presence} />
      <JobTray />
      <SaveStatus dot={tight} />
      <HistoryButton iconOnly={level !== 'full'} />
      <AssetsButton iconOnly={level !== 'full'} />
      {!tight && <ShareButton />}
      <MoreMenu where="canvas" tip={tight ? 'More: export, save now, copy link' : 'More: export, save now'}>
        {(close) => <CanvasMoreItems close={close} share={tight} />}
      </MoreMenu>
      <Account />
    </header>
  )
}

/** An editor's bar: ← back, the node mark and its title (it shrinks first, with an ellipsis), the meta
 *  pills and the view switch; then presence, the job button (the same slot on every bar), the editor's
 *  own controls, Undo/Redo, History, More, the primary and the account.
 *  Compact: History goes icon-only and the meta pills move into More's head. Tight: the way back is the
 *  arrow alone, the view switch and History move into More, Undo/Redo too on a fine pointer. */
export function EditorBar({ className = '', back, onBack, icon, title, meta, view, right, undo = false, history, moreHead, more, moreTip, primary }: {
  className?: string
  back: string
  onBack: () => void
  icon: NodeKind
  title: string
  meta?: ReactNode
  /** The one view switch (Screenplay | Video · Audio, Picture | Sound): the bar's, or More's at tight. */
  view?: { label: string; options: { id: string; label: string }[]; value: string; onPick: (id: string) => void }
  right?: ReactNode
  undo?: boolean
  history?: HistoryToggle
  /** Always at the head of More (Script's Shots from). */
  moreHead?: ReactNode
  /** The editor's own rows of More (every editor has Copy link to this). */
  more?: (close: () => void) => ReactNode
  moreTip?: string
  primary?: ReactNode
}) {
  const { level, coarse } = useFitLevel()
  const full = level === 'full'
  const tight = level === 'tight'
  const undoMore = undo && undoInMore(level, coarse)
  return (
    <header className={`ptbar ${className}`} data-fit={level} data-bar={icon}>
      <BackButton label={back} onClick={onBack} short={tight} />
      <BarSep />
      <NodeIcon kind={icon} />
      <h1 className="pt-title" title={title}>{title}</h1>
      {full && meta}
      {view && !tight && <ViewSwitch view={view} />}
      <span className="pt-grow" />
      <Presence />
      <JobTray />
      {right}
      {undo && !undoMore && <UndoButtons />}
      {!tight && <HistoryButton iconOnly={!full} own={history} />}
      <MoreMenu where={icon} tip={moreTip ?? 'More: copy link'} head={(!full && meta) || moreHead ? <>{!full && meta}{moreHead}</> : undefined}>
        {(close) => (
          <>
            {view && tight && <ViewItems view={view} close={close} />}
            {more?.(close)}
            {(undoMore || tight) && <div className="pt-menusep" />}
            {undoMore && <UndoMenuItems close={close} />}
            {tight && <HistoryItem close={close} own={history} />}
          </>
        )}
      </MoreMenu>
      {primary}
      <Account />
    </header>
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
