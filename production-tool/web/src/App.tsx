import { useEffect, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useShell, useUi } from './app/context'
import { CONFIG_CHOICES, PROVIDER_CHOICES, routedProvider, type ConfigChoice, type ProviderChoice } from './capabilities'
import type { CanvasSnapshot } from './canvas/controller'
import type { StageName } from './contracts/types'
import { systemUpdate } from './doc/store'
import { download, exportBundle } from './export'
import { isActive } from './jobs/runner'
import { Character } from './stages/Character'
import { Storyboard } from './stages/Storyboard'
import { Video } from './stages/Video'
import { StudioMark } from './ui/Mark'
import { HistoryPanel } from './ui/History'
import { CLAN_DB } from './doc/clan'
import { clanDbFor, INDEX_KEY } from './projects/storage'
import { OwnKeysButton } from './keys/OwnKeysPanel'
import { UpdateFollows } from './ui/Follow'
import { UpdateBox } from './ui/UpdateBox'
import { UndoButtons } from './ui/UndoButtons'
import { SaveButton } from './ui/SaveButton'

const STAGES: { id: StageName; n: number; label: string }[] = [
  { id: 'character', n: 1, label: 'Canvas' },
  { id: 'storyboard', n: 2, label: 'Storyboard' },
  { id: 'video', n: 3, label: 'Video' },
]

export function App({ initialCanvas }: { initialCanvas: CanvasSnapshot | null }) {
  const { clan, storeNote } = useServices()
  const doc = useDoc()
  const { config } = useConfig()
  const stage = doc.stage.current
  const [history, setHistory] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  useEffect(() => clan?.onTrouble((m) => setTrouble(m)), [clan])

  return (
    <>
      <TopBar history={history} onHistory={() => setHistory((h) => !h)} />
      {config.banner && <div className="banner">{config.banner}</div>}
      {storeNote && <div className="storenote" role="status">{storeNote}</div>}
      {trouble && <div className="storenote" role="alert">That change could not be saved to the .clan and was undone. <button className="btn xs ghost" onClick={() => setTrouble(null)}>OK</button></div>}
      <div className="stage">
        {history && <HistoryPanel store={clan} onClose={() => setHistory(false)} />}
        {/* The canvas stays mounted so its jobs keep landing while you're on another stage. */}
        <div className={`stage-pane ${stage === 'character' ? '' : 'hidden'}`}>
          <Character initial={initialCanvas} active={stage === 'character'} />
        </div>
        {stage === 'storyboard' && <div className="stage-pane"><Storyboard /></div>}
        {stage === 'video' && <div className="stage-pane"><Video /></div>}
      </div>
      <UpdateBox />
      {!import.meta.env.PROD && <DevSwitch />}
    </>
  )
}

