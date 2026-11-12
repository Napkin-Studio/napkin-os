// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Whether the beta notice is open to read again (features/bar-without-beta-chip.clan).
// The account menu's "About this beta" opens it; the bar's DogfoodBadge shows it.

let open = false
const subs = new Set<() => void>()

function set(next: boolean) {
  open = next
  subs.forEach(f => f())
}

export function betaNoticeOpen(): boolean { return open }
export function openBetaNotice() { set(true) }
export function closeBetaNotice() { set(false) }
export function subscribeBetaNotice(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}

/** The account menu's opener: only in a build that records, so the row shows only then. */
export function betaNoticeOpener(on: boolean): (() => void) | undefined {
  return on ? openBetaNotice : undefined
}
