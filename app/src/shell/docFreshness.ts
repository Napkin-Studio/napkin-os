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
