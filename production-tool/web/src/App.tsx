import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useConfig, useRoute, useServices, useShell, useUi } from './app/context'
import { CONFIG_CHOICES, PROVIDER_CHOICES, routedProvider, type ConfigChoice, type ProviderChoice } from './capabilities'
import type { CanvasSnapshot } from './canvas/controller'
import { Character } from './stages/Character'
import { Storyboard } from './stages/Storyboard'
import { Video } from './stages/Video'
import { HistoryPanel } from './ui/History'
import { RemakeBar } from './ui/Follow'
import { CanvasBar } from './ui/chrome/TopBars'
import { BusyPointer } from './ui/loader/BusyPointer'
import { UndoKeys } from './ui/UndoButtons'
import { SaveKeys } from './ui/SaveButton'
import { PhoneReview } from './stages/PhoneReview'
import { PHONE, useMedia } from './ui/hooks'
import { PanelsContext } from './ui/chrome/panels'
import { CLAN_DB } from './model/store'
import { clanDbFor, INDEX_KEY } from './projects/storage'
import { UpdateBox } from './ui/UpdateBox'
import { FallbackNotices } from './ui/FallbackNotices'
import { SaveConflictBox } from './ui/SaveConflict'
import { errorShown, setScreen } from './dogfood/recorder'

// The Script editor is its own chunk: projects that never open it never load Tiptap.
const ScriptEditor = lazy(() => import('./script/ScriptEditor').then((m) => ({ default: m.ScriptEditor })))

export function App({ initialCanvas }: { initialCanvas: CanvasSnapshot | null }) {
  const { clan, storeNote, project } = useServices()
  const { config } = useConfig()
  const ui = useUi()
  const stage = ui.stage
  const route = useRoute()
  // The Script editor opens full screen over the stages (features/script-editor.clan); the canvas
  // stays mounted underneath, so its jobs keep landing. Storyboard and Video open the same way.
  const script = route.kind === 'script' && route.projectId === project.id ? route.scriptId : null
  const [panel, setPanel] = useState<'history' | 'assets' | null>(null)
  const panels = useMemo(() => ({
    history: panel === 'history',
    assets: panel === 'assets',
    toggle: (p: 'history' | 'assets') => setPanel((now) => (now === p ? null : p)),
  }), [panel])
  const phone = useMedia(PHONE)
  const [trouble, setTrouble] = useState<string | null>(null)
  useEffect(() => clan?.onTrouble((m) => setTrouble(m)), [clan])
  // The beta's record: where the person is, and what went wrong in front of them.
  useEffect(() => { setScreen({ stage, project: project.id }) }, [stage, project.id])
  useEffect(() => { if (trouble) errorShown('clan-write', trouble) }, [trouble])
  useEffect(() => { if (storeNote) errorShown('store', storeNote) }, [storeNote])

  // A phone gets Phone review whatever the route (ui-behaviour 2.5): watch and leave notes, no editing.
  if (phone) return <PanelsContext.Provider value={panels}><PhoneReview /></PanelsContext.Provider>

  return (
    <PanelsContext.Provider value={panels}>
      {stage === 'character' && <CanvasBar />}
      {config.banner && <div className="banner">{config.banner}</div>}
      {storeNote && <div className="storenote" role="status">{storeNote}</div>}
      {trouble && <div className="storenote" role="alert">That change could not be saved to the .clan and was undone. <button className="btn xs ghost" onClick={() => setTrouble(null)}>OK</button></div>}
      <SaveConflictBox />
      <div className="stage">
        {/* The canvas stays mounted so its jobs keep landing while an editor is open over it. */}
        <div className={`stage-pane ${stage === 'character' ? '' : 'hidden'}`} data-dogfood-area="canvas">
          <Character initial={initialCanvas} active={stage === 'character'} />
        </div>
        {stage === 'storyboard' && <div className="stage-pane editor-pane" data-dogfood-area="storyboard"><Storyboard /></div>}
        {stage === 'video' && <div className="stage-pane editor-pane" data-dogfood-area="video"><Video /></div>}
        {/* The Video editor shows it in its timeline head (stages/Video.tsx). */}
        {stage === 'storyboard' && <RemakeBar />}
        {panel === 'history' && <HistoryPanel store={clan} onClose={() => setPanel(null)} />}
      </div>
      {script && <Suspense fallback={<div className="se" role="status" aria-busy="true" />}><ScriptEditor key={script} scriptId={script} /></Suspense>}
      <UpdateBox />
      <FallbackNotices />
      <BusyPointer />
      <UndoKeys />
      <SaveKeys />
      {!import.meta.env.PROD && <DevSwitch />}
    </PanelsContext.Provider>
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
