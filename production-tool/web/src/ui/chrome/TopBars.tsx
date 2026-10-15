// The canvas top bar and every editor's top bar (ui-behaviour 3.1, 2.3; mocks Main, Assets,
// Storyboard, ScriptScreenplay). No spend, cost or limit anywhere (principle 4).

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { usePanels } from './panels'
import { useDoc, useServices, useShell, useShowMock } from '../../app/context'
import { exportBundle, download } from '../../export'
import { downloadAllMedia } from '../../media/download'
import { viewsOnCanvas } from '../../media/names'
import { idbGet } from '../../lib/idb'
import type { CanvasSnapshot } from '../../canvas/controller'
import { openAsks } from '../../model/selectors'
import { BetaTag } from '../../dogfood/Dogfood'
import { Float } from '../Float'
import { JobTray } from '../JobTray'
import { SaveButton } from '../SaveButton'
import { Account, BackButton, BarSep, Brand, HomeMark, NodeIcon, Presence, type NodeKind } from './Bar'


function HistoryButton() {
  const { history, toggle } = usePanels()
  return (
    <button type="button" className={`btn ${history ? 'on' : ''}`} aria-pressed={history} title="Every decision, who made it and why" onClick={() => toggle('history')}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M7 4v3.2l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
      History
    </button>
  )
}

function AssetsButton() {
  const { assets, toggle } = usePanels()
  return (
    <button type="button" className={`btn ${assets ? 'on' : ''}`} aria-pressed={assets} title="Your references, the team library and uploads" onClick={() => toggle('assets')}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5 2v10" stroke="currentColor" strokeWidth="1.3" /></svg>
      Assets
    </button>
  )
}

/** Export (ui-behaviour 3.18): the media, the project, and what is not built yet, shown as not yet. */
function ExportMenu() {
  const { doc: docStore, project } = useServices()
  const shell = useShell()
  const doc = useDoc()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const close = useCallback(() => { setOpen(false); setNote(null) }, [])
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
      <button ref={ref} type="button" className={`btn ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Export
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
      <Float anchor={ref} open={open} onClose={close} align="end" label="Export" className="pt-menu">
        <button type="button" role="menuitem" className="pt-menurow" disabled={!!busy} onClick={() => void run('media', async () => {
          const canvas = await idbGet<CanvasSnapshot>('kv', project.canvasKey).catch(() => undefined)
          const r = await downloadAllMedia(docStore.get(), name, viewsOnCanvas(docStore.get(), canvas?.elements ?? []))
          if (!r.packed) return 'Nothing to save in this browser'
          return r.missing ? `Saved ${r.packed} · ${r.missing} not in this browser` : null
        })}>
          <ExportIcon kind="zip" />{busy === 'media' ? 'Packing…' : 'Download all media (zip)'}<span className="hint">{files} files</span>
        </button>
        <button type="button" role="menuitem" className="pt-menurow" disabled={!!busy} onClick={() => void run('clan', async () => {
          const { blob, name: file } = await exportBundle(docStore, project.canvasKey, name)
          download(blob, file)
          return null
        })}>
          <ExportIcon kind="clan" />{busy === 'clan' ? 'Packing…' : 'Project as .clan + assets'}
        </button>
        <div className="pt-menusep" />
        <button type="button" role="menuitem" className="pt-menurow" disabled title={soon}><NodeIcon kind="script" size={16} />Script as PDF</button>
        <button type="button" role="menuitem" className="pt-menurow" disabled title={soon}><NodeIcon kind="script" size={16} />Script as Fountain<span className="hint">.fountain</span></button>
        <button type="button" role="menuitem" className="pt-menurow" disabled title={soon}><NodeIcon kind="storyboard" size={16} />Storyboard as PDF</button>
        <div className="pt-menusep" />
        <button type="button" role="menuitem" className="pt-menurow" disabled title="Publish a reference from Assets"><ExportIcon kind="publish" />Publish selected to team library</button>
        {note && <div className="pt-menuhead" role="status">{note}</div>}
      </Float>
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
function ShareButton() {
  const [said, setSaid] = useState<string | null>(null)
  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      setSaid('Link copied')
    } catch {
      setSaid('Copy the address bar')
    }
    setTimeout(() => setSaid(null), 2400)
  }
  return <button type="button" className="btn" onClick={() => void share()} aria-live="polite">{said ?? 'Share'}</button>
}

/** "2 questions waiting", only while asks are open, with its position and ‹ › (ui-behaviour 3.17). */
function AsksPill() {
  const doc = useDoc()
  const asks = openAsks(doc)
  const [at, setAt] = useState(0)
  if (!asks.length) return null
  const i = Math.min(at, asks.length - 1)
  return (
    <div className="pt-asks" role="group" aria-label="Questions waiting">
      <span className="dot" aria-hidden="true" />
      <b>{asks.length} {asks.length === 1 ? 'question' : 'questions'} waiting</b>
      <span className="pos">{i + 1} of {asks.length}</span>
      <button type="button" aria-label="Previous question" onClick={() => setAt((i - 1 + asks.length) % asks.length)}>‹</button>
      <button type="button" aria-label="Next question" onClick={() => setAt((i + 1) % asks.length)}>›</button>
    </div>
  )
}

/** The canvas's bar: Home, the brand and project, what is running, the people here, History, Assets, Export, Share, you. */
export function CanvasBar({ presence }: { presence?: string }) {
  const shell = useShell()
  const { project, relay } = useServices()
  const mock = useShowMock()
  const name = shell.index.get(project.id)?.name
  return (
    <header className="ptbar">
      <HomeMark onClick={() => void shell.goHome()} />
      <Brand project={name} />
      <BetaTag screen={{ stage: 'canvas', project: project.id }} />
      {mock && relay.kind === 'mock' && <span className="mockbadge" title="No relay set: every result is a mock">MOCK</span>}
      <AsksPill />
      <span className="pt-grow" />
      <Presence line={presence} />
      <JobTray />
      <SaveButton />
      <HistoryButton />
      <AssetsButton />
      <ExportMenu />
      <ShareButton />
      <Account />
    </header>
  )
}

/** An editor's bar: ← back, the node mark and title, what follows it, then the right side: presence, the job
 *  button (the same slot on every bar), the editor's own controls, History, the primary. */
export function EditorBar({ back, onBack, icon, title, meta, middle, right, primary }: {
  back: string
  onBack: () => void
  icon: NodeKind
  title: ReactNode
  meta?: ReactNode
  middle?: ReactNode
  right?: ReactNode
  primary?: ReactNode
}) {
  return (
    <header className="ptbar">
      <BackButton label={back} onClick={onBack} />
      <BarSep />
      <NodeIcon kind={icon} />
      <h1 className="pt-title">{title}</h1>
      {meta}
      {middle}
      <span className="pt-grow" />
      <Presence />
      <JobTray />
      {right}
      <HistoryButton />
      {primary}
      <Account />
    </header>
  )
}
