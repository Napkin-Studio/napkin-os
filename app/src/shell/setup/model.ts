// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The audit view's words (features/agency-setup.clan; the setup flow's went with it in stage 4 of
// features/align-needs-lock-people.clan). Pure, so it is tested without a browser.

export type AuditFilter = 'all' | 'approval' | 'export' | 'link' | 'sign-in' | 'people'
export const AUDIT_FILTERS: readonly { id: AuditFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'approval', label: 'Approvals' },
  { id: 'export', label: 'Exports' },
  { id: 'link', label: 'Client links' },
  { id: 'people', label: 'People and roles' },
  { id: 'sign-in', label: 'Sign-ins' },
]

/** Which filter a line belongs under: settings and permission changes are one, People and roles. */
export function auditFilterOf(kind: string): AuditFilter {
  return kind === 'permission' || kind === 'settings' ? 'people' : (['approval', 'export', 'link', 'sign-in'].includes(kind) ? (kind as AuditFilter) : 'all')
}

export function auditShown<T extends { kind: string }>(lines: readonly T[], filter: AuditFilter): T[] {
  return filter === 'all' ? [...lines] : lines.filter(l => auditFilterOf(l.kind) === filter)
}

/** `2026-11-12T09:41:02Z` as `12 Nov, 09:41`, in the reader's own time. */
export function whenWords(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  const day = d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day}, ${time}`
}

/** A version hash, short enough to read and long enough to tell two apart: `sha256:a31631...` is `a31631`. */
export function versionWords(v: string | undefined): string | null {
  if (!v) return null
  return v.replace(/^sha256:/, '').slice(0, 8)
}
