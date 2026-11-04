// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The landing's data in React: read once, again when the window is focused or
// becomes visible, and on a slow poll while the landing is on screen. Never per
// circle. If the very first read fails the host predates the library route and
// the shell keeps the Launcher as home; a later failure keeps what is shown.

import { useCallback, useEffect, useRef, useState } from 'react'
import { addClient, loadLanding, type LandingData, type LandingHost } from './store'
import type { ClientMaterial } from '../../host'

export type LandingState = 'loading' | 'ready' | 'unavailable'

/** How often the landing re-reads while it is the screen. */
export const POLL_MS = 5000

export function useLanding(host: LandingHost, active: boolean, enabled = true) {
  const [state, setState] = useState<LandingState>('loading')
  const [data, setData] = useState<LandingData | null>(null)
  const seq = useRef(0)
  const apps = useRef<string[] | undefined>(undefined)

  const reload = useCallback(async () => {
    const n = ++seq.current
    try {
      const d = await loadLanding(host, apps.current)
      if (n !== seq.current) return
      apps.current = d.apps
      setData(d)
      setState('ready')
    } catch {
      if (n !== seq.current) return
      // Only the first read decides the home; a blip later keeps what is on screen.
      setState(s => (s === 'loading' ? 'unavailable' : s))
    }
  }, [host])

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

  return { state, data, reload, add }
}
