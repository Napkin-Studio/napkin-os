// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The document the shell last had open lives in the page's URL (`?open=`) and
// in its history entry, so a reload reopens it. That memory is one person's:
// after a sign-out and someone else's sign-in, the URL still names the first
// person's document, which the second cannot open (404). The history entry
// the shell writes names who opened it; a URL the shell wrote for someone
// else is not reopened, and a document that is gone is let go quietly.

/** The history entry an open document stands on, with whose it is. */
export interface DocEntry { napkinDoc: true; person: string | null }

export const docEntry = (person: string | null): DocEntry => ({ napkinDoc: true, person })

export const isDocEntryState = (state: unknown): state is { napkinDoc: true; person?: string | null } =>
  !!state && typeof state === 'object' && (state as { napkinDoc?: unknown }).napkinDoc === true

/**
 * Whether the `?open=` the page started with is this person's to reopen. A
 * link someone pasted carries no entry of ours and is theirs to try; an entry
 * the shell wrote is reopened only for the person it was written for.
 */
export function launchIsMine(state: unknown, person: string | null): boolean {
  if (!isDocEntryState(state)) return true
  return (state.person ?? null) === person
}

/** A refusal that means the document is not there (or not this person's). */
export const isNotFound = (e: unknown): boolean =>
  /\b404\b|not found|no such (document|file)|unknown document/i.test(String(e instanceof Error ? e.message : e))
