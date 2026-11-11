// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useState } from 'react'
import { host } from '../host'
import { lastSaved, savedWords } from '../shell/docFreshness'
import type { SaveState } from './states/saveQueue'

/**
 * "saved 37m ago" under the document's name in the OS bar (the mock's
 * .tba-saved). Only shown where it is true by construction (the studio, the
 * desktop's files). The time is the document's updated_at, or the last change
 * the host confirmed in this tab when that is later; the clock time goes in
 * the tooltip. The bridge tells the shell how each write went (states/saveQueue.ts).
 */
export default function SaveStatus({ docPath, updatedAt, state = 'idle' }: { docPath: string; updatedAt?: string | null; state?: SaveState }) {
  const [last, setLast] = useState<{ docPath: string; at: Date } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const note = () => { setLast({ docPath, at: new Date() }); setNow(Date.now()) }
    const subs = [host.on('clan-data-changed', note), host.on('clan-patch-saved', note)]
    subs.forEach(s => s.catch(() => {}))
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => { subs.forEach(s => s.then(f => f()).catch(() => {})); window.clearInterval(id) }
  }, [docPath])
  const at = lastSaved(last?.docPath === docPath ? last.at : null, updatedAt)
  const time = at?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const words = state === 'failed' || state === 'changed' ? 'Not saved' : null
  return (
    <span className="ch-saved" title={`Every change is kept as you make it.${time ? ` Last change kept at ${time}.` : ''}`}>
      {/* the clock ticks every 30 s; a time newer than its last tick reads as just now */}
      {words ?? savedWords(at, Math.max(now, at?.getTime() ?? 0))}
    </span>
  )
}