function TopBar({ history, onHistory }: { history: boolean; onHistory: () => void }) {
  const { doc: docStore, relay, ui: uiStore, project } = useServices()
  const shell = useShell()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  useJobsTick()
  const [exporting, setExporting] = useState(false)
  const [menu, setMenu] = useState(false)
  const stage = doc.stage.current
  const reachable = (s: StageName) =>
    s === 'character' || (s === 'storyboard' && doc.refs.length > 0) || (s === 'video' && doc.refs.length > 0 && (doc.shots ?? []).length > 0 && (doc.shots ?? []).every((x) => x.status === 'locked' || x.status === 'needs_review'))
  const order = STAGES.findIndex((s) => s.id === stage)
  const active = doc.jobs.filter((j) => isActive(j.state))
  const queued = active.filter((j) => j.state === 'queued').length
  const running = active.length - queued

  return (
    <header className="topbar">
      {/* The Napkin mark goes back to Home (features/project-home.clan); this project is saved on the way. */}
      <div className="brand">
        <button className="brand-home" title="Home: your projects" aria-label="Home" onClick={() => void shell.goHome()}><StudioMark size={24} /></button>
        <span>Napkin</span>
        <small title={shell.index.get(project.id)?.name}>{shell.index.get(project.id)?.name ?? 'Production Tool'}</small>
        {relay.kind === 'mock' && <span className="mockbadge" title="No relay set: every result is a mock">MOCK</span>}
      </div>
      <nav className="rail" aria-label="Stages">
        {STAGES.map((s, i) => (
          <span key={s.id} className="row" style={{ gap: 4 }}>
            {i > 0 && <span className="rail-sep">·</span>}
            <button
              className={`rail-step ${s.id === stage ? 'current' : ''} ${i < order ? 'done' : ''}`}
              disabled={!reachable(s.id)}
              aria-current={s.id === stage ? 'step' : undefined}
              onClick={() => systemUpdate(docStore, (d) => { d.stage.current = s.id }, 'stage')}
            >
              <span className="n">{i < order ? '✓' : s.n}</span>
              {s.label}
            </button>
          </span>
        ))}
      </nav>
      <div className="topbar-right">
        {stage !== 'character' && <UpdateFollows />}
        <span className={`jobchip ${active.length ? 'busy' : ''}`} aria-live="polite">
          <span className="dot" />
          {!active.length ? 'Nothing running' : [running && `${running} running`, queued && `${queued} queued`].filter(Boolean).join(' · ')}
        </span>
        {config.flags.ownKeys && <OwnKeysButton />}
        <UndoButtons />
        <SaveButton />
        <button className={`btn sm ${history ? 'on' : ''}`} aria-pressed={history} title="Every step, who made it and why" onClick={onHistory}>History</button>
        {/* Export, the handle and Sign out live in the menu: the bar keeps the run's state, keys and History. */}
        <span className="topmenu">
          <button className={`btn sm icon ${menu ? 'on' : ''}`} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
          {menu && (
            <span className="menu" role="menu">
              <span className="handle menu-head">@{ui.session?.handle ?? doc.participant.handle}</span>
              <button className="btn sm ghost" role="menuitem" disabled={exporting} title="Download your work: the .clan and its pictures, as a zip" onClick={async () => {
                setExporting(true)
                try {
                  const { blob, name } = await exportBundle(docStore, project.canvasKey, shell.index.get(project.id)?.name)
                  download(blob, name)
                } finally {
                  setExporting(false)
                  setMenu(false)
                }
              }}>{exporting ? 'Packing…' : 'Export'}</button>
              {relay.kind === 'http' && ui.session && (
                <button className="btn sm ghost" role="menuitem" onClick={() => {
                  setMenu(false)
                  relay.useToken(null)
                  uiStore.update((u) => { u.session = undefined; u.sessionFor = undefined })
                  void shell.goHome()
                }}>Sign out</button>
              )}
              {/* New project replaces Start over: this one is saved and stays on Home; nothing is overwritten. */}
              <button className="btn sm ghost" role="menuitem" title="Save this project and start an empty one" onClick={() => { setMenu(false); void shell.newProject() }}>New project</button>
              <button className="btn sm ghost" role="menuitem" onClick={() => { setMenu(false); void shell.goHome() }}>All projects</button>
            </span>
          )}
        </span>
      </div>
    </header>
  )
}

function DevSwitch() {
  const { ui: uiStore } = useServices()
  const shell = useShell()
  const ui = useUi()
  const { config, controls } = useConfig()
  const [open, setOpen] = useState(false)
  if (!open) return <div className="devswitch"><button className="btn sm" onClick={() => setOpen(true)}>⚙ Dev: {ui.providerChoice} · {ui.configChoice}</button></div>
  return (
    <div className="devswitch">
      <div className="open">
        <div className="row"><b>Dev switch</b><span className="spacer" /><button className="btn xs ghost" onClick={() => setOpen(false)}>Close</button></div>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Config</span>
          <select className="select" value={ui.configChoice} onChange={(e) => uiStore.update((u) => { u.configChoice = e.target.value as ConfigChoice })}>
            {CONFIG_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Providers (UI gating)</span>
          <select className="select" value={ui.providerChoice} onChange={(e) => uiStore.update((u) => { u.providerChoice = e.target.value as ProviderChoice })}>
            {PROVIDER_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <div className="faint" style={{ fontSize: 11 }}>image: {routedProvider('generate', config) ?? 'off'} · clip: {routedProvider('clip', config) ?? 'off'} · clip edit: {routedProvider('clip_edit', config) ?? 'off'}</div>
        <div className="ctl">
          {Object.entries(controls).map(([k, v]) => <span key={k} className={v ? 'y' : 'n'}>{k}</span>)}
        </div>
        <div className="faint" style={{ fontSize: 11 }}>Results always come from the mock relay unless VITE_RELAY_URL is set. Type #fail or #moderate in a text box to see errors.</div>
        <button className="btn xs ghost" style={{ color: 'var(--danger)' }} onClick={() => {
          if (!confirm(`Reset everything? This clears every project in this browser (${INDEX_KEY}: ${shell.index.all().length}).`)) return
          try {
            for (const p of shell.index.all()) indexedDB.deleteDatabase(clanDbFor(p.id))
            indexedDB.deleteDatabase('napkin-production-tool')
            indexedDB.deleteDatabase(CLAN_DB)
            localStorage.removeItem('napkin-pt.mock-ledger')
          } catch { /* nothing to clear */ }
          location.reload()
        }}>Reset everything</button>
      </div>
    </div>
  )
}
