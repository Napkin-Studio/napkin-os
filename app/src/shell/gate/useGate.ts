// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brief gate of the open brief, read from the host when it is asked for, and again
// whenever the document changes (features/brief-gate.clan).

import { useCallback, useEffect, useState } from 'react'
import { host } from '../../host'
import type { GateView } from '../../host'

export interface Gate {
  view: GateView | null
  error: string | null
  /** Who is signed in, as a brief names its signers (`name@agency`). */
  me: string | null
  reload: () => void
}

/** `on`: read it now and keep it current; off, nothing is asked. */
export function useGate(docPath: string, on: boolean): Gate {
  const [got, setGot] = useState<{ docPath: string; view: GateView | null; error: string | null }>({ docPath, view: null, error: null })
  const [me, setMe] = useState<string | null>(null)

  const reload = useCallback(() => {
    host.getGate().then(
      v => setGot({ docPath, view: v, error: null }),
      e => setGot(g => ({ docPath, view: g.docPath === docPath ? g.view : null, error: String(e instanceof Error ? e.message : e) })),
    )
  }, [docPath])

  useEffect(() => {
    if (!on) return
    reload()
    host.whoAmI().then(p => setMe(p.id), () => setMe(null))
  }, [on, reload])

  useEffect(() => {
    if (!on) return
    const offs = [host.on('clan-data-changed', reload), host.on('clan-patch-saved', reload)]
    return () => { for (const off of offs) off.then(f => f()).catch(() => {}) }
  }, [on, reload])

  const mine = got.docPath === docPath
  return { view: mine ? got.view : null, error: mine ? got.error : null, me, reload }
}
