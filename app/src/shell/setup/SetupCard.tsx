// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// On an admin's home: how far the agency's setup has got, and the one button to carry on. It reads the
// same status the flow does (logo, name, people, clients, jobs) and draws nothing once all five are done,
// so there is nothing to dismiss and nothing stored.

import { useEffect, useState } from 'react'
import { readSetup, type SetupStatus } from './api'
import { nextLine } from './model'
import './setup.css'

export function SetupCardBody({ status, onOpen }: { status: Pick<SetupStatus, 'steps' | 'next'> | null; onOpen: () => void }) {
  const line = nextLine(status)
  if (!line || !status) return null
  const done = status.steps.filter(s => s.done).length
  return (
    <section className="su-homecard" aria-labelledby="su-home-h" data-testid="setup-card" data-next={status.next ?? undefined}>
      <div>
        <h2 className="hm-h" id="su-home-h">Setting up</h2>
        <p className="su-homeline" data-testid="setup-card-line">{line.head}</p>
        <p className="su-sub">{done} of {status.steps.length} steps done.</p>
      </div>
      <button type="button" className="ch-btn ch-btn-primary su-btn" data-testid="setup-open" onClick={onOpen}>{line.verb}</button>
    </section>
  )
}

export function SetupCard({ onOpen }: { onOpen: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  useEffect(() => {
    let live = true
    void readSetup().then(r => { if (live && r.ok) setStatus(r.data) })
    return () => { live = false }
  }, [])
  return <SetupCardBody status={status} onOpen={onOpen} />
}
