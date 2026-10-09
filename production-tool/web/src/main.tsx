import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { idbPersister, SnapshotStore } from './doc/store'
import { initialAppUi, splitUi, type AppUi } from './doc/ui'
import { OwnKeysStore } from './keys/ownKeys'
import { migrateSingleProject } from './projects/migrate'
import { ProjectIndex } from './projects/projectIndex'
import { ProjectServer } from './projects/server'
import { browserClan } from './projects/session'
import { Shell } from './projects/shell'
import { browserStorage } from './projects/storage'
import { createRelay, relayId } from './relay'
import { Root } from './Root'

async function boot() {
  const relay = createRelay()
  const storage = browserStorage

  // The projects this browser holds (features/project-home.clan). The first load with projects
  // makes the one project of before the first in the list; nothing of it is lost.
  const index = new ProjectIndex(storage)
  if (!(await index.load())) {
    try {
      await migrateSingleProject(storage, index, browserClan)
    } catch (e) {
      // Left where it was (only a finished copy clears the old place): the next load tries again.
      console.error('could not carry the project over into the list', e)
    }
  }

  // The app's part of the UI: who is signed in, the dev switch, which view. Each project keeps its own part.
  const app = new SnapshotStore<AppUi>(initialAppUi(), idbPersister<AppUi>('ui'))
  const hadUi = await app.restore((v) => ({ ...initialAppUi(), ...splitUi(v).app }))
  if (!hadUi && relay.kind === 'http') app.update((u) => { u.configChoice = 'remote'; u.providerChoice = 'config' })

  const here = relayId()
  const saved = app.get().session
  if (saved && (app.get().sessionFor !== here || Date.parse(saved.expiresAt) <= Date.now())) {
    app.update((u) => { u.session = undefined; u.sessionFor = undefined })
  }
  relay.onUnauthorised = () => {
    relay.useToken(null)
    app.update((u) => { u.session = undefined; u.sessionFor = undefined })
  }
  if (app.get().session) relay.useToken(app.get().session!.token)
  if (relay.kind === 'mock' && !app.get().session) {
    const session = await relay.session({ eventCode: 'MOCK', handle: 'guest' })
    app.update((u) => { u.session = session; u.sessionFor = here })
  }
  const remoteConfig = relay.kind === 'http' ? await relay.config() : null
  const ownKeys = new OwnKeysStore()
  relay.ownKeys = () => ownKeys.header()

  // The person's projects on the relay (features/personal-workspaces.clan): saved from here, listed
  // on Home and opened from any browser under the same name. Not on the in-browser mock relay.
  const relayUrl = import.meta.env.VITE_RELAY_URL as string | undefined
  const server = relay.kind === 'http' && relayUrl ? new ProjectServer({ base: relayUrl, token: () => app.get().session?.token ?? null }) : undefined
  const shell = new Shell({ relay, app, index, storage, remoteConfig, ownKeys, makeClan: browserClan, server })
  if (app.get().session) await shell.start().catch((e) => console.error('could not open the last project', e))

  window.addEventListener('pagehide', () => {
    const s = shell.get().session?.services
    if (s) {
      for (const fn of s.project.beforeClose) void fn()
      void (s.doc as { flush?: () => Promise<void> }).flush?.()
      void s.ui.flush()
    }
    void app.flush()
  })

  // For poking at in the dev server's console (and the e2e checks); not in a build.
  if (import.meta.env.DEV) {
    (window as unknown as { __shell: Shell }).__shell = shell
    Object.defineProperty(window, '__pt', { get: () => shell.get().session?.services, configurable: true })
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root shell={shell} />
    </StrictMode>,
  )
}

void boot()
