import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { ServicesContext, type Services } from './app/context'
import type { CanvasSnapshot } from './canvas/controller'
import { CANVAS_KEY } from './canvas/controller'
import { idbPersister, SnapshotStore, updateDoc } from './doc/store'
import { initialUi, type UiState } from './doc/ui'
import { openDocument } from './doc/open'
import { postClanMirror } from './doc/clan'
import { applyFrame, applyShotList, applyStitch, applyTake } from './jobs/handlers'
import { JobRunner } from './jobs/runner'
import { idbGet } from './lib/idb'
import { createRelay } from './relay'

async function boot() {
  const relay = createRelay()
  const ui = new SnapshotStore<UiState>(initialUi(), idbPersister<UiState>('ui'))
  const hadUi = await ui.restore((v) => ({ ...initialUi(), ...v }))
  if (!hadUi && relay.kind === 'http') ui.update((u) => { u.configChoice = 'remote'; u.providerChoice = 'config' })

  const session = ui.get().session
  const participant = session ? { id: session.participantId, handle: session.handle } : { id: 'p_local', handle: 'guest' }
  const { doc, clan, storeNote } = await openDocument(participant, (jobId) => ui.get().jobCtx[jobId])

  if (ui.get().session) relay.useToken(ui.get().session!.token)
  if (relay.kind === 'mock' && !ui.get().session) {
    const session = await relay.session({ eventCode: 'MOCK', handle: 'guest' })
    ui.update((u) => { u.session = session })
  }
  const remoteConfig = relay.kind === 'http' ? await relay.config() : null
  const runner = new JobRunner(relay, doc, ui)
  runner.stage = () => doc.get().stage.current
  runner.onComplete('shot_list', (job, ctx) => void updateDoc(doc, (d) => ctx.for === 'shot_list' && applyShotList(d, job, ctx), 'shot list'))
  runner.onComplete('frame', (job, ctx) => void updateDoc(doc, (d) => ctx.for === 'frame' && applyFrame(d, job, ctx), 'frame'))
  runner.onComplete('clip', (job, ctx) => void updateDoc(doc, (d) => ctx.for === 'clip' && applyTake(d, job, ctx), 'take'))
  runner.onComplete('stitch', (job) => void updateDoc(doc, (d) => applyStitch(d, job), 'ad'))
  runner.resume()

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

  const services: Services = { relay, doc, ui, runner, remoteConfig, clan, storeNote }
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
