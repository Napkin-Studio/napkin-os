// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The People page's calls to napkin-web (docs/contracts/os-layer.md §13;
// the agency routes are features/agency-looks-admin.clan design.contracts).
// Every one is refused with 403 for anyone but an admin.

import type { AgencyAdminRow, CodeExport, NewBasicAgency, DraftPatch, Removed, WordmarkTaken } from './agencies/model'
import type { PersonRow } from './model'

export interface PeopleList { people: PersonRow[]; agencies: AgencyAdminRow[] }

/** What the page asks the server; a test hands it a fake. */
export interface PeopleApi {
  list(): Promise<PeopleList>
  add(body: { name: string; agency: string; username?: string }): Promise<PersonRow>
  rename(id: string, name: string): Promise<PersonRow>
  remove(id: string): Promise<PersonRow>
  /** Every agency, in code and basic, with its draft (GET /api/admin/agencies). */
  agencies(): Promise<AgencyAdminRow[]>
  /** A basic agency, made as a draft; its id is made from the name and fixed (POST /api/admin/agencies). */
  createAgency(body: NewBasicAgency): Promise<AgencyAdminRow>
  /** Change the draft: a basic agency's name, spellings or colours; an agency in code's name only (PATCH .../draft). */
  patchDraft(id: string, body: DraftPatch): Promise<AgencyAdminRow>
  /** The draft's one SVG wordmark, sanitised by the server (PUT .../draft/wordmark, image/svg+xml). */
  putWordmark(id: string, svg: string): Promise<WordmarkTaken>
  /** Take the wordmark out of the draft (DELETE .../draft/wordmark). */
  deleteWordmark(id: string): Promise<AgencyAdminRow>
  /** The draft goes live (POST .../publish {rev}). */
  publish(id: string, rev: number): Promise<AgencyAdminRow>
  /** Drop the draft (DELETE .../draft); a never-published agency is deleted. */
  discardDraft(id: string): Promise<AgencyAdminRow | Removed>
  /** A published basic agency as code, for a PR (GET .../export). */
  exportCode(id: string): Promise<CodeExport>
}

/** One thing in a refused file that could run or reach out, and its line (422 from the wordmark upload). */
export interface FoundLine { what: string; line: number }

/** A refusal ({ok: false, error, found?}), with the server's words and its status (403: not an admin; 409 stale or taken; 413, 415, 422 a refused upload). */
export class PeopleError extends Error {
  status: number
  /** What a refused upload carries, and where (422). */
  found: FoundLine[]
  constructor(status: number, message: string, found: FoundLine[] = []) {
    super(message)
    this.status = status
    this.found = found
  }
}

async function call<T>(method: string, path: string, body?: unknown, raw?: { type: string; text: string }): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    ...(raw ? { headers: { 'Content-Type': raw.type }, body: raw.text }
      : body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const found = Array.isArray(data?.found) ? (data.found as FoundLine[]).filter(f => f && typeof f.what === 'string' && Number.isInteger(f.line)) : []
    throw new PeopleError(r.status, (data && typeof data.error === 'string' && data.error) || `The server answered ${r.status}.`, found)
  }
  return data as T
}

const ag = (id: string, rest = '') => `/admin/agencies/${encodeURIComponent(id)}${rest}`

export const httpPeopleApi: PeopleApi = {
  list: () => call('GET', '/admin/people'),
  add: body => call('POST', '/admin/people', body),
  rename: (id, name) => call('PATCH', `/admin/people/${encodeURIComponent(id)}`, { name }),
  remove: id => call('DELETE', `/admin/people/${encodeURIComponent(id)}`),
  agencies: async () => {
    const d = await call<AgencyAdminRow[] | { agencies: AgencyAdminRow[] }>('GET', '/admin/agencies')
    return Array.isArray(d) ? d : d.agencies
  },
  createAgency: body => call('POST', '/admin/agencies', body),
  patchDraft: (id, body) => call('PATCH', ag(id, '/draft'), body),
  putWordmark: (id, svg) => call('PUT', ag(id, '/draft/wordmark'), undefined, { type: 'image/svg+xml', text: svg }),
  deleteWordmark: id => call('DELETE', ag(id, '/draft/wordmark')),
  publish: (id, rev) => call('POST', ag(id, '/publish'), { rev }),
  discardDraft: id => call('DELETE', ag(id, '/draft')),
  exportCode: id => call('GET', ag(id, '/export')),
}
