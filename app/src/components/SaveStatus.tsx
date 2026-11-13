// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useState } from 'react'
import { lastSaved, savedWords } from '../shell/docFreshness'
import type { SaveState } from './states/saveQueue'

/**
 * "saved 37m ago" under the document's name in the OS bar (the mock's
 * .tba-saved). Only shown where it is true by construction (the studio, the
 * desktop's files). The time is this document's own updated_at, as the
 * library listing has it (read every 5 s); the clock time goes in the tooltip.
 *
 * Not the host's clan-data-changed / clan-patch-saved events: they come on
 * one stream for the whole workspace (they name their document since
 * 2026-11-12), and before they did, a write anywhere read as this one saved
 * (UAT 2026-11-12). The listing is enough for "saved 37m ago".
 *
 * A write that did not land reads "Not saved" (the bridge tells the shell how each write went:
 * states/saveQueue.ts).
 */
export default function SaveStatus({ updatedAt, state = 'idle' }: { updatedAt?: string | null; state?: SaveState }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const at = lastSaved(null, updatedAt)
  const time = at?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const words = state === 'failed' || state === 'changed' ? 'Not saved' : null
  return (
    <span className="ch-saved" title={`Every change is kept as you make it.${time ? ` Last change kept at ${time}.` : ''}`}>
      {/* the clock ticks every 30 s; a time newer than its last tick reads as just now */}
      {words ?? savedWords(at, Math.max(now, at?.getTime() ?? 0))}
    </span>
  )
}
