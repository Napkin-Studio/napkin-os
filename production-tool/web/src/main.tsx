// First: tells Excalidraw to load its fonts from our copy (OFL replacements), before anything draws.
import './excalidrawAssets'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { idbPersister, SnapshotStore } from './doc/store'
import { initialAppUi, splitUi, type AppUi } from './doc/ui'
import { migrateSingleProject } from './projects/migrate'
import { ProjectIndex } from './projects/projectIndex'
import { ProjectServer } from './projects/server'
import { browserClan } from './projects/session'
import { Shell } from './projects/shell'
import { browserStorage } from './projects/storage'
import { createRelay } from './relay'
import { AccessStore, type Access } from './relay/access'
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

  // Who is signed in, asked on every load: the relay's identity seam knows (GET /me), so there is no
  // sign-in here. Behind Napkin OS, napkin-web's 401 means signed out (Root offers its Sign in, which
  // comes back here), the relay's 401 means it could not confirm who, and 403 flag_off means the
  // agency is not on (features/os-sign-in.clan, relay/access.ts). The same on any route later.
  // The mock always names its local person.
  const access = new AccessStore()
  const refused = (why: Access) => {
    access.set(why)
    app.update((u) => { u.me = undefined })
  }
  relay.onUnauthorised = refused
  // Unreachable: keep who this browser last knew, so the projects here still open.
  try {
    const me = await relay.me()
    app.update((u) => { u.me = me ?? undefined })
  } catch (e) {
    if (access.get() === 'ok') console.error('could not ask the relay who is signed in', e)
  }
  // Signed out (or not confirmed): nothing to configure, so not asked (a 401 is a state, not an error).
  const remoteConfig = relay.kind === 'http' && access.get() === 'ok' ? await relay.config() : null

  // The person's projects on the relay (features/personal-workspaces.clan): saved from here, listed
  // on Home and opened from any browser under the same name. Not on the in-browser mock relay.
  const relayUrl = import.meta.env.VITE_RELAY_URL as string | undefined
  const server = relay.kind === 'http' && relayUrl ? new ProjectServer({ base: relayUrl, signedIn: () => !!app.get().me, onUnauthorised: refused }) : undefined
  const shell = new Shell({ relay, app, index, storage, remoteConfig, makeClan: browserClan, server })
  if (app.get().me) await shell.start().catch((e) => console.error('could not open the last project', e))

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
      <Root shell={shell} access={access} />
    </StrictMode>,
  )
}

void boot()
