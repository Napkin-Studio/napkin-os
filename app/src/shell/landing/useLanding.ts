// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing's data in React: read once, again when the window is focused or
// becomes visible, and on a slow poll while the landing is on screen. Never per
// circle. If the very first read fails the host predates the library route and
// the shell keeps the Launcher as home; a later failure keeps what is shown.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addClient, adoptNames, loadArchived, loadLegacy, loadLanding, renameClient, setArchived, type LandingData, type LandingHost, type ManageHost } from './store'
import { makeSettler, type SettleHost } from './settle'
import type { ClientMaterial, ClientRecord, LegacyName } from '../../host'

export type LandingState = 'loading' | 'ready' | 'unavailable'

/** How often the landing re-reads while it is the screen. */
export const POLL_MS = 5000

/** Looking after the registry from the screen; each write re-reads the landing and answers with the host's words on a refusal. */
export interface Manage {
  rename: (id: string, name: string) => Promise<string | null>
  archive: (id: string) => Promise<string | null>
  restore: (id: string) => Promise<string | null>
  archived: () => Promise<ClientRecord[]>
  legacy: () => Promise<LegacyName[]>
  adopt: (names: string[]) => Promise<{ words: string } | { error: string }>
}

export function useLanding(host: LandingHost & ManageHost & SettleHost, active: boolean, enabled = true) {
  const [state, setState] = useState<LandingState>('loading')
  const [data, setData] = useState<LandingData | null>(null)
  const seq = useRef(0)
  const apps = useRef<string[] | undefined>(undefined)
  // Jobs that finished after their page closed land on the next read (settle.ts).
  const settler = useMemo(() => makeSettler(host), [host])

  const reload = useCallback(async () => {
    const n = ++seq.current
    try {
      const d = await loadLanding(host, apps.current)
      if (n !== seq.current) return
      apps.current = d.apps
      setData(d)
      setState('ready')
      void settler.settle(d.items)
    } catch {
      if (n !== seq.current) return
      // Only the first read decides the home; a blip later keeps what is on screen.
      setState(s => (s === 'loading' ? 'unavailable' : s))
    }
  }, [host, settler])

  // The initial read, and the slow poll while the landing is the screen.
  useEffect(() => {
    // The device's own home asks nothing of the studio (and must not load the
    // WebAssembly host just to find out).
    if (!enabled) return
    // The load from the host: state is set when it answers.
    void reload()
    if (!active) return
    const id = window.setInterval(() => { if (!document.hidden) void reload() }, POLL_MS)
    const wake = () => { if (!document.hidden) void reload() }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [reload, active, enabled])

  const add = useCallback(async (name: string, material?: ClientMaterial) => {
    const refused = await addClient(host, name, material)
    if (!refused) await reload()
    return refused
  }, [host, reload])

  const manage = useMemo<Manage>(() => ({
    rename: async (id, name) => {
      const refused = await renameClient(host, id, name)
      if (!refused) await reload()
      return refused
    },
    archive: async id => {
      const refused = await setArchived(host, id, true)
      if (!refused) await reload()
      return refused
    },
    restore: async id => {
      const refused = await setArchived(host, id, false)
      if (!refused) await reload()
      return refused
    },
    archived: () => loadArchived(host),
    legacy: () => loadLegacy(host),
    adopt: async names => {
      const r = await adoptNames(host, names)
      if ('error' in r) return r
      await reload()
      return { words: r.words }
    },
  }), [host, reload])

  return { state, data, reload, add, manage }
}
