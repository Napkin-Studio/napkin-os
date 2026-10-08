import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { ServicesContext, type Services } from './app/context'
import type { CanvasSnapshot } from './canvas/controller'
import { CANVAS_KEY } from './canvas/controller'
import { idbPersister, SnapshotStore } from './doc/store'
import { initialUi, type UiState } from './doc/ui'
import { openDocument } from './doc/open'
import { keepUndo } from './doc/undo'
import { postClanMirror } from './doc/clan'
import { JobRunner } from './jobs/runner'
import { resumeChains, wireJobs } from './jobs/wire'
import { OwnKeysStore } from './keys/ownKeys'
import { idbGet } from './lib/idb'
import { createRelay, relayId } from './relay'

async function boot() {
  const relay = createRelay()
  const ui = new SnapshotStore<UiState>(initialUi(), idbPersister<UiState>('ui'))
  const hadUi = await ui.restore((v) => ({ ...initialUi(), ...v }))
  if (!hadUi && relay.kind === 'http') ui.update((u) => { u.configChoice = 'remote'; u.providerChoice = 'config' })

  const session = ui.get().session
  const participant = session ? { id: session.participantId, handle: session.handle } : { id: 'p_local', handle: 'guest' }
  const { doc, clan, storeNote } = await openDocument(participant, (jobId) => ui.get().jobCtx[jobId])
  // Undo and redo steps live with the UI snapshot (doc/undo.ts), so they survive a reload.
  keepUndo(doc, { get: () => ui.get().undo ?? { done: [], undone: [] }, set: (s) => ui.update((u) => { u.undo = s }) })

  const here = relayId()
  const saved = ui.get().session
  if (saved && (ui.get().sessionFor !== here || Date.parse(saved.expiresAt) <= Date.now())) {
    ui.update((u) => { u.session = undefined; u.sessionFor = undefined })
  }
  relay.onUnauthorised = () => {
    relay.useToken(null)
    ui.update((u) => { u.session = undefined; u.sessionFor = undefined })
  }
  if (ui.get().session) relay.useToken(ui.get().session!.token)
  if (relay.kind === 'mock' && !ui.get().session) {
    const session = await relay.session({ eventCode: 'MOCK', handle: 'guest' })
    ui.update((u) => { u.session = session; u.sessionFor = here })
  }
  const remoteConfig = relay.kind === 'http' ? await relay.config() : null
  const ownKeys = new OwnKeysStore()
  relay.ownKeys = () => ownKeys.header()
  const runner = new JobRunner(relay, doc, ui)
  runner.stage = () => doc.get().stage.current
  // Landed jobs, and the chains they move on: Draw the rest, Fix it in the shot, Update what follows.
  const frameDeps = { relay, doc, ui, runner }
  wireJobs(frameDeps)
  runner.resume()
  void resumeChains(frameDeps)

  // The organisers' copy of the .clan: every 5 minutes when something changed,
  // on each lock, and on export (POST /clan). Not on the in-browser mock relay.
  const relayUrl = import.meta.env.VITE_RELAY_URL as string | undefined
  if (clan && relay.kind === 'http' && relayUrl) {
    clan.clan.startMirror(postClanMirror({ relay: relayUrl, token: () => ui.get().session?.token ?? null }), { everyMs: 300_000 })
  }

  const canvas = (await idbGet<CanvasSnapshot>('kv', CANVAS_KEY)) ?? null
  window.addEventListener('pagehide', () => {
    void doc.flush()
    void ui.flush()
  })

  const services: Services = { relay, doc, ui, runner, remoteConfig, clan, storeNote, ownKeys }
  // For poking at in the dev server's console (and the e2e checks); not in a build.
  if (import.meta.env.DEV) (window as unknown as { __pt: Services }).__pt = services
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ServicesContext.Provider value={services}>
        <App initialCanvas={canvas} />
      </ServicesContext.Provider>
    </StrictMode>,
  )
}

void boot()
