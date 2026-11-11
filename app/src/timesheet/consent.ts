// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The person's answer to "Should Napkin OS draft your timesheet?", held once for the shell so the
// card, the page and the session beacon all read the same one. `null` until the server has said.
// Nothing is captured until it is `yes`; `not_asked` and `no` both capture nothing.

import { useSyncExternalStore } from 'react'
import { readConsent, writeConsent, type Consent } from './api'

let value: Consent | null = null
let started = false
const listeners = new Set<() => void>()
const set = (v: Consent | null) => { value = v; listeners.forEach(l => l()) }

/** Read the answer once per signed-in person. */
export function loadConsent(): void {
  if (started) return
  started = true
  readConsent().then(set).catch(() => { started = false })
}

export function forgetConsent(): void { started = false; set(null) }

export async function answer(yes: boolean): Promise<void> { set(await writeConsent(yes)) }

export function useConsent(): Consent | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => value,
    () => value,
  )
}
