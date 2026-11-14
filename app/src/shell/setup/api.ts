// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The audit view's calls to napkin-web (features/agency-setup.clan; the setup flow's other calls went
// with it in stage 4 of features/align-needs-lock-people.clan). Every one is the signed-in person's own
// agency. A call answers a result, never throws, so a screen can say what happened in its own words.

import { apiBase } from '../../host/http'

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

export type AuditKind = 'approval' | 'export' | 'link' | 'sign-in' | 'permission' | 'settings'
export interface AuditEntry { at: string; who: string; kind: AuditKind; what: string; doc?: string; version?: string; ip?: string }
export const readAudit = () => call<{ total: number; lines: AuditEntry[] }>('audit')
/** What checking the log answers: `ok` only when the server's own chain holds and no line in it was copied from a document
 *  any member could write; `chain_intact` and `not_verified` say which. */
export interface Verified { ok: boolean; lines: number; line?: number; problem?: string; chain_intact?: boolean; not_verified?: number }

/** What a check says, plainly. */
export function verifiedWords(v: Verified): string {
  const n = `${v.lines} saved ${v.lines === 1 ? 'line' : 'lines'} checked.`
  if (v.ok) return `Nothing was changed. ${n}`
  if (v.chain_intact) {
    const c = v.not_verified ?? 0
    return `Nothing was changed. ${n} ${c} ${c === 1 ? 'line was' : 'lines were'} copied from the agency's old list, which anyone in the agency could edit, so ${c === 1 ? 'it is' : 'they are'} not shown or vouched for.`
  }
  return `A saved line was changed${v.line ? ` (line ${v.line})` : ''}. ${v.problem ?? ''}`
}
/** The log's chain: a 409 answers with the first line that breaks it, which is an answer here, not an error. */
export async function verifyAudit(): Promise<Result<Verified>> {
  const r = await call<Verified>('audit/verify')
  if (r.ok) return r
  if (r.status === 409) return { ok: true, data: { ok: false, chain_intact: false, lines: 0, problem: r.message || 'The log was changed.' } }
  return r
}
