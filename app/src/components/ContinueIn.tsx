// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useCallback, useEffect, useState } from 'react'

import { host } from '../host'
import type { SpinoffTarget, UpstreamView } from '../host'
import { madeFromOf } from './barMenus'

/**
 * "Continue in…": the apps that have declared they will take the open document
 * as a spin-off source, carrying its data and its decisions across. The bar
 * lists them in its More menu.
 *
 * Targets depend on the document's app, so they are held against the path they
 * were asked for: a different document shows none until its own answer comes.
 * An empty list is a normal state (nothing downstream is installed), not a
 * failure worth a disabled item in the chrome.
 */
export function useSpinoffTargets(docPath: string): SpinoffTarget[] {
  const [got, setGot] = useState<{ docPath: string; targets: SpinoffTarget[] } | null>(null)

  useEffect(() => {
    let live = true
    host.spinoffTargets()
      .then(targets => { if (live) setGot({ docPath, targets }) })
      // A host that cannot answer simply offers nothing; this is chrome, not
      // the document, and must never take the app down with it.
      .catch(() => { if (live) setGot({ docPath, targets: [] }) })
    return () => { live = false }
  }, [docPath])

  return got?.docPath === docPath ? got.targets : []
}

/**
 * What the open document was made from (`GET /upstream`), and the way to take
 * its newer version (`POST /upstream/update`, Contract 4 §5.5 as reversed for
 * spin-offs on 2026-11-09). `onTaken` runs after the update is written, so the
 * app's fields and the decisions read it again.
 */
export function useMadeFrom(docPath: string, onTaken: () => void, onError: (message: string) => void) {
  const [got, setGot] = useState<{ docPath: string; view: UpstreamView | null; tick: number } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    host.upstream()
      .then(view => { if (live) setGot({ docPath, view, tick }) })
      // The desktop has no /upstream yet, and a host that cannot answer
      // offers nothing: chrome, never the document.
      .catch(() => { if (live) setGot({ docPath, view: null, tick }) })
    return () => { live = false }
  }, [docPath, tick])

  const madeFrom = got?.docPath === docPath ? madeFromOf(got.view) : null
  const update = useCallback(() => {
    host.updateFromUpstream()
      .then(() => { setTick(t => t + 1); onTaken() })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
  }, [onTaken, onError])

  return { madeFrom, update }
}
