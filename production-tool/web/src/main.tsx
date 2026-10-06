import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { ServicesContext, type Services } from './app/context'
import type { CanvasSnapshot } from './canvas/controller'
import { CANVAS_KEY } from './canvas/controller'
import { emptyDocument, idbPersister, SnapshotDocumentStore, SnapshotStore, updateDoc } from './doc/store'
import { initialUi, type UiState } from './doc/ui'
import type { ProductionDocument } from './contracts/types'
import { applyFrame, applyShotList, applyStitch, applyTake } from './jobs/handlers'
import { JobRunner } from './jobs/runner'
import { idbGet } from './lib/idb'
import { createRelay } from './relay'

async function boot() {
  const relay = createRelay()
  const ui = new SnapshotStore<UiState>(initialUi(), idbPersister<UiState>('ui'))
  const hadUi = await ui.restore((v) => ({ ...initialUi(), ...v }))
  if (!hadUi && relay.kind === 'http') ui.update((u) => { u.configChoice = 'remote'; u.providerChoice = 'config' })

  const doc = new SnapshotDocumentStore(emptyDocument(), idbPersister<ProductionDocument>('doc'))
  if (!(await doc.load())) await doc.create({ participant: { id: 'p_local', handle: 'guest' } })

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

  const canvas = (await idbGet<CanvasSnapshot>('kv', CANVAS_KEY)) ?? null
  window.addEventListener('pagehide', () => {
    void doc.flush()
    void ui.flush()
  })

  const services: Services = { relay, doc, ui, runner, remoteConfig }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ServicesContext.Provider value={services}>
        <App initialCanvas={canvas} />
      </ServicesContext.Provider>
    </StrictMode>,
  )
}

void boot()
