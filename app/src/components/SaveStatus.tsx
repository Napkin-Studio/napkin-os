// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useState } from 'react'
import { host } from '../host'

/**
 * "Saved", with the green dot, in the OS bar. Only shown where it is true by
 * construction (the studio, the desktop's files); the time of the last change
 * the host confirmed goes in the tooltip. The shell is not told of a write that
 * fails; the app is.
 */
export default function SaveStatus({ docPath }: { docPath: string }) {
  const [last, setLast] = useState<{ docPath: string; at: Date } | null>(null)
  useEffect(() => {
    const note = () => setLast({ docPath, at: new Date() })
    const subs = [host.on('clan-data-changed', note), host.on('clan-patch-saved', note)]
    subs.forEach(s => s.catch(() => {}))
    return () => { subs.forEach(s => s.then(f => f()).catch(() => {})) }
  }, [docPath])
  const at = last?.docPath === docPath ? last.at : null
  const time = at?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return (
    <span className="ch-saved" title={`Every change is kept as you make it.${time ? ` Last change kept at ${time}.` : ''}`}>
      <span className="ch-saved-w">Saved</span>
    </span>
  )
}
