// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The People page's calls to napkin-web (docs/contracts/os-layer.md §13).
// Every one is refused with 403 for anyone but an admin.

import type { AgencyRow, PersonRow } from './model'

export interface PeopleList { people: PersonRow[]; agencies: AgencyRow[] }

export interface NewAgencyBody { name: string; id?: string; base: string; accent: string; aliases?: string[] }

/** What the page asks the server; a test hands it a fake. */
export interface PeopleApi {
  list(): Promise<PeopleList>
  add(body: { name: string; agency: string; username?: string }): Promise<PersonRow>
  rename(id: string, name: string): Promise<PersonRow>
  remove(id: string): Promise<PersonRow>
  addAgency(body: NewAgencyBody): Promise<AgencyRow>
}

/** A refusal, with the server's words and its status (403: not an admin). */
export class PeopleError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new PeopleError(r.status, (data && typeof data.error === 'string' && data.error) || `The server answered ${r.status}.`)
  return data as T
}

export const httpPeopleApi: PeopleApi = {
  list: () => call('GET', '/admin/people'),
  add: body => call('POST', '/admin/people', body),
  rename: (id, name) => call('PATCH', `/admin/people/${encodeURIComponent(id)}`, { name }),
  remove: id => call('DELETE', `/admin/people/${encodeURIComponent(id)}`),
  addAgency: body => call('POST', '/admin/agencies', body),
}
