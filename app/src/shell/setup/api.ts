// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agency setup's calls to napkin-web (features/agency-setup.clan). Every one is the signed-in
// person's own agency: none takes another agency's name. A call answers a result, never throws, so a
// screen can say what happened in its own words (a 403 is Missing access, a 0 is a failed save).

import { apiBase } from '../../host/http'
import type { StepId } from './model'

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<Result<T>> {
  try {
    const { json, ...rest } = init ?? {}
    const r = await fetch(`${await apiBase()}/${path}`, {
      credentials: 'same-origin',
      ...rest,
      headers: json !== undefined ? { 'content-type': 'application/json' } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
    const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null
    if (!r.ok) return { ok: false, status: r.status, message: body?.error ?? '' }
    return { ok: true, data: body as T }
  } catch {
    return { ok: false, status: 0, message: '' }
  }
}

export interface SetupStatus {
  steps: { id: StepId; done: boolean }[]
  next: StepId | null
  complete: boolean
  /** People on the list besides the admin. */
  people: number
  has_directory: boolean
}
export const readSetup = () => call<SetupStatus>('setup')

export interface Settings { name: string; credit_cap_month_eur?: number; time_zone?: string }
export const readSettings = () => call<Settings>('agency')
export const saveSettings = (patch: { name?: string; credit_cap_month_eur?: number; time_zone?: string }) =>
  call<Settings>('agency', { method: 'PUT', json: patch })

export type ImportKind = 'people' | 'clients' | 'jobs'
export interface RowResult { line: number; status: 'new' | 'changed' | 'same' | 'error'; label: string; reason?: string }
export interface ImportReport {
  kind: ImportKind
  dry_run: boolean
  rows: number
  ok: number
  errors: { line: number; reason: string }[]
  created: number
  updated: number
  unchanged: number
  committed: boolean
  results: RowResult[]
  starts_directory: boolean
  made_before_failure: number[]
}
/** Check a file (`dry`) or import it: the rows that are fine are written, the rest listed by line. */
export const importFile = (kind: ImportKind, file: Blob, dry: boolean) =>
  call<ImportReport>(`setup/import/${kind}${dry ? '?dry_run=1' : ''}`, { method: 'POST', body: file, headers: { 'content-type': 'text/csv' } })

export type PersonState = 'invited' | 'active' | 'removed'
/** What an admin sees of a person; a member sees only `username`, `name` and `roles`. */
export interface Person { username: string; name: string; roles: string[]; email?: string; state?: PersonState; invited_by?: string; at?: string }
export const listPeople = () => call<Person[]>('agency/people')
export const invitePerson = (p: { email: string; name: string; roles: string[]; username?: string }) =>
  call<Person>('agency/people/invite', { method: 'POST', json: p })
export const editPerson = (username: string, patch: { name?: string; email?: string; roles?: string[] }) =>
  call<Person>(`agency/people/${encodeURIComponent(username)}`, { method: 'PUT', json: patch })
export const removePerson = (username: string) =>
  call<Person>(`agency/people/${encodeURIComponent(username)}`, { method: 'DELETE' })
