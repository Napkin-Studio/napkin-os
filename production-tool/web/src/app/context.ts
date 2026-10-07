import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { controlsFor, effectiveConfig, type Controls } from '../capabilities'
import type { Config, ProductionDocument } from '../contracts/types'
import { subscribeDoc, type DocumentStore, type SnapshotStore } from '../doc/store'
import type { UiState } from '../doc/ui'
import type { JobRunner } from '../jobs/runner'
import type { Relay } from '../relay'
import type { ClanBackedStore } from '../doc/clan'
import { withOwnKeys, type OwnKeys, type OwnKeysStore } from '../keys/ownKeys'
import { SHEETS } from '../contracts/load'

export interface Services {
  relay: Relay
  doc: DocumentStore
  ui: SnapshotStore<UiState>
  runner: JobRunner
  /** The config the relay served (GET /config), when there is one. */
  remoteConfig: Config | null
  /** The CLAN store behind `doc` (decision chain, .clan export); null when the wasm did not load. */
  clan: ClanBackedStore | null
  /** Shown under the top bar when saving is degraded ("Saving without history"). */
  storeNote: string | null
  /** The participant's own provider keys (this tab only). */
  ownKeys: OwnKeysStore
}

export const ServicesContext = createContext<Services | null>(null)

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
  const { ownKeys } = useServices()
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
