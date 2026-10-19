// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What is attached to the open document, read from `GET /upstream`: once when
// the document opens, again after every write the host fans out (an attach,
// an update, a detach, the Brand Clan moving on), and when asked.

import { useCallback, useEffect, useState } from 'react'
import { host } from '../../host'
import type { AttachedEntry } from '../../host'

export interface Attached {
  entries: AttachedEntry[] | undefined
  reload: () => void
}

export function useAttached(docPath: string, enabled: boolean): Attached {
  // Kept against the document it was read for, so another document never shows the old one's.
  const [got, setGot] = useState<{ docPath: string; entries: AttachedEntry[] } | null>(null)

  const reload = useCallback(() => {
    if (!enabled) return
    host.upstream().then(
      v => setGot({ docPath, entries: v.attached ?? [] }),
      // A host that cannot say leaves the chip as it was; this is chrome.
      () => {},
    )
  }, [docPath, enabled])

  useEffect(() => { reload() }, [reload])
  useEffect(() => {
    if (!enabled) return
    const offs = [host.on('clan-data-changed', reload), host.on('clan-patch-saved', reload)]
    return () => { for (const off of offs) off.then(f => f()).catch(() => {}) }
  }, [reload, enabled])

  return { entries: got?.docPath === docPath ? got.entries : undefined, reload }
}
