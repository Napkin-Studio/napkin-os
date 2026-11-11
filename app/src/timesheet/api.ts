// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The timesheet's calls to napkin-web (features/timesheet-sessions.clan). Every one is the signed-in
// person's own: none takes another person's name.

import { apiBase } from '../host/http'
import type { WorkEvent } from './beacon'

export type Consent = 'not_asked' | 'yes' | 'no'

export interface Line {
  key: string
  job: string | null
  label: string
  minutes: number
  /** `sessions`, `hand` or `guess`. */
  source: 'sessions' | 'hand' | 'guess'
  session_ids: string[]
  edits: number
}
export interface Gap {
  from: number
  to: number
  minutes: number
  guess: { job: string; label: string } | null
  session_ids: string[]
}
export interface Day {
  date: string
  consent: Consent
  status: 'draft' | 'confirmed'
  lines: Line[]
  gaps: Gap[]
  total_minutes: number
  confirmed_at: number | null
  editable_until: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${await apiBase()}/timesheet/${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  const body = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(body.error ?? `${r.status}`)
  return body
}
const send = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) })

export const readConsent = async (): Promise<Consent> => (await call<{ consent: Consent }>('consent')).consent
export const writeConsent = async (yes: boolean): Promise<Consent> =>
  (await call<{ consent: Consent }>('consent', send('POST', { consent: yes }))).consent

/** A beacon event. Fire and forget: a lost one costs at most a heartbeat. */
export function sendWorkEvent(event: WorkEvent, doc: string): void {
  void apiBase()
    .then(b => fetch(`${b}/timesheet/events`, {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, doc }),
    }))
    .catch(() => {})
}

/** Minutes east of UTC, so the server cuts the day where the person's own day is. */
const tz = () => -new Date().getTimezoneOffset()

export const readDay = (date: string) => call<Day>(`day?date=${date}&tz=${tz()}`)
export const confirmDay = (date: string) => call<Day>('day/confirm', send('POST', { date, tz: tz() }))
export const reopenDay = (date: string) => call<{ ok: true }>('day/reopen', send('POST', { date }))
export const addLine = (b: { date: string; job: string | null; label: string; minutes: number; source?: 'hand' | 'guess'; from?: number; session_ids?: string[] }) =>
  call<{ key: string }>('lines', send('POST', b))
export const changeLine = (date: string, key: string, minutes: number) =>
  call<{ ok: true }>('lines/change', send('PUT', { date, key, minutes }))
export const eraseMine = () => call<{ ok: true }>('mine', { method: 'DELETE' })

/** The jobs a line may name, with their clients' names (`GET /jobs`). */
export async function jobChoices(): Promise<{ number: string; client: string }[]> {
  try {
    const r = await fetch(`${await apiBase()}/jobs`, { credentials: 'same-origin' })
    if (!r.ok) return []
    return ((await r.json()) as { number: string; client: { name: string } }[]).map(j => ({ number: j.number, client: j.client.name }))
  } catch { return [] }
}
