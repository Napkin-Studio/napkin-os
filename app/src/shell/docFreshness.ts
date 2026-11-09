// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the open document shows of other documents goes stale when they change
// elsewhere: the link chip, the update notice, and its own name once its app
// renames it (features/spinoff-and-links). The library listing the shell
// already reads every 5 s says when any document changed and what each is
// called now. Pure: no host, no React.

import type { LibraryItem } from '../host'

/** Changes whenever a document other than `docPath` changes: what makes the open one read its links again. */
export function othersStamp(items: readonly LibraryItem[] | null | undefined, docPath: string): string {
  return (items ?? [])
    .filter(i => i.path !== docPath)
    .map(i => `${i.path}@${i.updated_at}`)
    .sort()
    .join('|')
}

/** The open document's name as the library has it now (its app may have renamed it since it opened), or null. */
export function listedTitle(items: readonly LibraryItem[] | null | undefined, docPath: string): string | null {
  const t = (items ?? []).find(i => i.path === docPath)?.title
  return t && t.trim() ? t : null
}

/** When the open document last changed, as the library has it now, or null. */
export function listedUpdated(items: readonly LibraryItem[] | null | undefined, docPath: string): string | null {
  const t = (items ?? []).find(i => i.path === docPath)?.updated_at
  return t && t.trim() ? t : null
}

/** The later of the last change this tab saw kept and the document's own updated_at. */
export function lastSaved(local: Date | null, updatedAt?: string | null): Date | null {
  const t = updatedAt ? Date.parse(updatedAt) : NaN
  const stored = Number.isFinite(t) ? new Date(t) : null
  if (!local) return stored
  if (!stored) return local
  return stored.getTime() > local.getTime() ? stored : local
}

/** "saved just now", "saved 37m ago", "saved 3h ago", "saved 2d ago"; "saved" when the time is not known. */
export function savedWords(at: Date | null, now: number): string {
  if (!at) return 'saved'
  const mins = Math.max(0, Math.floor((now - at.getTime()) / 60_000))
  if (mins < 1) return 'saved just now'
  if (mins < 60) return `saved ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `saved ${hours}h ago`
  return `saved ${Math.floor(hours / 24)}d ago`
}
