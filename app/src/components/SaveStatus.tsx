// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useState } from 'react'
import { host } from '../host'

/**
 * "saved 2m ago" under the document's name in the OS bar (the mock's
 * .tba-saved). Only shown where it is true by construction (the studio, the
 * desktop's files); the time of the last change the host confirmed goes in the
 * tooltip. The shell is not told of a write that fails; the app is.
 */
export default function SaveStatus({ docPath }: { docPath: string }) {
  const [last, setLast] = useState<{ docPath: string; at: Date } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const note = () => { setLast({ docPath, at: new Date() }); setNow(Date.now()) }
    const subs = [host.on('clan-data-changed', note), host.on('clan-patch-saved', note)]
    subs.forEach(s => s.catch(() => {}))
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => { subs.forEach(s => s.then(f => f()).catch(() => {})); window.clearInterval(id) }
  }, [docPath])
  const at = last?.docPath === docPath ? last.at : null
  const time = at?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const mins = at ? Math.round((now - at.getTime()) / 60_000) : null
  return (
    <span className="ch-saved" title={`Every change is kept as you make it.${time ? ` Last change kept at ${time}.` : ''}`}>
      {mins == null ? 'saved' : mins < 1 ? 'saved just now' : `saved ${mins}m ago`}
    </span>
  )
}
