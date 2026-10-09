import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { controlsFor, effectiveConfig, type Controls } from '../capabilities'
import type { Config, ProductionDocument } from '../contracts/types'
import { subscribeDoc, type DocumentStore } from '../doc/store'
import type { UiState } from '../doc/ui'
import type { UiStore } from '../projects/uiStore'
import type { JobRunner } from '../jobs/runner'
import type { Relay } from '../relay'
import type { ClanBackedStore } from '../doc/clan'
import { withOwnKeys, type OwnKeys, type OwnKeysStore } from '../keys/ownKeys'
import { SHEETS } from '../contracts/load'
import type { Shell } from '../projects/shell'
import type { ServerCopy } from '../projects/serverCopy'

/** The open project (features/project-home.clan). */
export interface ProjectHandle {
  id: string
  /** Where its canvas is kept in the kv store. */
  canvasKey: string
  /** Run before the project closes (the canvas saves what it has now). */
  beforeClose: Set<() => Promise<void> | void>
  /** A picture another project also uses: Clean up takes it out of this one but keeps its bytes. */
  usedElsewhere(sha: string): boolean
}

export interface Services {
  project: ProjectHandle
  relay: Relay
  doc: DocumentStore
  ui: UiStore
  runner: JobRunner
  /** The config the relay served (GET /config), when there is one. */
  remoteConfig: Config | null
  /** The CLAN store behind `doc` (decision chain, .clan export); null when the wasm did not load. */
  clan: ClanBackedStore | null
  /** Shown under the top bar when saving is degraded ("Saving without history"). */
  storeNote: string | null
  /** The participant's own provider keys (this tab only). */
  ownKeys: OwnKeysStore
  /** The project's copy on the relay, and a save conflict waiting for the person's choice; null on the mock. */
  serverCopy: ServerCopy | null
}

export const ServicesContext = createContext<Services | null>(null)

/** Home and the projects (projects/shell.ts): what the Napkin mark and New project call. */
export const ShellContext = createContext<Shell | null>(null)

export function useShell(): Shell {
  const s = useContext(ShellContext)
  if (!s) throw new Error('ShellContext missing')
  return s
}

/** The own-keys store outside a project (Home); inside one, the project's services carry it. */
export const OwnKeysContext = createContext<OwnKeysStore | null>(null)

export function useOwnKeysStore(): OwnKeysStore {
  const outside = useContext(OwnKeysContext)
  const services = useContext(ServicesContext)
  const store = outside ?? services?.ownKeys
  if (!store) throw new Error('no own-keys store')
  return store
}

export function useServices(): Services {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('ServicesContext missing')
  return s
}

export function useDoc(): ProductionDocument {
  const { doc } = useServices()
  const subscribe = useMemo(() => subscribeDoc(doc), [doc])
  return useSyncExternalStore(subscribe, () => doc.get())
}

export function useUi(): UiState {
  const { ui } = useServices()
  return useSyncExternalStore(ui.subscribe, ui.get)
}

/** Re-render on any job progress (queue position, state). */
export function useJobsTick(): number {
  const { runner } = useServices()
  return useSyncExternalStore(runner.subscribe, runner.getVersion)
}

/** MOCK labels show only while the in-browser mock relay is in use (no VITE_RELAY_URL). */
export function useShowMock(): boolean {
  return useServices().relay.kind === 'mock'
}

export function useOwnKeys(): OwnKeys {
  const ownKeys = useOwnKeysStore()
  return useSyncExternalStore(ownKeys.subscribe, ownKeys.get)
}

export function useConfig(): { config: Config; controls: Controls } {
  const { remoteConfig } = useServices()
  const ui = useUi()
  const keys = useOwnKeys()
  return useMemo(() => {
    const config = withOwnKeys(effectiveConfig(ui.configChoice, ui.providerChoice, undefined, remoteConfig), keys, SHEETS)
    return { config, controls: controlsFor(config) }
  }, [ui.configChoice, ui.providerChoice, remoteConfig, keys])
}
