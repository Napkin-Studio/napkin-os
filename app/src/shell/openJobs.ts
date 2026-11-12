// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The open document's running jobs, for its page (features/brief-resumes-running-job.clan).
//
// The app frame is sandboxed without allow-same-origin, so a page cannot keep
// a job id in storage across an open. The host knows each document's
// unsettled job ids (`LibraryItem.jobs`, from its RunTracker); the shell hands
// the open document's to its page as `clan:jobs {jobs: string[]}`, on every
// frame load and whenever the listing changes them. The page polls each one it
// is not already polling, so a run still going when the document is reopened
// resumes, and a finished one lands while the document stays open (the
// landing settler skips the open document: its page polls).

import type { LibraryItem } from '../host'

/** The unsettled job ids of the document at `path` in the listing, in order, deduplicated. */
export function openDocJobs(library: LibraryItem[] | null | undefined, path: string): string[] {
  const item = library?.find(i => i.path === path)
  return [...new Set((item?.jobs ?? []).filter(j => typeof j === 'string' && j !== ''))]
}

/** The message the page hears: the whole list, each time, so a repeated or lost one does no harm. */
export function jobsMessage(jobs: readonly string[]): { type: 'clan:jobs'; jobs: string[] } {
  return { type: 'clan:jobs', jobs: [...jobs] }
}
