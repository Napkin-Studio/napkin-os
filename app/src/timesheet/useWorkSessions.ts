// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Keeps the beacon (beacon.ts) running while a job's document is open: only when the signed-in
// person has said yes. With no yes it does not even start, so nothing is sent; the server asks
// again and keeps nothing without it. `doc` is the open document's id, or null away from one.

import { useEffect } from 'react'
import { sendWorkEvent } from './api'
import { Beacon, capturing } from './beacon'
import { forgetConsent, loadConsent, useConsent } from './consent'

export function useWorkSessions(signedIn: boolean, doc: string | null): void {
  const consent = useConsent()
  useEffect(() => { if (signedIn) loadConsent(); else forgetConsent() }, [signedIn])
  useEffect(() => {
    if (!capturing(signedIn, consent, doc) || !doc) return
    const beacon = new Beacon(sendWorkEvent, Date.now)
    const here = () => document.visibilityState === 'visible' && document.hasFocus()
    beacon.open(doc)
    beacon.setFocused(here())
    const timer = setInterval(() => beacon.tick(), 2000)
    const sync = () => beacon.setFocused(here())
    const leave = () => beacon.close()
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pagehide', leave)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pagehide', leave)
      beacon.close()
    }
  }, [signedIn, consent, doc])
}
