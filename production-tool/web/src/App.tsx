import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from './app/context'
import { CONFIG_CHOICES, PROVIDER_CHOICES, routedProvider, type ConfigChoice, type ProviderChoice } from './capabilities'
import type { CanvasSnapshot } from './canvas/controller'
import type { StageName } from './contracts/types'
import { updateDoc } from './doc/store'
import { download, exportBundle } from './export'
import { Character } from './stages/Character'
import { Storyboard } from './stages/Storyboard'
import { Video } from './stages/Video'
import { StudioMark } from './ui/Mark'
import { HistoryPanel } from './ui/History'
import { CLAN_DB } from './doc/clan'
import { relayId } from './relay'
import { startOver, START_OVER_TEXT } from './app/startOver'
import { OwnKeysButton } from './keys/OwnKeysPanel'
import { InlineConfirm } from './ui/Undo'
import { UpdateFollows } from './ui/Follow'
import { UpdateBox } from './ui/UpdateBox'
import { Float, MenuItem } from './ui/Float'
import { JobTray } from './ui/JobTray'

const STAGES: { id: StageName; n: number; label: string }[] = [
  { id: 'character', n: 1, label: 'Canvas' },
  { id: 'storyboard', n: 2, label: 'Storyboard' },
  { id: 'video', n: 3, label: 'Video' },
]

export function App({ initialCanvas }: { initialCanvas: CanvasSnapshot | null }) {
  const { relay, clan, storeNote } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  const stage = doc.stage.current
  const [history, setHistory] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [restart, setRestart] = useState<'no' | 'asking' | 'busy'>('no')
  const services = useServices()
  useEffect(() => clan?.onTrouble((m) => setTrouble(m)), [clan])

  if (relay.kind === 'http' && !ui.session) return <SignIn />

  return (
    <>
      <TopBar history={history} onHistory={() => setHistory((h) => !h)} onStartOver={() => setRestart('asking')} />
      {restart !== 'no' && (
        <div className="startover">
          <InlineConfirm text={START_OVER_TEXT} yes={restart === 'busy' ? 'Starting over…' : 'Start over'} no="Keep working" busy={restart === 'busy'}
            onNo={() => setRestart('no')}
            onYes={async () => {
              setRestart('busy')
              try {
                await startOver(services)
              } catch (e) {
                console.error('could not start over', e)
                setRestart('no')
              }
            }} />
        </div>
      )}
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

function TopBar({ history, onHistory, onStartOver }: { history: boolean; onHistory: () => void; onStartOver: () => void }) {
  const { doc: docStore, relay, ui: uiStore } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  useJobsTick()
  const [exporting, setExporting] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const stage = doc.stage.current
  const reachable = (s: StageName) =>
    s === 'character' || (s === 'storyboard' && doc.refs.length > 0) || (s === 'video' && doc.refs.length > 0 && (doc.shots ?? []).length > 0 && (doc.shots ?? []).every((x) => x.status === 'locked' || x.status === 'needs_review'))
  const order = STAGES.findIndex((s) => s.id === stage)

  return (
    <header className="topbar">
      <div className="brand">
        <StudioMark size={22} />
        <span className="brand-studio">Napkin Studio</span>
        <span className="brand-tool">Production</span>
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
              onClick={() => updateDoc(docStore, (d) => { d.stage.current = s.id }, 'stage')}
            >
              <span className="n">{i < order ? '✓' : s.n}</span>
              {s.label}
            </button>
          </span>
        ))}
      </nav>
      <div className="topbar-right">
        {stage !== 'character' && <UpdateFollows />}
        <JobTray />
        {config.flags.ownKeys && <OwnKeysButton />}
        <button className={`btn sm ${history ? 'on' : ''}`} aria-pressed={history} title="Every step, who made it and why" onClick={onHistory}>History</button>
        {/* Export, the handle, Sign out and Start over live in the menu: the bar keeps the run's state, keys and History.
            Undo and Redo (features/system-undo.clan) will sit just left of History. */}
        <button ref={menuRef} className={`btn sm icon ${menuOpen ? 'on' : ''}`} aria-label="Menu" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
        <Float anchor={menuRef} open={menuOpen} onClose={closeMenu} align="end" label="Menu">
          <div className="fhead handle">@{ui.session?.handle ?? doc.participant.handle}</div>
          <MenuItem icon="↓" disabled={exporting} hint="zip" onSelect={async () => {
            setExporting(true)
            try {
              const { blob, name } = await exportBundle(docStore)
              download(blob, name)
            } finally {
              setExporting(false)
              closeMenu()
            }
          }}>{exporting ? 'Packing…' : 'Export'}</MenuItem>
          {relay.kind === 'http' && ui.session && (
            <MenuItem icon="⎋" onSelect={() => {
              closeMenu()
              relay.useToken(null)
              uiStore.update((u) => { u.session = undefined; u.sessionFor = undefined })
            }}>Sign out</MenuItem>
          )}
          <div className="fsep" />
          <MenuItem icon="↺" danger onSelect={() => { closeMenu(); onStartOver() }}>Start over…</MenuItem>
        </Float>
      </div>
    </header>
  )
}

function DevSwitch() {
  const { ui: uiStore } = useServices()
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
          if (!confirm('Start over? This clears your work in this browser.')) return
          try {
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

function SignIn() {
  const { relay, ui: uiStore, doc } = useServices()
  const [code, setCode] = useState('')
  const [handle, setHandle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ display: 'flex', flex: 1, background: 'var(--soft)' }}>
      <form className="card signin stack" onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          const s = await relay.session({ eventCode: code.trim(), handle: handle.trim() })
          relay.useToken(s.token)
          uiStore.update((u) => { u.session = s; u.sessionFor = relayId() })
          await updateDoc(doc, (d) => { d.participant = { id: s.participantId, handle: s.handle } }, 'sign in')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not sign in.')
        } finally {
          setBusy(false)
        }
      }}>
        <div className="row" style={{ gap: 10 }}><StudioMark size={28} /><b className="brand" style={{ fontSize: 18 }}>Napkin Studio <span className="brand-tool">Production</span></b></div>
        <p className="muted" style={{ margin: 0 }}>Make your characters on a free canvas, storyboard them, and turn it into an ad.</p>
        <label className="stack" style={{ gap: 4 }}><span className="eyebrow">Event code</span><input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></label>
        <label className="stack" style={{ gap: 4 }}><span className="eyebrow">Your name</span><input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} pattern="[A-Za-z0-9_.\-]{2,24}" title="2-24 letters, numbers, . _ or -" /></label>
        {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div>}
        <button className="btn primary" disabled={busy || code.trim().length < 4 || handle.trim().length < 2}>{busy ? 'Signing in…' : 'Start'}</button>
      </form>
    </div>
  )
}
