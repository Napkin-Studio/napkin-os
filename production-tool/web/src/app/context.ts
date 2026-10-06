import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { controlsFor, effectiveConfig, type Controls } from '../capabilities'
import type { Config, ProductionDocument } from '../contracts/types'
import { subscribeDoc, type DocumentStore, type SnapshotStore } from '../doc/store'
import type { UiState } from '../doc/ui'
import type { JobRunner } from '../jobs/runner'
import type { Relay } from '../relay'

export interface Services {
  relay: Relay
  doc: DocumentStore
  ui: SnapshotStore<UiState>
  runner: JobRunner
  /** The config the relay served (GET /config), when there is one. */
  remoteConfig: Config | null
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

export function useConfig(): { config: Config; controls: Controls } {
  const { remoteConfig } = useServices()
  const ui = useUi()
  return useMemo(() => {
    const config = effectiveConfig(ui.configChoice, ui.providerChoice, undefined, remoteConfig)
    return { config, controls: controlsFor(config) }
  }, [ui.configChoice, ui.providerChoice, remoteConfig])
}
